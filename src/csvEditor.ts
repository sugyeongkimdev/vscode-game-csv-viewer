import * as vscode from 'vscode';
import { cellAt, cellStart, CsvDoc, CsvOp, editsFor, parseCsv, rowsSplice, staleCells, validOp } from './csv';
import { Lang, pickLang, uiText } from './i18n';
import { recordSizes, sameSizes, sizesFollow, sanitizeView, SizeHistory, takeSizeStep, textPrint, ViewSettings } from './view';

/** 오른쪽 버튼 메뉴 작업. rows, cols는 고른 범위가 걸친 행, 열 번호들(작은 것부터)이다. */
type OpAtSel = (rows: number[], cols: number[]) => CsvOp;

/** 머리글 고정 방식: 첫 행(row), 첫 열(column), 없음(none) */
type HeaderMode = 'row' | 'column' | 'none';
const HEADER_MODES: readonly unknown[] = ['row', 'column', 'none'];
const isHeaderMode = (v: unknown): v is HeaderMode => HEADER_MODES.includes(v);

/** 설정에서 머리글 고정 방식을 읽는다. 값이 이상하거나 읽다가 문제가 생기면 첫 행(row)이다. */
function currentHeaderMode(): HeaderMode {
    try {
        const v = vscode.workspace.getConfiguration('gameCsvViewer').get('headerMode');
        return isHeaderMode(v) ? v : 'row';
    } catch {
        return 'row';
    }
}

/** 파일 이름으로 나눔 글자를 정한다. TSV는 탭, 나머지는 쉼표다. */
const delimiterOf = (document: vscode.TextDocument): string => (/\.tsv$/i.test(document.uri.path) ? '\t' : ',');

/** 표 화면이 보낸 번호 목록에서 정수만 작은 것부터 남긴다. */
function ints(v: unknown): number[] {
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)).sort((x, y) => x - y) : [];
}

/** 오류 안내를 띄운다. 오류 글에 $& 같은 글자가 있어도 그대로 보이게 바꾸기에 함수를 넘긴다. */
function showError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(uiText(currentLang()).error.replace('{message}', () => message));
}

/** 설정과 VS Code 표시 언어로 쓸 언어를 정한다. 읽다가 문제가 생기면 영어다. */
function currentLang(): Lang {
    try {
        return pickLang(vscode.workspace.getConfiguration('gameCsvViewer').get('language'), vscode.env.language);
    } catch {
        return 'en';
    }
}

/**
 * 파일 글자는 VS Code 문서가 그대로 들고, 표 화면은 그 글자를 보여 주고 고치기만 한다.
 * 그래서 저장, 되돌리기, 저장 안 됨 표시는 VS Code가 알아서 처리한다.
 */
export class CsvEditorProvider implements vscode.CustomTextEditorProvider {
    static readonly viewType = 'gameCsvViewer.table';

    /** 마지막으로 앞에 나온 표 화면에서, 오른쪽 버튼을 누를 때 고른 범위 기준으로 작업을 돌린다. */
    private runAtMenuCell?: (make: OpAtSel) => void;

    /** 파일마다 열 너비, 행 높이 되돌리기 기록(view.ts). 탭을 글자 편집기와 바꿔 끼워도 남게 확장에 둔다. */
    private readonly sizeHistory = new Map<string, SizeHistory>();

    /** 파일마다 표 화면이 마지막으로 알린 지금 셀 [행, 열]. 글자 편집기로 바꿀 때 커서를 둘 자리다. */
    private readonly lastCell = new Map<string, [number, number]>();

    /** 파일마다 다음에 뜨는 표 화면이 고를 셀 [행, 열]. 글자 편집기에서 표로 바꿀 때 커서 자리를 넘긴다. */
    private readonly openAt = new Map<string, [number, number]>();

