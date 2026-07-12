# Changelog

All notable project changes should be recorded in this file.

The format is intentionally simple for now and can later be aligned with Keep a Changelog if release cadence increases.

## Unreleased

## 0.1.2 - 2026-07-12

### Added

- on-demand context panel access for outline, knowledge, and AI tools
- user-controlled focus writing mode with an optional startup preference

### Changed

- reading mode now uses the full editor width with responsive padding
- startup no longer creates an automatic untitled Markdown tab
- closed Markdown tabs are no longer restored on the next launch
- source, reading, split, and focus mode menu behavior is clearer and more stable
- workspace and editor layouts no longer resize automatically while typing

### Fixed

- AI context overlays no longer add a shadow to the empty home view
- session restoration now follows the active open tab and clears closed paths
- empty-state operations continue to show global notices

## 0.1.1 - 2026-07-11

### Added

- core native Markdown editor workflow with CodeMirror and Tauri
- edit, split, and preview modes
- workspace browsing and full-text search
- recent files and session restore
- large-file read-only paging mode
- external file change and deletion detection
- HTML export
- PDF export
- persistent editor settings
- Playwright browser E2E coverage for core flows
- Rust tests for file IO, workspace scanning, export, and metadata paths
- macOS release icon and DMG packaging support
- QA checklist, WebView automation notes, contributing guide, roadmap, security policy, and community docs

### Changed

- preview and HTML export now share the same `markdown-it` renderer
- frontend and Rust backend modules were split into clearer ownership boundaries
- frontend bundle output was optimized with manual chunking

### Known Gaps

- release signing and notarization are still pending
- native Tauri WebDriver automation is still unavailable on macOS
- PDF layout support for complex documents is still limited
