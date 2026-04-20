import { fileName, formatBytes } from "../lib/format";
import type { RecentFile, SearchMatch, Workspace, WorkspaceFile } from "../types";

type SidebarProps = {
  busy: boolean;
  workspace: Workspace | null;
  workspaceQuery: string;
  workspaceMatches: SearchMatch[];
  workspaceSearchActive: boolean;
  recentFiles: RecentFile[];
  path: string | null;
  isLarge: boolean;
  isDirty: boolean;
  byteSize: number;
  lineCount: number;
  visibleStartLine: number;
  visibleEndLine: number;
  onNew: () => void;
  onOpen: () => void;
  onOpenWorkspace: () => void;
  onRefreshWorkspace: () => void;
  onSave: () => void;
  onExportHtml: () => void;
  onWorkspaceQueryChange: (query: string) => void;
  onWorkspaceSearch: () => void;
  onOpenWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onOpenRecentFile: (path: string, name: string) => void;
};

export function Sidebar({
  busy,
  workspace,
  workspaceQuery,
  workspaceMatches,
  workspaceSearchActive,
  recentFiles,
  path,
  isLarge,
  isDirty,
  byteSize,
  lineCount,
  visibleStartLine,
  visibleEndLine,
  onNew,
  onOpen,
  onOpenWorkspace,
  onRefreshWorkspace,
  onSave,
  onExportHtml,
  onWorkspaceQueryChange,
  onWorkspaceSearch,
  onOpenWorkspaceFile,
  onOpenSearchMatch,
  onOpenRecentFile,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div>
        <div className="app-mark">LMD</div>
        <p className="sidebar-copy">Light Markdown</p>
      </div>

      <div className="sidebar-actions">
        <button type="button" onClick={onNew} disabled={busy}>
          New
        </button>
        <button type="button" onClick={onOpen} disabled={busy}>
          Open
        </button>
        <button type="button" onClick={onOpenWorkspace} disabled={busy}>
          Workspace
        </button>
        <button type="button" onClick={onRefreshWorkspace} disabled={busy || !workspace}>
          Refresh
        </button>
        <button type="button" className="primary-action" onClick={onSave} disabled={busy || !isDirty}>
          Save
        </button>
        <button type="button" onClick={onExportHtml} disabled={busy}>
          Export HTML
        </button>
      </div>

      <div className="workspace-panel">
        <div className="workspace-header">
          <span className="label">Workspace</span>
          <small>{workspace ? `${workspace.files.length.toLocaleString()} files` : "None"}</small>
        </div>

        {workspace ? (
          <>
            <strong title={workspace.rootPath}>{fileName(workspace.rootPath)}</strong>
            <form
              className="workspace-search"
              onSubmit={(event) => {
                event.preventDefault();
                onWorkspaceSearch();
              }}
            >
              <input
                value={workspaceQuery}
                onChange={(event) => onWorkspaceQueryChange(event.target.value)}
                placeholder="Search workspace"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !workspaceQuery.trim()}>
                Find
              </button>
            </form>
            <div className="file-list" aria-label="Workspace files">
              {workspaceSearchActive ? (
                workspaceMatches.length > 0 ? (
                  workspaceMatches.map((match, index) => (
                    <button
                      type="button"
                      key={`${match.path}:${match.lineNumber}:${index}`}
                      className={`file-item search-result ${match.path === path ? "active" : ""}`}
                      onClick={() => onOpenSearchMatch(match)}
                      disabled={busy}
                      title={`${match.relativePath}:${match.lineNumber}`}
                    >
                      <span>{match.relativePath}</span>
                      <small>Line {match.lineNumber.toLocaleString()}</small>
                      <em>{match.lineText}</em>
                    </button>
                  ))
                ) : (
                  <p className="empty-workspace">No matches found.</p>
                )
              ) : workspace.files.length > 0 ? (
                workspace.files.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className={`file-item ${file.path === path ? "active" : ""}`}
                    onClick={() => onOpenWorkspaceFile(file)}
                    disabled={busy}
                    title={file.relativePath}
                  >
                    <span>{file.relativePath}</span>
                    <small>{formatBytes(file.byteSize)}</small>
                  </button>
                ))
              ) : (
                <p className="empty-workspace">No Markdown files found.</p>
              )}
            </div>
          </>
        ) : (
          <p className="empty-workspace">Open a folder to browse notes.</p>
        )}
      </div>

      <div className="recent-panel">
        <div className="workspace-header">
          <span className="label">Recent</span>
          <small>{recentFiles.length.toLocaleString()}</small>
        </div>
        {recentFiles.length > 0 ? (
          <div className="recent-list" aria-label="Recent files">
            {recentFiles.map((file) => (
              <button
                type="button"
                key={file.path}
                className={`recent-item ${file.path === path ? "active" : ""}`}
                onClick={() => onOpenRecentFile(file.path, file.name)}
                disabled={busy}
                title={file.path}
              >
                {file.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-workspace">No recent files yet.</p>
        )}
      </div>

      <div className="document-card">
        <span className="label">Document</span>
        <strong>{fileName(path)}</strong>
        <small title={path ?? undefined}>{path ?? "Not saved yet"}</small>
      </div>

      {isLarge && (
        <div className="large-file-card">
          <span className="label">Large file</span>
          <strong>Read-only window</strong>
          <small>
            Lines {visibleStartLine.toLocaleString()}-{visibleEndLine.toLocaleString()}
          </small>
        </div>
      )}

      <div className="stats-grid">
        <div>
          <span>{formatBytes(byteSize)}</span>
          <small>Size</small>
        </div>
        <div>
          <span>{lineCount.toLocaleString()}</span>
          <small>Lines</small>
        </div>
      </div>
    </aside>
  );
}
