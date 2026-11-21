// 표 화면과 확장 안내 글자의 영어, 한국어 목록. 표 화면은 이 목록을 확장에게서 받아 쓴다.
// 명령 이름과 오른쪽 버튼 메뉴 글자는 package.nls.json, package.nls.ko.json에 있다(VS Code 표시 언어를 따른다).
// vscode에 기대지 않는 순수 코드라 node 시험으로 바로 확인할 수 있다.

export type Lang = 'en' | 'ko';

const EN_TEXT = {
    headerLabel: 'Header',
    modeRow: 'Row',
    modeColumn: 'Column',
    modeNone: 'None',
    modeRowTip: 'First row is the header (fixed at the top)',
    modeColumnTip: 'First column is the header (fixed at the left)',
    modeNoneTip: 'No header',
    zoomLabel: 'Zoom',
    zoomOut: 'Zoom out (Ctrl+wheel down)',
    zoomIn: 'Zoom in (Ctrl+wheel up)',
    zoomReset: 'Reset zoom to 100%',
    selectAll: 'Select all',
    findPlaceholder: 'Find',
    findNone: 'No results',
    findPrev: 'Previous match (Shift+Enter)',
    findNext: 'Next match (Enter)',
    findClose: 'Close (Escape)',
    emptyFile: 'This file is empty. Right-click here to insert a row.',
    size: '{rows} rows, {cols} columns',
    selected: '{n} cells selected',
    moveRows: 'Move rows ({n})',
    moveCols: 'Move columns ({n})',
    editCanceled: 'The cell you were editing changed or was removed outside the table, so the edit was canceled.',
    staleEdit: 'Game CSV Viewer: The file changed outside the table after you saw it, so this edit was not applied. Check the table and try again.',
    openQuote: 'Game CSV Viewer: This file has a quote that is never closed. Rows or columns added at the end will go inside that cell. Fix the quote in the text editor first.',
    multiCopy: 'Multiple ranges can be copied only when they cover the same rows or the same columns.',
    error: 'Game CSV Viewer: {message}',
};

export type UiText = typeof EN_TEXT;

const KO_TEXT: UiText = {
    headerLabel: '머리글',
    modeRow: '가로',
    modeColumn: '세로',
    modeNone: '없음',
    modeRowTip: '첫 행을 머리글로 위에 고정',
    modeColumnTip: '첫 열을 머리글로 왼쪽에 고정',
    modeNoneTip: '머리글 없음',
    zoomLabel: '배율',
    zoomOut: '축소(Ctrl+휠 아래로)',
    zoomIn: '확대(Ctrl+휠 위로)',
    zoomReset: '100%로 되돌리기',
    selectAll: '전체 선택',
    findPlaceholder: '찾기',
    findNone: '결과 없음',
    findPrev: '이전 결과(Shift+Enter)',
    findNext: '다음 결과(Enter)',
    findClose: '닫기(Esc)',
    emptyFile: '빈 파일입니다. 여기를 오른쪽 버튼으로 눌러 행을 삽입하세요.',
    size: '{rows}행, {cols}열',
    selected: '셀 {n}개 선택',
    moveRows: '행 {n}개 옮기기',
    moveCols: '열 {n}개 옮기기',
    editCanceled: '고치던 셀이 표 밖에서 바뀌거나 없어져서 고치기를 취소했습니다.',
    staleEdit: 'Game CSV Viewer: 표를 본 뒤 파일이 표 밖에서 바뀌어 이 고침은 넣지 않았습니다. 표를 확인하고 다시 해 주세요.',
    openQuote: 'Game CSV Viewer: 이 파일에는 닫히지 않은 따옴표가 있습니다. 끝에 행이나 열을 붙이면 그 셀 안으로 들어가니, 글자 편집기에서 따옴표를 먼저 고쳐 주세요.',
    multiCopy: '여러 범위는 같은 행들이나 같은 열들에 걸쳐 있을 때만 복사할 수 있습니다.',
    error: 'Game CSV Viewer: {message}',
};

/**
 * 쓸 언어를 정한다. 설정이 en, ko면 그대로 쓰고, 그 밖(auto 등)이면 VS Code 표시 언어가 한국어일 때만 한국어다.
 * 표시 언어를 읽지 못하거나 한국어가 아니면 영어다.
 */
export function pickLang(setting: unknown, uiLanguage: unknown): Lang {
    if (setting === 'en' || setting === 'ko') return setting;
    return typeof uiLanguage === 'string' && uiLanguage.toLowerCase().startsWith('ko') ? 'ko' : 'en';
}

export function uiText(lang: Lang): UiText {
    return lang === 'ko' ? KO_TEXT : EN_TEXT;
}
