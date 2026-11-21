// 표 화면. 보이는 행만 그리고, 셀 고르기, 셀 고치기, 키보드 이동, 복사와 붙여 넣기, 열과 행 크기 조절, 확대와 축소를 맡는다.
// 파일 글자는 확장 쪽이 들고 있다. import가 없는 일반 스크립트로 컴파일되어 웹뷰에서 그대로 읽힌다.

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): unknown; setState(state: unknown): void };

/** 탭을 옮겼다 와도 이어지게 웹뷰 상태에 두는 값. 머리글 고정은 확장 설정, 크기와 배율은 확장 저장소가 기억한다. */
interface ViewState {
    row: number;
    col: number;
    top: number;
    left: number;
}

interface Pos {
    row: number;
    col: number;
}

/** 네모 범위: [첫 행, 첫 열, 끝 행, 끝 열] */
type Rect = [number, number, number, number];
/** 끌어서 고를 때의 단위: 셀, 행 전체, 열 전체 */
type DragMode = 'cell' | 'row' | 'col';
/** 머리글 고정 방식: 첫 행(가로), 첫 열(세로), 없음 */
type HeaderMode = 'row' | 'column' | 'none';
const isHeaderMode = (v: unknown): v is HeaderMode => v === 'row' || v === 'column' || v === 'none';

/** 끌어서 크기를 바꾸는 중인 열이나 행. base는 배율 100% 기준 처음 크기다. */
interface Resize {
    kind: 'col' | 'row';
    targets: number[];
    start: number;
    base: number;
}
/** 행 번호(열 이름)를 끌어 행(열) 묶음을 옮기는 중인 상태. to는 놓을 틈(그 번호 앞에 넣는다), -1이면 아직 없음. */
interface Moving {
    kind: 'row' | 'col';
    from: number;
    count: number;
    to: number;
    /** 누른 자리와 마지막 마우스 자리 */
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    /** 조금이라도 끌었는지. 안 끌고 놓으면 그냥 누른 것(click)으로 친다 */
    active: boolean;
    click: () => void;
    /** 끌기 시작할 때 묶음의 끄는 방향 크기(px)와, 누른 자리가 묶음 앞끝에서 떨어진 거리. 유령 상자가 마우스를 따라오게 한다 */
    size: number;
    grab: number;
}
/** 화면이나 본문 안의 자리(px) */
type Point = { x: number; y: number };
/** 본문 한 곳을 열 c, 본문 행 k와 그 칸 안의 비율(fx, fy)로 적은 것. 배율이 바뀌어도 같은 곳을 가리킨다. */
type Spot = { c: number; fx: number; k: number; fy: number };
/** 그릴 칸 하나: 열 번호, 또는 그리지 않은 열들 자리를 채우는 빈자리(너비 px) */
type Slot = number | { gap: number };

const vscodeApi = acquireVsCodeApi();
const saved = (vscodeApi.getState() ?? {}) as Partial<ViewState>;

/** 기본 행 높이(배율 100% 기준 px) */
const BASE_ROW_H = 22;
/** 배율 단계. view.ts의 ZOOMS와 같아야 한다. */
const ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** 열 너비, 행 높이의 범위(배율 100% 기준 px). view.ts의 같은 이름 값과 같아야 한다. */
const COL_W_MIN = 20;
const COL_W_MAX = 2000;
const ROW_H_MIN = 12;
const ROW_H_MAX = 400;
/** 열 이름 경계를 두 번 눌러 내용에 맞출 때의 최대 너비 */
const FIT_MAX = 1000;
/** 찾기 결과를 셀 번호 하나로 묶을 때 쓰는 열 자리 수(행 x FIND_KEY + 열). 열이 이보다 많으면 안 된다. */
const FIND_KEY = 65536;
/** 찾기 결과 상한. 넘으면 개수 뒤에 +를 붙인다. */
const FIND_MAX = 100000;
/** 화면 위아래로 미리 더 그려 둘 행 수 */
const OVERSCAN = 8;
/** 가로로 보이는 열 앞뒤로 더 그려 둘 열 수 */
const COL_OVERSCAN = 3;
/** 셀 글자가 너무 길면 앞부분만 그린다. */
const SHOW_MAX = 300;

const grid = document.getElementById('grid') as HTMLDivElement;
const table = document.getElementById('table') as HTMLTableElement;
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const modeLabel = document.getElementById('modeLabel') as HTMLSpanElement;
const modeButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#mode button'));
const zoomButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#zoom button'));
const zoomLabel = document.getElementById('zoomLabel') as HTMLSpanElement;
const zoomPct = document.getElementById('zoomPct') as HTMLButtonElement;
const emptyNote = document.getElementById('empty') as HTMLDivElement;
const addrText = document.getElementById('addr') as HTMLSpanElement;
const selText = document.getElementById('selinfo') as HTMLSpanElement;
const noteText = document.getElementById('note') as HTMLSpanElement;
const sizeText = document.getElementById('size') as HTMLSpanElement;
const findBox = document.getElementById('find') as HTMLDivElement;
const findInput = document.getElementById('findInput') as HTMLInputElement;
const findCount = document.getElementById('findCount') as HTMLSpanElement;
const findButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#find button'));
const ruler = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
/**
 * 배율 100%일 때의 글자 크기와 글꼴(VS Code 편집기 글꼴).
 * VS Code는 테마 값(--vscode-editor-font-*)을 이 스크립트가 시작한 뒤에 넣을 수 있어서, 처음 한 번만 읽으면
 * 기본값(13px monospace)으로 재고 실제로는 더 큰 글꼴로 그려 글자가 잘린다. 그래서 쓸 때마다 새로 읽는다.
 */
function baseFont(): { size: number; family: string } {
    const cs = getComputedStyle(document.body);
    return { size: parseFloat(cs.fontSize) || 13, family: cs.fontFamily };
}
/** 글자 폭을 재는 캔버스에 지금 글꼴(배율 100%)을 넣는다. */
function setRulerFont(): void {
    const f = baseFont();
    ruler.font = `${f.size}px ${f.family}`;
}
/** 셀 너비 = 글자 폭 + 이 값(배율 100% 기준). 좌우 여백 12px, 오른쪽 경계선 1px, 캔버스로 잰 폭과 실제로 그린 폭의 작은 차이를 덮는 여유 7px */
const CELL_EXTRA = 20;
/** 셀 좌우 여백(배율 100% 기준). table.css의 --pad-x 기본값과 같아야 한다. */
const PAD_X = 6;

/** 화면 글자 목록. 확장이 `text` 메시지로 보내 준다(i18n.ts). 받기 전에는 아래 임시 글자를 쓴다. */
let text: Record<string, string> = { size: '{rows} x {cols}', selected: '{n}', multiCopy: '', selectAll: '', moveRows: '{n}', moveCols: '{n}', editCanceled: '' };
let rows: string[][] = [];
let colCount = 0;
/** 확장이 HTML에 처음 값을 넣어 두고, 설정이 바뀌면 `mode` 메시지로 알려 준다. */
let mode: HeaderMode = isHeaderMode(document.body.dataset.mode) ? document.body.dataset.mode : 'row';

// 크기와 배율. 확장이 `view` 메시지로 기억해 둔 값을 보내 주고, 바뀌면 `saveView`로 돌려보낸다.
let zoom = 1;
/** 사용자가 바꾼 열 너비, 행 높이(배율 100% 기준 px). 없는 번호는 자동 너비, 기본 높이다. */
let colW: Record<number, number> = {};
let rowHt: Record<number, number> = {};
/** 내용을 보고 정한 열 너비(배율 100% 기준) */
let autoW: number[] = [];
let numWBase = 40;
// 아래는 layout()이 위 값과 배율로 계산하는 실제 화면 크기(px)다.
let widths: number[] = [];
let numW = 40;
/** 본문 행 k의 위쪽 위치. tops[k + 1] - tops[k]가 그 행의 높이다. */
let tops = new Float64Array(1);
let layoutDirty = true;

/** 지금 셀: 타자가 들어가는 셀 */
let sel: Pos = { row: saved.row ?? 0, col: saved.col ?? 0 };
/** 지금 범위의 시작 셀과 움직이는 끝 셀. 범위는 이 두 셀을 꼭짓점으로 하는 네모다. */
let anchor: Pos = { ...sel };
let head: Pos = { ...sel };
/** Ctrl+클릭으로 앞서 고른 범위들 */
let extra: Rect[] = [];
let drag: DragMode | null = null;
let resizing: Resize | null = null;
let editing = false;
/**
 * 고치기를 시작할 때 그 행의 값들. 고치는 사이 파일이 밖에서 바뀌어 이 행이 달라지면(행이 밀리거나 줄면) 고치기를 그만둔다.
 * 셀 하나만 비교하면 밀려온 행의 같은 열 값이 우연히 같을 때 다른 행에 쓴다.
 */
let editOrigin: string[] = [];
/** 한글 등을 조합하는 중인지 */
let composing = false;
let loaded = false;
let frame = 0;
/** 스크롤한 프레임에 할 일(onScrollFrame)을 걸어 둔 번호 */
let scrollFrame = 0;
/**
 * 지금 그려 둔 범위: 본문 행 번호 [start, end)와 스크롤되는 열 [c0, c1](세로 머리글의 고정 열은 늘 그리므로 뺀다).
 * 스크롤해도 보이는 곳이 이 안이면 다시 그리지 않는다.
 */
let drawn = { start: 0, end: 0, c0: 0, c1: -1 };
let noteTimer = 0;
let wheelSum = 0;
let moving: Moving | null = null;

