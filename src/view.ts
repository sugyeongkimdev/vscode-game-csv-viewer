// 표 화면의 보기 설정(배율, 사용자가 바꾼 열 너비와 행 높이). 파일마다 확장 저장소(globalState)에 기억한다.
// 표 화면(table.ts)이 보낸 값은 믿지 않고 여기서 검사한 뒤 저장한다. vscode에 기대지 않아 node 시험으로 확인한다.

/** 배율 단계. table.ts의 ZOOMS와 같아야 한다. */
export const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** 열 너비, 행 높이의 범위(배율 100% 기준 px). table.ts의 같은 이름 값과 같아야 한다. */
export const COL_W_MIN = 20;
export const COL_W_MAX = 2000;
export const ROW_H_MIN = 12;
export const ROW_H_MAX = 400;
/** 너무 많은 값이 쌓이지 않게 열, 행마다 기억하는 개수 상한 */
const MAX_ENTRIES = 100000;

export interface ViewSettings {
    zoom: number;
    /** 열 번호 → 너비 */
    colW: Record<string, number>;
    /** 행 번호 → 높이 */
    rowH: Record<string, number>;
}

/** 번호 → 크기 표에서 번호가 숫자이고 크기가 범위 안인 것만 남긴다. */
function sizes(m: unknown, lo: number, hi: number): Record<string, number> {
    const out: Record<string, number> = {};
    if (!m || typeof m !== 'object') return out;
    let n = 0;
    for (const [k, v] of Object.entries(m)) {
        if (n >= MAX_ENTRIES) break;
        if (!/^\d{1,7}$/.test(k) || typeof v !== 'number' || !(v >= lo && v <= hi)) continue;
        out[k] = Math.round(v);
        n++;
    }
    return out;
}

/**
 * 보기 설정을 검사해 저장할 모양으로 만든다. 이상한 값은 버린다.
 * 모두 기본값(배율 100%, 바꾼 크기 없음)이면 저장할 것이 없으므로 undefined를 돌려준다.
 */
export function sanitizeView(v: unknown): ViewSettings | undefined {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    const zoom = typeof o.zoom === 'number' && ZOOMS.includes(o.zoom) ? o.zoom : 1;
    const colW = sizes(o.colW, COL_W_MIN, COL_W_MAX);
    const rowH = sizes(o.rowH, ROW_H_MIN, ROW_H_MAX);
    if (zoom === 1 && !Object.keys(colW).length && !Object.keys(rowH).length) return undefined;
    return { zoom, colW, rowH };
}
