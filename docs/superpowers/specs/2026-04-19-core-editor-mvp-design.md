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

The first version does not include AI chat, file tree watching, Keychain storage, local vector search, or full mmap indexing. The code structure should leave room for those modules later.

## Architecture

Frontend owns UI state and editing interactions. It calls Rust through Tauri IPC for native file dialogs and file I/O. CodeMirror handles viewport rendering and Markdown editing so large documents do not become a full DOM tree.

Rust backend exposes a small command surface:

- `open_markdown_file`: ask the user for a Markdown/text file and return its path, text content, byte size, and line count.
- `save_markdown_file`: write content to an existing path or ask for a save path when the document is untitled.
- `document_stats`: compute byte size and line count for current content.

## UI

The app opens directly into the editor. A left rail contains document actions and status. The main area is the CodeMirror editor. A top toolbar includes New, Open, Save, search, and current file state.

Visual direction: restrained macOS-style editor, Claude-adjacent warmth, high readability, no marketing screen.

## Error Handling

File operations return typed errors as strings for the MVP. The frontend shows errors in a dismissible status banner and keeps the current document intact when operations fail.

## Testing And Verification

Minimum verification:

- TypeScript build succeeds.
- Rust/Tauri build configuration is valid.
- The app can open, edit, and save a Markdown file.
- Search updates match count without changing the document.

If dependencies cannot be installed due network restrictions, verification stops at static file creation and the blocker is reported.