// 찾기(Ctrl+F). 표는 보이는 행만 그리므로 화면 글자가 아니라 표 값 전체에서 찾는다.
/** 찾은 셀 번호(행 x FIND_KEY + 열)들. 읽는 순서(행, 열 순)다. */
let found: number[] = [];
let foundSet = new Set<number>();
/** 지금 결과의 순번. 결과가 없으면 -1 */
let foundIdx = -1;
let findTimer = 0;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
const cell = (r: number, c: number): string => rows[r]?.[c] ?? '';
/** 가로 머리글이면 0번 행은 위에 고정되고 본문은 1번 행부터다. */
const firstBody = (): number => (mode === 'row' && rows.length > 0 ? 1 : 0);
/** 세로 머리글이면 0번 열이 행 번호 옆에 고정된다. 그 너비만큼 스크롤 영역이 좁아진다. */
const stickyColW = (): number => (mode === 'column' ? widths[0] ?? 0 : 0);
/** 행 r의 화면 높이 */
const rowHeight = (r: number): number => Math.round((rowHt[r] ?? BASE_ROW_H) * zoom);
/** 열 이름 행의 화면 높이 */
const lettersH = (): number => Math.round(BASE_ROW_H * zoom);
/** 위에 고정된 행(열 이름 행과 머리글 행)의 높이 */
const headH = (): number => lettersH() + (firstBody() ? rowHeight(0) : 0);
/** 한 줄 글자의 줄 높이. 행보다 크면 행이 늘어나 위치 계산이 어긋나므로 행 높이보다 작게 둔다. */
const lineH = (h: number): number => Math.max(1, Math.min(h - 1, Math.round((BASE_ROW_H - 1) * zoom)));
const trStyle = (h: number): string => `height:${h}px;line-height:${lineH(h)}px`;
const rectOf = (a: Pos, b: Pos): Rect => [Math.min(a.row, b.row), Math.min(a.col, b.col), Math.max(a.row, b.row), Math.max(a.col, b.col)];
/** 고른 범위 전부. 마지막이 지금 범위다. */
const ranges = (): Rect[] => [...extra, rectOf(anchor, head)];
const inRanges = (rs: Rect[], r: number, c: number): boolean => rs.some(([r1, c1, r2, c2]) => r >= r1 && r <= r2 && c >= c1 && c <= c2);
const selectionKey = (): string => JSON.stringify([sel, anchor, head, extra]);

function colLeft(c: number): number {
    let x = 0;
    for (let k = 0; k < c; k++) x += widths[k];
    return x;
}

