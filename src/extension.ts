import * as vscode from 'vscode';
import { CsvOp } from './csv';
import { CsvEditorProvider } from './csvEditor';

/** CSV, TSV 파일인지(이름으로 본다) */
const isCsv = (uri: vscode.Uri): boolean => /\.(csv|tsv)$/i.test(uri.path);

export function activate(context: vscode.ExtensionContext): void {
    const provider = new CsvEditorProvider(context.extensionUri, context.globalState);
    // 오른쪽 버튼 메뉴 명령. 대상은 표 화면이 메뉴를 열 때 알려 준, 고른 범위가 걸친 행, 열 번호들(작은 것부터)이다.
    // 여러 행(열)을 골랐으면 넣기는 그 개수만큼, 지우기는 그 행(열) 모두다(구글 시트 방식).
    const menu = (id: string, make: (rows: number[], cols: number[]) => CsvOp): vscode.Disposable =>
        vscode.commands.registerCommand(`gameCsvViewer.${id}`, () => provider.runMenu(make));
    // 텍스트 버튼으로 일부러 글자 편집기로 바꾼 파일과 그 때. 아래 "CSV를 표로 열기"가 곧바로 다시 표로 바꾸지 않게 비켜 간다.
    const wantText = new Map<string, number>();
    // 탐색기나 편집기 제목 줄에서 누르면 그 파일 주소가 넘어온다. 명령 팔레트에서는 지금 탭의 파일을 쓴다.
    // 그 파일이 어느 그룹의 지금 탭이면 새 탭을 열지 않고 그 탭을 바꿔 끼운다(2026-11-21 "탭이 하나 더 생기는데 보기 귀찮다").
    const openWith = (viewType: string) => async (uri?: vscode.Uri) => {
        const groups = vscode.window.tabGroups;
        const target = uri ?? tabUri(groups.activeTabGroup.activeTab);
        if (!target) return;
        // 표로는 CSV, TSV만 연다. VS Code는 편집기 이름을 집어 주면 파일 이름을 보지 않아서, 다른 파일도 쉼표 표로 열고 고칠 수 있었다.
        if (viewType !== 'default' && !isCsv(target)) return;
        if (viewType === 'default') wantText.set(target.toString(), Date.now());
        // 그 파일을 보여 주는 탭(지금 그룹 먼저). Cursor는 오른쪽 에이전트 창도 탭 그룹이라, 지금 그룹이 버튼을 누른 그룹과 다를 수 있다.
        const tab = [groups.activeTabGroup, ...groups.all].map((g) => g.activeTab).find((t) => tabUri(t)?.toString() === target.toString());
        if (tab) return reopen(tab, viewType);
        return vscode.commands.executeCommand('vscode.openWith', target, viewType);
    };

    // CSV가 글자 편집기로 새로 열리면 표로 바꿔 끼울지 정한다(2026-11-21 사용자 지시).
    // 설정 gameCsvViewer.defaultEditor가 table이거나, 바로 앞에 보던 탭이 표였으면(표를 보다가 다른 CSV를 열면) 표로 연다.
    // VS Code는 탭을 열 때 "열림" 이벤트를 먼저, "앞에 옴" 이벤트를 따로 보내고, 미리보기 탭을 갈아 치울 때는 그 사이에
    // 앞 탭이 비어 있다(null). 그래서 "앞에 보던 탭이 표였나"는 앞 탭이 있는 이벤트에서만 새로 적는다.
    let lastWasTable = isTable(vscode.window.tabGroups.activeTabGroup.activeTab);
    // 방금 닫힌 탭의 파일과 그 때. 같은 파일 탭이 닫히자마자 글자 탭으로 열리면 새로 연 것이 아니라 바꿔 끼우기(Reopen Editor With)나
    // 다른 그룹으로 옮기기라서 표로 바꾸지 않는다. VS Code는 바꿔 끼울 때 옛 탭을 먼저 닫고 새 탭을 연다.
    const closedAt = new Map<string, number>();
    // 탭을 다 닫으면 "앞에 보던 탭이 표" 기억을 지운다. 다만 미리보기 탭을 갈아 치울 때도 잠깐 탭이 하나도 없으므로 조금 기다린다.
    let forget: ReturnType<typeof setTimeout> | undefined;
    const onTabs = vscode.window.tabGroups.onDidChangeTabs((e) => {
        const now = Date.now();
        for (const tab of e.closed) {
            const uri = tabUri(tab);
            if (uri) closedAt.set(uri.toString(), now);
        }
        const wasTable = lastWasTable;
        const active = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (active) lastWasTable = isTable(active);
        if (e.opened.length) clearTimeout(forget);
        else if (vscode.window.tabGroups.all.every((g) => g.tabs.length === 0)) forget = setTimeout(() => (lastWasTable = false), 500);
        for (const tab of e.opened) {
            if (!(tab.input instanceof vscode.TabInputText) || !isCsv(tab.input.uri)) continue;
            const uri = tab.input.uri;
            const key = uri.toString();
            // git 비교의 옛 판 같은 파일 아닌 보기는 읽기 전용이라 그대로 둔다.
            if (!['file', 'vscode-remote', 'untitled'].includes(uri.scheme)) continue;
            const asked = wantText.get(key);
            wantText.delete(key);
            if (asked !== undefined && now - asked < 3000) continue;
            if (now - (closedAt.get(key) ?? 0) < 500) continue;
            const same = vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) => tabUri(t)?.toString() === key);
            // 같은 파일의 표 탭이 아직 있으면 그 표를 글자로 바꿔 끼우는 중이다. 고정 탭은 VS Code가 새 탭을 먼저 열고 옛 탭을 나중에 닫는다
            // (미리보기 탭은 반대라 위의 closedAt이 잡는다). 같은 파일의 글자 탭이 이미 있으면(편집기 나누기 등) 일부러 글자로 보는 것이다.
            if (same.some(isTable) || same.filter((t) => t.input instanceof vscode.TabInputText).length > 1) continue;
            const table = vscode.workspace.getConfiguration('gameCsvViewer').get('defaultEditor') === 'table';
            if (!table && !wasTable) continue;
            reopen(tab, CsvEditorProvider.viewType).then(undefined, () => undefined);
        }
    });

    // 파일 이름을 바꾸거나 지우면 그 파일에 기억한 보기 설정(배율, 크기) 열쇠도 옮기거나 지운다. 폴더면 그 안의 파일 모두다.
    const memory = context.globalState;
    const moveViews = (from: vscode.Uri, to: vscode.Uri | undefined): void => {
        const prefix = `view:${from.toString()}`;
        for (const key of memory.keys()) {
            if (key !== prefix && !key.startsWith(prefix + '/')) continue;
            const value = memory.get(key);
            if (to) void memory.update(`view:${to.toString()}${key.slice(prefix.length)}`, value);
            void memory.update(key, undefined);
        }
    };

    context.subscriptions.push(
        vscode.window.registerCustomEditorProvider(CsvEditorProvider.viewType, provider),
        onTabs,
        // 표가 열려 있지 않을 때도 CSV 글자 바뀜을 세어 둔다(표의 Ctrl+Y가 버려진 고침을 되살리지 않게).
        vscode.workspace.onDidChangeTextDocument((e) => provider.noteTextChange(e)),
        vscode.workspace.onDidRenameFiles((e) => e.files.forEach((f) => moveViews(f.oldUri, f.newUri))),
        vscode.workspace.onDidDeleteFiles((e) => e.files.forEach((uri) => moveViews(uri, undefined))),
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

// 파일 탭을 그 자리에서 다른 편집기(글자 편집기 'default' 또는 표)로 바꿔 끼운다.
async function reopen(tab: vscode.Tab, viewType: string): Promise<void> {
    const uri = tabUri(tab);
    if (!uri) return;
    try {
        // VS Code 안쪽 명령(Reopen Editor With가 쓰는 길). 파일 주소를 넘기면 그 파일의 탭을 집고, 저장 안 한 내용도 묻지 않고 넘긴다.
        await vscode.commands.executeCommand('reopenActiveEditorWith', viewType, uri);
        return;
    } catch {
        // Cursor에는 이 명령이 없다(2026-11-22 확인). 그 탭의 그룹에 새로 열고 옛 탭을 닫는다.
    }
    const column = tab.group.viewColumn;
    const wasTable = isTable(tab);
    await vscode.commands.executeCommand('vscode.openWith', uri, viewType, { viewColumn: column, preview: tab.isPreview });
    // 탭이 열리면 Cursor가 탭 목록을 새로 만들어 들고 있던 탭이 낡으므로, 그 그룹에서 같은 파일의 옛 종류 탭을 다시 찾는다.
    // 미리보기 탭이었으면 새로 연 미리보기 탭이 이미 갈아 치워 없을 수 있다.
    const old = vscode.window.tabGroups.all
        .find((g) => g.viewColumn === column)
        ?.tabs.find((t) => tabUri(t)?.toString() === uri.toString() && isTable(t) === wasTable);
    // shortcut: 저장 안 한 내용이 있으면 닫을 때 저장을 물으므로 옛 탭을 남겨 탭이 둘이 된다, Cursor에 바꿔 끼우는 명령이 생기면 그것을 쓴다.
    if (old && !old.isDirty) await vscode.window.tabGroups.close(old, true);
}

export function deactivate(): void {}
