const assert = require('node:assert/strict');
const test = require('node:test');
const { parseCsv, encodeCell, editsFor, applyEdits, pasteCells } = require('../out/csv');
const { pickLang, uiText } = require('../out/i18n');

// 작업 하나를 적용한 결과 글자를 돌려준다.
const run = (text, op, delimiter = ',', eol = '\n') => applyEdits(text, editsFor(parseCsv(text, delimiter), op, delimiter, eol));
const values = (text, delimiter = ',') => parseCsv(text, delimiter).values;
const set = (row, col, value) => ({ kind: 'setCells', cells: [[row, col, value]] });

test('따옴표, 셀 안 줄바꿈, 따옴표 두 개를 읽는다', () => {
    assert.deepEqual(values('a,"b,c","say ""hi""","x\r\ny"\r\n1,2,3,4\r\n'), [
        ['a', 'b,c', 'say "hi"', 'x\r\ny'],
        ['1', '2', '3', '4'],
    ]);
});

test('맨 끝 줄바꿈은 행을 만들지 않고, 가운데 빈 줄은 행으로 센다', () => {
    assert.deepEqual(values('a\n\nb\n'), [['a'], [''], ['b']]);
    assert.deepEqual(values(''), []);
    assert.deepEqual(values('a,'), [['a', '']]);
});

test('셀 위치가 원래 글자를 빈틈없이 덮는다', () => {
    const text = 'a,"b\n""c",\r\n\r\nx,y';
    const { rows } = parseCsv(text, ',');
    assert.equal(rows[0].start, 0);
    assert.equal(rows[rows.length - 1].next, text.length);
    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (r > 0) assert.equal(row.start, rows[r - 1].next);
        assert.equal(row.cells[0], row.start);
        assert.equal(row.cells[row.cells.length - 1], row.end);
        for (let k = 2; k < row.cells.length; k += 2) assert.equal(row.cells[k], row.cells[k - 1] + 1);
    }
});

test('따옴표는 꼭 필요할 때만 붙인다', () => {
    assert.equal(encodeCell('plain', ','), 'plain');
    assert.equal(encodeCell('a,b', ','), '"a,b"');
    assert.equal(encodeCell('a,b', '\t'), 'a,b');
    assert.equal(encodeCell('say "hi"', ','), '"say ""hi"""');
    assert.equal(encodeCell('x\ny', ','), '"x\ny"');
});

test('셀 하나를 고치면 그 셀 글자만 바뀐다', () => {
    const text = '"a",b,c\r\n1,"2",3\r\n';
    assert.equal(run(text, set(1, 2, 'x,y')), '"a",b,c\r\n1,"2","x,y"\r\n');
    assert.equal(run(text, set(0, 0, 'z')), 'z,b,c\r\n1,"2",3\r\n');
    assert.equal(run(text, set(0, 1, 'b')), text);
});

test('열이 모자란 행은 나눔 글자를 채운다', () => {
    assert.equal(run('a,b,c\nx\n', set(1, 2, 'z')), 'a,b,c\nx,,z\n');
    assert.equal(run('a,b,c\nx\n', set(1, 2, '')), 'a,b,c\nx\n');
});

test('여러 셀을 한 번에 바꾼다', () => {
    const op = { kind: 'setCells', cells: [[0, 0, 'A'], [0, 2, 'C'], [1, 1, ''], [1, 3, 'D']] };
    assert.equal(run('a,b,c\n1,2,3\n', op), 'A,b,C\n1,,3,D\n');
    // 같은 셀이 두 번 오면 마지막 값을 쓴다.
    assert.equal(run('a,b\n', { kind: 'setCells', cells: [[0, 1, 'x'], [0, 1, 'y']] }), 'a,y\n');
    // 맨 끝 셀을 바꾸면서 그 뒤에 열을 늘려도 서로 겹치지 않는다. 맨 끝 셀이 비어 있어도 순서가 지켜진다.
    assert.equal(run('a,b\n', { kind: 'setCells', cells: [[0, 1, 'B'], [0, 3, 'D']] }), 'a,B,,D\n');
    assert.equal(run('a,\n', { kind: 'setCells', cells: [[0, 1, 'p'], [0, 2, 'q']] }), 'a,p,q\n');
    assert.equal(run('a,\n', { kind: 'setCells', cells: [[0, 2, 'q'], [0, 1, 'p']] }), 'a,p,q\n');
});

test('파일 끝을 넘는 행은 늘린다', () => {
    assert.equal(run('a,b\n', { kind: 'setCells', cells: [[2, 1, 'z']] }), 'a,b\n,\n,z\n');
    assert.equal(run('a,b', { kind: 'setCells', cells: [[1, 0, 'x']] }), 'a,b\nx,');
    assert.equal(run('a,b\r\n', { kind: 'setCells', cells: [[1, 3, 'w']] }, ',', '\r\n'), 'a,b\r\n,,,w\r\n');
    assert.equal(run('', { kind: 'setCells', cells: [[0, 1, 'q']] }), ',q\n');
    // 줄바꿈 없는 마지막 행 끝을 늘리면서 새 행도 붙일 때 순서가 지켜진다.
    assert.equal(run('a,b', { kind: 'setCells', cells: [[1, 0, 'x'], [0, 2, 'c']] }), 'a,b,c\nx,');
    assert.equal(run('a,', { kind: 'setCells', cells: [[1, 0, 'x'], [0, 1, 'b']] }), 'a,b\nx,');
    // 열이 하나뿐인 표에서 맨 끝에 빈 행이 생겨도 사라지지 않는다.
    assert.deepEqual(values(run('a', { kind: 'setCells', cells: [[2, 0, '']] })), [['a'], [''], ['']]);
});

