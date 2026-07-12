# LMD

[English](README.md) | [简体中文](README.zh-CN.md)

**Local-first Markdown notes, connected knowledge, and AI-assisted Wiki drafting.**

LMD is a native macOS app for writing Markdown, organizing a folder as a knowledge workspace, and turning notes and linked context into reviewable Wiki drafts with AI. Your source files stay as plain Markdown in folders you control—there is no proprietary note database to migrate into.

[Download LMD 0.1.2 for Intel macOS](https://github.com/TaylorChen/lmd/releases/tag/0.1.2) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md)

> **Early release:** the macOS build is currently unsigned and unnotarized. If Gatekeeper blocks the first launch, open the DMG, drag LMD to Applications, then Control-click LMD in Finder and choose **Open**.

## Screenshot

### The native macOS app with the current on-demand workspace and document tools

![Current LMD native macOS editor](docs/assets/lmd-editor.png)

## Why LMD

- **Own your notes.** Files remain ordinary `.md` documents on disk.
- **Connect knowledge without changing formats.** Use Wiki links, backlinks, tags, Front Matter, aliases, block IDs, and block references.
- **Keep AI grounded in your workspace.** Work with the current note and indexed related context, then save results as Markdown drafts under `wiki/inbox/`.
- **Choose local or hosted models.** Use Ollama, LM Studio, an external command, or supported OpenAI-compatible providers.
- **Stay focused.** The workspace dock, outline, knowledge inspector, and AI drawer appear on demand instead of permanently shrinking the editor.

## Core Workflows

### Write Markdown

Open a file, drop one or more Markdown files into LMD, or create a new note. Edit in source, preview, or split view with CodeMirror 6 and a Markdown renderer that supports tables, task lists, math, diagrams, callouts, footnotes, highlighted code, and a document TOC.

### Open a local workspace

Drop a folder onto LMD or press `Cmd+Shift+O`. The folder becomes the workspace without closing open or unsaved tabs. Files, search, recent items, history snapshots, and Git actions stay tied to that local folder.

### Build connected knowledge

Initialize the workspace from the native **Knowledge** menu or command palette. LMD creates a transparent folder protocol:

```text
notes/
sources/
wiki/
wiki/inbox/
.lmd/knowledge/lmd.db
AGENTS.md
wiki/index.md
wiki/log.md
```

The local SQLite index powers workspace search, Wiki-link resolution, backlinks, unresolved-link checks, tags, aliases, block references, knowledge linting, and related context.

### Draft with AI, keep the result local

Open the on-demand AI drawer to summarize, polish, extract todos, generate a title or outline, continue writing, or ask a custom question. Generated content can be inserted into the note, replace a selection, or be saved as:

```text
<workspace>/wiki/inbox/<draft-title>.md
```

## Features

### Editing and Markdown

- Tabs, unsaved-state indicators, rename and close actions
- Native file and folder drag-and-drop
- `Cmd+O` for Markdown and `Cmd+Shift+O` for workspaces
- Source, preview, vertical split, and horizontal split views
- Temporary `Cmd+F` document search
- Large-file read-only paging for files over 5 MB
- External-change detection for modified or deleted files
- YAML Front Matter hidden from preview and exports
- Tables, task lists, strikethrough, `==highlight==`, footnotes, `[TOC]`, and Obsidian-style callouts
- KaTeX math, Mermaid, PlantUML, code highlighting, and copy buttons

### Knowledge and workspace

- SQLite-backed full-workspace index
- Queries including `path:`, `#tag`, and `block:^id`
- Wiki links, backlinks, unresolved links, aliases, and block references
- Editable Front Matter and workspace-wide tag rename
- Knowledge lint reports and index rebuild controls
- Recent files and recently opened workspaces
- Daily notes, attachments, history snapshots, and Git status/diff/commit actions

### AI assistant

- DeepSeek, MiniMax, Kimi/Moonshot, Zhipu GLM/Z.ai, Ollama, and LM Studio
- Advanced local external-command provider using JSON over stdin/stdout
- Streaming responses in the native app
- Current-note and indexed workspace context
- Summarize, polish, extract todos, title, outline, continue, and chat tasks
- Insert, replace selection, save Wiki draft, and archive conversation actions
- API keys stored in macOS Keychain in the native app

### Export

- HTML
- Lightweight PDF
- DOCX through a local `pandoc` installation

## Install

LMD is currently developed and verified primarily on macOS.

1. Open the [LMD 0.1.2 Release](https://github.com/TaylorChen/lmd/releases/tag/0.1.2).
2. Download `LMD_0.1.2_x64.dmg` for Intel Macs.
3. Drag LMD into Applications.
4. Because this early build is unsigned and unnotarized, Control-click LMD in Finder and choose **Open** for the first launch if macOS blocks it.

Windows, Linux, Apple Silicon macOS, code signing, notarization, and automatic updates are not currently provided.

## First Run

- Drop Markdown files to open them as tabs.
- Drop a folder to use it as a workspace.
- Use `Cmd+K` to open the command palette.
- Initialize knowledge features from **Knowledge → Initialize Knowledge Base** or the command palette.
- Configure an AI provider from Settings; use Ollama or LM Studio to keep inference local.

## Development

### Requirements

- Node.js and npm
- Rust toolchain with Cargo available on `PATH`
- Tauri v2 prerequisites for macOS
- Optional: `pandoc` for DOCX export

```bash
npm install
npm run tauri:dev
```

Frontend-only preview:

```bash
npm run dev
```

The browser preview cannot perform real native file operations. Playwright tests install mocked Tauri commands for UI coverage.

## Verification and Packaging

```bash
npm run build
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build
```

Local macOS bundles are written under:

```text
src-tauri/target/release/bundle/macos/LMD.app
src-tauri/target/release/bundle/dmg/
```

The DMG filename reflects the application version and local build architecture.

## Project Structure

```text
src/           React UI, editor hooks, Markdown rendering, and components
src-tauri/     Rust backend for files, workspace indexing, AI, export, and Git
tests/e2e/     Playwright browser UI and workflow coverage
docs/          QA notes, screenshots, and design documentation
```

## Current Limits and Direction

- Raw HTML is intentionally disabled in preview and HTML export.
- PDF export is lightweight and does not cover every complex layout.
- DOCX export requires a local `pandoc` installation.
- Release builds are not signed or notarized.
- Native macOS WebView automation is unavailable, so LMD combines Rust file-flow tests, mocked Playwright UI tests, and real local bundle builds.
- Deeper semantic retrieval, source transparency, knowledge review workflows, and code signing remain roadmap work—not current features.

See the [Roadmap](ROADMAP.md) and [QA checklist](docs/qa-release-checklist.md) for current priorities and release checks.

## Contributing

Contributions and focused bug reports are welcome.

- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Changelog](CHANGELOG.md)
- [MIT license](LICENSE)
