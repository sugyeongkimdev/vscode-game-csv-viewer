import * as vscode from 'vscode';
import { CsvDoc, CsvOp, editsFor, parseCsv } from './csv';
import { Lang, pickLang, uiText } from './i18n';
import { sanitizeView } from './view';

type OpAtCell = (row: number, col: number) => CsvOp;

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

    /** 마지막으로 앞에 나온 표 화면에서, 오른쪽 버튼을 누른 셀 기준으로 작업을 돌린다. */
    private runAtMenuCell?: (make: OpAtCell) => void;

    /** memory: 파일마다 보기 설정을 기억하는 확장 저장소(context.globalState) */
    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly memory: vscode.Memento,
    ) {}

    runMenu(make: OpAtCell): void {
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
        const send = (): void => {
            // 연달아 바뀌면 마지막 한 번만 보낸다.
            clearTimeout(timer);
            timer = setTimeout(() => void webview.postMessage({ type: 'data', rows: current().values }), 20);
        };

        // 작업은 하나씩 차례로 처리한다. 앞 작업이 반영된 글자에서 다음 작업 위치를 계산해야 하기 때문이다.
        let queue: Promise<unknown> = Promise.resolve();
        const run = (op: CsvOp): void => {
            queue = queue
                .then(() => this.apply(document, current(), op, delimiter))
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

        let menuCell = { row: 0, col: 0 };
        const runAtMenuCell = (make: OpAtCell): void => run(make(menuCell.row, menuCell.col));
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

        const subs = [
            vscode.workspace.onDidChangeTextDocument((e) => {
                if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length) send();
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
                    void this.memory.update(viewKey, sanitizeView(m.view));
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
                else if (m.type === 'menu') menuCell = { row: Number(m.row), col: Number(m.col) };
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
<div id="bar"><span id="mode" class="seg" role="group" aria-label="${text.headerLabel}"><span id="modeLabel">${text.headerLabel}</span><button type="button" data-mode="row" title="${text.modeRowTip}">${text.modeRow}</button><button type="button" data-mode="column" title="${text.modeColumnTip}">${text.modeColumn}</button><button type="button" data-mode="none" title="${text.modeNoneTip}">${text.modeNone}</button></span><span id="zoom" class="seg" role="group"><button type="button" data-zoom="out" title="${text.zoomOut}">-</button><button type="button" data-zoom="reset" id="zoomPct" title="${text.zoomReset}">100%</button><button type="button" data-zoom="in" title="${text.zoomIn}">+</button></span><span id="addr"></span><span id="selinfo"></span><span id="note"></span><span id="size"></span></div>
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
