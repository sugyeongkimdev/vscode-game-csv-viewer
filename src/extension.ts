import * as vscode from 'vscode';
import { CsvOp } from './csv';
import { CsvEditorProvider } from './csvEditor';

export function activate(context: vscode.ExtensionContext): void {
    const provider = new CsvEditorProvider(context.extensionUri, context.globalState);
    // 오른쪽 버튼 메뉴 명령. 대상은 표 화면이 메뉴를 열 때 알려 준, 고른 범위가 걸친 행, 열 번호들(작은 것부터)이다.
    // 여러 행(열)을 골랐으면 넣기는 그 개수만큼, 지우기는 그 행(열) 모두다(구글 시트 방식).
    const menu = (id: string, make: (rows: number[], cols: number[]) => CsvOp): vscode.Disposable =>
        vscode.commands.registerCommand(`gameCsvViewer.${id}`, () => provider.runMenu(make));
    // 텍스트 버튼으로 일부러 글자 편집기로 바꾼 파일과 그 때. 아래 "CSV를 표로 열기"가 곧바로 다시 표로 바꾸지 않게 비켜 간다.
    const wantText = new Map<string, number>();
    // 탐색기나 편집기 제목 줄에서 누르면 그 파일 주소가 넘어온다. 명령 팔레트에서는 지금 탭의 파일을 쓴다.
    // 지금 탭이 그 파일이면 새 탭을 열지 않고 그 탭을 바꿔 끼운다(2026-11-21 "탭이 하나 더 생기는데 보기 귀찮다").
    const openWith = (viewType: string) => async (uri?: vscode.Uri) => {
        const active = tabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
        const target = uri ?? active;
        if (!target) return;
        if (viewType === 'default') wantText.set(target.toString(), Date.now());
        if (active?.toString() === target.toString()) {
            try {
                // VS Code 안쪽 명령(Reopen Editor With가 쓰는 길). 저장 안 한 내용도 묻지 않고 그대로 넘긴다.
                return await vscode.commands.executeCommand('reopenActiveEditorWith', viewType);
            } catch {
                // 공개 API가 아니라서 VS Code가 이 명령을 없애면 예전처럼 새 탭으로 연다.
            }
        }
        return vscode.commands.executeCommand('vscode.openWith', target, viewType);
    };

    // CSV가 글자 편집기로 새로 열리면 표로 바꿔 끼울지 정한다(2026-11-21 사용자 지시).
    // 설정 gameCsvViewer.defaultEditor가 table이거나, 바로 앞에 보던 탭이 표였으면(표를 보다가 다른 CSV를 열면) 표로 연다.
    // VS Code는 탭을 열 때 "열림" 이벤트를 먼저, "앞에 옴" 이벤트를 따로 보내고, 미리보기 탭을 갈아 치울 때는 그 사이에
    // 앞 탭이 비어 있다(null). 그래서 "앞에 보던 탭이 표였나"는 앞 탭이 있는 이벤트에서만 새로 적는다.
    let lastWasTable = isTable(vscode.window.tabGroups.activeTabGroup.activeTab);
    const onTabs = vscode.window.tabGroups.onDidChangeTabs((e) => {
        const wasTable = lastWasTable;
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (active) lastWasTable = isTable(active);
        for (const tab of e.opened) {
            if (!(tab.input instanceof vscode.TabInputText) || !/\.(csv|tsv)$/i.test(tab.input.uri.path)) continue;
            const key = tab.input.uri.toString();
            const asked = wantText.get(key);
            wantText.delete(key);
            if (asked !== undefined && Date.now() - asked < 3000) continue;
            const table = vscode.workspace.getConfiguration('gameCsvViewer').get('defaultEditor') === 'table';
            if (!table && !wasTable) continue;
            // 파일 주소를 넘기면 그 파일의 탭을 집어 바꾼다(저장 안 한 내용도 그대로). 안쪽 명령이 없어지면 글자 편집기로 둔다.
            vscode.commands.executeCommand('reopenActiveEditorWith', CsvEditorProvider.viewType, tab.input.uri).then(undefined, () => undefined);
        }
    });

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, provider),
        onTabs,
        vscode.commands.registerCommand('gameCsvViewer.openTable', openWith(CsvEditorProvider.viewType)),
        vscode.commands.registerCommand('gameCsvViewer.openText', openWith('default')),
        menu('insertRowAbove', (rows) => ({ kind: 'insertRow', at: rows[0], count: rows.length })),
        menu('insertRowBelow', (rows) => ({ kind: 'insertRow', at: rows[rows.length - 1] + 1, count: rows.length })),
        menu('deleteRow', (rows) => ({ kind: 'deleteRow', at: rows })),
        menu('insertColLeft', (_rows, cols) => ({ kind: 'insertCol', at: cols[0], count: cols.length })),
        menu('insertColRight', (_rows, cols) => ({ kind: 'insertCol', at: cols[cols.length - 1] + 1, count: cols.length })),
        menu('deleteCol', (_rows, cols) => ({ kind: 'deleteCol', at: cols })),
    );
}

// 표 화면 탭인지
function isTable(tab: vscode.Tab | undefined): boolean {
    return tab?.input instanceof vscode.TabInputCustom && tab.input.viewType === CsvEditorProvider.viewType;
}

// 탭이 보여 주는 파일(글자 편집기나 표). 그 밖의 탭은 없음.
function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
    const input = tab?.input;
    return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

export function deactivate(): void {}
