const assert = require('node:assert/strict');
const test = require('node:test');
const { sanitizeView } = require('../out/view');

test('기본값뿐이면 저장하지 않는다', () => {
    assert.equal(sanitizeView(undefined), undefined);
    assert.equal(sanitizeView(null), undefined);
    assert.equal(sanitizeView('x'), undefined);
    assert.equal(sanitizeView({ zoom: 1, colW: {}, rowH: {} }), undefined);
});

test('배율은 정해진 단계만 받는다', () => {
    assert.deepEqual(sanitizeView({ zoom: 1.25 }), { zoom: 1.25, colW: {}, rowH: {} });
    assert.equal(sanitizeView({ zoom: 1.3 }), undefined);
    assert.equal(sanitizeView({ zoom: '2' }), undefined);
});

test('크기는 숫자 번호와 범위 안 값만 남기고 반올림한다', () => {
    const v = sanitizeView({ colW: { 0: 120.6, 3: 5, x: 100, 5: 99999, 7: '80' }, rowH: { 2: 40, 9: 1, 10: 400 } });
    assert.deepEqual(v, { zoom: 1, colW: { 0: 121 }, rowH: { 2: 40, 10: 400 } });
});

// 크기 되돌리기 차례 판단. 'text'는 VS Code 글자 되돌리기를 부를 차례라는 뜻이다.
const { recordSizes, takeSizeStep, textPrint, moveSizes, sizesFollow } = require('../out/view');

test('너비 -> 글자 -> 너비 뒤 되돌리기는 너비, 글자, 너비 순서이고 다시 하기는 그 반대다', () => {
    const h = { undo: [], redo: [] };
    let text = 'a,b\n1,2\n';
    const v0 = undefined;
    const v1 = { zoom: 1, colW: { 0: 150 }, rowH: {} };
    const v2 = { zoom: 1, colW: { 0: 150, 1: 90 }, rowH: {} };
    recordSizes(h, v0, v1, textPrint(text)); // 너비 1
    const before = text;
    text = 'a,b\n1,X\n'; // 글자 고침(VS Code가 기록)
    recordSizes(h, v1, v2, textPrint(text)); // 너비 2

    const press = (dir) => {
        const s = takeSizeStep(h, dir, textPrint(text));
        if (s) return dir === 'undo' ? s.before : s.after;
        text = dir === 'undo' ? before : 'a,b\n1,X\n'; // VS Code가 글자를 되돌린 셈
        return 'text';
    };
    assert.deepEqual(press('undo'), { colW: { 0: 150 }, rowH: {} });
    assert.equal(press('undo'), 'text');
    assert.deepEqual(press('undo'), { colW: {}, rowH: {} });
    assert.equal(press('undo'), 'text'); // 더 없으면 VS Code에 맡긴다
    assert.deepEqual(press('redo'), { colW: { 0: 150 }, rowH: {} });
    assert.equal(press('redo'), 'text');
    assert.deepEqual(press('redo'), { colW: { 0: 150, 1: 90 }, rowH: {} });
});

test('배율만 바뀌면 기록하지 않고, 새 크기 바꿈은 다시 하기를 버린다', () => {
    const h = { undo: [], redo: [] };
    recordSizes(h, { zoom: 1, colW: { 2: 80 }, rowH: {} }, { zoom: 1.5, colW: { 2: 80 }, rowH: {} }, 1);
    assert.equal(h.undo.length, 0);
    recordSizes(h, undefined, { zoom: 1, colW: {}, rowH: { 3: 40 } }, 1);
    assert.ok(takeSizeStep(h, 'undo', 1));
    assert.equal(h.redo.length, 1);
    recordSizes(h, undefined, { zoom: 1, colW: { 0: 99 }, rowH: {} }, 1);
    assert.equal(h.redo.length, 0);
});

test('행, 열을 옮기면 크기도 내용을 따라간다', () => {
    const m = { 1: 50, 2: 60, 5: 90, 8: 30 };
    // 2~3번을 7번 앞으로: 2, 3 -> 5, 6 / 4~6번 -> 2~4 / 나머지 그대로
    assert.deepEqual(moveSizes(m, 2, 2, 7), { 1: 50, 5: 60, 3: 90, 8: 30 });
    // 5번을 1번 앞으로: 5 -> 1 / 1~4번 -> 2~5
    assert.deepEqual(moveSizes(m, 5, 1, 1), { 2: 50, 3: 60, 1: 90, 8: 30 });
    // 그대로인 자리
    assert.deepEqual(moveSizes(m, 2, 2, 3), m);
    assert.deepEqual(moveSizes(m, 2, 2, 4), m);
});

