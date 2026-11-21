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

test('여러 행 넣기와 지우기(고른 행이 여러 개일 때)', () => {
    assert.equal(run('a\nb\n', { kind: 'insertRow', at: 1, count: 3 }), 'a\n\n\n\nb\n');
    assert.equal(run('a,b\r\nc,d', { kind: 'insertRow', at: 2, count: 2 }, ',', '\r\n'), 'a,b\r\nc,d\r\n,\r\n,');
    // 이어진 행, 이어지지 않은 행, 범위 밖 번호, 같은 번호 두 번
    assert.equal(run('a\nb\nc\nd\ne\n', { kind: 'deleteRow', at: [1, 2] }), 'a\nd\ne\n');
    assert.equal(run('a\nb\nc\nd\ne\n', { kind: 'deleteRow', at: [4, 0, 2, 2, 9] }), 'b\nd\n');
    // 줄바꿈 없는 마지막 행까지 묶어 지우면 앞 행의 줄바꿈부터 지운다.
    assert.equal(run('a\nb\nc', { kind: 'deleteRow', at: [1, 2] }), 'a');
    assert.equal(run('a\nb\nc', { kind: 'deleteRow', at: [0, 2] }), 'b');
    assert.equal(run('a\nb\nc', { kind: 'deleteRow', at: [0, 1, 2] }), '');
});

test('여러 열 넣기와 지우기(행마다 셀 수가 달라도)', () => {
    const text = 'a,b,c,d\n1,2\n';
    assert.equal(run(text, { kind: 'insertCol', at: 1, count: 2 }), 'a,,,b,c,d\n1,,,2\n');
    assert.equal(run(text, { kind: 'deleteCol', at: [1, 2] }), 'a,d\n1\n');
    assert.equal(run(text, { kind: 'deleteCol', at: [0, 2] }), 'b,d\n2\n');
    // 마지막 열까지 묶어 지우면 앞의 나눔 글자부터 지운다.
    assert.equal(run(text, { kind: 'deleteCol', at: [2, 3] }), 'a,b\n1,2\n');
    assert.equal(run(text, { kind: 'deleteCol', at: [1, 3] }), 'a,c\n1\n');
    // 셀을 모두 지우면 빈 행이 남는다.
    assert.equal(run(text, { kind: 'deleteCol', at: [0, 1, 2, 3] }), '\n\n');
    assert.equal(run('"x,y",b,c\n', { kind: 'deleteCol', at: [0, 1] }), 'c\n');
});

test('행 옮기기는 행 글자를 그대로 옮기고 줄바꿈 자리는 둔다', () => {
    const text = 'h\na\nb\nc\nd\n';
    assert.equal(run(text, { kind: 'moveRows', from: 3, count: 2, to: 1 }), 'h\nc\nd\na\nb\n');
    assert.equal(run(text, { kind: 'moveRows', from: 1, count: 1, to: 5 }), 'h\nb\nc\nd\na\n');
    assert.equal(run(text, { kind: 'moveRows', from: 1, count: 2, to: 4 }), 'h\nc\na\nb\nd\n');
    // 묶음 안이나 바로 뒤, 범위 밖은 그대로
    assert.equal(run(text, { kind: 'moveRows', from: 1, count: 2, to: 3 }), text);
    assert.equal(run(text, { kind: 'moveRows', from: 1, count: 2, to: 2 }), text);
    assert.equal(run(text, { kind: 'moveRows', from: 4, count: 2, to: 0 }), text);
    // 줄바꿈 없는 마지막 행, CRLF, 셀 안 줄바꿈과 따옴표는 원래 글자 그대로
    assert.equal(run('a\r\nb\r\nc', { kind: 'moveRows', from: 2, count: 1, to: 0 }), 'c\r\na\r\nb');
    assert.equal(run('a\r\nb\r\nc', { kind: 'moveRows', from: 0, count: 1, to: 3 }), 'b\r\nc\r\na');
    assert.equal(run('x,"p\nq"\n"y",z\n', { kind: 'moveRows', from: 1, count: 1, to: 0 }), '"y",z\nx,"p\nq"\n');
});