/** 0, 1, 2 ... 를 A, B, C ... AA 처럼 바꾼다. */
function colName(c: number): string {
    let s = '';
    for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

function esc(s: string): string {
    return s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

/** 셀에 그릴 글자. 줄바꿈은 기호로 바꿔 행 높이가 늘지 않게 한다. */
function shown(v: string): string {
    return esc(v.length > SHOW_MAX ? v.slice(0, SHOW_MAX) : v).replace(/\r\n|\r|\n/g, '↵');
}

/**
 * 열 c의 내용 폭(배율 100% 기준). all이 true면 모든 행을 본다(경계 두 번 눌러 맞추기).
 * false면 속도 때문에 앞뒤 1000행씩만 본다(처음 자동 너비). 뒤로 갈수록 값이 길어지는 열(번호 등)이 있어서 뒤쪽도 본다.
 * 머리글 셀은 굵은 글씨라 굵게 재야 잘리지 않는다.
 */
function contentWidth(c: number, all: boolean): number {
    const f = baseFont();
    const normal = `${f.size}px ${f.family}`;
    const bold = `600 ${normal}`;
    const maxChars = all ? 200 : 60;
    const boldCol = mode === 'column' && c === 0;
    let w = 0;
    const one = (r: number): void => {
        const v = rows[r]?.[c];
        if (v) w = Math.max(w, ruler.measureText(v.length > maxChars ? v.slice(0, maxChars) : v).width);
    };
    ruler.font = normal;
    w = ruler.measureText(colName(c)).width;
    ruler.font = bold;
    if (mode === 'row' && rows.length) one(0);
    ruler.font = boldCol ? bold : normal;
    const start = mode === 'row' ? 1 : 0;
    if (all || rows.length <= 2000) {
        for (let r = start; r < rows.length; r++) one(r);
    } else {
        for (let r = start; r < 1000; r++) one(r);
        for (let r = rows.length - 1000; r < rows.length; r++) one(r);
    }
    return Math.ceil(w) + CELL_EXTRA;
}

/** 행 번호 열 너비(배율 100% 기준)를 가장 큰 행 번호의 폭으로 정한다. */
function measureNumW(): void {
    setRulerFont();
    numWBase = Math.max(40, Math.ceil(ruler.measureText(String(rows.length)).width) + CELL_EXTRA);
    layoutDirty = true;
}

/** 앞쪽 1000행을 보고 열마다 자동 너비를 정한다. */
function measure(): void {
    autoW = [];
    for (let c = 0; c < colCount; c++) autoW.push(clamp(contentWidth(c, false), 48, 320));
    layoutDirty = true;
}

/** 배율과 사용자가 바꾼 크기로 화면 크기를 계산한다. 크기, 배율, 표, 머리글 방식이 바뀌면 다시 한다. */
function layout(): void {
    layoutDirty = false;
    widths = autoW.map((w, c) => Math.round((colW[c] ?? w) * zoom));
    numW = Math.round(numWBase * zoom);
    const fb = firstBody();
    const n = Math.max(rows.length - fb, 0);
    tops = new Float64Array(n + 1);
    for (let k = 0; k < n; k++) tops[k + 1] = tops[k] + rowHeight(k + fb);
    const font = `${baseFont().size * zoom}px`;
    // 셀 여백도 배율을 따라 바꾼다. 여백이 그대로면 축소할수록 글자 자리가 모자라 잘린다.
    table.style.setProperty('--pad-x', `${PAD_X * zoom}px`);
    editor.style.padding = `0 ${Math.max(2, Math.round(4 * zoom))}px`;
    table.style.fontSize = font;
    editor.style.fontSize = font;
    table.style.setProperty('--letters-h', `${lettersH()}px`);
    // 세로 머리글 열은 행 번호 바로 옆에 고정한다(table.css의 .hc).
    table.style.setProperty('--num-w', `${numW}px`);
}

/** 위치 y에 걸친 본문 행 번호(본문 안에서 몇 번째인지). 행 높이가 제각각이라 tops를 반씩 나눠 찾는다. */
function findRow(y: number): number {
    let lo = 0;
    let hi = tops.length - 2;
    if (hi < 0) return 0;
    while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
    }
    return lo;
}

function render(): void {
    // 이미 걸어 둔 다음 프레임 그리기는 지금 그리므로 취소한다(한 프레임에 여러 번 그리지 않게).
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (layoutDirty) layout();
    emptyNote.hidden = rows.length > 0;
    sizeText.textContent = text.size.replace('{rows}', rows.length.toLocaleString()).replace('{cols}', String(colCount));
    if (!rows.length) {
        table.innerHTML = '';
        addrText.textContent = '';
        selText.textContent = '';
        drawn = { start: 0, end: 0, c0: 0, c1: -1 };
        return;
    }
    const fb = firstBody();
    const n = rows.length - fb;
    // 보이는 행과 열에 앞뒤 여유를 더해 그린다. 칸이 많을수록 화면 배치가 오래 걸려서, 열도 보이는 것만 그린다
    // (1만 행 38열에서 열을 다 그리면 한 번에 약 17ms, 보이는 열만 그리면 약 6ms).
    const vis = visibleRange();
    const start = Math.max(vis.start - OVERSCAN, 0);
    const end = Math.min(vis.end + OVERSCAN, n);
    const fc = mode === 'column' ? 1 : 0;
    const c0 = Math.max(vis.c0 - COL_OVERSCAN, fc);
    const c1 = Math.min(vis.c1 + COL_OVERSCAN, colCount - 1);
    drawn = { start, end, c0, c1 };
    // 그릴 칸 차례: 세로 머리글의 고정 열, 왼쪽 빈자리, 보이는 열들, 오른쪽 빈자리. 빈자리는 그리지 않은 열들의 너비를 채운다.
    const plan: Slot[] = [];
    if (fc && colCount) plan.push(0);
    if (c0 <= c1) {
        const before = colLeft(c0) - (fc ? widths[0] : 0);
        if (before > 0) plan.push({ gap: before });
        for (let c = c0; c <= c1; c++) plan.push(c);
        const after = colLeft(colCount) - colLeft(c1 + 1);
        if (after > 0) plan.push({ gap: after });
    }
    const rs = ranges();
    const count = rs.reduce((sum, [r1, c1, r2, c2]) => sum + (r2 - r1 + 1) * (c2 - c1 + 1), 0);
    const mvR = movableBlock('row');
    const mvC = movableBlock('col');

    let html = `<colgroup><col style="width:${numW}px">`;
    for (const s of plan) html += `<col style="width:${typeof s === 'number' ? widths[s] : s.gap}px">`;
    // 왼쪽 위 네모를 누르면 전체 선택이다(구글 시트처럼).
    html += `</colgroup><thead><tr class="letters" style="${trStyle(lettersH())}"><th class="corner" title="${esc(text.selectAll)}"></th>`;
    for (const c of plan) {
        if (typeof c !== 'number') {
            html += '<th class="gap"></th>';
            continue;
        }
        const cls = [rs.some(([, c1, , c2]) => c >= c1 && c <= c2) ? 'on' : '', mode === 'column' && c === 0 ? 'hc' : '', mvC && c >= mvC[0] && c <= mvC[1] ? 'mv' : '', movingCol(c) ? 'mv-src' : ''].join(' ').replace(/ +/g, ' ').trim();
        // 열 이름 오른쪽 경계를 끌면 너비가 바뀐다.
        html += `<th data-c="${c}"${cls ? ` class="${cls}"` : ''}>${colName(c)}<span class="rs rs-c" data-rc="${c}"></span></th>`;
    }
    html += '</tr>';
    if (fb) html += `<tr class="hdr" style="${trStyle(rowHeight(0))}">${rowHtml(0, rs, count > 1, mvR, plan)}</tr>`;
    html += '</thead><tbody>';
    if (start > 0) html += pad(tops[start], plan.length);
    // 끄는 동안 옮기는 원래 행은 흐리게 그린다.
    const dim = (r: number): string => (moving?.active && moving.kind === 'row' && r >= moving.from && r < moving.from + moving.count ? ' class="mv-src"' : '');
    for (let k = start; k < end; k++) html += `<tr${dim(k + fb)} style="${trStyle(rowHeight(k + fb))}">${rowHtml(k + fb, rs, count > 1, mvR, plan)}</tr>`;
    if (end < n) html += pad(tops[n] - tops[end], plan.length);
    table.innerHTML = html + '</tbody>';
    table.style.width = `${numW + colLeft(colCount)}px`;

    addrText.textContent = `${colName(sel.col)}${sel.row + 1}`;
    selText.textContent = count > 1 ? text.selected.replace('{n}', count.toLocaleString()) : '';
    placeEditor();
    saveState();
}

/** 탭을 옮겼다 와도 이어지게 지금 셀과 스크롤 자리를 웹뷰 상태에 둔다. */
function saveState(): void {
    vscodeApi.setState({ row: sel.row, col: sel.col, top: grid.scrollTop, left: grid.scrollLeft } satisfies ViewState);
}

/** 지금 스크롤 자리에서 보이는 본문 행 [start, end)와 스크롤되는 열 [c0, c1](세로 머리글의 고정 열은 빼고 센다). */
function visibleRange(): { start: number; end: number; c0: number; c1: number } {
    const n = rows.length - firstBody();
    const start = clamp(findRow(grid.scrollTop), 0, n);
    const end = clamp(findRow(grid.scrollTop + grid.clientHeight - headH()) + 1, start, n);
    // 열은 행 번호와 고정 열 오른쪽부터 표 영역 오른쪽 끝까지가 보이는 곳이다.
    const left = grid.scrollLeft + stickyColW();
    const right = grid.scrollLeft + grid.clientWidth - numW;
    let c = 0;
    let x = 0;
    while (c < colCount - 1 && x + widths[c] <= left) x += widths[c++];
    const c0 = c;
    while (c < colCount - 1 && x + widths[c] < right) x += widths[c++];
    return { start, end, c0, c1: c };
}

/** 그리지 않은 행 자리를 채우는 빈 행. span은 행 번호 칸 말고 그린 칸 수다. */
function pad(height: number, span: number): string {
    return `<tr><td class="pad" colspan="${span + 1}" style="height:${height}px"></td></tr>`;
}

/** mvR: 끌어 옮길 수 있게 통째로 고른 행 묶음(손 모양 커서). plan: 그릴 칸 차례(render 참고). */
function rowHtml(r: number, rs: Rect[], multi: boolean, mvR: [number, number] | null, plan: Slot[]): string {
    const vals = rows[r];
    const on = rs.some(([r1, , r2]) => r >= r1 && r <= r2);
    // 행 번호 아래쪽 경계를 끌면 높이가 바뀐다.
    const mv = mvR && r >= mvR[0] && r <= mvR[1] ? ' mv' : '';
    let h = `<th class="num${on ? ' on' : ''}${mv}" data-r="${r}">${r + 1}<span class="rs rs-r" data-rr="${r}"></span></th>`;
    for (const c of plan) {
        if (typeof c !== 'number') {
            h += '<td class="gap"></td>';
            continue;
        }
        const cls: string[] = [];
        // 지금 셀은 진한 테두리만, 나머지 고른 셀은 파란 배경이다(구글 시트처럼 지금 셀은 배경을 칠하지 않는다).
        if (r === sel.row && c === sel.col) cls.push('sel');
        else if (multi && inRanges(rs, r, c)) cls.push('in');
        if (movingCol(c)) cls.push('mv-src');
        if (mode === 'column' && c === 0) cls.push('hc');
        // 줄무늬: 가로 머리글이면 본문 행을, 세로 머리글이면 본문 열을 하나 건너 하나씩 칠한다(2026-11-21 사용자 지시로 0.3 첫 판 방향으로 되돌림).
        // 머리글 셀은 칠하지 않는다. 파일 번호 기준이라 스크롤해도 무늬가 그대로다.
        else if ((mode === 'row' && r > 0 && r % 2 === 0) || (mode === 'column' && c > 0 && c % 2 === 0)) cls.push('z');
        // 찾은 셀은 노란 바탕, 지금 결과는 더 진한 바탕이다.
        const key = r * FIND_KEY + c;
        if (foundSet.has(key)) cls.push(key === found[foundIdx] ? 'found-cur' : 'found');
        const edge = multi ? rangeEdges(rs, r, c) : '';
        h += `<td data-r="${r}" data-c="${c}"${cls.length ? ` class="${cls.join(' ')}"` : ''}${edge}>${shown(vals[c] ?? '')}</td>`;
    }
    return h;
}

/** 고른 범위의 바깥 테두리. 범위 가장자리에 있는 셀에만 그 쪽 선을 긋는다. */
function rangeEdges(rs: Rect[], r: number, c: number): string {
    let top = false;
    let bottom = false;
    let left = false;
    let right = false;
    for (const [r1, c1, r2, c2] of rs) {
        if (r < r1 || r > r2 || c < c1 || c > c2) continue;
        top ||= r === r1;
        bottom ||= r === r2;
        left ||= c === c1;
        right ||= c === c2;
    }
    const lines: string[] = [];
    if (top) lines.push('inset 0 2px 0 var(--sel-line)');
    if (bottom) lines.push('inset 0 -2px 0 var(--sel-line)');
    if (left) lines.push('inset 2px 0 0 var(--sel-line)');
    if (right) lines.push('inset -2px 0 0 var(--sel-line)');
    return lines.length ? ` style="box-shadow:${lines.join(',')}"` : '';
}

/** 입력칸을 지금 셀 위에 둔다. 고치지 않을 때도 투명한 채로 포커스를 지켜 첫 글자를 받는다. */
function placeEditor(): void {
    const g = grid.getBoundingClientRect();
    const inHead = mode === 'row' && sel.row === 0;
    const inHeadCol = mode === 'column' && sel.col === 0;
    const h = rowHeight(sel.row);
    const top = inHead ? g.top + lettersH() : g.top + headH();
    const left = g.left + numW + (inHeadCol ? 0 : stickyColW());
    const x = inHeadCol ? left : g.left + numW + colLeft(sel.col) - grid.scrollLeft;
    const y = inHead ? top : top + (tops[sel.row - firstBody()] ?? 0) - grid.scrollTop;
    // 셀이 화면 밖이면 표 안쪽 가장자리에 붙인다. 한글 입력 창이 엉뚱한 곳에 뜨지 않게 하려고.
    editor.style.left = `${clamp(x, left, Math.max(left, g.right - 60))}px`;
    editor.style.top = `${clamp(y, top, Math.max(top, g.bottom - h))}px`;
    editor.style.minWidth = `${widths[sel.col] ?? 48}px`;
    editor.style.lineHeight = `${Math.round((BASE_ROW_H - 4) * zoom)}px`;
    if (editing) fitEditor();
    else editor.style.height = `${h}px`;
}

/** 고치는 동안 입력칸 크기를 글자에 맞춘다. */
function fitEditor(): void {
    const lines = editor.value.split('\n');
    setRulerFont();
    let w = 0;
    for (const line of lines.slice(0, 50)) w = Math.max(w, ruler.measureText(line).width);
    editor.style.width = `${clamp(Math.ceil(w * zoom) + 24, widths[sel.col] ?? 48, 600 * zoom)}px`;
    const textH = clamp(lines.length, 1, 10) * Math.round((BASE_ROW_H - 4) * zoom) + 4;
    editor.style.height = `${Math.max(rowHeight(sel.row), textH)}px`;
}

/** 지정한 셀이 화면에 보이도록 스크롤한다. row나 col이 없으면 그 축은 그대로 둔다(행, 열 통째로 고를 때 다른 축이 튀지 않게). */
function reveal(p: Partial<Pos>): void {
    if (layoutDirty) layout();
    if (p.row !== undefined && !(mode === 'row' && p.row === 0)) {
        const y = tops[p.row - firstBody()] ?? 0;
        const h = rowHeight(p.row);
        const viewH = grid.clientHeight - headH();
        if (y < grid.scrollTop) grid.scrollTop = y;
        else if (y + h > grid.scrollTop + viewH) grid.scrollTop = y + h - viewH;
    }
    if (p.col !== undefined && !(mode === 'column' && p.col === 0)) {
        // 고정된 머리글 열 뒤에 가려지지 않게, 그 너비만큼 뺀 자리를 기준으로 본다.
        const stick = stickyColW();
        const x = colLeft(p.col) - stick;
        const w = widths[p.col];
        const viewW = grid.clientWidth - numW - stick;
        if (x < grid.scrollLeft) grid.scrollLeft = x;
        else if (x + w > grid.scrollLeft + viewW) grid.scrollLeft = x + w - viewW;
    }
}

/** 고르기 상태를 바꾸고, show 셀이 보이게 스크롤한 뒤 다시 그린다. show에 없는 축은 스크롤하지 않는다. */
function setSelection(nextSel: Pos, nextAnchor: Pos, nextHead: Pos, nextExtra: Rect[], show: Partial<Pos>): void {
    if (!rows.length) return;
    const fix = (p: Pos): Pos => ({ row: clamp(p.row, 0, rows.length - 1), col: clamp(p.col, 0, colCount - 1) });
    const before = selectionKey();
    sel = fix(nextSel);
    anchor = fix(nextAnchor);
    head = fix(nextHead);
    extra = nextExtra;
    reveal({
        row: show.row === undefined ? undefined : clamp(show.row, 0, rows.length - 1),
        col: show.col === undefined ? undefined : clamp(show.col, 0, colCount - 1),
    });
    // 같은 셀을 다시 누르면 다시 그리지 않는다. 두 번 누르기가 같은 셀 요소 위에서 일어나야 인식되기 때문이다.
    if (selectionKey() !== before) render();
}

function selectCell(r: number, c: number): void {
    const p = { row: r, col: c };
    setSelection(p, p, p, [], p);
}

/** 지금 범위의 움직이는 끝만 옮긴다(Shift+방향키). 지금 셀과 시작 셀은 그대로다. */
function extendTo(p: Pos): void {
    // 바뀐 축만 보이게 한다. 열을 통째로 고른 뒤 Shift+→ 하면 움직이는 끝이 맨 아래 행이라, 두 축을 다 보이게 하면 표 끝으로 튄다.
    setSelection(sel, anchor, p, extra, { row: p.row !== head.row ? p.row : undefined, col: p.col !== head.col ? p.col : undefined });
}

function selectAll(): void {
    setSelection(sel, { row: 0, col: 0 }, { row: rows.length - 1, col: colCount - 1 }, [], sel);
}

/** 표가 바뀐 뒤 고른 셀과 범위가 표 밖으로 나가지 않게 맞춘다. */
function clampSelection(): void {
    if (!rows.length) return;
    const lastRow = rows.length - 1;
    const lastCol = colCount - 1;
    const fix = (p: Pos): Pos => ({ row: clamp(p.row, 0, lastRow), col: clamp(p.col, 0, lastCol) });
    // 표 밖으로 완전히 나간 범위는 버린다. 표 끝으로 접어 남기면 Delete가 고르지 않은 셀을 비운다.
    const outside = ([r1, c1]: Rect): boolean => r1 > lastRow || c1 > lastCol;
    sel = fix(sel);
    if (outside(rectOf(anchor, head))) {
        anchor = { ...sel };
        head = { ...sel };
    } else {
        anchor = fix(anchor);
        head = fix(head);
    }
    extra = extra.filter((rc) => !outside(rc)).map(([r1, c1, r2, c2]): Rect => [r1, c1, Math.min(r2, lastRow), Math.min(c2, lastCol)]);
}

/** 셀 값들을 바꾼다. 확장이 파일을 고친 뒤 새 표를 다시 보내 주지만, 그 사이에도 바로 보이게 먼저 바꿔 둔다. */
function setCells(cells: [number, number, string][]): void {
    // 바꾸기 전 값을 같이 보낸다. 확장은 지금 파일의 그 셀이 이 값일 때만 바꾼다(그 사이 파일이 밖에서 바뀌었으면 다른 행에 쓰지 않게).
    const changed = cells.filter(([r, c, v]) => cell(r, c) !== v).map(([r, c, v]): [number, number, string, string] => [r, c, v, cell(r, c)]);
    if (!changed.length) return;
    for (const [r, c, v] of changed) {
        const row = rows[r];
        if (!row) continue;
        while (row.length < c) row.push('');
        row[c] = v;
    }
    vscodeApi.postMessage({ type: 'op', op: { kind: 'setCells', cells: changed } });
    render();
}

/** 고른 셀을 모두 비운다. 되돌리기 한 번에 돌아온다. */
function clearSelected(): void {
    const cells: [number, number, string][] = [];
    for (const [r1, c1, r2, c2] of ranges()) {
        for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (cell(r, c) !== '') cells.push([r, c, '']);
    }
    setCells(cells);
}

/** 셀 고치기를 시작한다. initial이 null이면 입력칸에 이미 들어온 글자(첫 타자, 한글 조합)를 그대로 쓴다. */
function startEditing(initial: string | null): void {
    if (!rows.length) return;
    editing = true;
    editOrigin = rows[sel.row].slice();
    if (initial !== null) {
        editor.value = initial.replace(/\r\n?/g, '\n');
        editor.setSelectionRange(editor.value.length, editor.value.length);
    }
    editor.classList.add('editing');
    // 고치기를 시작하면 고른 범위는 지금 셀 하나로 줄인다.
    anchor = { ...sel };
    head = { ...sel };
    extra = [];
    reveal(sel);
    render();
}

function stopEditing(): void {
    editing = false;
    editor.classList.remove('editing');
    editor.value = '';
    editor.style.width = '';
}

/**
 * 마우스로 다른 곳을 누를 때의 확정. 한글 조합 중이면 입력칸 포커스를 잠깐 빼서 조합을 먼저 끝낸다(blur 처리기가 확정한다).
 * 조합 중에 값을 비우면 입력기가 조합 글자를 다시 넣어 다음 셀의 고치기가 그 글자로 시작될 수 있다.
 */
function commitInput(): void {
    if (composing) {
        editor.blur();
        editor.focus({ preventScroll: true });
    }
    commit();
}

function commit(): void {
    if (!editing) return;
    const old = cell(sel.row, sel.col);
    let v = editor.value;
    stopEditing();
    // 입력칸은 줄바꿈을 \n으로 바꾸므로, 고치지 않고 끝내면 파일도 그대로 둔다.
    if (v === old.replace(/\r\n?/g, '\n')) return;
    // 원래 셀이 \r\n 줄바꿈이었으면 그 모양을 따른다.
    if (old.includes('\r\n')) v = v.replace(/\n/g, '\r\n');
    setCells([[sel.row, sel.col, v]]);
}

/** 범위 하나를 값 표로 잘라 낸다. */
function cut([r1, c1, r2, c2]: Rect): string[][] {
    const out: string[][] = [];
    for (let r = r1; r <= r2; r++) {
        const line: string[] = [];
        for (let c = c1; c <= c2; c++) line.push(cell(r, c));
        out.push(line);
    }
    return out;
}

/**
 * 복사할 값 표. 범위가 여러 개면 엑셀처럼, 모두 같은 열들에 걸쳐 있으면 위아래로,
 * 모두 같은 행들에 걸쳐 있으면 좌우로 잇는다. 둘 다 아니면 null이다.
 */
function selectionBlock(): string[][] | null {
    const rs = ranges();
    if (rs.length === 1) return cut(rs[0]);
    if (rs.every(([, c1, , c2]) => c1 === rs[0][1] && c2 === rs[0][3])) {
        return [...rs].sort((a, b) => a[0] - b[0]).flatMap(cut);
    }
    if (rs.every(([r1, , r2]) => r1 === rs[0][0] && r2 === rs[0][2])) {
        const parts = [...rs].sort((a, b) => a[1] - b[1]).map(cut);
        return parts[0].map((_, i) => parts.flatMap((p) => p[i]));
    }
    return null;
}

/** 구글 시트가 읽는 탭 나눔 글자. 탭, 줄바꿈, 큰따옴표가 있는 셀은 큰따옴표로 감싼다. */
function toTsv(block: string[][]): string {
    const one = (v: string): string => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    // 엑셀처럼 행마다 끝에 줄바꿈을 붙인다. 붙여 넣을 때 맨 끝 줄바꿈 하나는 행으로 치지 않으므로,
    // 이렇게 해야 끝의 빈 셀과 빈 셀 하나짜리 복사도 그대로 붙여 넣어진다.
    return block.map((line) => line.map(one).join('\t') + '\r\n').join('');
}

/** 구글 시트는 붙여 넣을 때 HTML 표가 있으면 먼저 써서 셀을 더 정확히 나눈다. */
function toHtml(block: string[][]): string {
    const one = (v: string): string => `<td>${esc(v).replace(/\r\n|\r|\n/g, '<br>')}</td>`;
    return `<table>${block.map((line) => `<tr>${line.map(one).join('')}</tr>`).join('')}</table>`;
}

/** 고른 셀을 클립보드에 넣는다. 복사할 수 없는 고르기면 안내를 띄우고 false를 돌려준다. */
function copySelection(e: ClipboardEvent): boolean {
    const block = selectionBlock();
    if (!block) {
        notify(text.multiCopy);
        return false;
    }
    e.clipboardData?.setData('text/plain', toTsv(block));
    e.clipboardData?.setData('text/html', toHtml(block));
    return true;
}

/** 위쪽 막대에 안내를 잠깐 띄운다. */
function notify(message: string): void {
    noteText.textContent = message;
    clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => (noteText.textContent = ''), 5000);
}

