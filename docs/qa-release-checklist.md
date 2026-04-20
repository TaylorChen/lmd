# LMD QA and Release Checklist

Run this checklist before handing off a build.

## Automated Checks

- `npm run build`
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

## Current Limits

- Preview covers common Markdown blocks, but not full GFM tables or task lists.
- HTML export uses the same lightweight renderer style; advanced Markdown should be checked manually.
- PDF export is not implemented yet.
- Release builds are unsigned and not notarized.