test('열 옮기기는 행마다 셀 글자를 그대로 옮긴다(셀 수가 달라도)', () => {
    assert.equal(run('a,b,c,d\n1,2,3,4\n', { kind: 'moveCols', from: 2, count: 2, to: 0 }), 'c,d,a,b\n3,4,1,2\n');
    assert.equal(run('a,"b,x",c\n', { kind: 'moveCols', from: 0, count: 1, to: 3 }), '"b,x",c,a\n');
    // 셀이 모자란 행: 없는 칸은 빈 값이다. 빈 값만 밀려나면 칸을 늘리지 않고, 값이 없던 칸으로 가면 칸을 늘린다.
    assert.equal(run('a,b,c,d\n1,2\n', { kind: 'moveCols', from: 3, count: 1, to: 0 }), 'd,a,b,c\n,1,2\n');
    assert.equal(run('a,b,c,d\n1,2\n', { kind: 'moveCols', from: 0, count: 1, to: 4 }), 'b,c,d,a\n2,,,1\n');
    assert.equal(run('a,b,c,d\n1\n', { kind: 'moveCols', from: 2, count: 1, to: 1 }), 'a,c,b,d\n1\n');
    assert.equal(run('a,b\n', { kind: 'moveCols', from: 0, count: 1, to: 1 }), 'a,b\n');
});

test('줄바꿈 없는 마지막 행이 빈 행이 되어도 사라지지 않는다', () => {
    const rowsOf = (text) => values(text).length;
    // 셀 하나짜리 마지막 행 비우기(Delete, 빈 값 붙여 넣기)
    assert.equal(run('name\nAAA\nBBB', set(2, 0, '')), 'name\nAAA\n\n');
    assert.equal(rowsOf(run('name\nAAA\nBBB', set(2, 0, ''))), 3);
    assert.equal(run('a', set(0, 0, '')), '\n');
    // 비우면서 뒤에 행을 더 붙이면 줄바꿈은 한 번만
    assert.deepEqual(values(run('a\nb', { kind: 'setCells', cells: [[1, 0, ''], [2, 0, 'c']] })), [['a'], [''], ['c']]);
    // 빈 줄 뒤의 마지막 행 지우기
    assert.equal(run('a\n\nc', { kind: 'deleteRow', at: 2 }), 'a\n\n');
    assert.deepEqual(values(run('a\n\n\nd', { kind: 'deleteRow', at: 3 })), [['a'], [''], ['']]);
    // 빈 줄을 맨 끝으로 옮기기, 마지막 행을 맨 위로 옮기기
    assert.deepEqual(values(run('a\n\nc', { kind: 'moveRows', from: 1, count: 1, to: 3 })), [['a'], ['c'], ['']]);
    assert.deepEqual(values(run('a\n\nc', { kind: 'moveRows', from: 2, count: 1, to: 0 })), [['c'], ['a'], ['']]);
    // 열 지우기로 셀 하나뿐인 마지막 행이 빔, 모든 열 지우기, 남은 셀 하나가 빈 값
    assert.deepEqual(values(run('a,b\nc', { kind: 'deleteCol', at: 0 })), [['b'], ['']]);
    assert.deepEqual(values(run('a,b\nc,d', { kind: 'deleteCol', at: [0, 1] })), [[''], ['']]);
    assert.deepEqual(values(run('a,b\nx,', { kind: 'deleteCol', at: 0 })), [['b'], ['']]);
    // 줄바꿈이 있는 파일은 예전과 같다
    assert.equal(run('name\nAAA\nBBB\n', set(2, 0, '')), 'name\nAAA\n\n');
});