test('행, 열을 넣거나 지우면 크기도 내용을 따라간다', () => {
    const m = { 1: 50, 2: 60, 5: 90 };
    const follow = (op) => {
        const f = sizesFollow(op);
        return [f.key, f.shift(m)];
    };
    // 2번 앞에 2개 넣기: 2번부터 2칸 뒤로
    assert.deepEqual(follow({ kind: 'insertRow', at: 2, count: 2 }), ['rowH', { 1: 50, 4: 60, 7: 90 }]);
    assert.deepEqual(follow({ kind: 'insertCol', at: 6 }), ['colW', m]);
    // 빈 파일에서 위에 넣기(at -1)는 0번 앞에 넣기와 같다
    assert.deepEqual(follow({ kind: 'insertRow', at: -1 }), ['rowH', { 2: 50, 3: 60, 6: 90 }]);
    // 2번과 4번 지우기: 2번 크기는 빠지고, 5번은 앞에서 지운 2개만큼 당겨진다
    assert.deepEqual(follow({ kind: 'deleteCol', at: [2, 4] }), ['colW', { 1: 50, 3: 90 }]);
    assert.deepEqual(follow({ kind: 'deleteRow', at: 0 }), ['rowH', { 0: 50, 1: 60, 4: 90 }]);
    assert.deepEqual(follow({ kind: 'moveCols', from: 5, count: 1, to: 0 }), ['colW', { 2: 50, 3: 60, 0: 90 }]);
    assert.equal(sizesFollow({ kind: 'setCells', cells: [] }), undefined);
});

test('옮기기와 묶인 크기 기록은 되돌리기 한 번에 글자와 같이 돌아온다', () => {
    const h = { undo: [], redo: [] };
    const t0 = 1;
    const t1 = 2; // 옮긴 뒤 글자
    recordSizes(h, { zoom: 1, colW: { 0: 80 }, rowH: {} }, { zoom: 1, colW: { 0: 120 }, rowH: {} }, t0); // 너비 바꿈
    recordSizes(h, { zoom: 1, colW: { 0: 120 }, rowH: {} }, { zoom: 1, colW: { 2: 120 }, rowH: {} }, t1, t0); // 옮기기
    // 되돌리기 1: 옮기기(글자도 같이 되돌릴 기록)
    const u1 = takeSizeStep(h, 'undo', t1);
    assert.deepEqual(u1.before.colW, { 0: 120 });
    assert.notEqual(u1.text, u1.textBefore);
    // 되돌리기 2: 글자가 t0으로 돌아온 뒤 너비 바꿈
    assert.deepEqual(takeSizeStep(h, 'undo', t0).before.colW, { 0: 80 });
    // 다시 하기: 너비 바꿈(글자 t0), 그다음 옮기기(글자 t0에서 시작, 글자도 같이 다시 할 기록)
    assert.deepEqual(takeSizeStep(h, 'redo', t0).after.colW, { 0: 120 });
    const r2 = takeSizeStep(h, 'redo', t0);
    assert.deepEqual(r2.after.colW, { 2: 120 });
    assert.equal(takeSizeStep(h, 'undo', t0), undefined); // 글자가 아직 t0이면 옮기기 되돌리기 차례가 아니다
});

test('글자 지문은 글자가 다르면 대개 다르다', () => {
    assert.equal(textPrint('a,b'), textPrint('a,b'));
    assert.notEqual(textPrint('a,b'), textPrint('a,c'));
    assert.notEqual(textPrint(''), textPrint('\n'));
});

test('지우기 번호 매기기는 단순한 방식과 결과가 같다', () => {
    const { deleteSizes } = require('../out/view');
    const naive = (m, gone) => {
        const set = new Set(gone);
        const out = {};
        for (const [k, v] of Object.entries(m)) {
            const i = Number(k);
            if (set.has(i)) continue;
            out[i - [...set].filter((g) => g < i).length] = v;
        }
        return out;
    };
    let seed = 3;
    const rnd = (n) => Math.floor(((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * n);
    for (let k = 0; k < 500; k++) {
        const m = {};
        for (let i = 0; i < rnd(12); i++) m[rnd(30)] = 20 + rnd(100);
        const gone = Array.from({ length: rnd(10) }, () => rnd(30));
        assert.deepEqual(deleteSizes(m, gone), naive(m, gone));
    }
});

test('크기 기록은 오래된 것부터 버려 상한을 넘지 않는다', () => {
    const { sameSizes } = require('../out/view');
    const h = { undo: [], redo: [] };
    for (let i = 0; i < 600; i++) recordSizes(h, { zoom: 1, colW: { 0: 50 + i }, rowH: {} }, { zoom: 1, colW: { 0: 51 + i }, rowH: {} }, 1);
    assert.equal(h.undo.length, 500);
    assert.deepEqual(h.undo[0].after.colW, { 0: 151 });
    assert.equal(sameSizes({ zoom: 2, colW: { 1: 9 }, rowH: {} }, { zoom: 1, colW: { 1: 9 }, rowH: {} }), true);
    assert.equal(sameSizes(undefined, { zoom: 1, colW: {}, rowH: {} }), true);
    assert.equal(sameSizes(undefined, { zoom: 1, colW: { 0: 30 }, rowH: {} }), false);
});
