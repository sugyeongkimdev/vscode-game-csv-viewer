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
}

export interface TextEdit {
    start: number;
    end: number;
    text: string;
}

/** 셀 하나: [행, 열, 값] */
export type Cell = [row: number, col: number, value: string];
/** 네모 범위: [첫 행, 첫 열, 끝 행, 끝 열] */
export type Rect = [r1: number, c1: number, r2: number, c2: number];

export type CsvOp =
    | { kind: 'setCells'; cells: Cell[] }
    | { kind: 'paste'; row: number; col: number; text: string; fill?: Rect[] }
    | { kind: 'insertRow' | 'deleteRow' | 'insertCol' | 'deleteCol'; at: number };

const QUOTE = 34;
const LF = 10;
const CR = 13;

export function parseCsv(text: string, delimiter: string): CsvDoc {
    const d = delimiter.charCodeAt(0);
    const n = text.length;
    const rows: CsvRow[] = [];
    const values: string[][] = [];
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
    return { rows, values };
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
            const line = delimiter.repeat(Math.max(columnCount(doc) - 1, 0));
            if (at < rows.length) return [{ start: rows[at].start, end: rows[at].start, text: line + eol }];
            return [appendLines(doc, [line], eol)];
        }
        case 'deleteRow': {
            const row = rows[op.at];
            if (!row) return [];
            if (row.next > row.end || op.at === 0) return [{ start: row.start, end: row.next, text: '' }];
            // 줄바꿈 없는 마지막 행은 앞 행의 줄바꿈까지 지워서 빈 행이 남지 않게 한다.
            return [{ start: rows[op.at - 1].end, end: row.end, text: '' }];
        }
        case 'insertCol': {
            const edits: TextEdit[] = [];
            const at = Math.max(op.at, 0);
            for (const row of rows) {
                const count = row.cells.length / 2;
                if (at < count) edits.push({ start: row.cells[at * 2], end: row.cells[at * 2], text: delimiter });
                else if (at === count) edits.push({ start: row.end, end: row.end, text: delimiter });
            }
            return edits;
        }
        case 'deleteCol': {
            const edits: TextEdit[] = [];
            const at = op.at;
            for (const row of rows) {
                const c = row.cells;
                const count = c.length / 2;
                if (at < 0 || at >= count) continue;
                if (count === 1) {
                    if (c[1] > c[0]) edits.push({ start: c[0], end: c[1], text: '' });
                } else if (at < count - 1) {
                    // 셀과 뒤따르는 나눔 글자를 함께 지운다.
                    edits.push({ start: c[at * 2], end: c[at * 2 + 2], text: '' });
                } else {
                    // 마지막 셀은 앞의 나눔 글자와 함께 지운다.
                    edits.push({ start: c[at * 2 - 1], end: c[at * 2 + 1], text: '' });
                }
            }
            return edits;
        }
    }
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
        }
    }

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

/** 바꾸기 목록을 글자에 적용한다(시험과 확인 스크립트용). */
export function applyEdits(text: string, edits: TextEdit[]): string {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    for (const e of sorted) text = text.slice(0, e.start) + e.text + text.slice(e.end);
    return text;
}
