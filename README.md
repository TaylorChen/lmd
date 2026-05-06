# LMD

LMD is a native Markdown editor built with Tauri, React, and Rust. It is designed for local-first note taking, fast Markdown editing, workspace browsing, and AI-assisted writing without turning into a browser-only note app.

![LMD editor screenshot](docs/assets/lmd-editor.png)

[MIT licensed](LICENSE).

## Highlights

- Native macOS desktop shell powered by Tauri
- Focused three-column layout for files, writing/preview, and AI assistance
- Edit, Split, and Preview modes for Markdown writing
- Front Matter-aware preview, KaTeX math, Mermaid diagrams, and syntax-highlighted code blocks
- Workspace browsing, recent files, and full-text search
- Local knowledge workspace with `notes/`, `sources/`, `wiki/`, and `wiki/inbox/`
- AI assistant chat with DeepSeek, MiniMax, Kimi, 智谱 GLM, or a local external command
- Save AI drafts directly into `wiki/inbox/`
- HTML and lightweight PDF export
- Large-file read-only paging for Markdown files over 5 MB
- Browser E2E tests and Rust backend tests

## Features

- Native desktop shell with Tauri
- Markdown preview powered by `markdown-it`
- GFM-style tables, task lists, strikethrough, images, and linkify in preview and HTML export
- YAML Front Matter is hidden from rendered preview and export output
- KaTeX math formulas, Mermaid diagrams, and syntax-highlighted code blocks
- Workspace file listing and full-text search
- Large-file mmap-backed paging for files over 5 MB
- Real file metadata checks for external change detection
- Knowledge workspace protocol with `notes/`, `sources/`, `wiki/`, and `.lmd/knowledge/`
- Wiki links, backlinks, unresolved links, source references, and lint checks
- Assistant chat with provider selection, explicit loading states, and save-to-wiki draft workflow
- HTML export using the same renderer as Preview
- Lightweight Markdown-aware PDF export with heading, list, quote, and code styling
- Playwright browser E2E coverage for core UI flows
- Rust tests for real file save/open/export/metadata behavior

## Tech Stack

- Frontend: React, TypeScript, Vite
- Editor: CodeMirror 6
- Desktop runtime: Tauri v2
- Backend: Rust
- Markdown rendering: `markdown-it`, `markdown-it-task-lists`, `markdown-it-texmath`, KaTeX, Mermaid, highlight.js
- UI testing: Playwright

## Project Layout

```text
src/           React UI, preview renderer, hooks, components
src-tauri/     Rust backend, file IO, export, workspace scanning
tests/e2e/     Playwright browser-based UI tests
docs/          QA notes and platform limitations
```

## Quick Start

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
npm run tauri:dev
```

If you only need the frontend dev server:

```bash
npm run dev
```

## Knowledge Workspace

Open a folder as a workspace, then use `More -> Initialize Knowledge Base` in the left rail. LMD creates:

```text
notes/
sources/
wiki/
wiki/inbox/
.lmd/knowledge/
AGENTS.md
wiki/index.md
wiki/log.md
```

AI drafts saved from the assistant are written to:

```text
<workspace>/wiki/inbox/<draft-title>.md
```

The app also updates `wiki/index.md` and `wiki/log.md` when saving a draft.

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

LMD ships with OpenAI-compatible assistant providers for DeepSeek, MiniMax, Kimi, and 智谱 GLM. Select a provider in Settings, then either enter the provider API key in the local settings panel or export the matching environment variable before starting the Tauri app:

- `DEEPSEEK_API_KEY`
- `MINIMAX_API_KEY`
- `MOONSHOT_API_KEY`
- `ZAI_API_KEY`

`external_command` runs a local executable. Configure the command path and timeout in Settings, or use `LMD_ASSISTANT_COMMAND` and `LMD_ASSISTANT_TIMEOUT_SECONDS` as environment-variable fallbacks.

The external command provider is the integration point for local LLM tools such as an `llm-wiki` wrapper. LMD writes one JSON object to stdin:

```json
{
  "provider": "external_command",
  "model": "command-json-v1",
  "task": "summarize",
  "prompt": "Optional user instruction",
  "currentContent": "# Current note",
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
# Optional fallback if the command path is not configured in Settings.
export LMD_ASSISTANT_COMMAND=/absolute/path/to/lmd/scripts/lmd-assistant-command.example.mjs
export LMD_ASSISTANT_TIMEOUT_SECONDS=60
npm run tauri:dev
```

The timeout defaults to 60 seconds and is capped at 600 seconds.

The repository includes [`scripts/lmd-assistant-command.example.mjs`](scripts/lmd-assistant-command.example.mjs) as a minimal protocol-compatible command. Replace it with a wrapper that calls your local model or `llm-wiki` workflow.

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

- [QA checklist](docs/qa-release-checklist.md)
- [Tauri WebView automation notes](docs/tauri-webview-automation-notes.md)

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

- [Contributing guide](CONTRIBUTING.md)
- [Roadmap](ROADMAP.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
