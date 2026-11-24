// CSV 글자를 읽고, 표에서 고친 내용을 "파일의 어느 글자 자리를 무엇으로 바꿀지" 목록으로 바꾼다.
// vscode에 기대지 않는 순수 함수라 node 시험으로 바로 확인할 수 있다.

export interface CsvRow {
    /** 행 내용이 시작하는 글자 위치 */
    start: number;
    /** 행 내용이 끝나는 위치(줄바꿈 앞) */
    end: number;
    /** 다음 행이 시작하는 위치(줄바꿈 뒤). 줄바꿈 없는 마지막 행이면 end와 같다 */
    next: number;
    /** 셀마다 [시작, 끝] 위치를 차례로 담는다. 따옴표까지 포함한 원래 글자 범위다 */
    cells: number[];
}

export interface CsvDoc {
    rows: CsvRow[];
    values: string[][];
    /** 읽은 원래 글자. 행, 열을 옮길 때 셀 글자를 따옴표 모양 그대로 옮기려고 둔다 */
    text: string;
    /** 파일 끝까지 닫히지 않은 따옴표가 있는지. 그러면 끝에 붙인 행, 열이 그 셀 안으로 들어간다(규칙에서 벗어난 파일) */
    openQuote: boolean;
}

export interface TextEdit {
    start: number;
    end: number;
    text: string;
}

/** 셀 하나: [행, 열, 값] */
/** 셀 하나: [행, 열, 값, 바꾸기 전 값]. 바꾸기 전 값이 있으면 확장은 지금 파일의 그 셀이 그 값일 때만 바꾼다(staleCells). */
export type Cell = [row: number, col: number, value: string, old?: string];
/** 네모 범위: [첫 행, 첫 열, 끝 행, 끝 열] */
export type Rect = [r1: number, c1: number, r2: number, c2: number];

export type CsvOp =
    | { kind: 'setCells'; cells: Cell[] }
    | { kind: 'paste'; row: number; col: number; text: string; fill?: Rect[] }
    /** at 앞에 빈 행(열)을 count개(없으면 1개) 넣는다. */
    | { kind: 'insertRow' | 'insertCol'; at: number; count?: number }
    /** at의 행(열)을 지운다. 여러 개면 이어지지 않아도 된다. */
    | { kind: 'deleteRow' | 'deleteCol'; at: number | number[] }
    /** from부터 count개 행(열)을 to 앞으로 옮긴다. to는 옮기기 전 번호다. 묶음 안이나 바로 뒤면 그대로다. */
    | { kind: 'moveRows' | 'moveCols'; from: number; count: number; to: number };

const QUOTE = 34;
const LF = 10;
const CR = 13;

export function parseCsv(text: string, delimiter: string): CsvDoc {
    const d = delimiter.charCodeAt(0);
    const n = text.length;
    const rows: CsvRow[] = [];
    const values: string[][] = [];
    let openQuote = false;
    // 셀 끝(나눔 글자나 줄바꿈)까지 i를 옮긴다.
    const toCellEnd = (i: number): number => {
        while (i < n) {
            const ch = text.charCodeAt(i);
            if (ch === d || ch === LF || ch === CR) break;
            i++;
        }
        return i;
    };
    let i = 0;
    while (i < n) {
        const start = i;
        const cells: number[] = [];
        const vals: string[] = [];
        for (;;) {
            const cellStart = i;
            let value: string;
            if (text.charCodeAt(i) === QUOTE) {
                value = '';
                let seg = ++i;
                for (;;) {
                    const q = text.indexOf('"', i);
                    if (q < 0) {
                        // 닫는 따옴표가 없으면 파일 끝까지 한 셀로 본다.
                        value += text.slice(seg);
                        i = n;
                        openQuote = true;
                        break;
                    }
                    if (text.charCodeAt(q + 1) === QUOTE) {
                        value += text.slice(seg, q + 1);
                        i = seg = q + 2;
                        continue;
                    }
                    value += text.slice(seg, q);
                    i = q + 1;
                    break;
                }
                // 닫는 따옴표 뒤에 남은 글자는 값에 그대로 붙인다(규칙에서 벗어난 파일도 읽으려고).
                const rest = i;
                i = toCellEnd(i);
                value += text.slice(rest, i);
            } else {
                i = toCellEnd(i);
                value = text.slice(cellStart, i);
            }
            cells.push(cellStart, i);
            vals.push(value);
            if (i < n && text.charCodeAt(i) === d) {
                i++;
                continue;
            }
            break;
        }
        const end = i;
        if (text.charCodeAt(i) === CR) i++;
        if (text.charCodeAt(i) === LF) i++;
        rows.push({ start, end, next: i, cells });
        values.push(vals);
    }
    return { rows, values, text, openQuote };
}