    /** memory: 파일마다 보기 설정을 기억하는 확장 저장소(context.globalState) */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly memory: vscode.Memento,
    ) {}

    runMenu(make: OpAtSel): void {
        this.runAtMenuCell?.(make);
    }

    /** 글자 편집기의 커서 자리(글자 위치)가 든 셀을, 이 파일의 다음 표 화면이 뜰 때 고르게 한다. */
    selectOnOpen(document: vscode.TextDocument, offset: number): void {
        const cell = cellAt(parseCsv(document.getText(), delimiterOf(document)), offset);
        if (cell) this.openAt.set(document.uri.toString(), cell);
    }

    /** 이 파일의 표 화면에서 마지막으로 고른 셀이 시작하는 글자 위치. 고른 적이 없거나 그 행이 없어졌으면 없음. */
    lastCellOffset(document: vscode.TextDocument): number | undefined {
        const cell = this.lastCell.get(document.uri.toString());
        return cell && cellStart(parseCsv(document.getText(), delimiterOf(document)), ...cell);
    }

    /** 파일의 크기 되돌리기 기록. 없으면 만든다. */
    private historyFor(uri: vscode.Uri): SizeHistory {
        const key = `view:${uri.toString()}`;
        let h = this.sizeHistory.get(key);
        if (!h) this.sizeHistory.set(key, (h = { undo: [], redo: [], textRedos: 0 }));
        return h;
    }

    /**
     * CSV 글자가 바뀔 때마다 부른다(표가 열려 있지 않을 때도, extension.ts가 부른다). VS Code 다시 하기로 되살릴 수 있는
     * 글자 고침 수를 센다. 되돌린 뒤 새로 고치면(글자든 크기든) 그 다시 하기는 버려진 것으로 본다(4-7절 13번).
     */
    noteTextChange(e: vscode.TextDocumentChangeEvent): void {
        if (!e.contentChanges.length || !/\.(csv|tsv)$/i.test(e.document.uri.path)) return;
        const h = this.historyFor(e.document.uri);
        if (e.reason === vscode.TextDocumentChangeReason.Undo) h.textRedos = (h.textRedos ?? 0) + 1;
        else if (e.reason === vscode.TextDocumentChangeReason.Redo) h.textRedos = Math.max((h.textRedos ?? 0) - 1, 0);
        else {
            // 되돌리기가 아닌 새 글자 고침이면 크기 다시 하기도 버린다(VS Code도 글자 다시 하기를 버린다).
            h.textRedos = 0;
            h.redo.length = 0;
        }
    }

    resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const webview = panel.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media'), vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        };
        webview.html = this.html(webview);

        const delimiter = delimiterOf(document);
        let cache: { version: number; doc: CsvDoc } | undefined;
        const current = (): CsvDoc => {
            if (cache?.version !== document.version) cache = { version: document.version, doc: parseCsv(document.getText(), delimiter) };
            return cache.doc;
        };

        let timer: ReturnType<typeof setTimeout> | undefined;
        // 열 자동 너비는 내용을 보고 정하므로 열 순서가 바뀌었을 수 있으면(열 옮기기, 되돌리기) 표 화면이 다시 재게 한다.
        let remeasure = false;
        // 표 화면에 마지막으로 보낸 표. 처음 말고는 달라진 행 구간만 보낸다(rowsSplice). 1만 행 38열 표 전체를 보내면
        // 실제 VS Code에서 왕복 113ms가 걸려, 셀 하나 고칠 때마다 멈칫했다. 행 하나는 1ms 아래다.
        let sent: string[][] | undefined;
        /** 표를 보낸다. 연달아 바뀌면 마지막 한 번만 보낸다. full이면 표 전체를 보낸다(표 화면이 먼저 바꿔 둔 값을 되돌릴 때). */
        const send = (full = false): void => {
            if (full) sent = undefined;
            clearTimeout(timer);
            timer = setTimeout(() => {
                const rows = current().values;
                const msg = sent ? { type: 'splice', ...rowsSplice(sent, rows), remeasure } : { type: 'data', rows, remeasure };
                sent = rows;
                remeasure = false;
                // 보내지 못했으면(웹뷰가 닫히거나 다시 뜨는 중) 다음에는 표 전체를 보낸다.
                webview.postMessage(msg).then(
                    (ok) => {
                        if (!ok) sent = undefined;
                    },
                    () => (sent = undefined),
                );
            }, 20);
        };

        // 작업은 하나씩 차례로 처리한다. 앞 작업이 반영된 글자에서 다음 작업 위치를 계산해야 하기 때문이다.
        let queue: Promise<unknown> = Promise.resolve();
        const run = (op: CsvOp): void => {
            queue = queue
                .then(async () => {
                    // 표 화면이 본 뒤에 파일이 밖에서 바뀌었으면(셀의 바꾸기 전 값이 다름) 넣지 않는다. 다른 행에 들어갈 수 있다.
                    if (op.kind === 'setCells' && staleCells(current(), op.cells)) {
                        void vscode.window.showWarningMessage(uiText(currentLang()).staleEdit);
                        return false;
                    }
                    if (op.kind === 'moveCols') remeasure = true;
                    // 행, 열 넣기, 지우기, 옮기기는 사용자가 바꾼 크기도 내용을 따라가게 한다.
                    const follow = sizesFollow(op);
                    if (!follow) return this.apply(document, current(), op, delimiter);
                    const textBefore = textPrint(document.getText());
                    const changed = await this.apply(document, current(), op, delimiter);
                    if (changed) await followSizes(follow, textBefore);
                    return changed;
                })
                .then(
                    (changed) => {
                        // 바뀐 것이 없으면 표 화면이 먼저 바꿔 둔 값을 되돌리도록 표 전체를 다시 보낸다.
                        if (!changed) send(true);
                    },
                    (err) => {
                        send(true);
                        showError(err);
                    },
                );
        };

        // 오른쪽 버튼을 누를 때 고른 범위. 메뉴 명령이 한 번 쓰면 비운다. 오른쪽 버튼 없이 명령만 부르면(단축키 등) 아무것도 하지 않는다.
        let menuSel: { rows: number[]; cols: number[] } | undefined;
        // 닫히지 않은 따옴표 안내를 이 표 화면에서 이미 띄웠는지
        let warnedQuote = false;
        const runAtMenuCell = (make: OpAtSel): void => {
            if (!menuSel) return;
            const s = menuSel;
            menuSel = undefined;
            run(make(s.rows, s.cols));
        };
        const track = (): void => {
            if (panel.active) this.runAtMenuCell = runAtMenuCell;
        };
        track();

        // 표 화면 글자 목록을 보낸다. 설정을 바꾸면 열려 있는 표 화면에도 바로 다시 보낸다.
        const sendText = (): void => void webview.postMessage({ type: 'text', text: uiText(currentLang()) });
        // 머리글 고정 방식도 설정 하나를 모든 표가 같이 쓴다. 한 표에서 바꾸면 열려 있는 다른 표도 바로 바뀐다.
        const sendMode = (): void => void webview.postMessage({ type: 'mode', mode: currentHeaderMode() });
        // 배율, 열 너비, 행 높이는 파일마다 기억한다(view.ts). 파일 주소를 열쇠로 확장 저장소에 둔다.
        const viewKey = `view:${document.uri.toString()}`;
        const history = this.historyFor(document.uri);
        // 크기 기록과 되돌리기, 저장도 작업 줄에 세운다. 앞 작업이 글자에 반영된 뒤에 해야 순서가 맞다.
        const later = (f: () => unknown): void => {
            queue = queue.then(f).then(undefined, showError);
        };
        // 행, 열을 넣거나 지우거나 옮기면 사용자가 바꾼 크기도 내용을 따라간다(view.ts의 sizesFollow).
        // 작업 전 글자 지문과 묶어 기록해서, Ctrl+Z 한 번에 글자와 크기가 같이 돌아오게 한다.
        const followSizes = async (follow: NonNullable<ReturnType<typeof sizesFollow>>, textBefore: number): Promise<void> => {
            const old = this.memory.get<ViewSettings>(viewKey);
            const next = sanitizeView({ ...old, [follow.key]: follow.shift(old?.[follow.key] ?? {}) });
            if (JSON.stringify(old) === JSON.stringify(next)) return;
            recordSizes(history, old, next, textPrint(document.getText()), textBefore);
            // 바뀐 표(20ms 뒤에 보냄)보다 먼저 닿게 저장보다 앞서 보낸다. 그래야 옮긴 뒤 반짝임이 새 크기로 그려진다.
            void webview.postMessage({ type: 'view', view: next });
            await this.memory.update(viewKey, next);
        };
        // 이 표를 활성 편집기로 만든다(최대 1초 기다림). 키를 누른 곳이 이 표여도 Cursor는 오른쪽 에이전트 창 그룹을
        // 활성으로 남겨 둘 수 있어서, 그대로 두면 Ctrl+Z가 아무것도 하지 않았다(2026-11-24 재현).
        const activate = (): Promise<boolean> => {
            if (panel.active) return Promise.resolve(true);
            return new Promise((resolve) => {
                const done = (): void => {
                    sub.dispose();
                    clearTimeout(wait);
                    resolve(panel.active);
                };
                const sub = panel.onDidChangeViewState(() => panel.active && done());
                const wait = setTimeout(done, 1000);
                panel.reveal(panel.viewColumn, false);
            });
        };
        // Ctrl+Z, Ctrl+Y: 크기 차례면 크기를 되돌리고, 아니면 VS Code 되돌리기(글자)를 부른다.
        const undoRedo = async (dir: 'undo' | 'redo'): Promise<void> => {
            // VS Code 되돌리기는 활성 편집기로 간다. 이 표를 활성으로 만들지 못하면 다른 파일을 되돌릴 수 있으니 하지 않는다.
            if (!(await activate())) return;
            const step = takeSizeStep(history, dir, textPrint(document.getText()));
            if (!step) {
                // 다시 하기는 다시 할 글자 고침이 남아 있을 때만 부른다. 되돌린 뒤 크기를 바꿨으면 그 고침은 버려진 것이다.
                if (dir === 'undo' || (history.textRedos ?? 0) > 0) await vscode.commands.executeCommand(dir);
                return;
            }
            // 행, 열 옮기기처럼 글자와 같이 바뀐 크기면 글자도 같이 되돌린다(다시 한다).
            if (step.text !== step.textBefore) await vscode.commands.executeCommand(dir);
            const view = sanitizeView({ ...this.memory.get<ViewSettings>(viewKey), ...(dir === 'undo' ? step.before : step.after) });
            await this.memory.update(viewKey, view);
            void webview.postMessage({ type: 'view', view });
        };

        const subs = [
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() !== document.uri.toString() || !e.contentChanges.length) return;
                // 되돌리기, 다시 하기는 열 순서가 바뀌었을 수 있다(크기 다시 하기 기록은 noteTextChange가 맞춘다).
                if (e.reason !== undefined) remeasure = true;
                send();
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('gameCsvViewer.language')) sendText();
                if (e.affectsConfiguration('gameCsvViewer.headerMode')) sendMode();
            }),
            webview.onDidReceiveMessage((m) => {
                if (m.type === 'ready') {
                    // 표보다 먼저 보내야 표 화면이 처음부터 기억한 크기로 그린다. 표 화면이 새로 떴으니 표 전체를 보낸다.
                    sendText();
                    sendMode();
                    void webview.postMessage({ type: 'view', view: sanitizeView(this.memory.get(viewKey)) });
                    // 글자 편집기에서 바꿔 끼운 표면 그 커서 자리 셀을 고르게 한다(표 화면은 표를 받은 뒤에 고른다).
                    const at = this.openAt.get(document.uri.toString());
                    this.openAt.delete(document.uri.toString());
                    if (at) void webview.postMessage({ type: 'select', row: at[0], col: at[1] });
                    send(true);
                    // 파일 끝까지 닫히지 않은 따옴표가 있으면 끝에 붙인 행, 열이 그 셀 안으로 들어간다. 한 번 알린다.
                    if (current().openQuote && !warnedQuote) {
                        warnedQuote = true;
                        void vscode.window.showWarningMessage(uiText(currentLang()).openQuote);
                    }
                } else if (m.type === 'saveView') {
                    // 표 화면은 바뀐 것만 보낸다(배율만, 또는 열 너비와 행 높이만). 기억한 값에 합쳐 검사한 뒤 저장하고,
                    // 기본값뿐이면 지운다(undefined 저장). 전체를 보내면 크기가 내용을 따라 바뀐 직후 옛 크기로 덮을 수 있다.
                    const part: object = m.view && typeof m.view === 'object' ? m.view : {};
                    later(() => {
                        const old = this.memory.get<ViewSettings>(viewKey);
                        const next = sanitizeView({ ...old, ...part });
                        // 열 너비, 행 높이가 바뀌었으면 Ctrl+Z로 되돌릴 수 있게 기록한다(배율만 바뀌면 글자 지문도 재지 않는다).
                        // 새 크기 바꿈은 되돌린 글자 고침의 다시 하기도 버린다.
                        if (!sameSizes(old, next)) {
                            recordSizes(history, old, next, textPrint(document.getText()));
                            history.textRedos = 0;
                        }
                        return this.memory.update(viewKey, next);
                    });
                } else if (m.type === 'undo' || m.type === 'redo') {
                    later(() => undoRedo(m.type));
                } else if (m.type === 'save') {
                    // Ctrl+S: 앞서 보낸 고침이 파일에 들어간 뒤에 저장한다.
                    later(() => document.save());
                } else if (m.type === 'headerMode' && isHeaderMode(m.mode)) {
                    // 표 화면의 토글 버튼을 누르면 사용자 설정에 저장한다.
                    vscode.workspace
                        .getConfiguration('gameCsvViewer')
                        .update('headerMode', m.mode, vscode.ConfigurationTarget.Global)
                        .then(undefined, (err) => {
                            sendMode();
                            showError(err);
                        });
                } else if (m.type === 'op') {
                    // 웹뷰가 보낸 작업은 모양을 검사한 뒤에만 돌린다(csv.ts의 validOp).
                    const op = validOp(m.op);
                    if (op) run(op);
                    else send(true);
                } else if (m.type === 'cell') {
                    if (Number.isInteger(m.row) && Number.isInteger(m.col) && m.row >= 0 && m.col >= 0) this.lastCell.set(document.uri.toString(), [m.row, m.col]);
                } else if (m.type === 'menu') {
                    const rows = ints(m.rows);
                    const cols = ints(m.cols);
                    menuSel = rows.length && cols.length ? { rows, cols } : undefined;
                }
            }),
            panel.onDidChangeViewState(track),
        ];
        panel.onDidDispose(() => {
            clearTimeout(timer);
            if (this.runAtMenuCell === runAtMenuCell) this.runAtMenuCell = undefined;
            subs.forEach((s) => s.dispose());
        });
    }

    private async apply(document: vscode.TextDocument, doc: CsvDoc, op: CsvOp, delimiter: string): Promise<boolean> {
        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const edits = editsFor(doc, op, delimiter, eol);
        if (!edits.length) return false;
        const we = new vscode.WorkspaceEdit();
        for (const e of edits) we.replace(document.uri, new vscode.Range(document.positionAt(e.start), document.positionAt(e.end)), e.text);
        return vscode.workspace.applyEdit(we);
    }

    private html(webview: vscode.Webview): string {
        // VS Code 웹뷰 예제와 같은 방식의 1회용 값. 이 값이 붙은 스크립트만 실행된다.
        const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
        const css = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'table.css'));
        const js = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'table.js'));
        // 처음 그릴 때부터 맞는 언어로 보이게 글자를 넣어 둔다. 설정이 바뀌면 표 화면이 `text` 메시지로 바꾼다.
        const lang = currentLang();
        const text = uiText(lang);
        return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}">
