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
12. Open a workspace for the first time and verify root files are visible while folders are collapsed; open a nested file from a command/search result and verify its ancestors expand and the file is revealed.
13. Open workspace search and Recent Files, then press Escape in each view; verify the sidebar returns to the tree and restores a sensible tree focus target.
14. In the workspace tree, verify Arrow Up/Down/Left/Right, Home, End, and Enter navigate/open files without losing the visible focus outline.
15. Open a workspace with no saved sidebar preference and verify its file dock opens for that session without writing a preference; explicitly close it, restart, and verify the saved closed state restores with only the 44px Ribbon visible.
16. Use the Ribbon to open Files, Search, and Recent; verify the active item is clear, keyboard focus is visible, and closing the dock returns focus to its active Ribbon button.
17. With a saved closed preference, reveal a nested file from command search; verify the dock opens transiently, expands the file's ancestors, and keeps the saved closed preference unchanged after restart.
18. Enter writing mode and verify the entire left workspace area, including the Ribbon, collapses to 0px; press Escape or move the pointer and verify the normal Ribbon/dock state returns.
19. At 1280px and 1024px widths, verify light and dark mode each use exactly 284px when the file dock is open and 44px when it is closed; verify no permanent right column is reserved and the editor remains usable.
20. From Finder, drag one Markdown file into LMD and verify it opens in a tab; drag multiple `.md`/`.markdown` files and verify every file opens in source order.
21. Drag a folder into LMD and verify it opens in place as the workspace without closing existing or unsaved tabs; dropping the active workspace should refresh it.
22. Drag a folder together with Markdown files and verify the folder becomes the workspace and all Markdown files open; drag multiple folders or unsupported files and verify LMD opens only the first folder and summarizes skipped items.
23. Verify the drop overlay appears only while dragging, `Cmd+O` opens Markdown, `Cmd+Shift+O` opens a workspace, and recent workspaces appear only in Recent/menu surfaces.
24. Open Outline, Knowledge, and AI from the editor utilities; verify only one is visible at a time, Escape closes it and restores trigger focus, and Knowledge is absent without an initialized knowledge context.
25. Open the AI drawer and verify the editor width does not change, the drawer is at most 400px/90vw, Summary/Polish/Todos remain primary, and Title/Outline/Continue/Run Log are under More.

## Current Limits

- Preview and HTML export use `markdown-it` with tables, task lists, strikethrough, images, and linkify enabled.
- Preview and HTML export intentionally disable raw HTML input.
- PDF export is a lightweight Markdown-aware renderer with heading, list, quote, and code styling. Complex layout, tables, images, and font embedding should be checked manually.
- Native Tauri WebDriver automation is not available on macOS; see `docs/tauri-webview-automation-notes.md`.
- Release builds are unsigned and not notarized.
