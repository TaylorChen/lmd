# LMD Core Editor MVP Design

## Goal

Build the first usable version of LMD as a native macOS Markdown editor shell. The MVP validates the core path from the source brief: a Tauri desktop app with a high-performance Markdown editing surface and Rust-backed file access.

## Scope

The first version includes:

- Tauri 2 desktop shell.
- Vite + React frontend.
- CodeMirror 6 Markdown editor.
- Open Markdown file from disk.
- Save current document back to disk.
- Create an untitled in-memory document.
- Open a folder as a workspace and browse Markdown/text files from the left rail.
- Refresh an open workspace after files change on disk.
- Search Markdown/text files in the active workspace.
- Restore the last workspace and last opened document on launch.
- Show recent files in the sidebar.
- Detect when the current file changes or disappears on disk.
- Use keyboard shortcuts for New, Open, Open Workspace, Save, and Refresh Workspace.
- Basic in-document search with match count.
- File metadata display: path, dirty state, byte size, line count.
- Rust commands for file open/save and file metadata.
- Large files use a Rust mmap-backed line index and open in a read-only windowed mode.

The first version does not include AI chat, file tree watching, Keychain storage, local vector search, or editable large-file mode. The code structure should leave room for those modules later.

## Architecture

Frontend owns UI state and editing interactions. It calls Rust through Tauri IPC for native file dialogs and file I/O. CodeMirror handles viewport rendering and Markdown editing so large documents do not become a full DOM tree.

Rust backend exposes a small command surface:

- `open_markdown_file`: ask the user for a Markdown/text file and return its path, text content, byte size, and line count.
- `open_markdown_path`: open a Markdown/text file by absolute path. Workspace file clicks use this command.
- `open_workspace`: ask the user for a folder, recursively scan Markdown/text files, and return a sorted file list.
- `refresh_workspace`: rescan an existing workspace root without opening a folder picker.
- `search_workspace`: search Markdown/text files in a workspace and return capped line-level matches.
- `load_markdown_range`: return a line window for large files by using the cached line offset index.
- `save_markdown_file`: write content to an existing path or ask for a save path when the document is untitled.
- `file_metadata`: return current existence, size, and modification timestamp for external change checks.
- `document_stats`: compute byte size and line count for current content.

For files above the large-file threshold, Rust maps the file with `memmap2`, scans newline byte offsets once, caches the index in Tauri state, and returns only the first line window. The frontend marks these files read-only and loads previous/next windows on demand. This keeps the MVP honest about large-file handling without pretending full large-file editing is solved.

## UI

The app opens directly into the editor. A left rail contains document actions and status. The main area is the CodeMirror editor. A top toolbar includes New, Open, Save, search, and current file state.

The left rail also supports a workspace file browser, recent files, and manual workspace search. Workspace scanning filters generated and hidden directories such as `.git`, `.superpowers`, `node_modules`, `target`, `dist`, and `build`.

Session recovery stores the last workspace root, last opened document path, and recent files in local browser storage. It is best-effort: if a path no longer exists, the app reports the restore error and keeps the current untitled document.

Keyboard shortcuts are mapped to common macOS editing flows: `Cmd+N`, `Cmd+O`, `Cmd+Shift+O`, `Cmd+S`, and `Cmd+R`.

Visual direction: restrained macOS-style editor, Claude-adjacent warmth, high readability, no marketing screen.

## Error Handling

File operations return typed errors as strings for the MVP. The frontend shows errors in a dismissible status banner and keeps the current document intact when operations fail.

The frontend polls the current file metadata and shows a warning when the file changes or disappears on disk. Reloading discards local edits only after confirmation, and saving after an external change asks before overwriting or recreating the file.

Large-file save is disabled in this phase because the editor only holds one visible line window, not the complete document.

## Testing And Verification

Minimum verification:

- TypeScript build succeeds.
- Rust/Tauri build configuration is valid.
- The app can open, edit, and save a Markdown file.
- A workspace folder can be scanned and files can be opened by clicking the side rail.
- An open workspace can be refreshed without reopening the folder picker.
- The previous workspace and document can be restored on app launch.
- External changes to the current file produce a visible warning and reload action.
- Workspace search returns capped line-level results and opens files from result clicks.
- A file above the large-file threshold opens in read-only window mode and can page through line ranges.
- Search updates match count without changing the document.

If dependencies cannot be installed due network restrictions, verification stops at static file creation and the blocker is reported.