/** 배율, 사용자가 바꾼 열 너비와 행 높이를 확장에 보내 파일마다 기억하게 한다. */
function saveView(part: 'zoom' | 'sizes'): void {
    // 바뀐 것만 보낸다. 확장이 기억한 값에 합친다. 전체를 보내면, 크기가 내용을 따라 바뀐 직후(행 지우기, 옮기기)
    // 그 새 크기가 여기 닿기 전에 배율을 바꿀 때 옛 크기로 덮는다.
    vscodeApi.postMessage({ type: 'saveView', view: part === 'zoom' ? { zoom } : { colW, rowH: rowHt } });
}

/** 본문 자리 (x, y)(열 0의 왼쪽, 본문 첫 행의 위 기준)를 열, 행 번호와 그 칸 안의 비율로 바꾼다. 배율을 바꾼 뒤 같은 곳을 다시 찾는 데 쓴다. */
function spotAt(x: number, y: number): Spot {
    let c = 0;
    let left = 0;
    while (c < colCount - 1 && left + widths[c] <= x) left += widths[c++];
    const k = findRow(y);
    return { c, fx: (x - left) / (widths[c] || 1), k, fy: (y - tops[k]) / (tops[k + 1] - tops[k] || 1) };
}

/** spotAt으로 적은 곳의 지금 배율에서의 본문 자리 */
function spotPos(s: Spot): Point {
    return { x: colLeft(s.c) + s.fx * (widths[s.c] ?? 0), y: tops[s.k] + s.fy * (tops[s.k + 1] - tops[s.k] || 0) };
}

/** 지금 셀 가운데의 화면 자리(표 영역 왼쪽 위 기준). 배율 버튼의 기준점이다. */
function selPoint(): Point {
    if (layoutDirty) layout();
    return {
        x: numW + colLeft(sel.col) + (widths[sel.col] ?? 0) / 2 - grid.scrollLeft,
        y: headH() + (tops[sel.row - firstBody()] ?? 0) + rowHeight(sel.row) / 2 - grid.scrollTop,
    };
}

