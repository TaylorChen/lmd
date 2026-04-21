# LMD QA and Release Checklist

Run this checklist before handing off a build.

## Automated Checks

- `npm run build`
- `npm run test:e2e`
- `cargo test` from `src-tauri`
- `npm run tauri build`

The release build should produce:

- `src-tauri/target/release/bundle/macos/LMD.app`
- `src-tauri/target/release/bundle/dmg/LMD_0.1.0_aarch64.dmg`

DMG creation uses macOS disk image tooling. If it fails in a sandboxed shell, rerun `npm run tauri build` outside the sandbox.

## Manual Regression

1. Launch `LMD.app`.
2. Create a new document, type Markdown, and verify size and line count update.
3. Switch between Edit, Split, and Preview.
4. Save a new document, close the app, reopen it, and verify session restore.
5. Open a workspace and confirm Markdown files appear.
6. Search the workspace and open a result.
7. Change Settings:
   - Default view persists after restart.
   - Search result limit changes the number of returned matches.
   - File check interval persists after restart.
8. Open a large Markdown file over 5 MB and verify read-only paging.
9. Modify the active file outside LMD and verify the external-change warning appears.
10. Export HTML and open the result in a browser.
11. Export PDF and open the result in Preview.

## Current Limits

- Preview and HTML export use `markdown-it` with tables, task lists, strikethrough, images, and linkify enabled.
- Preview and HTML export intentionally disable raw HTML input.
- PDF export is a lightweight Markdown-aware renderer with heading, list, quote, and code styling. Complex layout, tables, images, and font embedding should be checked manually.
- Native Tauri WebDriver automation is not available on macOS; see `docs/tauri-webview-automation-notes.md`.
- Release builds are unsigned and not notarized.
