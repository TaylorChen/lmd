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
- Basic in-document search with match count.
- File metadata display: path, dirty state, byte size, line count.
- Rust commands for file open/save and file metadata.
- Large files use a Rust mmap-backed line index and open in a read-only windowed mode.

The first version does not include AI chat, file tree watching, Keychain storage, local vector search, or editable large-file mode. The code structure should leave room for those modules later.

## Architecture

Frontend owns UI state and editing interactions. It calls Rust through Tauri IPC for native file dialogs and file I/O. CodeMirror handles viewport rendering and Markdown editing so large documents do not become a full DOM tree.

Rust backend exposes a small command surface:

- `open_markdown_file`: ask the user for a Markdown/text file and return its path, text content, byte size, and line count.
- `load_markdown_range`: return a line window for large files by using the cached line offset index.
- `save_markdown_file`: write content to an existing path or ask for a save path when the document is untitled.
- `document_stats`: compute byte size and line count for current content.

For files above the large-file threshold, Rust maps the file with `memmap2`, scans newline byte offsets once, caches the index in Tauri state, and returns only the first line window. The frontend marks these files read-only and loads previous/next windows on demand. This keeps the MVP honest about large-file handling without pretending full large-file editing is solved.

## UI

The app opens directly into the editor. A left rail contains document actions and status. The main area is the CodeMirror editor. A top toolbar includes New, Open, Save, search, and current file state.

Visual direction: restrained macOS-style editor, Claude-adjacent warmth, high readability, no marketing screen.

## Error Handling

File operations return typed errors as strings for the MVP. The frontend shows errors in a dismissible status banner and keeps the current document intact when operations fail.

Large-file save is disabled in this phase because the editor only holds one visible line window, not the complete document.

## Testing And Verification

Minimum verification:

- TypeScript build succeeds.
- Rust/Tauri build configuration is valid.
- The app can open, edit, and save a Markdown file.
- A file above the large-file threshold opens in read-only window mode and can page through line ranges.
- Search updates match count without changing the document.

If dependencies cannot be installed due network restrictions, verification stops at static file creation and the blocker is reported.
