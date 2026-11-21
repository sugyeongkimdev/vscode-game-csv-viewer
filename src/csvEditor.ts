import * as vscode from 'vscode';
import { CsvDoc, CsvOp, editsFor, parseCsv } from './csv';
import { Lang, pickLang, uiText } from './i18n';
import { recordSizes, sizesFollow, sanitizeView, SizeHistory, takeSizeStep, textPrint, ViewSettings } from './view';

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

/** 표 화면이 보낸 번호 목록에서 정수만 작은 것부터 남긴다. 남는 것이 없으면 0번 하나다. */
function ints(v: unknown): number[] {
    const list = Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)).sort((x, y) => x - y) : [];
    return list.length ? list : [0];
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

    /** memory: 파일마다 보기 설정을 기억하는 확장 저장소(context.globalState) */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly memory: vscode.Memento,
    ) {}

    runMenu(make: OpAtSel): void {
        this.runAtMenuCell?.(make);
    }

    resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
        const webview = panel.webview;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media'), vscode.Uri.joinPath(this.extensionUri, 'out', 'webview')],
        };
        webview.html = this.html(webview);

        const delimiter = /\.tsv$/i.test(document.uri.path) ? '\t' : ',';
        let cache: { version: number; doc: CsvDoc } | undefined;
        const current = (): CsvDoc => {
            if (cache?.version !== document.version) cache = { version: document.version, doc: parseCsv(document.getText(), delimiter) };
            return cache.doc;
        };

        let timer: ReturnType<typeof setTimeout> | undefined;
        // 열 자동 너비는 내용을 보고 정하므로 열 순서가 바뀌었을 수 있으면(열 옮기기, 되돌리기) 표 화면이 다시 재게 한다.
        let remeasure = false;
        const send = (): void => {
            // 연달아 바뀌면 마지막 한 번만 보낸다.
            clearTimeout(timer);
            timer = setTimeout(() => {
                void webview.postMessage({ type: 'data', rows: current().values, remeasure });
                remeasure = false;
            }, 20);
        };

        // 작업은 하나씩 차례로 처리한다. 앞 작업이 반영된 글자에서 다음 작업 위치를 계산해야 하기 때문이다.
        let queue: Promise<unknown> = Promise.resolve();
        const run = (op: CsvOp): void => {
            queue = queue
                .then(async () => {
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
                        // 바뀐 것이 없으면 표 화면이 먼저 바꿔 둔 값을 되돌리도록 다시 보낸다.
                        if (!changed) send();
                    },
                    (err) => {
                        send();
                        const message = err instanceof Error ? err.message : String(err);
                        void vscode.window.showErrorMessage(uiText(currentLang()).error.replace('{message}', message));
                    },
                );
        };

        let menuSel = { rows: [0], cols: [0] };
        const runAtMenuCell = (make: OpAtSel): void => run(make(menuSel.rows, menuSel.cols));
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
        const history = this.sizeHistory.get(viewKey) ?? { undo: [], redo: [] };
        this.sizeHistory.set(viewKey, history);
        // 크기 기록과 되돌리기도 작업 줄에 세운다. 앞 작업이 글자에 반영된 뒤의 지문으로 재야 순서가 맞다.
        const later = (f: () => unknown): void => {
            queue = queue.then(f).then(undefined, (err) => {
                const message = err instanceof Error ? err.message : String(err);
                void vscode.window.showErrorMessage(uiText(currentLang()).error.replace('{message}', message));
            });
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
        // Ctrl+Z, Ctrl+Y: 크기 차례면 크기를 되돌리고, 아니면 VS Code 되돌리기(글자)를 부른다.
        const undoRedo = async (dir: 'undo' | 'redo'): Promise<void> => {
            const step = takeSizeStep(history, dir, textPrint(document.getText()));
            if (!step) {
                await vscode.commands.executeCommand(dir);
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
                // 되돌리기가 아닌 새 글자 고침이면 크기 다시 하기는 버린다(VS Code도 글자 다시 하기를 버린다).
                if (e.reason === undefined) history.redo.length = 0;
                else remeasure = true;
                send();
            }),
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('gameCsvViewer.language')) sendText();
                if (e.affectsConfiguration('gameCsvViewer.headerMode')) sendMode();
            }),
            webview.onDidReceiveMessage((m) => {
                if (m.type === 'ready') {
                    // 표보다 먼저 보내야 표 화면이 처음부터 기억한 크기로 그린다.
                    sendText();
                    sendMode();
                    void webview.postMessage({ type: 'view', view: sanitizeView(this.memory.get(viewKey)) });
                    send();
                } else if (m.type === 'saveView') {
                    // 표 화면이 보낸 값은 검사해서 저장한다. 기본값뿐이면 지운다(undefined 저장).
                    // 열 너비, 행 높이가 바뀌었으면 Ctrl+Z로 되돌릴 수 있게 기록한다.
                    const next = sanitizeView(m.view);
                    later(() => {
                        recordSizes(history, this.memory.get<ViewSettings>(viewKey), next, textPrint(document.getText()));
                        return this.memory.update(viewKey, next);
                    });
                } else if (m.type === 'undo' || m.type === 'redo') {
                    later(() => undoRedo(m.type));
                } else if (m.type === 'headerMode' && isHeaderMode(m.mode)) {
                    // 표 화면의 토글 버튼을 누르면 사용자 설정에 저장한다.
                    vscode.workspace
                        .getConfiguration('gameCsvViewer')
                        .update('headerMode', m.mode, vscode.ConfigurationTarget.Global)
                        .then(undefined, (err) => {
                            sendMode();
                            const message = err instanceof Error ? err.message : String(err);
                            void vscode.window.showErrorMessage(uiText(currentLang()).error.replace('{message}', message));
                        });
                }
                else if (m.type === 'op') run(m.op as CsvOp);
                else if (m.type === 'menu') menuSel = { rows: ints(m.rows), cols: ints(m.cols) };
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
