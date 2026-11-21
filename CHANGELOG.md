# Changelog

## 0.1 (first preview)

First public preview.

- Open `.csv` and `.tsv` files as a table from the editor title bar or the Explorer context menu. The same tab switches between the text editor and the table, and unsaved changes are kept.
- Setting `gameCsvViewer.defaultEditor` (`text` or `table`). A CSV file opened while a table view is in front also opens as a table.
- Editing a cell rewrites only that cell's text. Quotes are added only when needed.
- Spreadsheet-style selection: Shift+click, Ctrl+click, drag, Shift+arrow keys, row and column headers, Ctrl+A and the corner box.
- Copy as tab-separated text and an HTML table, the formats spreadsheet apps use. Pasting one value fills the selection, and pasting past the end grows the table.
- Drag selected rows or columns to move them, with a floating preview and a drop line.
- Insert and delete rows and columns from the right-click menu, several at once when several are selected.
- Header modes (first row, first column, none) with stripes along the header, shared by all files.
- Resize columns and rows by dragging, with double-click to fit or reset. Sizes follow inserted, deleted and moved rows and columns.
- Undo and redo cover cell edits and column and row sizes in one order. Ctrl+S confirms the cell being edited before saving.
- Zoom with Ctrl+mouse wheel around the pointer, or with the zoom buttons around the current cell. Sizes and zoom are remembered per file.
- Find with Ctrl+F across the whole file.
- Large files stay responsive: only the rows and columns on screen are drawn, and only changed rows are sent after an edit.
- English and Korean user interface.