/**
 * 배율을 바꾼다. 화면 자리 pivot(표 영역 왼쪽 위 기준)에 있던 곳이 바꾼 뒤에도 그 자리에 오게 스크롤한다
 * (2026-11-21 사용자 지시: Ctrl+휠은 마우스 자리, 버튼은 지금 셀 기준). 행, 열 번호로 다시 찾으므로 반올림 오차가 쌓이지 않는다.
 */
function setZoom(next: number, pivot: Point): void {
    zoomPct.textContent = `${Math.round(next * 100)}%`;
    if (next === zoom) return;
    if (!loaded) {
        zoom = next;
        layoutDirty = true;
        return;
    }
    if (layoutDirty) layout();
    // 고정된 열 이름, 머리글, 행 번호 위나 표 밖이면 가장 가까운 본문 자리를 기준으로 한다.
    const px = clamp(pivot.x, numW + stickyColW(), grid.clientWidth);
    const py = clamp(pivot.y, headH(), grid.clientHeight);
    const spot = spotAt(grid.scrollLeft + px - numW, grid.scrollTop + py - headH());
    zoom = next;
    layoutDirty = true;
    render();
    const p = spotPos(spot);
    grid.scrollLeft = p.x + numW - px;
    grid.scrollTop = p.y + headH() - py;
    render();
    saveView('zoom');
}

/** 배율 단계를 하나 올리거나(1) 내린다(-1). */
function zoomStep(dir: number, pivot: Point): void {
    let i = ZOOMS.indexOf(zoom);
    if (i < 0) i = ZOOMS.indexOf(1);
    setZoom(ZOOMS[clamp(i + dir, 0, ZOOMS.length - 1)], pivot);
}

/**
 * 크기를 바꿀 열이나 행들. 끄는 열(행)이 열(행) 통째로 고른 범위 안에 있으면 그 범위의 열(행) 모두이고,
 * 아니면 그 열(행) 하나다(구글 시트 방식).
 */
function resizeTargets(kind: 'col' | 'row', index: number): number[] {
    const out = new Set<number>();
    for (const [r1, c1, r2, c2] of ranges()) {
        if (kind === 'col' && r1 === 0 && r2 === rows.length - 1 && index >= c1 && index <= c2) {
            for (let c = c1; c <= c2; c++) out.add(c);
        }
        if (kind === 'row' && c1 === 0 && c2 === colCount - 1 && index >= r1 && index <= r2) {
            for (let r = r1; r <= r2; r++) out.add(r);
        }
    }
    if (!out.size) out.add(index);
    return [...out];
}

/**
 * 찾을 글자로 표 전체를 다시 찾는다. 대소문자는 가리지 않고, 셀 값 안에 들어 있으면 찾은 것이다.
 * move가 true면 지금 셀 다음(지금 셀 포함)의 첫 결과로 옮겨 가고, false면 고르기는 그대로 두고 결과만 새로 센다.
 */
function runFind(move: boolean): void {
    clearTimeout(findTimer);
    findTimer = 0;
    const q = findInput.value.toLowerCase();
    found = [];
    if (q) {
        outer: for (let r = 0; r < rows.length; r++) {
            const vals = rows[r];
            for (let c = 0; c < vals.length; c++) {
                if (vals[c] && vals[c].toLowerCase().includes(q)) {
                    found.push(r * FIND_KEY + c);
                    if (found.length >= FIND_MAX) break outer;
                }
            }
        }
    }
    foundSet = new Set(found);
    const at = sel.row * FIND_KEY + sel.col;
    foundIdx = found.findIndex((k) => k >= at);
    if (foundIdx < 0 && found.length) foundIdx = 0;
    if (move && foundIdx >= 0) goFound();
    else showFound();
}

/** 지금 결과 셀을 골라 화면에 보이게 한다. */
function goFound(): void {
    // 고치는 중이면 먼저 확정한다. 찾기 버튼은 입력칸 포커스를 지키므로, 확정하지 않으면 입력이 다음 결과 셀에 들어간다.
    commitInput();
    const k = found[foundIdx];
    selectCell(Math.floor(k / FIND_KEY), k % FIND_KEY);
    showFound();
}

/** 결과 개수를 적고 강조를 다시 그린다. */
function showFound(): void {
    findCount.textContent = !findInput.value ? '' : found.length ? `${foundIdx + 1} / ${found.length.toLocaleString()}${found.length >= FIND_MAX ? '+' : ''}` : text.findNone;
    findBox.classList.toggle('none', !!findInput.value && !found.length);
    if (loaded) render();
}

/** 다음(1) 또는 이전(-1) 결과로 간다. 끝에서는 처음으로 돌아간다. */
function findStep(dir: number): void {
    if (findTimer) {
        // 친 글자로 아직 찾지 않았으면, 다음은 지금 셀부터의 첫 결과다(한 칸 더 넘기면 첫 결과를 건너뛴다).
        runFind(false);
        if (!found.length) return;
        if (dir > 0) return goFound();
    }
    if (!found.length) return;
    foundIdx = (foundIdx + dir + found.length) % found.length;
    goFound();
}

function openFind(): void {
    // 표 오른쪽 위에 띄운다. 위쪽 막대 높이가 글꼴에 따라 달라서 열 때마다 자리를 잡는다.
    findBox.style.top = `${grid.getBoundingClientRect().top + 6}px`;
    findBox.hidden = false;
    findInput.focus();
    findInput.select();
    if (findInput.value) runFind(false);
}

function closeFind(): void {
    findBox.hidden = true;
    clearTimeout(findTimer);
    found = [];
    foundSet = new Set();
    foundIdx = -1;
    if (loaded) render();
    editor.focus({ preventScroll: true });
}

function onKey(e: KeyboardEvent): void {
    // 한글, 번체 등을 조합하는 중에는 Enter 등을 입력기에 맡긴다.
    if (e.isComposing || e.keyCode === 229) return;
    // Ctrl+F: 찾기 상자를 연다. 고치는 중이면 먼저 확정한다. 한글 입력 상태에서도 되도록 글쇠 자리(code)로 본다.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyF') {
        e.preventDefault();
        commit();
        openFind();
        return;
    }
    // 찾기 상자가 열려 있으면 F3, Shift+F3으로 표에서도 결과를 넘긴다.
    if (!findBox.hidden && e.key === 'F3') {
        e.preventDefault();
        commit();
        findStep(e.shiftKey ? -1 : 1);
        return;
    }
    // Ctrl+S: 고치던 값을 먼저 확정하고, 확장이 그 고침을 파일에 반영한 뒤 저장하게 한다.
    // VS Code에 바로 맡기면 고침이 파일에 들어가기 전에 저장된다.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyS') {
        e.preventDefault();
        e.stopPropagation();
        commit();
        vscodeApi.postMessage({ type: 'save' });
        return;
    }
    if (editing) {
        if (e.key === 'Enter' && e.altKey) {
            e.preventDefault();
            editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
            fitEditor();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            e.preventDefault();
            commit();
            const step = e.shiftKey ? -1 : 1;
            if (e.key === 'Enter') selectCell(sel.row + step, sel.col);
            else selectCell(sel.row, sel.col + step);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            stopEditing();
        }
        return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    // Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z: 열 너비, 행 높이 바꾼 것도 글자 고친 것과 한 순서로 되돌린다. 어느 쪽 차례인지는 확장이 정한다.
    // VS Code까지 가면 글자만 되돌리므로 여기서 멈춘다(VS Code는 웹뷰 창(window)에서 키를 받는다).
    if (ctrl && !e.altKey && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        e.stopPropagation();
        vscodeApi.postMessage({ type: e.code === 'KeyY' || e.shiftKey ? 'redo' : 'undo' });
        return;
    }
    // Ctrl+Tab, Ctrl+PageUp 같은 탭 넘기기는 VS Code에 맡긴다.
    if (ctrl && (e.key === 'Tab' || e.key === 'PageUp' || e.key === 'PageDown')) return;
    if (!rows.length) return;
    // 한글 입력 상태에서도 되도록 글쇠 자리(code)로 본다.
    if (ctrl && !e.shiftKey && !e.altKey && e.code === 'KeyA') {
        e.preventDefault();
        selectAll();
        return;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        selectCell(sel.row, sel.col + (e.shiftKey ? -1 : 1));
        return;
    }
    // Shift를 누르면 지금 셀 대신 범위의 움직이는 끝을 옮겨 범위를 늘린다.
    const from = e.shiftKey ? head : sel;
    const page = Math.max(1, Math.floor((grid.clientHeight - headH()) / (BASE_ROW_H * zoom)) - 1);
    const last = rows.length - 1;
    const lastCol = colCount - 1;
    const moves: Record<string, Pos> = {
        ArrowUp: { row: ctrl ? 0 : from.row - 1, col: from.col },
        ArrowDown: { row: ctrl ? last : from.row + 1, col: from.col },
        ArrowLeft: { row: from.row, col: ctrl ? 0 : from.col - 1 },
        ArrowRight: { row: from.row, col: ctrl ? lastCol : from.col + 1 },
        Home: { row: ctrl ? 0 : from.row, col: 0 },
        End: { row: ctrl ? last : from.row, col: lastCol },
        PageUp: { row: from.row - page, col: from.col },
        PageDown: { row: from.row + page, col: from.col },
    };
    const to = moves[e.key];
    if (to) {
        e.preventDefault();
        if (e.shiftKey) extendTo(to);
        else selectCell(to.row, to.col);
        // 키보드로 고정 머리글 행(열)에 가면 그 축을 맨 처음으로 스크롤한다. 머리글은 늘 보이지만 첫 데이터가 가려져 있지 않게.
        if (mode === 'row' && to.row <= 0) grid.scrollTop = 0;
        if (mode === 'column' && to.col <= 0) grid.scrollLeft = 0;
        return;
    }
    // Ctrl+S 같은 단축키는 VS Code가 처리한다.
    if (ctrl || e.altKey) return;
    if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        startEditing(cell(sel.row, sel.col));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        clearSelected();
    } else if (e.key === 'Escape') {
        // 찾기 상자가 열려 있으면 먼저 닫는다(VS Code 편집기와 같다).
        if (!findBox.hidden) closeFind();
        else selectCell(sel.row, sel.col);
    }
}

