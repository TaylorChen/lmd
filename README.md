# LMD

LMD is a native Markdown editor built with Tauri, React, and Rust. It is optimized for fast local editing, workspace browsing, and practical handling of large Markdown files without turning into a browser-only note app.

[MIT licensed](/Users/ahyk/nodejs/lmd/LICENSE).

## Current Scope

LMD currently focuses on a local-first desktop workflow:

- Edit Markdown with CodeMirror
- Switch between Edit, Split, and Preview modes
- Browse a Markdown workspace and search across files
- Reopen recent files and restore the last session
- Open large files in read-only paged mode
- Detect external file changes and deletions
- Initialize and inspect a local knowledge workspace
- Build assistant drafts from explicit local context
- Export HTML
- Export PDF
- Persist editor settings locally

## Features

- Native desktop shell with Tauri
- Markdown preview powered by `markdown-it`
- GFM-style tables, task lists, strikethrough, images, and linkify in preview and HTML export
- Workspace file listing and full-text search
- Large-file mmap-backed paging for files over 5 MB
- Real file metadata checks for external change detection
- Knowledge workspace protocol with `notes/`, `sources/`, `wiki/`, and `.lmd/knowledge/`
- Wiki links, backlinks, unresolved links, source references, and lint checks
- Assistant panel with provider selection and save-to-wiki draft workflow
- HTML export using the same renderer as Preview
- Lightweight Markdown-aware PDF export with heading, list, quote, and code styling
- Playwright browser E2E coverage for core UI flows
- Rust tests for real file save/open/export/metadata behavior

## Tech Stack

- Frontend: React, TypeScript, Vite
- Editor: CodeMirror 6
- Desktop runtime: Tauri v2
- Backend: Rust
- Markdown rendering: `markdown-it`, `markdown-it-task-lists`
- UI testing: Playwright

## Project Layout

```text
src/           React UI, preview renderer, hooks, components
src-tauri/     Rust backend, file IO, export, workspace scanning
tests/e2e/     Playwright browser-based UI tests
docs/          QA notes and platform limitations
```

## Development

Requirements:

- Node.js
- npm
- Rust toolchain
- Tauri prerequisites for your platform

Install dependencies:

```bash
npm install
```

Run the app in development:

```bash
npm run tauri dev
```

If you only need the frontend dev server:

```bash
npm run dev
```

## Test and Build

Frontend build:

```bash
npm run build
```

Rust tests:

```bash
cd src-tauri
cargo test
```

Browser E2E:

```bash
npm run test:e2e
```

## Assistant Providers

LMD ships with three assistant provider modes:

- `builtin`: deterministic local summary assembly, no network or external process
- `mock_openai`: test adapter for provider wiring
- `external_command`: runs a local executable defined by `LMD_ASSISTANT_COMMAND`

The external command provider is the integration point for local LLM tools such as an `llm-wiki` wrapper. LMD writes one JSON object to stdin:

```json
{
  "provider": "external_command",
  "model": "command-json-v1",
  "context": {
    "currentPath": "/absolute/path/to/current.md",
    "currentRelativePath": "notes/current.md",
    "items": []
  }
}
```

The command must write an assistant draft JSON object to stdout:

```json
{
  "title": "topic summary",
  "content": "# topic summary\n\n## Summary\n\nDraft text."
}
```

Example:

```bash
export LMD_ASSISTANT_COMMAND=/absolute/path/to/lmd/scripts/lmd-assistant-command.example.mjs
export LMD_ASSISTANT_TIMEOUT_SECONDS=60
npm run tauri dev
```

`LMD_ASSISTANT_TIMEOUT_SECONDS` is optional. It defaults to 60 seconds and is capped at 600 seconds.

The repository includes [`scripts/lmd-assistant-command.example.mjs`](/Users/ahyk/nodejs/lmd/scripts/lmd-assistant-command.example.mjs) as a minimal protocol-compatible command. Replace it with a wrapper that calls your local model or `llm-wiki` workflow.

Desktop bundles:

```bash
npm run tauri build
```

Current macOS release outputs:

- `src-tauri/target/release/bundle/macos/LMD.app`
- `src-tauri/target/release/bundle/dmg/LMD_0.1.0_aarch64.dmg`

## Testing Strategy

LMD uses three layers of verification:

1. Rust tests
   - real file save/open/export flows
   - metadata changes
   - workspace scanning and search
   - large-file range logic
2. Playwright browser tests
   - editing
   - preview rendering
   - settings persistence
   - save/export/workspace command flows
3. Tauri release build verification
   - ensures `.app` and `.dmg` still build

More detail:

- [QA checklist](/Users/ahyk/nodejs/lmd/docs/qa-release-checklist.md)
- [Tauri WebView automation notes](/Users/ahyk/nodejs/lmd/docs/tauri-webview-automation-notes.md)

## Platform Notes

- The project is currently developed and verified primarily on macOS.
- Native Tauri WebDriver automation is not available on macOS because Tauri desktop WebDriver support does not currently cover WKWebView.
- The repository therefore uses:
  - Rust real file-flow tests
  - Playwright browser tests with mocked Tauri command calls
  - real Tauri bundle verification

## Known Limits

- Preview and HTML export intentionally disable raw HTML input.
- PDF export is not a full layout engine yet. Complex table layout, image placement, and font embedding still need manual checking.
- Release builds are not signed or notarized yet.
- Native Tauri WebDriver automation would need Linux or Windows CI rather than the current macOS environment.

## Status

This project is usable, testable, and buildable, but still early.

High-priority remaining work:

- code signing and notarization
- optional native Tauri WebDriver coverage on supported CI platforms
- further PDF layout improvements

## Contributing

- [Contributing guide](/Users/ahyk/nodejs/lmd/CONTRIBUTING.md)
- [Roadmap](/Users/ahyk/nodejs/lmd/ROADMAP.md)
- [Security policy](/Users/ahyk/nodejs/lmd/SECURITY.md)
- [Code of conduct](/Users/ahyk/nodejs/lmd/CODE_OF_CONDUCT.md)
- [Changelog](/Users/ahyk/nodejs/lmd/CHANGELOG.md)
