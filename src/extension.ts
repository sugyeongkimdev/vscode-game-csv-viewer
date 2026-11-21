import * as vscode from 'vscode';
import { CsvOp } from './csv';
import { CsvEditorProvider } from './csvEditor';

export function activate(context: vscode.ExtensionContext): void {
    const provider = new CsvEditorProvider(context.extensionUri, context.globalState);
    // 오른쪽 버튼 메뉴 명령. 어느 셀인지는 표 화면이 메뉴를 열 때 알려 준 셀을 쓴다.
    const menu = (id: string, make: (row: number, col: number) => CsvOp): vscode.Disposable =>
        vscode.commands.registerCommand(`gameCsvViewer.${id}`, () => provider.runMenu(make));
    // 탐색기나 편집기 제목 줄에서 누르면 그 파일 주소가 넘어온다.
    const openWith = (viewType: string) => (uri?: vscode.Uri) => {
        const target = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (target) return vscode.commands.executeCommand('vscode.openWith', target, viewType);
    };

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, provider),
        vscode.commands.registerCommand('gameCsvViewer.openTable', openWith(CsvEditorProvider.viewType)),
        vscode.commands.registerCommand('gameCsvViewer.openText', openWith('default')),
        menu('insertRowAbove', (row) => ({ kind: 'insertRow', at: row })),
        menu('insertRowBelow', (row) => ({ kind: 'insertRow', at: row + 1 })),
        menu('deleteRow', (row) => ({ kind: 'deleteRow', at: row })),
        menu('insertColLeft', (_row, col) => ({ kind: 'insertCol', at: col })),
        menu('insertColRight', (_row, col) => ({ kind: 'insertCol', at: col + 1 })),
        menu('deleteCol', (_row, col) => ({ kind: 'deleteCol', at: col })),
    );
}

export function deactivate(): void {}