editor.addEventListener('keydown', onKey);
editor.addEventListener('input', () => {
    // 빈 파일에서는 고칠 셀이 없다. 친 글자가 숨은 입력칸에 쌓였다가 나중에 한꺼번에 들어가지 않게 비운다.
    if (!rows.length) {
        editor.value = '';
        return;
    }
    if (editing) fitEditor();
    else startEditing(null);
});
editor.addEventListener('compositionstart', () => {
    composing = true;
    if (!editing) startEditing(null);
});
editor.addEventListener('compositionend', () => (composing = false));
editor.addEventListener('blur', commit);

// 고치는 중이 아닐 때 복사, 잘라내기, 붙여 넣기는 고른 셀에 대해 한다. 고치는 중에는 보통 글자 복사, 붙여 넣기다.
editor.addEventListener('copy', (e) => {
    if (editing || !rows.length) return;
    e.preventDefault();
    copySelection(e);
});
editor.addEventListener('cut', (e) => {
    if (editing || !rows.length) return;
    e.preventDefault();
    if (copySelection(e)) clearSelected();
});
editor.addEventListener('paste', (e) => {
    if (editing) return;
    e.preventDefault();
    const data = e.clipboardData?.getData('text/plain') ?? '';
    if (!data) return;
    // 지금 범위의 왼쪽 위 셀부터 채운다. 글자를 셀로 나누는 일은 확장이 한다(csv.ts의 pasteCells).
    const [r1, c1] = rows.length ? rectOf(anchor, head) : [0, 0];
    vscodeApi.postMessage({ type: 'op', op: { kind: 'paste', row: r1, col: c1, text: data, fill: rows.length ? ranges() : [] } });
});

grid.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (!rows.length) return;
    // 열 이름, 행 번호 경계: 끌어서 크기를 바꾼다. 고르기는 하지 않는다.
    const handle = target.closest<HTMLElement>('.rs');
    if (handle && e.button === 0) {
        e.preventDefault();
        commitInput();
        const kind = handle.dataset.rc !== undefined ? 'col' : 'row';
        const index = Number(kind === 'col' ? handle.dataset.rc : handle.dataset.rr);
        const base = kind === 'col' ? colW[index] ?? autoW[index] : rowHt[index] ?? BASE_ROW_H;
        resizing = { kind, targets: resizeTargets(kind, index), start: kind === 'col' ? e.clientX : e.clientY, base };
        document.body.classList.add(kind === 'col' ? 'col-resizing' : 'row-resizing');
        return;
    }
    // 왼쪽 위 네모: 전체 선택
    if (target.closest('th.corner')) {
        e.preventDefault();
        commitInput();
        selectAll();
        editor.focus({ preventScroll: true });
        return;
    }
    const t = target.closest<HTMLElement>('[data-r], [data-c]');
    if (!t) return;
    // 입력칸 포커스를 지키려고 기본 동작을 막는다.
    e.preventDefault();
    commitInput();
    const r = t.dataset.r === undefined ? -1 : Number(t.dataset.r);
    const c = t.dataset.c === undefined ? -1 : Number(t.dataset.c);
    // 열 이름을 누르면 그 열 전체, 행 번호를 누르면 그 행 전체다.
    const unit: DragMode = r < 0 ? 'col' : c < 0 ? 'row' : 'cell';
    const a: Pos = unit === 'col' ? { row: 0, col: c } : unit === 'row' ? { row: r, col: 0 } : { row: r, col: c };
    const h: Pos = unit === 'col' ? { row: rows.length - 1, col: c } : unit === 'row' ? { row: r, col: colCount - 1 } : a;
    // 행이나 열 전체를 고를 때는 그 축만 보이게 해서 화면이 맨 위나 맨 왼쪽으로 튀지 않게 한다.
    const show: Partial<Pos> = unit === 'col' ? { col: c } : unit === 'row' ? { row: r } : h;
    // 통째로 고른 행(열) 묶음 안의 행 번호(열 이름)를 누르면 끌어서 그 묶음을 옮긴다(2026-11-21 사용자 지시).
    // 끌지 않고 놓으면 그냥 누른 것으로 친다(mouseup에서 click).
    const block = e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && unit !== 'cell' ? movableBlock(unit) : null;
    const at = unit === 'row' ? r : c;
    if (block && at >= block[0] && at <= block[1]) {
        const click = (): void => setSelection(a, a, h, [], show);
        moving = { kind: unit === 'row' ? 'row' : 'col', from: block[0], count: block[1] - block[0] + 1, to: -1, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, active: false, click, size: 0, grab: 0 };
        editor.focus({ preventScroll: true });
        return;
    }
    if (e.button === 2) {
        // 오른쪽 버튼: 누른 곳이 고른 범위 안이면 범위는 두고 지금 셀만 옮긴다. 메뉴 작업은 범위가 걸친 행, 열 모두가 대상이다.
        // 행 번호, 열 이름은 그 행(열)이 통째로 고른 범위 안일 때만 범위를 둔다(구글 시트 방식).
        const rs = ranges();
        const keep =
            unit === 'cell'
                ? inRanges(rs, r, c)
                : unit === 'row'
                  ? rs.some(([r1, c1, r2, c2]) => r >= r1 && r <= r2 && c1 === 0 && c2 === colCount - 1)
                  : rs.some(([r1, c1, r2, c2]) => c >= c1 && c <= c2 && r1 === 0 && r2 === rows.length - 1);
        if (keep) setSelection(a, anchor, head, extra, show);
        else setSelection(a, a, h, [], show);
    } else if (e.shiftKey) {
        // Shift+클릭: 시작 셀은 두고 범위를 누른 곳까지 늘린다. 행 번호, 열 이름이면 행, 열 단위로 늘린다.
        const from: Pos = unit === 'col' ? { row: 0, col: anchor.col } : unit === 'row' ? { row: anchor.row, col: 0 } : anchor;
        setSelection(sel, from, h, extra, show);
        drag = unit;
    } else if (e.ctrlKey || e.metaKey) {
        // Ctrl+클릭: 지금 범위를 남겨 두고 새 범위를 시작한다.
        setSelection(a, a, h, [...extra, rectOf(anchor, head)], show);
        drag = unit;
    } else {
        setSelection(a, a, h, [], show);
        drag = unit;
    }
    editor.focus({ preventScroll: true });
});
// 누른 채 끌면 지금 범위의 움직이는 끝을 따라 옮긴다.
grid.addEventListener('mousemove', (e) => {
    if (!drag || resizing) return;
    if (!(e.buttons & 1)) {
        drag = null;
        return;
    }
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-r], [data-c]');
    if (!t) return;
    const r = t.dataset.r === undefined ? head.row : Number(t.dataset.r);
    const c = t.dataset.c === undefined ? head.col : Number(t.dataset.c);
    const h: Pos = drag === 'col' ? { row: rows.length - 1, col: c } : drag === 'row' ? { row: r, col: colCount - 1 } : { row: r, col: c };
    if (h.row !== head.row || h.col !== head.col) {
        head = h;
        render();
    }
});
// 크기 조절은 표 밖으로 나가도 이어지게 창 전체에서 받는다.
window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    // 표 화면 밖(VS Code 쪽)에서 버튼을 놓으면 mouseup이 오지 않는다. 버튼이 이미 놓였으면 거기서 끝낸다.
    if (!(e.buttons & 1)) return endResize();
    const moved = ((resizing.kind === 'col' ? e.clientX : e.clientY) - resizing.start) / zoom;
    const v = Math.round(resizing.kind === 'col' ? clamp(resizing.base + moved, COL_W_MIN, COL_W_MAX) : clamp(resizing.base + moved, ROW_H_MIN, ROW_H_MAX));
    const sizes = resizing.kind === 'col' ? colW : rowHt;
    for (const i of resizing.targets) sizes[i] = v;
    layoutDirty = true;
    if (!frame) frame = requestAnimationFrame(render);
});
window.addEventListener('mouseup', () => {
    drag = null;
    endResize();
});
/** 크기 조절을 끝내고 확장에 기억하게 한다. */
function endResize(): void {
    if (!resizing) return;
    resizing = null;
    document.body.classList.remove('col-resizing', 'row-resizing');
    saveView('sizes');
}
grid.addEventListener('mouseup', () => {
    if (!editing) editor.focus({ preventScroll: true });
});
grid.addEventListener('dblclick', (e) => {
    const target = e.target as HTMLElement;
    // 경계를 두 번 누르면 열은 내용에 맞추고, 행은 기본 높이로 되돌린다.
    const handle = target.closest<HTMLElement>('.rs');
    if (handle) {
        const kind = handle.dataset.rc !== undefined ? 'col' : 'row';
        const index = Number(kind === 'col' ? handle.dataset.rc : handle.dataset.rr);
        for (const i of resizeTargets(kind, index)) {
            if (kind === 'col') colW[i] = clamp(contentWidth(i, true), COL_W_MIN, FIT_MAX);
            else delete rowHt[i];
        }
        layoutDirty = true;
        render();
        saveView('sizes');
        return;
    }
    if (target.closest('td[data-c]')) startEditing(cell(sel.row, sel.col));
});
// 오른쪽 버튼 메뉴 명령의 대상(고른 범위가 걸친 행, 열 번호들)을 확장에 알린다. 빈 파일이면 행 번호로 -1을 보낸다.
grid.addEventListener('contextmenu', () =>
    vscodeApi.postMessage({ type: 'menu', rows: rows.length ? spanned(0) : [-1], cols: rows.length ? spanned(1) : [sel.col] }),
);

