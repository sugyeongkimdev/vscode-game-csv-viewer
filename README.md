# Game CSV Viewer

Edit CSV and TSV files in VS Code as a spreadsheet-like table. Only the cells you change are rewritten, so quotes, line endings and the rest of the file stay exactly as they were.

> **Preview.** This extension is in early development. Please report problems on [GitHub Issues](https://github.com/sugyeongkimdev/vscode-game-csv-viewer/issues).

[한국어 설명은 아래에 있습니다.](#한국어)

## Features

- **Minimal diffs.** Editing a cell replaces only that cell's text. Quotes are added only when a value needs them (delimiter, quote or line break).
- **Spreadsheet-style selection.** Click, Shift+click, Ctrl+click, drag, Shift+arrow keys, row numbers and column letters, Ctrl+A, or the corner box to select all.
- **Copy and paste with Google Sheets and Excel**, cell by cell (Ctrl+C, Ctrl+X, Ctrl+V). Pasting one value into a selection fills every selected cell. Pasting past the end of the table adds rows and columns.
- **Header modes**: first row, first column, or none. Rows or columns get alternating stripes along the header. The choice applies to every file.
- **Resize** columns and rows by dragging the header borders. Double-click a border to fit a column to its content or to reset a row.
- **Zoom** with Ctrl+mouse wheel or the `- | 100% | +` buttons. Sizes and zoom are remembered per file.
- **Find** (Ctrl+F) searches the whole file, not just the rows on screen.
- **Insert and delete** rows and columns from the right-click menu.
- **Undo, redo and save** work as usual, because the file stays a normal VS Code text document.
- Handles large files: only the visible rows are drawn.
- English and Korean user interface.

## Usage

1. Open a `.csv` or `.tsv` file. The text editor stays the default.
2. Click the table icon (**Open as Table**) in the editor title bar, or right-click the file in the Explorer.
3. Click **Open as Text** in the title bar to go back to the text editor.

### Keyboard

| Key | Action |
|---|---|
| Enter, F2, double-click, or just start typing | Edit the cell |
| Enter / Shift+Enter (while editing) | Confirm and move down / up |
| Tab / Shift+Tab | Confirm and move right / left |
| Alt+Enter (while editing) | New line inside the cell |
| Esc | Cancel editing, or shrink the selection to one cell |
| Arrow keys, Home, End, PageUp, PageDown | Move (with Ctrl: jump to the edge) |
| Shift + movement keys | Extend the selection |
| Delete, Backspace | Clear the selected cells |
| Ctrl+C, Ctrl+X, Ctrl+V | Copy, cut, paste |
| Ctrl+A | Select all |
| Ctrl+F, then Enter / Shift+Enter (or F3 / Shift+F3) | Find, next match / previous match |
| Ctrl+mouse wheel | Zoom in / out |

## Settings

| Setting | Default | Description |
|---|---|---|
| `gameCsvViewer.language` | `auto` | Table view language. `auto` follows the VS Code display language (Korean if it is Korean, otherwise English). Also `en`, `ko`. |
| `gameCsvViewer.headerMode` | `row` | Fixed header: `row` (first row), `column` (first column) or `none`. The toggle in the table view changes this setting. |
| `gameCsvViewer.defaultEditor` | `text` | How CSV and TSV files open: `text` (text editor) or `table` (table view). Either way, a CSV you open while a table view is in front also opens as a table. |

Command and menu names always follow the VS Code display language.

## Notes

- The delimiter is chosen by file extension: comma for `.csv`, tab for `.tsv`.
- Multi-line values are shown on one line with a return mark. Edit the cell to see every line.
- Column widths and row heights are remembered by position. Inserting or deleting rows or columns does not move them.

## License

[MIT](LICENSE)

---

## 한국어

VS Code에서 CSV, TSV 파일을 스프레드시트 같은 표로 열어 고치는 확장입니다. 고친 셀의 글자만 바꾸고, 다른 셀의 따옴표와 줄끝은 한 글자도 건드리지 않습니다.

미리보기 판입니다. 문제가 있으면 [GitHub Issues](https://github.com/sugyeongkimdev/vscode-game-csv-viewer/issues)에 알려 주세요.

### 기능

- 고친 셀만 바꿉니다. 따옴표는 값에 나눔 글자, 큰따옴표, 줄바꿈이 있을 때만 붙입니다.
- 구글 시트 방식의 고르기: 클릭, Shift+클릭, Ctrl+클릭, 끌기, Shift+방향키, 행 번호와 열 이름 누르기, Ctrl+A, 왼쪽 위 네모(전체 선택).
- 구글 시트, 엑셀과 셀마다 나눠 복사하고 붙여 넣습니다(Ctrl+C, Ctrl+X, Ctrl+V). 값 하나를 여러 셀을 고른 채 붙이면 고른 셀 전부에 들어가고, 표 끝을 넘으면 행과 열이 늘어납니다.
- 머리글 고정: 가로(첫 행), 세로(첫 열), 없음. 머리글 방향을 따라 줄무늬가 들어갑니다. 고른 값은 모든 파일에 같이 쓰입니다.
- 열 이름의 오른쪽 경계, 행 번호의 아래쪽 경계를 끌어 크기를 바꿉니다. 경계를 두 번 누르면 열은 내용에 맞추고 행은 기본 높이로 돌아갑니다.
- Ctrl+휠이나 위쪽 `- | 100% | +` 버튼으로 확대, 축소합니다. 크기와 배율은 파일마다 기억합니다.
- Ctrl+F로 화면에 보이는 행만이 아니라 파일 전체에서 찾습니다.
- 오른쪽 버튼 메뉴로 행과 열을 삽입, 삭제합니다.
- 되돌리기, 다시 하기, 저장은 VS Code 기본 동작 그대로입니다.
- 화면에 보이는 행만 그려서 큰 파일도 빠르게 엽니다.

### 쓰는 법

1. `.csv` 또는 `.tsv` 파일을 엽니다. 기본은 지금처럼 글자 편집기입니다.
2. 편집기 오른쪽 위의 표 버튼(표로 열기)을 누르거나, 탐색기에서 파일을 오른쪽 버튼으로 누릅니다.
3. 오른쪽 위의 "텍스트 편집기로 열기"를 누르면 글자 편집기로 돌아갑니다.

키보드 조작과 설정은 위 영어 절의 표와 같습니다.

### 설정

- `gameCsvViewer.language`: 표 화면 언어입니다. 자동(기본)은 VS Code 표시 언어가 한국어면 한국어, 그 밖에는 영어입니다.
- `gameCsvViewer.headerMode`: 고정할 머리글입니다. 표 화면의 토글 버튼이 이 설정을 바꿉니다.
- `gameCsvViewer.defaultEditor`: CSV, TSV 파일을 열 때 쓸 편집기입니다. `text`(기본)는 글자 편집기, `table`은 표 화면입니다. 어느 쪽이든 표 화면을 보고 있을 때 연 CSV는 표로 열립니다.

### 알아 둘 점

- 나눔 글자는 파일 이름으로 정합니다. .csv는 쉼표, .tsv는 탭입니다.
- 셀 안 줄바꿈은 줄바꿈 표시와 함께 한 줄로 보입니다. 셀을 고치면 모든 줄이 보입니다.
- 열 너비와 행 높이는 위치로 기억해서, 행이나 열을 삽입, 삭제해도 따라 옮겨 가지 않습니다.

---

## Development

- `build.cmd` compiles, bumps the patch version, packages a VSIX into `build/` and installs it into VS Code (Windows). Run `Developer: Reload Window` afterwards.
- `npm test` runs the unit tests.
- `node tests/check-real-files.js <folder>` reads every CSV and TSV under a folder and checks that cell positions match the original text and that editing a cell changes nothing else.