test('붙여 넣기는 탭과 줄바꿈으로 나눠 지금 셀부터 채운다', () => {
    assert.deepEqual(pasteCells('1\t2\r\n3\t4\r\n', 5, 1), [[5, 1, '1'], [5, 2, '2'], [6, 1, '3'], [6, 2, '4']]);
    // 구글 시트는 줄바꿈이 있는 셀을 큰따옴표로 감싸 보낸다.
    assert.deepEqual(pasteCells('"a\nb"\tc', 0, 0), [[0, 0, 'a\nb'], [0, 1, 'c']]);
    assert.deepEqual(pasteCells('', 0, 0), []);
    assert.equal(run('a,b,c\n1,2,3\n', { kind: 'paste', row: 1, col: 1, text: 'x\ty,z\nw' }), 'a,b,c\n1,x,"y,z"\n,w,\n');
});

test('값 하나를 여러 셀에 붙이면 고른 셀을 모두 채운다', () => {
    const fill = [[0, 0, 1, 0], [0, 2, 0, 2]];
    assert.deepEqual(pasteCells('v', 0, 0, fill), [[0, 0, 'v'], [1, 0, 'v'], [0, 2, 'v']]);
    // 고른 셀이 하나면 그 셀에만 붙인다.
    assert.deepEqual(pasteCells('v', 3, 4, [[3, 4, 3, 4]]), [[3, 4, 'v']]);
    assert.equal(run('a,b,c\n1,2,3\n', { kind: 'paste', row: 0, col: 0, text: 'v\r\n', fill }), 'v,b,v\nv,2,3\n');
});

test('행 삽입은 줄끝 모양을 지킨다', () => {
    assert.equal(run('a,b\r\nc,d\r\n', { kind: 'insertRow', at: 1 }, ',', '\r\n'), 'a,b\r\n,\r\nc,d\r\n');
    assert.equal(run('a,b\r\nc,d\r\n', { kind: 'insertRow', at: 2 }, ',', '\r\n'), 'a,b\r\nc,d\r\n,\r\n');
    assert.equal(run('a,b\nc,d', { kind: 'insertRow', at: 2 }), 'a,b\nc,d\n,');
    assert.equal(run('', { kind: 'insertRow', at: 0 }), '\n');
    // 열이 하나뿐인 표도 맨 끝에 넣은 행이 사라지지 않는다.
    assert.deepEqual(values(run('a', { kind: 'insertRow', at: 1 })), [['a'], ['']]);
});

test('행 삭제는 빈 줄을 남기지 않는다', () => {
    assert.equal(run('a\nb\nc\n', { kind: 'deleteRow', at: 1 }), 'a\nc\n');
    assert.equal(run('a\nb', { kind: 'deleteRow', at: 1 }), 'a');
    assert.equal(run('a\nb', { kind: 'deleteRow', at: 0 }), 'b');
    assert.equal(run('a', { kind: 'deleteRow', at: 0 }), '');
    assert.equal(run('a', { kind: 'deleteRow', at: 5 }), 'a');
});

test('열 삽입과 삭제', () => {
    const text = 'a,b,c\n1,2\n';
    assert.equal(run(text, { kind: 'insertCol', at: 0 }), ',a,b,c\n,1,2\n');
    assert.equal(run(text, { kind: 'insertCol', at: 2 }), 'a,b,,c\n1,2,\n');
    assert.equal(run(text, { kind: 'insertCol', at: 3 }), 'a,b,c,\n1,2\n');
    assert.equal(run(text, { kind: 'deleteCol', at: 0 }), 'b,c\n2\n');
    assert.equal(run(text, { kind: 'deleteCol', at: 1 }), 'a,c\n1\n');
    assert.equal(run(text, { kind: 'deleteCol', at: 2 }), 'a,b\n1,2\n');
    assert.equal(run('"x,y",b\n', { kind: 'deleteCol', at: 0 }), 'b\n');
});

test('TSV는 탭으로 나눈다', () => {
    assert.deepEqual(values('a\tb,c\n', '\t'), [['a', 'b,c']]);
    assert.equal(run('a\tb\n', set(0, 1, 'x\ty'), '\t'), 'a\t"x\ty"\n');
});

test('어떤 값을 써도 다시 읽으면 같은 값이 나온다', () => {
    const samples = ['', ' ', '"', '""', ',', '\n', '\r\n', 'a"b', '"a', 'a,b\nc', '한글,번體', '\t'];
    for (const delimiter of [',', '\t']) {
        for (const v of samples) {
            const text = `x${delimiter}${encodeCell(v, delimiter)}${delimiter}y\n`;
            assert.deepEqual(values(text, delimiter), [['x', v, 'y']], JSON.stringify({ v, delimiter }));
        }
    }
});

test('언어는 설정이 먼저이고, 자동이면 VS Code 표시 언어가 한국어일 때만 한국어다', () => {
    assert.equal(pickLang('auto', 'ko'), 'ko');
    assert.equal(pickLang('auto', 'ko-KR'), 'ko');
    assert.equal(pickLang('auto', 'en-US'), 'en');
    assert.equal(pickLang('auto', 'zh-tw'), 'en');
    assert.equal(pickLang('auto', undefined), 'en');
    assert.equal(pickLang(undefined, 'ko'), 'ko');
    assert.equal(pickLang('en', 'ko'), 'en');
    assert.equal(pickLang('ko', 'en'), 'ko');
});

test('영어와 한국어 글자 목록의 항목이 같다', () => {
    assert.deepEqual(Object.keys(uiText('ko')).sort(), Object.keys(uiText('en')).sort());
    for (const v of Object.values(uiText('ko'))) assert.ok(v.length > 0);
});
