// 실제 CSV 폴더로 읽기와 고치기를 점검한다. npm test에는 들어가지 않는다.
// 쓰는 법: npm run compile 뒤에 node tests/check-real-files.js <폴더>
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv, encodeCell, editsFor, applyEdits } = require('../out/csv');

const root = process.argv[2];
if (!root) {
    console.error('쓰는 법: node tests/check-real-files.js <폴더>');
    process.exit(2);
}

// 폴더 아래 .csv, .tsv 파일을 모두 찾는다.
function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git' || e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out);
        else if (/\.(csv|tsv)$/i.test(e.name)) out.push(p);
    }
    return out;
}

const TRICKY = 'x,"y"\nz 한글';
const problems = [];
let cells = 0;
let edits = 0;
let slowest = { ms: 0, file: '' };

for (const file of walk(root, [])) {
    const delimiter = /\.tsv$/i.test(file) ? '\t' : ',';
    // VS Code도 BOM은 빼고 글자를 넘겨준다.
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    const t0 = performance.now();
    const doc = parseCsv(text, delimiter);
    const ms = performance.now() - t0;
    if (ms > slowest.ms) slowest = { ms, file };
    const fail = (msg) => problems.push(`${path.relative(root, file)}: ${msg}`);

    // 1. 행과 셀 위치가 원래 글자를 빈틈없이 덮는지
    let expect = 0;
    for (const row of doc.rows) {
        if (row.start !== expect) fail(`행 시작 위치 어긋남 ${row.start} != ${expect}`);
        const rowText = text.slice(row.start, row.end);
        const rebuilt = [];
        for (let k = 0; k < row.cells.length; k += 2) rebuilt.push(text.slice(row.cells[k], row.cells[k + 1]));
        if (rebuilt.join(delimiter) !== rowText) fail(`셀을 이어 붙인 글자가 행과 다름 (위치 ${row.start})`);
        expect = row.next;
    }
    if (expect !== text.length) fail(`마지막 위치 어긋남 ${expect} != ${text.length}`);

    // 2. 모든 셀 값을 다시 써서 읽으면 같은 값인지
    for (const vals of doc.values) {
        for (const v of vals) {
            cells++;
            const back = parseCsv(encodeCell(v, delimiter) + '\n', delimiter).values[0];
            if (back.length !== 1 || back[0] !== v) fail(`값 되읽기 다름 ${JSON.stringify(v).slice(0, 60)}`);
        }
    }

    // 3. 고르게 고른 셀 하나를 고쳐서, 그 셀 범위 밖 글자는 그대로인지
    const step = Math.max(1, Math.floor(doc.rows.length / 5));
    for (let r = 0; r < doc.rows.length; r += step) {
        const row = doc.rows[r];
        const c = Math.floor((row.cells.length / 2 - 1) / 2);
        const list = editsFor(doc, { kind: 'setCells', cells: [[r, c, TRICKY]] }, delimiter, '\r\n');
        const next = applyEdits(text, list);
        const [e] = list;
        edits++;
        if (list.length !== 1 || next.slice(0, e.start) !== text.slice(0, e.start) || next.slice(e.start + e.text.length) !== text.slice(e.end)) {
            fail(`행 ${r + 1} 열 ${c + 1} 고치기가 다른 글자를 건드림`);
            continue;
        }
        const after = parseCsv(next, delimiter);
        if (after.rows.length !== doc.rows.length || after.values[r][c] !== TRICKY) fail(`행 ${r + 1} 열 ${c + 1} 고친 뒤 다시 읽은 값이 다름`);
    }

    // 4. 두 행에 걸친 여러 셀(행 끝을 넘는 셀 포함)을 한 번에 바꿔서, 나머지 행 글자와 나머지 셀 값이 그대로인지
    for (let r = 0; r + 1 < doc.rows.length; r += step) {
        const width = doc.rows[r].cells.length / 2;
        const cells = [[r, 0, TRICKY], [r, width, 'tail'], [r + 1, 0, '']];
        const next = applyEdits(text, editsFor(doc, { kind: 'setCells', cells }, delimiter, '\r\n'));
        const after = parseCsv(next, delimiter);
        edits++;
        if (after.rows.length !== doc.rows.length) {
            fail(`행 ${r + 1} 여러 셀 고치기 뒤 행 수가 달라짐`);
            continue;
        }
        for (let k = 0; k < doc.rows.length; k++) {
            if (k === r || k === r + 1) continue;
            if (next.slice(after.rows[k].start, after.rows[k].next) !== text.slice(doc.rows[k].start, doc.rows[k].next)) {
                fail(`행 ${r + 1} 여러 셀 고치기가 행 ${k + 1} 글자를 건드림`);
                break;
            }
        }
        const expect = doc.values[r].slice();
        expect[0] = TRICKY;
        expect[width] = 'tail';
        const expect2 = doc.values[r + 1].slice();
        expect2[0] = '';
        if (JSON.stringify(after.values[r]) !== JSON.stringify(expect) || JSON.stringify(after.values[r + 1]) !== JSON.stringify(expect2)) {
            fail(`행 ${r + 1} 여러 셀 고친 뒤 다시 읽은 값이 다름`);
        }
    }
}

console.log(`파일 ${walk(root, []).length}개, 셀 ${cells}개, 고치기 ${edits}번 점검`);
console.log(`가장 오래 걸린 읽기: ${slowest.ms.toFixed(1)}ms (${path.relative(root, slowest.file)})`);
if (problems.length) {
    console.log(`문제 ${problems.length}건`);
    for (const p of problems.slice(0, 30)) console.log(`- ${p}`);
    process.exit(1);
}
console.log('문제 없음');