test('표 화면이 보낸 작업은 모양이 맞을 때만 받는다', () => {
    const { validOp } = require('../out/csv');
    const good = [
        { kind: 'setCells', cells: [[0, 1, 'x'], [2, 3, 'y', 'old']] },
        { kind: 'paste', row: 1, col: 0, text: 'a\tb', fill: [[1, 0, 2, 1]] },
        { kind: 'insertRow', at: -1 },
        { kind: 'insertCol', at: 3, count: 2 },
        { kind: 'deleteRow', at: [1, 5] },
        { kind: 'deleteCol', at: 0 },
        { kind: 'moveRows', from: 2, count: 3, to: 0 },
    ];
    for (const op of good) assert.equal(validOp(op), op, JSON.stringify(op));
    const bad = [
        null,
        'x',
        { kind: 'nope' },
        { kind: 'insertRow', at: Number.NaN },
        { kind: 'insertRow', at: 1, count: 1.5 },
        { kind: 'insertRow', at: -2 },
        { kind: 'paste', row: '1', col: 0, text: 'a' },
        { kind: 'setCells', cells: [[2000000000, 0, 'x']] },
        { kind: 'setCells', cells: [[0, 0, 5]] },
        { kind: 'deleteRow', at: [1, -1] },
        { kind: 'moveCols', from: 0, count: 0, to: 2 },
        { kind: 'paste', row: 0, col: 0, text: 'a', fill: [[2, 0, 1, 0]] },
    ];
    for (const op of bad) assert.equal(validOp(op), undefined, JSON.stringify(op));
});

test('셀의 바꾸기 전 값이 지금 파일과 다르면 오래된 작업이다', () => {
    const { staleCells } = require('../out/csv');
    const doc = parseCsv('a,b\nc,d\n', ',');
    assert.equal(staleCells(doc, [[1, 0, 'x', 'c']]), false);
    assert.equal(staleCells(doc, [[1, 0, 'x']]), false);
    assert.equal(staleCells(doc, [[1, 0, 'x', 'b']]), true);
    // 표 밖 셀의 바꾸기 전 값은 빈 값이다
    assert.equal(staleCells(doc, [[5, 0, 'x', '']]), false);
});

test('달라진 행 구간만 찾는다', () => {
    const { rowsSplice } = require('../out/csv');
    const apply = (prev, s) => prev.slice(0, s.start).concat(s.rows, prev.slice(s.start + s.del));
    const check = (prev, next, expect) => {
        const s = rowsSplice(prev, next);
        assert.deepEqual(apply(prev, s), next);
        if (expect) assert.deepEqual([s.start, s.del, s.rows.length], expect);
    };
    const t = [['h'], ['a'], ['b'], ['c']];
    check(t, t, [4, 0, 0]);
    check(t, [['h'], ['a'], ['X'], ['c']], [2, 1, 1]);
    check(t, [['h'], ['a'], ['n'], ['b'], ['c']], [2, 0, 1]);
    check(t, [['h'], ['b'], ['c']], [1, 1, 0]);
    check(t, [], [0, 4, 0]);
    check([], t, [0, 0, 4]);
    check([['x'], ['x'], ['x']], [['x'], ['x']], [2, 1, 0]);
    check([['a', '']], [['a']], [0, 1, 1]);
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const table = () => Array.from({ length: Math.floor(rnd() * 6) }, () => [String(Math.floor(rnd() * 3))]);
    for (let k = 0; k < 2000; k++) check(table(), table());
});

test('시험용 applyEdits는 VS Code처럼 겹치는 바꾸기를 거절한다', () => {
    assert.throws(() => applyEdits('abcdef', [{ start: 1, end: 4, text: 'x' }, { start: 3, end: 5, text: 'y' }]), /Overlapping/);
    assert.equal(applyEdits('abc', [{ start: 1, end: 1, text: 'x' }, { start: 1, end: 2, text: 'y' }]), 'axyc');
});

test('파일 끝까지 닫히지 않은 따옴표를 알려 준다', () => {
    assert.equal(parseCsv('"open\ntail', ',').openQuote, true);
    assert.equal(parseCsv('"a",b\n', ',').openQuote, false);
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
