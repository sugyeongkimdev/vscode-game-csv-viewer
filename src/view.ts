// 표 화면의 보기 설정(배율, 사용자가 바꾼 열 너비와 행 높이). 파일마다 확장 저장소(globalState)에 기억한다.
// 표 화면(table.ts)이 보낸 값은 믿지 않고 여기서 검사한 뒤 저장한다. vscode에 기대지 않아 node 시험으로 확인한다.

import type { CsvOp } from './csv';

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

// 열 너비, 행 높이 되돌리기(2026-11-21 "너비 수정 -> 글자 수정 -> 너비 수정 뒤 Ctrl+Z하면 글자 수정이 되돌아간다").
// 글자 되돌리기는 VS Code가 들고 있어서 순서를 섞을 수 없다. 그래서 크기를 바꿀 때 그때 글자의 지문을 같이 적어 두고,
// Ctrl+Z 때 지문이 지금 글자와 같으면 크기 차례, 다르면 그 뒤에 글자가 바뀐 것이므로 VS Code 차례로 본다.
// shortcut: 글자를 고쳤다가 똑같이 되돌려 쓰면(x 쓰고 지우기) 지문이 같아져 크기가 먼저 되돌아간다. 거슬리면 글자 쪽 판 번호로 센다.

type Sizes = Pick<ViewSettings, 'colW' | 'rowH'>;

/** 크기를 바꾼 한 번. 되돌리면 before, 다시 하면 after가 된다. */
export interface SizeStep {
    before: Sizes;
    after: Sizes;
    /** 크기가 after일 때 파일 글자의 지문(textPrint) */
    text: number;
    /** 크기가 before일 때 파일 글자의 지문. 행, 열 옮기기처럼 글자와 같이 바뀐 크기면 text와 다르고, 되돌릴 때 글자도 같이 되돌린다 */
    textBefore: number;
}

/** 파일 하나의 크기 되돌리기 기록 */
export interface SizeHistory {
    undo: SizeStep[];
    redo: SizeStep[];
}

/** 표 화면이 보기 설정을 보낼 때 부른다. 열 너비나 행 높이가 바뀌었으면 기록에 넣는다. 배율만 바뀐 것은 넣지 않는다. */
export function recordSizes(h: SizeHistory, before: ViewSettings | undefined, after: ViewSettings | undefined, text: number, textBefore = text): void {
    const b = { colW: before?.colW ?? {}, rowH: before?.rowH ?? {} };
    const a = { colW: after?.colW ?? {}, rowH: after?.rowH ?? {} };
    if (JSON.stringify(b) === JSON.stringify(a)) return;
    h.undo.push({ before: b, after: a, text, textBefore });
    h.redo.length = 0;
}

/**
 * Ctrl+Z(undo)나 Ctrl+Y(redo)가 크기 차례인지 본다. 크기 차례면 그 기록을 반대쪽으로 옮겨 돌려주고,
 * 글자 차례면 undefined(VS Code 되돌리기에 맡긴다).
 */
export function takeSizeStep(h: SizeHistory, dir: 'undo' | 'redo', text: number): SizeStep | undefined {
    const [from, to] = dir === 'undo' ? [h.undo, h.redo] : [h.redo, h.undo];
    const step = from[from.length - 1];
    // 되돌리기는 크기가 after인 글자, 다시 하기는 크기가 before인 글자에서만 크기 차례다.
    if (!step || (dir === 'undo' ? step.text : step.textBefore) !== text) return undefined;
    to.push(step);
    from.pop();
    return step;
}

/**
 * 행(열) 옮기기(csv.ts의 moveRows, moveCols와 같은 from, count, to)를 번호 → 크기 표에 반영해, 사용자가 바꾼 크기가
 * 내용을 따라가게 한다(2026-11-21 "이동 시 행이나 열 넓이도 같이 가야지"). 옮겨도 그대로인 자리면 그대로 돌려준다.
 */
export function moveSizes(m: Record<string, number>, from: number, count: number, to: number): Record<string, number> {
    const end = from + count;
    if (count < 1 || (to >= from && to <= end)) return m;
    const at = to < from ? to : to - count;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
        const i = Number(k);
        let j = i;
        if (i >= from && i < end) j = at + (i - from);
        else if (to < from && i >= to && i < from) j = i + count;
        else if (to > end && i >= end && i < to) j = i - count;
        out[j] = v;
    }
    return out;
}

/** at 앞에 count개를 넣으면 at 이상 번호의 크기가 count만큼 뒤로 밀린다. */
export function insertSizes(m: Record<string, number>, at: number, count: number): Record<string, number> {
    const from = Math.max(at, 0);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) out[Number(k) >= from ? Number(k) + count : Number(k)] = v;
    return out;
}

/** 번호들을 지우면 그 크기는 빠지고, 뒤 번호의 크기는 앞에서 지운 개수만큼 당겨진다. */
export function deleteSizes(m: Record<string, number>, gone: number[]): Record<string, number> {
    const set = new Set(gone);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(m)) {
        const i = Number(k);
        if (set.has(i)) continue;
        let before = 0;
        for (const g of set) if (g < i) before++;
        out[i - before] = v;
    }
    return out;
}

/**
 * 행, 열 넣기, 지우기, 옮기기 뒤에 사용자가 바꾼 크기가 내용을 따라가게 하는 방법. 행 작업이면 rowH, 열 작업이면 colW를 바꾼다
 * (2026-11-21 "이동 시 넓이도 같이 가야지", 이어서 넣기, 지우기도 맞추기). 크기와 상관없는 작업이면 undefined.
 */
export function sizesFollow(op: CsvOp): { key: 'rowH' | 'colW'; shift: (m: Record<string, number>) => Record<string, number> } | undefined {
    switch (op.kind) {
        case 'insertRow':
        case 'insertCol':
            return { key: op.kind === 'insertRow' ? 'rowH' : 'colW', shift: (m) => insertSizes(m, op.at, Math.max(op.count ?? 1, 1)) };
        case 'deleteRow':
        case 'deleteCol':
            return { key: op.kind === 'deleteRow' ? 'rowH' : 'colW', shift: (m) => deleteSizes(m, Array.isArray(op.at) ? op.at : [op.at]) };
        case 'moveRows':
        case 'moveCols':
            return { key: op.kind === 'moveRows' ? 'rowH' : 'colW', shift: (m) => moveSizes(m, op.from, op.count, op.to) };
        default:
            return undefined;
    }
}

/** 파일 글자의 지문(FNV-1a 32비트). 큰 파일 글자를 기록마다 들고 있지 않으려고 이것만 적는다. */
export function textPrint(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    return h >>> 0;
}