/** 고른 범위들이 걸친 행(which 0) 또는 열(which 1) 번호들. 작은 것부터. */
function spanned(which: 0 | 1): number[] {
    const set = new Set<number>();
    for (const rc of ranges()) for (let i = rc[which]; i <= rc[which + 2]; i++) set.add(i);
    return [...set].sort((x, y) => x - y);
}
grid.addEventListener('scroll', () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(onScrollFrame);
    // 끄는 중에 휠로 스크롤하면 마우스 아래 놓을 자리가 바뀐다.
    if (moving?.active) moveTo(moving.lastX, moving.lastY);
});

/**
 * 스크롤한 프레임. 보이는 행과 열이 이미 그려 둔 범위 안이면 다시 그리지 않고 입력칸 자리와 저장 상태만 맞춘다.
 * 다시 그리기가 한 프레임 예산을 거의 다 써서, 스크롤마다 그리면 버벅인다.
 */
function onScrollFrame(): void {
    scrollFrame = 0;
    if (!loaded) return;
    if (layoutDirty || !rows.length) return render();
    const v = visibleRange();
    if (v.start >= drawn.start && v.end <= drawn.end && v.c0 >= drawn.c0 && v.c1 <= drawn.c1) {
        placeEditor();
        saveState();
    } else render();
}

// 행, 열 끌어 옮기기(2026-11-21 "드래그 시 애니메이션, 어디로 들어갈지 미리보기, 드래그인지 아닌지 티가 안 난다").
// 끄는 동안: 옮기는 원래 자리는 흐리게(mv-src), 묶음 크기의 유령 상자가 마우스를 따라오고, 놓을 자리는 빛나는 선이 미끄러지며 옮겨 간다.
// 놓은 뒤: 새 자리가 파랗게 반짝였다 사라진다.
const overlay = (id: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.id = id;
    el.hidden = true;
    document.body.append(el);
    return el;
};
const moveLine = overlay('moveLine');
const moveGhost = overlay('moveGhost');
const moveFlash = overlay('moveFlash');
moveFlash.addEventListener('animationend', () => (moveFlash.hidden = true));
/** 옮긴 뒤 표가 새로 오면 반짝일 묶음 */
let pendingFlash: { kind: 'row' | 'col'; from: number; count: number } | null = null;

/** 끄는 중인 열 묶음에 든 열인지(원래 자리를 흐리게 그린다) */
function movingCol(c: number): boolean {
    return !!moving?.active && moving.kind === 'col' && c >= moving.from && c < moving.from + moving.count;
}

/**
 * 행(열) 묶음이 지금 화면에서 차지하는 자리(화면 기준 px). 네모는 보이는 본문 영역 안으로 자른 것이고,
 * start, size는 자르기 전 끄는 방향의 앞끝과 크기다.
 */
function blockRect(kind: 'row' | 'col', from: number, count: number): { left: number; top: number; width: number; height: number; start: number; size: number } {
    const g = grid.getBoundingClientRect();
    if (kind === 'row') {
        const k = from - firstBody();
        const start = g.top + headH() + tops[k] - grid.scrollTop;
        const size = tops[k + count] - tops[k];
        const top = Math.max(start, g.top + headH());
        const bottom = Math.min(start + size, g.top + grid.clientHeight);
        return { left: g.left, top, width: Math.min(grid.clientWidth, table.offsetWidth), height: Math.max(0, bottom - top), start, size };
    }
    const start = g.left + numW + colLeft(from) - grid.scrollLeft;
    let size = 0;
    for (let c = from; c < from + count; c++) size += widths[c];
    const left = Math.max(start, g.left + numW + stickyColW());
    const right = Math.min(start + size, g.left + grid.clientWidth);
    return { left, top: g.top, width: Math.max(0, right - left), height: Math.min(grid.clientHeight, table.offsetHeight), start, size };
}

/** 옮긴 묶음의 새 자리를 파랗게 반짝인다. */
function flashBlock(kind: 'row' | 'col', from: number, count: number): void {
    if (layoutDirty) layout();
    const b = blockRect(kind, from, count);
    if (b.width <= 0 || b.height <= 0) return;
    Object.assign(moveFlash.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    moveFlash.hidden = false;
    // 같은 이름을 다시 붙여도 애니메이션이 처음부터 돌게 한 번 뗐다가 붙인다.
    moveFlash.classList.remove('on');
    void moveFlash.offsetWidth;
    moveFlash.classList.add('on');
}

/** 행(열)을 통째로 고른 범위 하나면 그 [처음, 끝]. 끌어 옮길 수 있는 묶음이다. 고정된 머리글 행(열)이 들어 있으면 못 옮긴다. */
function movableBlock(kind: 'row' | 'col'): [number, number] | null {
    if (extra.length || !rows.length) return null;
    const [r1, c1, r2, c2] = rectOf(anchor, head);
    if (kind === 'row') return c1 === 0 && c2 === colCount - 1 && r1 >= firstBody() ? [r1, r2] : null;
    return r1 === 0 && r2 === rows.length - 1 && c1 >= (mode === 'column' ? 1 : 0) ? [c1, c2] : null;
}

/** 옮겨도 그대로인 자리(묶음 안이나 바로 뒤)인지 */
const moveIsNoop = (m: Moving): boolean => m.to < 0 || (m.to >= m.from && m.to <= m.from + m.count);

/** 마우스 자리 (x, y)(화면 기준)에서 놓을 틈을 찾아 파란 선을 옮긴다. 칸의 앞쪽 절반이면 그 칸 앞, 뒤쪽 절반이면 뒤다. */
function moveTo(x: number, y: number): void {
    const m = moving;
    if (!m) return;
    m.lastX = x;
    m.lastY = y;
    const g = grid.getBoundingClientRect();
    // 놓을 자리는 스크롤되는 본문 영역 안으로 당겨서 찾는다. 열 이름 줄이나 고정 머리글 위에서는 그 뒤에 가려진 행(열)이
    // 잡혀서, 선이 그려진 자리와 실제로 들어가는 자리가 달랐다.
    const bx = clamp(x, g.left + numW + stickyColW(), g.left + grid.clientWidth);
    const by = clamp(y, g.top + headH(), g.top + grid.clientHeight);
    const s = spotAt(bx - g.left - numW + grid.scrollLeft, by - g.top - headH() + grid.scrollTop);
    const fb = firstBody();
    m.to = m.kind === 'row' ? clamp(fb + s.k + (s.fy < 0.5 ? 0 : 1), fb, rows.length) : clamp(s.c + (s.fx < 0.5 ? 0 : 1), mode === 'column' ? 1 : 0, colCount);
    // 유령 상자: 묶음 크기(화면보다 크면 화면만큼)로, 누른 자리를 잡은 채 마우스를 따라온다. 반쯤은 표 안에 남게 한다.
    if (m.kind === 'row') {
        const h = Math.min(m.size, grid.clientHeight - headH());
        const top = clamp(y - Math.min(m.grab, h), g.top + headH() - h / 2, g.top + grid.clientHeight - h / 2);
        Object.assign(moveGhost.style, { left: `${g.left}px`, top: `${top}px`, width: `${Math.min(grid.clientWidth, table.offsetWidth)}px`, height: `${h}px` });
    } else {
        const w = Math.min(m.size, grid.clientWidth - numW);
        const left = clamp(x - Math.min(m.grab, w), g.left + numW - w / 2, g.left + grid.clientWidth - w / 2);
        Object.assign(moveGhost.style, { left: `${left}px`, top: `${g.top}px`, width: `${w}px`, height: `${Math.min(grid.clientHeight, table.offsetHeight)}px` });
    }
    moveLine.hidden = moveIsNoop(m);
    if (moveLine.hidden) return;
    // 선은 스크롤되는 본문 영역 안에만 그린다.
    if (m.kind === 'row') {
        const top = g.top + headH();
        const ly = clamp(g.top + headH() + tops[m.to - fb] - grid.scrollTop, top, g.top + grid.clientHeight);
        Object.assign(moveLine.style, { left: `${g.left}px`, top: `${ly - 1}px`, width: `${Math.min(grid.clientWidth, table.offsetWidth)}px`, height: '3px' });
    } else {
        const left = g.left + numW + stickyColW();
        const lx = clamp(g.left + numW + colLeft(m.to) - grid.scrollLeft, left, g.left + grid.clientWidth);
        Object.assign(moveLine.style, { left: `${lx - 1}px`, top: `${g.top}px`, width: '3px', height: `${Math.min(grid.clientHeight, table.offsetHeight)}px` });
    }
}

window.addEventListener('mousemove', (e) => {
    if (!moving) return;
    // 표 화면 밖에서 버튼을 놓아 mouseup을 놓쳤으면, 어디에 놓았는지 모르므로 옮기지 않고 끝낸다.
    if (!(e.buttons & 1)) return endMove(false);
    if (!moving.active) {
        // 손이 조금 떨린 것은 끌기로 보지 않는다.
        if (Math.abs(e.clientX - moving.x) + Math.abs(e.clientY - moving.y) < 5) return;
        moving.active = true;
        document.body.classList.add('moving');
        const b = blockRect(moving.kind, moving.from, moving.count);
        moving.size = b.size;
        moving.grab = clamp((moving.kind === 'row' ? moving.y : moving.x) - b.start, 0, b.size);
        moveGhost.innerHTML = `<span>${esc((moving.kind === 'row' ? text.moveRows : text.moveCols).replace('{n}', String(moving.count)))}</span>`;
        moveGhost.hidden = false;
        render();
    }
    moveTo(e.clientX, e.clientY);
});

window.addEventListener('mouseup', () => endMove(true));

/** 끌어 옮기기를 끝낸다. drop이 false면 옮기지 않는다. 끌지 않고 놓았으면 그냥 누른 것으로 친다. */
function endMove(drop: boolean): void {
    const m = moving;
    if (!m) return;
    moving = null;
    moveLine.hidden = true;
    moveGhost.hidden = true;
    document.body.classList.remove('moving');
    if (!m.active) {
        if (drop) m.click();
        return;
    }
    // 흐리게 그린 원래 자리를 되돌린다.
    render();
    if (!drop || moveIsNoop(m)) return;
    vscodeApi.postMessage({ type: 'op', op: { kind: m.kind === 'row' ? 'moveRows' : 'moveCols', from: m.from, count: m.count, to: m.to } });
    pendingFlash = { kind: m.kind, from: m.to < m.from ? m.to : m.to - m.count, count: m.count };
    // 옮긴 묶음을 새 자리에서 계속 고른 상태로 둔다. 놓은 선 쪽 끝이 보이게 한다.
    const at = m.to < m.from ? m.to : m.to - m.count;
    const end = at + m.count - 1;
    const near = m.to < m.from ? at : end;
    if (m.kind === 'row') setSelection({ row: at, col: sel.col }, { row: at, col: 0 }, { row: end, col: colCount - 1 }, [], { row: near });
    else setSelection({ row: sel.row, col: at }, { row: 0, col: at }, { row: rows.length - 1, col: end }, [], { col: near });
}
// Ctrl+휠: 확대와 축소. 터치패드는 조금씩 여러 번 오므로 모아서 한 단계씩 바꾼다.
document.addEventListener(
    'wheel',
    (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        wheelSum += e.deltaY;
        if (Math.abs(wheelSum) < 40) return;
        const g = grid.getBoundingClientRect();
        zoomStep(wheelSum < 0 ? 1 : -1, { x: e.clientX - g.left, y: e.clientY - g.top });
        wheelSum = 0;
    },
    { passive: false },
);
window.addEventListener('resize', () => {
    // 표를 받기 전에 그리면 "빈 파일" 안내와 "0행"이 잠깐 비친다.
    if (!loaded) return;
    if (!frame) frame = requestAnimationFrame(render);
});
// 창에 돌아오면 입력칸에 포커스를 준다. 찾기 칸에서 치던 중이면 그대로 둔다(아니면 이어 친 글자가 셀 고치기로 들어간다).
window.addEventListener('focus', () => {
    if (!findBox.contains(document.activeElement)) editor.focus({ preventScroll: true });
});
// 위쪽 막대와 찾기 상자의 빈 곳을 눌러도 포커스가 입력칸에서 빠지지 않게 한다(빠지면 키보드가 먹지 않는다).
document.getElementById('bar')?.addEventListener('mousedown', (e) => e.preventDefault());
findBox.addEventListener('mousedown', (e) => {
    if (e.target !== findInput) e.preventDefault();
});

/** 머리글 고정 방식을 바꾸고 토글 버튼 모양을 맞춘다. */
function setMode(next: HeaderMode): void {
    mode = next;
    layoutDirty = true;
    for (const b of modeButtons) {
        const on = b.dataset.mode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
    }
    // 표를 받기 전에 그리면 "빈 파일" 안내가 잠깐 비친다.
    if (!loaded) return;
    // 머리글은 굵게 재므로, 머리글 방식이 바뀌면 자동 열 너비를 다시 잰다.
    measure();
    if (rows.length) reveal(sel);
    render();
}

for (const b of modeButtons) {
    // 입력칸 포커스를 지키려고 누를 때의 기본 동작을 막는다. 누름(click)은 그대로 온다.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
        const next = b.dataset.mode;
        if (!isHeaderMode(next) || next === mode) return;
        commitInput();
        setMode(next);
        // 확장이 사용자 설정에 저장하고, 열려 있는 다른 표에도 알린다.
        vscodeApi.postMessage({ type: 'headerMode', mode: next });
    });
}
setMode(mode);

