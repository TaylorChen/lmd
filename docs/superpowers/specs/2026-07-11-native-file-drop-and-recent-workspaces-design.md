# Native File Drop And Recent Workspaces Design

## Goal

Make opening local Markdown content feel native while keeping LMD's initial editor and empty workspace sidebar visually quiet.

## Scope

This change adds native drag and drop for Markdown files and folders, keyboard and menu access for opening content, recent-workspace persistence, and a minimal empty workspace state.

It does not add file copying, workspace merging, arbitrary attachment drops, tab reordering, or a first-run onboarding screen.

## Interaction Design

### Empty workspace

When no workspace is open, the workspace sidebar body is blank. It does not show a heading, explanatory copy, an open button, recent workspaces, or a permanent drop target.

Opening actions remain discoverable through the macOS menu and command palette:

- `File -> Open Markdown...` uses `Cmd+O`.
- `File -> Open Workspace...` uses `Cmd+Shift+O`.
- Recent workspaces are available through the File menu and the existing Recent sidebar view.

The existing workspace title/menu remains available in the sidebar header when the sidebar is visible.

### Drag feedback

The application shows no drag affordance during ordinary use. When supported paths enter the native window, a full-window translucent drop overlay appears above the application content.

The overlay uses one concise instruction: `松开以打开` and a secondary description based on the detected payload:

- Markdown files: `打开 N 个 Markdown 文件`
- One folder: `将 <folder-name> 作为工作区打开`
- Mixed files and folders: `打开工作区和 N 个 Markdown 文件`

The overlay disappears on drop, cancellation, or when the pointer leaves the native window.

### Dropped Markdown files

- `.md` and `.markdown` matching is case-insensitive.
- All supported files are opened in the order supplied by the native event.
- Each file opens in its own tab using the existing open-by-path flow.
- A file that is already open activates its existing tab instead of creating a duplicate.
- Existing tabs, including unsaved tabs, remain open.
- Unsupported files do not open.

### Dropped folders

- The first dropped folder becomes the active workspace.
- Opening a folder means referencing it in place; LMD never copies its contents.
- Existing document tabs remain open when the workspace changes.
- Dropping the currently open workspace refreshes it instead of reopening it.
- An empty folder is a valid workspace and shows an empty file tree.
- When more than one folder is dropped, only the first is opened and the notification reports how many were skipped.
- Files inside a dropped folder are not automatically opened as tabs.

### Mixed payloads

When a payload contains both folders and Markdown files, LMD opens or refreshes the first folder as the workspace, then opens every supported Markdown file as a tab. Unsupported files and additional folders are skipped and summarized in one notification.

## Recent Workspaces

LMD stores up to eight recent workspace entries, each containing its absolute path, display name, and last-opened time. Opening a workspace through a dialog, drag and drop, session restore, or the recent-workspace action promotes it to the front and removes duplicates.

Recent workspaces appear only in:

- the File menu;
- the existing Recent sidebar view.

They do not appear in the initial editor or blank workspace body. Users can open or remove individual recent workspaces. Removing a recent workspace does not alter the folder on disk.

Invalid or missing recent workspace paths remain in the list until an attempted open fails; after failure, LMD explains the problem and offers removal through the existing recent-item action.

## Architecture

### Frontend path classification

A focused module classifies native drop paths into Markdown files, the first folder, additional folders, and unsupported paths. Classification preserves input order and does not perform UI work. This boundary is covered with deterministic unit tests.

### Native path inspection

The Rust backend exposes a command that classifies a supplied path using filesystem metadata. It returns `markdown`, `directory`, `unsupported`, or a readable error. The frontend does not infer directories from filename extensions.

### Native window events

The React application subscribes to Tauri's native drag-enter, drag-over, drag-leave, and drop event stream. A small hook owns subscription cleanup and exposes overlay state plus the final list of paths. Browser preview remains usable when the native API is unavailable.

### Existing flows

Dropped Markdown paths reuse the existing `open_markdown_path` and tab deduplication behavior. Dropped folders reuse a path-based workspace-loading command and the same state update used by the folder picker. Recent-workspace persistence lives beside the existing recent-file persistence.

The feature should not add more unrelated state and effects directly to `App.tsx`; path classification, drag subscription, and persistence remain in focused modules or hooks.

## Error Handling And Feedback

One drop produces at most one summary notification after processing:

- Success reports the number of Markdown files opened and the workspace name when applicable.
- Partial success reports unsupported paths, extra folders, or individual paths that could not be opened.
- Complete failure explains that no supported Markdown file or readable folder was found.
- Permission and missing-path failures include a readable path-specific reason without exposing a raw Rust debug representation.

During processing, the existing busy state prevents duplicate drops. A second drop while busy is ignored with no new destructive action.

## Accessibility

- The drop overlay is visual feedback, not the only way to open content.
- Menu items and command-palette actions remain keyboard accessible.
- The overlay status is exposed as a polite live region.
- Notifications summarize the result for assistive technologies.
- Keyboard focus stays in the current editor or tab after a folder-only drop; after files are dropped, the last successfully opened file becomes active.
- Reduced-motion preferences disable nonessential overlay transitions.

## Testing

### Frontend unit tests

- Classify case-insensitive Markdown extensions.
- Preserve multiple-file order.
- Select only the first folder.
- Separate unsupported files and additional folders.
- Build the correct overlay message for file, folder, and mixed payloads.
- Deduplicate and limit recent workspaces.

### Browser E2E tests

- Empty workspace body contains no onboarding heading, explanation, or open button.
- Simulated drag state shows and dismisses the drop overlay.
- Recent sidebar renders recent files and recent workspaces without adding content to the initial editor.
- Command-palette open actions remain available.

### Rust tests

- Identify Markdown files, directories, unsupported files, missing paths, and unreadable paths.
- Load an explicit workspace path without invoking a picker.

### Native manual verification

- Drag one Markdown file, multiple Markdown files, one folder, mixed paths, unsupported files, and multiple folders from Finder.
- Verify switching and refreshing workspaces preserves unsaved tabs.
- Verify `Cmd+O`, `Cmd+Shift+O`, native menu actions, and notifications.

## Acceptance Criteria

- The initial workspace body is blank and contains no open-workspace call to action.
- Users can open Markdown through `Cmd+O`, a native menu, the command palette, or native drag and drop.
- Users can open a workspace through `Cmd+Shift+O`, a native menu, the command palette, a recent-workspace entry, or native drag and drop.
- Dropping multiple Markdown files opens all supported files as tabs.
- Dropping a folder opens it in place as the workspace without closing existing tabs.
- Drop feedback appears only while dragging and gives one accessible result notification.
- Recent workspaces are persisted but never displayed on the initial editor or blank workspace body.