</head>
<body data-mode="${currentHeaderMode()}">
<div id="bar"><span class="group"><span class="group-label" id="modeLabel">${text.headerLabel}</span><span id="mode" class="seg" role="group" aria-label="${text.headerLabel}"><button type="button" data-mode="none" title="${text.modeNoneTip}">${text.modeNone}</button><button type="button" data-mode="row" title="${text.modeRowTip}">${text.modeRow}</button><button type="button" data-mode="column" title="${text.modeColumnTip}">${text.modeColumn}</button></span></span><span class="group"><span class="group-label" id="zoomLabel">${text.zoomLabel}</span><span id="zoom" class="seg" role="group" aria-label="${text.zoomLabel}"><button type="button" data-zoom="out" title="${text.zoomOut}">-</button><button type="button" data-zoom="reset" id="zoomPct" title="${text.zoomReset}">100%</button><button type="button" data-zoom="in" title="${text.zoomIn}">+</button></span></span><span id="addr"></span><span id="selinfo"></span><span id="note"></span><span id="size"></span></div>
<div id="grid">
<div id="empty" hidden data-vscode-context='{"webviewSection":"empty","preventDefaultContextMenuItems":true}'>${text.emptyFile}</div>
<table id="table" data-vscode-context='{"webviewSection":"cell","preventDefaultContextMenuItems":true}'></table>
</div>
<textarea id="editor" spellcheck="false" autocomplete="off"></textarea>
<div id="find" hidden><input id="findInput" type="text" spellcheck="false" autocomplete="off" placeholder="${text.findPlaceholder}"><span id="findCount"></span><button type="button" data-find="prev" title="${text.findPrev}">↑</button><button type="button" data-find="next" title="${text.findNext}">↓</button><button type="button" data-find="close" title="${text.findClose}">×</button></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
    }
}