// 찾기 상자: 글자를 칠 때마다(잠깐 쉬었다가) 다시 찾는다. 큰 표에서 한 글자마다 전부 찾으면 느려서다.
findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = window.setTimeout(() => {
        findTimer = 0;
        // 그사이 셀을 고치기 시작했으면 고르기를 옮기지 않고 결과만 센다.
        runFind(!editing);
    }, 150);
});
findInput.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' || e.key === 'F3') {
        e.preventDefault();
        findStep(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') {
        e.preventDefault();
        findInput.select();
    }
});
for (const b of findButtons) {
    // 찾기 칸 포커스를 지키려고 누를 때의 기본 동작을 막는다.
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
        if (b.dataset.find === 'prev') findStep(-1);
        else if (b.dataset.find === 'next') findStep(1);
        else closeFind();
    });
}

for (const b of zoomButtons) {
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
        if (b.dataset.zoom === 'in') zoomStep(1, selPoint());
        else if (b.dataset.zoom === 'out') zoomStep(-1, selPoint());
        else setZoom(1, selPoint());
    });
}

window.addEventListener('message', (e: MessageEvent) => {
    const m = e.data as { type?: string; rows?: string[][]; text?: Record<string, string>; mode?: unknown; view?: unknown; remeasure?: boolean; start?: number; del?: number };
    if (m.type === 'text' && m.text) {
        text = m.text;
        modeLabel.textContent = text.headerLabel;
        zoomLabel.textContent = text.zoomLabel;
        for (const b of modeButtons) {
            const key = b.dataset.mode === 'row' ? 'Row' : b.dataset.mode === 'column' ? 'Column' : 'None';
            b.textContent = text[`mode${key}`];
            b.title = text[`mode${key}Tip`];
        }
        for (const b of zoomButtons) {
            b.title = b.dataset.zoom === 'in' ? text.zoomIn : b.dataset.zoom === 'out' ? text.zoomOut : text.zoomReset;
        }
        findInput.placeholder = text.findPlaceholder;
        for (const b of findButtons) b.title = b.dataset.find === 'prev' ? text.findPrev : b.dataset.find === 'next' ? text.findNext : text.findClose;
        emptyNote.textContent = text.emptyFile;
        if (loaded) render();
        return;
    }
    if (m.type === 'mode') {
        if (isHeaderMode(m.mode) && m.mode !== mode) setMode(m.mode);
        return;
    }
    if (m.type === 'view') {
        // 확장이 이 파일에 기억해 둔 배율과 크기(view.ts가 검사한 값). 없으면 기본값이다.
        const v = (m.view ?? {}) as { zoom?: number; colW?: Record<number, number>; rowH?: Record<number, number> };
        colW = { ...(v.colW ?? {}) };
        rowHt = { ...(v.rowH ?? {}) };
        zoom = ZOOMS.includes(v.zoom ?? 1) ? v.zoom ?? 1 : 1;
        zoomPct.textContent = `${Math.round(zoom * 100)}%`;
        layoutDirty = true;
        if (loaded) render();
        return;
    }
    if (m.type === 'splice') {
        // 확장은 처음 말고는 달라진 행 구간만 보낸다(csvEditor.ts의 send). 큰 표 전체를 보내면 100ms 넘게 걸리기 때문이다.
        // 처음 표를 받기 전이거나 범위가 맞지 않으면 표 전체를 다시 달라고 한다.
        const { start, del } = m;
        const ok = loaded && Array.isArray(m.rows) && Number.isInteger(start) && Number.isInteger(del) && start! >= 0 && del! >= 0 && start! + del! <= rows.length;
        if (!ok) {
            vscodeApi.postMessage({ type: 'ready' });
            return;
        }
        rows = rows.slice(0, start).concat(m.rows!, rows.slice(start! + del!));
        applyRows(!!m.remeasure);
        return;
    }
    if (m.type !== 'data' || !Array.isArray(m.rows)) return;
    rows = m.rows;
    applyRows(!!m.remeasure);
});

/** 새 표(rows)를 받은 뒤의 일: 크기 다시 재기, 고르기와 고치기 맞추기, 찾기 결과 다시 세기, 그리기. */
function applyRows(remeasure: boolean): void {
    const cols = rows.reduce((n, r) => Math.max(n, r.length), 0);
    // 열을 옮기거나 되돌리면 확장이 remeasure로 알려 준다. 자동 너비는 내용을 보고 정하므로 다시 잰다.
    if (!loaded || cols !== colCount || remeasure) {
        colCount = cols;
        measure();
    }
    measureNumW();
    layoutDirty = true;
    // 고치는 중인 셀이 표에서 없어졌거나 그 값이 밖에서 바뀌었으면(행이 줄거나 밀렸을 때) 고치기를 그만두고 알린다.
    // 그대로 두면 확정할 때 다른 셀에 쓴다.
    const row = rows[sel.row];
    if (editing && (!row || sel.col >= cols || row.length !== editOrigin.length || row.some((v, i) => v !== editOrigin[i]))) {
        stopEditing();
        notify(text.editCanceled);
    }
    clampSelection();
    // 찾기 상자가 열려 있으면 바뀐 표에서 결과를 다시 센다(고르기는 그대로).
    if (!findBox.hidden && findInput.value) runFind(false);
    render();
    // 행, 열을 옮긴 결과가 표에 들어오면 새 자리를 반짝인다.
    if (pendingFlash) {
        flashBlock(pendingFlash.kind, pendingFlash.from, pendingFlash.count);
        pendingFlash = null;
    }
    if (!loaded) {
        // 처음 열 때는 지난번 스크롤 자리로 돌아간다(탭을 옮겼다 오면 웹뷰가 새로 그려지기 때문).
        loaded = true;
        grid.scrollTop = saved.top ?? 0;
        grid.scrollLeft = saved.left ?? 0;
        render();
    }
}

// VS Code가 테마 값(편집기 글꼴과 크기 포함)을 넣거나 바꾸면 html 요소의 style이 바뀐다.
// 글꼴이 바뀌었으면 자동 열 너비와 행 번호 너비를 다시 잰다. 사용자가 바꾼 너비는 그대로 둔다.
let lastFont = JSON.stringify(baseFont());
new MutationObserver(() => {
    const now = JSON.stringify(baseFont());
    if (now === lastFont) return;
    lastFont = now;
    if (!loaded) return;
    measure();
    measureNumW();
    render();
}).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });

vscodeApi.postMessage({ type: 'ready' });
editor.focus({ preventScroll: true });