/** 글자 위치가 든 셀의 [행, 열]. 나눔 글자는 앞 셀, 줄바꿈과 파일 끝 빈 줄은 앞 행의 마지막 셀로 본다. 빈 파일이면 없음. */
export function cellAt(doc: CsvDoc, offset: number): [row: number, col: number] | undefined {
    if (!doc.rows.length) return undefined;
    // 행 시작 위치는 차례로 커지므로, offset 이하에서 시작하는 마지막 행을 반씩 나눠 찾는다.
    let lo = 0;
    let hi = doc.rows.length - 1;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (doc.rows[mid].start <= offset) lo = mid;
        else hi = mid - 1;
    }
    const cells = doc.rows[lo].cells;
    let col = 0;
    while (col * 2 + 2 < cells.length && cells[col * 2 + 2] <= offset) col++;
    return [lo, col];
}

/** 셀이 파일에서 시작하는 글자 위치. 그 행에 그 열이 없으면(짧은 행) 행 끝이고, 행이 없으면 없음. */
export function cellStart(doc: CsvDoc, row: number, col: number): number | undefined {
    const r = doc.rows[row];
    if (!r) return undefined;
    return col * 2 < r.cells.length ? r.cells[col * 2] : r.end;
}

/** 셀 값을 파일 글자로 바꾼다. 따옴표는 꼭 필요할 때만 붙인다(MSW는 쓸데없는 따옴표를 화면에 그대로 보여 준다). */
export function encodeCell(value: string, delimiter: string): string {
    return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function columnCount(doc: CsvDoc): number {
    let max = 0;
    for (const row of doc.rows) max = Math.max(max, row.cells.length / 2);
    return max;
}

/** 표 작업 하나를 파일 글자 바꾸기 목록으로 만든다. 건드리지 않는 글자는 목록에 들어가지 않는다. */
export function editsFor(doc: CsvDoc, op: CsvOp, delimiter: string, eol: string): TextEdit[] {
    const { rows } = doc;
    switch (op.kind) {
        case 'setCells':
            return setCellsEdits(doc, op.cells, delimiter, eol);
        case 'paste':
            return setCellsEdits(doc, pasteCells(op.text, op.row, op.col, op.fill), delimiter, eol);
        case 'insertRow': {
            const at = Math.min(Math.max(op.at, 0), rows.length);
            const lines = Array<string>(Math.max(op.count ?? 1, 1)).fill(delimiter.repeat(Math.max(columnCount(doc) - 1, 0)));
            if (at < rows.length) return [{ start: rows[at].start, end: rows[at].start, text: lines.join(eol) + eol }];
            return [appendLines(doc, lines, eol)];
        }
        case 'deleteRow': {
            // 이어진 행 묶음마다 한 번에 지운다. 따로 지우면 마지막 행 처리에서 지울 자리가 겹친다.
            const edits: TextEdit[] = [];
            for (const [a, b] of runs(op.at, rows.length)) {
                if (rows[b].next > rows[b].end || a === 0) edits.push({ start: rows[a].start, end: rows[b].next, text: '' });
                // 줄바꿈 없는 마지막 행까지 지우면 앞 행의 줄바꿈부터 지워서 빈 행이 남지 않게 한다.
                // 다만 앞 행이 빈 행이면 그 줄바꿈은 남긴다. 지우면 그 빈 행이 파일 끝 줄바꿈과 구별되지 않아 함께 사라진다.
                else if (rows[a - 1].start === rows[a - 1].end) edits.push({ start: rows[a - 1].next, end: rows[b].end, text: '' });
                else edits.push({ start: rows[a - 1].end, end: rows[b].end, text: '' });
            }
            return edits;
        }
        case 'insertCol': {
            const edits: TextEdit[] = [];
            const at = Math.max(op.at, 0);
            const text = delimiter.repeat(Math.max(op.count ?? 1, 1));
            for (const row of rows) {
                const count = row.cells.length / 2;
                if (at < count) edits.push({ start: row.cells[at * 2], end: row.cells[at * 2], text });
                else if (at === count) edits.push({ start: row.end, end: row.end, text });
            }
            return edits;
        }
        case 'deleteCol': {
            const edits: TextEdit[] = [];
            for (const [ri, row] of rows.entries()) {
                const c = row.cells;
                const count = c.length / 2;
                const rowEdits: TextEdit[] = [];
                // 이어진 열 묶음마다 한 번에 지운다(행마다 셀 수가 달라서 행마다 묶는다).
                const cut = runs(op.at, count);
                for (const [a, b] of cut) {
                    if (b < count - 1) {
                        // 셀들과 뒤따르는 나눔 글자를 함께 지운다.
                        rowEdits.push({ start: c[a * 2], end: c[b * 2 + 2], text: '' });
                    } else if (a === 0) {
                        // 행의 셀을 모두 지우면 빈 행이 남는다.
                        if (c[b * 2 + 1] > c[0]) rowEdits.push({ start: c[0], end: c[b * 2 + 1], text: '' });
                    } else {
                        // 마지막 셀까지 지우면 앞의 나눔 글자부터 지운다.
                        rowEdits.push({ start: c[a * 2 - 1], end: c[b * 2 + 1], text: '' });
                    }
                }
                // 줄바꿈 없는 마지막 행이 빈 행이 되면 파일 끝 줄바꿈과 구별되지 않아 사라진다. 줄바꿈을 하나 붙여 빈 행으로 남긴다.
                // 남은 셀이 없거나, 하나 남았는데 비어 있으면 빈 행이다. 이때 맨 뒤 바꾸기는 언제나 행 끝에서 끝난다.
                if (rowEdits.length && ri === rows.length - 1 && row.next === row.end) {
                    const left = Array.from({ length: count }, (_, i) => i).filter((i) => !cut.some(([a, b]) => i >= a && i <= b));
                    if (left.length === 0 || (left.length === 1 && c[left[0] * 2] === c[left[0] * 2 + 1])) {
                        rowEdits.reduce((x, y) => (y.end > x.end ? y : x)).text += eol;
                    }
                }
                edits.push(...rowEdits);
            }
            return edits;
        }
        case 'moveRows': {
            const mv = moveOrder(op, rows.length);
            if (!mv) return [];
            const { lo, order } = mv;
            const last = rows[lo + order.length - 1];
            // 행 글자는 원래대로 옮기고, 행 사이 줄바꿈은 자리에 그대로 둔다(줄바꿈 없는 마지막 행도 그대로다).
            let text = '';
            order.forEach((i, j) => {
                text += doc.text.slice(rows[i].start, rows[i].end);
                if (j < order.length - 1) text += doc.text.slice(rows[lo + j].end, rows[lo + j].next);
            });
            // 줄바꿈 없는 마지막 행 자리에 빈 행이 오면 파일 끝 줄바꿈과 구별되지 않아 사라진다. 줄바꿈을 하나 붙인다.
            const lastNew = rows[order[order.length - 1]];
            if (last === rows[rows.length - 1] && last.next === last.end && lastNew.start === lastNew.end) text += eol;
            return [{ start: rows[lo].start, end: last.end, text }];
        }
        case 'moveCols': {
            const mv = moveOrder(op, columnCount(doc));
            if (!mv) return [];
            const { lo, order } = mv;
            const edits: TextEdit[] = [];
            for (const row of rows) {
                const c = row.cells;
                const count = c.length / 2;
                if (lo >= count) continue;
                // 셀 수가 모자란 행은 없는 칸을 빈 값으로 본다. 원래 없던 칸 자리에 빈 값만 오면 칸을 늘리지 않는다.
                const parts = order.map((i) => (i < count ? doc.text.slice(c[i * 2], c[i * 2 + 1]) : ''));
                let keep = parts.length;
                while (keep > count - lo && parts[keep - 1] === '') keep--;
                const start = c[lo * 2];
                const end = c[(Math.min(lo + order.length, count) - 1) * 2 + 1];
                const text = parts.slice(0, keep).join(delimiter);
                if (text !== doc.text.slice(start, end)) edits.push({ start, end, text });
            }
            return edits;
        }
    }
}

/**
 * 옮기기 작업에서 바뀌는 구간의 첫 번호(lo)와, 그 구간 자리마다 올 원래 번호들(order)을 구한다.
 * 번호가 0~n 밖이거나 옮겨도 그대로면 undefined다.
 */
function moveOrder(op: { from: number; count: number; to: number }, n: number): { lo: number; order: number[] } | undefined {
    const { from, count, to } = op;
    const end = from + count;
    if (![from, count, to].every(Number.isInteger) || from < 0 || count < 1 || end > n || to < 0 || to > n) return undefined;
    if (to >= from && to <= end) return undefined;
    const seq = (a: number, b: number): number[] => Array.from({ length: b - a }, (_, i) => a + i);
    return to < from ? { lo: to, order: [...seq(from, end), ...seq(to, from)] } : { lo: from, order: [...seq(end, to), ...seq(from, end)] };
}

/** 번호들(하나나 여러 개) 가운데 0 이상 n 미만인 것을 이어진 묶음 [처음, 끝]들로 나눈다. 작은 것부터. */
function runs(at: number | number[], n: number): [number, number][] {
    const list = [...new Set(Array.isArray(at) ? at : [at])].filter((i) => Number.isInteger(i) && i >= 0 && i < n).sort((x, y) => x - y);
    const out: [number, number][] = [];
    for (const i of list) {
        const last = out[out.length - 1];
        if (last && last[1] === i - 1) last[1] = i;
        else out.push([i, i]);
    }
    return out;
}

/** 여러 셀을 한 번에 바꾼다. 행이 모자라면 파일 끝에 행을 늘리고, 열이 모자란 행은 나눔 글자를 채운다. */
function setCellsEdits(doc: CsvDoc, cells: Cell[], delimiter: string, eol: string): TextEdit[] {
    const { rows } = doc;
    // 같은 셀이 여러 번 오면 마지막 값을 쓴다(Ctrl+클릭으로 겹쳐 고른 범위).
    const byRow = new Map<number, Map<number, string>>();
    for (const [r, c, v] of cells) {
        if (!(r >= 0 && c >= 0)) continue;
        let m = byRow.get(r);
        if (!m) byRow.set(r, (m = new Map()));
        m.set(c, v);
    }

    const edits: TextEdit[] = [];
    let lastNewRow = -1;
    // 줄바꿈 없는 마지막 행의 하나뿐인 셀을 비운 바꾸기(그 행이 빈 행이 된다)
    let emptiedLast: TextEdit | undefined;
    for (const [r, m] of byRow) {
        if (r >= rows.length) {
            lastNewRow = Math.max(lastNewRow, r);
            continue;
        }
        const row = rows[r];
        const count = row.cells.length / 2;
        let tailTo = -1;
        let lastCellEdit: TextEdit | undefined;
        for (const [c, v] of m) {
            if (c < count) {
                if (doc.values[r][c] === v) continue;
                const edit = { start: row.cells[c * 2], end: row.cells[c * 2 + 1], text: encodeCell(v, delimiter) };
                edits.push(edit);
                if (c === count - 1) lastCellEdit = edit;
            } else if (v !== '') {
                tailTo = Math.max(tailTo, c);
            }
        }
        // 열이 모자란 행: 행 끝에 나눔 글자와 값을 이어 붙여 그 셀까지 만든다.
        if (tailTo >= 0) {
            let tail = '';
            for (let c = count; c <= tailTo; c++) tail += delimiter + encodeCell(m.get(c) ?? '', delimiter);
            // 마지막 셀도 바꾸면 그 바꾸기에 이어 붙인다. 마지막 셀이 비어 있으면 두 바꾸기가 같은 자리에 겹쳐 순서가 뒤바뀔 수 있기 때문이다.
            if (lastCellEdit) lastCellEdit.text += tail;
            else edits.push({ start: row.end, end: row.end, text: tail });
        } else if (r === rows.length - 1 && row.next === row.end && count === 1 && lastCellEdit?.text === '') {
            emptiedLast = lastCellEdit;
        }
    }
    // 줄바꿈 없는 마지막 행이 빈 행이 되면 파일 끝 줄바꿈과 구별되지 않아 사라진다. 줄바꿈을 하나 붙여 빈 행으로 남긴다.
    // 뒤에 행을 더 붙이면(아래 appendLines) 그쪽이 줄바꿈을 넣으므로 붙이지 않는다.
    if (emptiedLast && lastNewRow < 0) emptiedLast.text += eol;

    if (lastNewRow >= 0) {
        // 파일 끝을 넘는 행: 새 행은 표의 열 수만큼(값이 더 오른쪽까지 있으면 거기까지) 만든다.
        const width = columnCount(doc);
        const lines: string[] = [];
        for (let r = rows.length; r <= lastNewRow; r++) {
            const m = byRow.get(r);
            let last = width - 1;
            if (m) for (const c of m.keys()) last = Math.max(last, c);
            const vals: string[] = [];
            for (let c = 0; c <= Math.max(last, 0); c++) vals.push(encodeCell(m?.get(c) ?? '', delimiter));
            lines.push(vals.join(delimiter));
        }
        // 줄바꿈 없는 마지막 행 끝을 이미 고쳤다면, 같은 자리에 겹치지 않게 그 바꾸기 뒤에 이어 붙인다.
        const add = appendLines(doc, lines, eol);
        const touching = edits.find((e) => e.end === add.start);
        if (touching) touching.text += add.text;
        else edits.push(add);
    }
    return edits;
}

/** 파일 끝에 행들을 붙이는 바꾸기 하나를 만든다. */
function appendLines(doc: CsvDoc, lines: string[], eol: string): TextEdit {
    const { rows } = doc;
    const body = lines.join(eol);
    if (rows.length === 0) return { start: 0, end: 0, text: body + eol };
    const last = rows[rows.length - 1];
    if (last.next > last.end) return { start: last.next, end: last.next, text: body + eol };
    // 마지막 행에 줄바꿈이 없으면 앞에 줄바꿈을 붙인다. 맨 끝이 빈 행이면 파일 끝 줄바꿈과 구별되지 않아 줄바꿈을 하나 더 둔다.
    return { start: last.end, end: last.end, text: eol + body + (lines[lines.length - 1] === '' ? eol : '') };
}

/**
 * 붙여 넣을 글자(탭과 줄바꿈으로 나뉜 표, 구글 시트와 엑셀이 복사하는 모양)를 셀 목록으로 바꾼다.
 * 값 하나를 여러 셀을 고른 채 붙이면 고른 셀을 모두 그 값으로 채운다(구글 시트 방식).
 */
export function pasteCells(text: string, row: number, col: number, fill: Rect[] = []): Cell[] {
    const block = parseCsv(text, '\t').values;
    const cells: Cell[] = [];
    const fillCount = fill.reduce((n, [r1, c1, r2, c2]) => n + (r2 - r1 + 1) * (c2 - c1 + 1), 0);
    if (block.length === 1 && block[0].length === 1 && fillCount > 1) {
        for (const [r1, c1, r2, c2] of fill) {
            for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cells.push([r, c, block[0][0]]);
        }
        return cells;
    }
    block.forEach((vals, i) => vals.forEach((v, j) => cells.push([row + i, col + j, v])));
    return cells;
}

/**
 * 바꾸기 목록을 글자에 적용한다(시험과 확인 스크립트용). VS Code처럼 끝 자리, 시작 자리, 목록 순서로 정렬하고,
 * 바꿀 자리가 겹치면 오류를 낸다. 그래야 시험이 실제 VS Code에서 거절될 바꾸기를 잡는다.
 */
export function applyEdits(text: string, edits: TextEdit[]): string {
    const sorted = edits.map((e, i) => ({ e, i })).sort((a, b) => a.e.end - b.e.end || a.e.start - b.e.start || a.i - b.i);
    let out = '';
    let pos = 0;
    for (const { e } of sorted) {
        if (e.start < pos) throw new Error('Overlapping ranges are not allowed!');
        out += text.slice(pos, e.start) + e.text;
        pos = e.end;
    }
    return out + text.slice(pos);
}

/** 번호, 개수 상한. 표 화면이 보낸 값이 터무니없이 크면 거절한다. */
const MAX_INDEX = 10_000_000;

/**
 * 표 화면이 보낸 작업이 모양에 맞는지 본다. 웹뷰가 보낸 값은 믿지 않는다(번호는 0 이상의 정수이고 상한이 있다).
 * 맞으면 그 작업을, 아니면 undefined를 돌려준다.
 */
export function validOp(op: unknown): CsvOp | undefined {
    if (!op || typeof op !== 'object') return undefined;
    const o = op as Record<string, unknown>;
    const idx = (v: unknown, min = 0): boolean => Number.isInteger(v) && (v as number) >= min && (v as number) <= MAX_INDEX;
    const rect = (v: unknown): boolean => Array.isArray(v) && v.length === 4 && v.every((x) => idx(x)) && v[0] <= v[2] && v[1] <= v[3];
    const cell = (v: unknown): boolean =>
        Array.isArray(v) && (v.length === 3 || v.length === 4) && idx(v[0]) && idx(v[1]) && typeof v[2] === 'string' && (v.length === 3 || typeof v[3] === 'string');
    let ok = false;
    switch (o.kind) {
        case 'setCells':
            ok = Array.isArray(o.cells) && o.cells.length <= MAX_INDEX && o.cells.every(cell);
            break;
        case 'paste':
            ok = idx(o.row) && idx(o.col) && typeof o.text === 'string' && (o.fill === undefined || (Array.isArray(o.fill) && o.fill.every(rect)));
            break;
        case 'insertRow':
        case 'insertCol':
            // 빈 파일에서 위에 넣기는 -1 행 기준으로 온다.
            ok = idx(o.at, -1) && (o.count === undefined || idx(o.count, 1));
            break;
        case 'deleteRow':
        case 'deleteCol':
            ok = idx(o.at) || (Array.isArray(o.at) && o.at.length <= MAX_INDEX && o.at.every((x) => idx(x)));
            break;
        case 'moveRows':
        case 'moveCols':
            ok = idx(o.from) && idx(o.count, 1) && idx(o.to);
            break;
    }
    return ok ? (op as CsvOp) : undefined;
}

/**
 * 셀 바꾸기에 실린 "바꾸기 전 값"이 지금 파일과 다른 셀이 있는지. 있으면 표 화면이 본 뒤에 파일이 밖에서 바뀐 것이라,
 * 그대로 쓰면 다른 행에 들어갈 수 있다.
 */
export function staleCells(doc: CsvDoc, cells: Cell[]): boolean {
    return cells.some(([r, c, , old]) => old !== undefined && (doc.values[r]?.[c] ?? '') !== old);
}

/**
 * 앞 표(prev)를 새 표(next)로 만들려면 start부터 del개 행을 rows로 바꾸면 된다. 앞뒤로 같은 행은 건너뛴다.
 * 확장이 표 화면에 달라진 행 구간만 보내는 데 쓴다(큰 표 전체를 보내면 100ms 넘게 걸린다).
 */
export function rowsSplice(prev: string[][], next: string[][]): { start: number; del: number; rows: string[][] } {
    const same = (a: string[], b: string[]): boolean => a === b || (a.length === b.length && a.every((v, i) => v === b[i]));
    const max = Math.min(prev.length, next.length);
    let start = 0;
    while (start < max && same(prev[start], next[start])) start++;
    let endP = prev.length;
    let endN = next.length;
    while (endP > start && endN > start && same(prev[endP - 1], next[endN - 1])) {
        endP--;
        endN--;
    }
    return { start, del: endP - start, rows: next.slice(start, endN) };
}
