# Contributing

Thanks for contributing to LMD.

## Before You Start

- Keep changes scoped to the task you are addressing.
- Prefer the existing project patterns over introducing a new abstraction style.
- If you touch behavior, add or update tests when practical.

## Local Setup

Install dependencies:

```bash
npm install
```

Run the desktop app in development:

```bash
npm run tauri dev
```

Run checks before opening a PR:

```bash
npm run build
npm run test:e2e
cd src-tauri && cargo test
```

## Pull Request Expectations

- Describe the user-visible change clearly.
- Mention any tradeoffs or known limitations.
- Keep unrelated refactors out of the same PR unless they are necessary for safety.
- Update docs when behavior, workflow, or project expectations change.

## Testing Notes

This repository currently uses:

- Rust tests for real file IO and backend behavior
- Playwright browser tests for core UI flows
- real Tauri bundle builds for release verification

Native Tauri WebDriver automation is not currently available on macOS. See [docs/tauri-webview-automation-notes.md](/Users/ahyk/nodejs/lmd/docs/tauri-webview-automation-notes.md).

## Issue Reports

If you report a bug, include:

- platform and OS version
- whether the issue happens in dev mode or a built app
- reproduction steps
- expected behavior
- actual behavior
- sample Markdown file if relevant
