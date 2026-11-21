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
