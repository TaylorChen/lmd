import { fileName, formatBytes } from "../lib/format";
import type {
  AppSettings,
  AssistantCatalog,
  EditorMode,
  LibrarySection,
  RecentFile,
  SearchMatch,
  Workspace,
  WorkspaceFile,
} from "../types";

type WorkspaceListPanelProps = {
  busy: boolean;
  workspace: Workspace | null;
  librarySection: LibrarySection;
  workspaceFiles: WorkspaceFile[];
  workspaceQuery: string;
  workspaceMatches: SearchMatch[];
  workspaceSearchActive: boolean;
  recentFiles: RecentFile[];
  path: string | null;
  isLarge: boolean;
  byteSize: number;
  lineCount: number;
  visibleStartLine: number;
  visibleEndLine: number;
  settings: AppSettings;
  assistantCatalog: AssistantCatalog;
  onWorkspaceQueryChange: (query: string) => void;
  onWorkspaceSearch: () => void;
  onOpenWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onOpenRecentFile: (path: string, name: string) => void;
  onSettingsChange: (settings: AppSettings) => void;
};

function sourceKindForPath(relativePath: string) {
  if (relativePath.startsWith("wiki/inbox/")) return "inbox";
  if (relativePath.startsWith("wiki/")) return "wiki";
  if (relativePath.startsWith("sources/")) return "source";
  if (relativePath.startsWith("notes/")) return "note";
  return "file";
}

export function WorkspaceListPanel({
  busy,
  workspace,
  librarySection,
  workspaceFiles,
  workspaceQuery,
  workspaceMatches,
  workspaceSearchActive,
  recentFiles,
  path,
  isLarge,
  byteSize,
  lineCount,
  visibleStartLine,
  visibleEndLine,
  settings,
  assistantCatalog,
  onWorkspaceQueryChange,
  onWorkspaceSearch,
  onOpenWorkspaceFile,
  onOpenSearchMatch,
  onOpenRecentFile,
  onSettingsChange,
}: WorkspaceListPanelProps) {
  function updateSetting(nextSettings: Partial<AppSettings>) {
    onSettingsChange({ ...settings, ...nextSettings });
  }

  const selectedProvider =
    assistantCatalog.providers.find((provider) => provider.id === settings.assistantProvider) ??
    assistantCatalog.providers[0];
  const sectionLabel = {
    inbox: "Inbox",
    "all-notes": "Workspace",
    notes: "Notes",
    sources: "Sources",
    wiki: "Wiki",
    recent: "Recent",
  }[librarySection];

  return (
    <aside className="workspace-list-panel" aria-label="Workspace notes">
      <div className="workspace-panel">
        <div className="workspace-header">
          <span className="label">{sectionLabel}</span>
          <small>
            {librarySection === "recent"
              ? `${recentFiles.length.toLocaleString()} files`
              : workspace
                ? `${workspaceFiles.length.toLocaleString()} files`
                : "None"}
          </small>
        </div>

        {librarySection === "recent" ? (
          recentFiles.length > 0 ? (
            <div className="file-list" aria-label="Workspace files">
              {recentFiles.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  className={`file-item ${file.path === path ? "active" : ""}`}
                  onClick={() => onOpenRecentFile(file.path, file.name)}
                  disabled={busy}
                  title={file.path}
                >
                  <span>{file.name}</span>
                  <small className="file-kind">recent</small>
                  <em>{file.path}</em>
                </button>
              ))}
            </div>
          ) : (
            <p className="empty-workspace">No recent files yet.</p>
          )
        ) : workspace ? (
          <>
            <div className="workspace-summary">
              <strong title={workspace.rootPath}>{fileName(workspace.rootPath)}</strong>
              <small title={workspace.rootPath}>{workspace.rootPath}</small>
              <span className={`workspace-mode ${workspace.knowledge.isInitialized ? "ready" : "pending"}`}>
                {workspace.knowledge.isInitialized ? "Knowledge workspace ready" : "Standard workspace"}
              </span>
            </div>
            <form
              className="workspace-search"
              onSubmit={(event) => {
                event.preventDefault();
                onWorkspaceSearch();
              }}
            >
              <input
                aria-label="Search workspace"
                value={workspaceQuery}
                onChange={(event) => onWorkspaceQueryChange(event.target.value)}
                placeholder="Search workspace"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !workspaceQuery.trim()}>
                Find
              </button>
            </form>
            {workspaceSearchActive && (
              <div className="workspace-header workspace-subheader">
                <span className="label">Matches</span>
                <small>{workspaceMatches.length.toLocaleString()}</small>
              </div>
            )}
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
                      <small className="file-kind">Line {match.lineNumber.toLocaleString()}</small>
                      <em>{match.lineText}</em>
                    </button>
                  ))
                ) : (
                  <p className="empty-workspace">No matches found.</p>
                )
              ) : workspaceFiles.length > 0 ? (
                workspaceFiles.map((file) => (
                  <button
                    type="button"
                    key={file.path}
                    className={`file-item ${file.path === path ? "active" : ""}`}
                    onClick={() => onOpenWorkspaceFile(file)}
                    disabled={busy}
                    title={file.relativePath}
                  >
                    <span>{fileName(file.relativePath)}</span>
                    <small className="file-kind">{sourceKindForPath(file.relativePath)}</small>
                    <em>{file.relativePath}</em>
                    <small className="file-meta">{formatBytes(file.byteSize)}</small>
                  </button>
                ))
              ) : (
                <p className="empty-workspace">No Markdown files found in {sectionLabel}.</p>
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

      <div className="settings-panel">
        <div className="workspace-header">
          <span className="label">Settings</span>
          <small>Local</small>
        </div>

        <label>
          <span>Default view</span>
          <select
            aria-label="Default view"
            value={settings.defaultEditorMode}
            onChange={(event) => updateSetting({ defaultEditorMode: event.target.value as EditorMode })}
          >
            <option value="edit">Edit</option>
            <option value="split">Split</option>
            <option value="preview">Preview</option>
          </select>
        </label>

        <label>
          <span>Search results</span>
          <select
            aria-label="Search results"
            value={settings.searchResultLimit}
            onChange={(event) => updateSetting({ searchResultLimit: Number(event.target.value) })}
          >
            <option value={40}>40</option>
            <option value={80}>80</option>
            <option value={120}>120</option>
            <option value={200}>200</option>
          </select>
        </label>

        <label>
          <span>File check</span>
          <select
            aria-label="File check"
            value={settings.externalCheckSeconds}
            onChange={(event) => updateSetting({ externalCheckSeconds: Number(event.target.value) })}
          >
            <option value={2}>2 sec</option>
            <option value={5}>5 sec</option>
            <option value={10}>10 sec</option>
            <option value={30}>30 sec</option>
          </select>
        </label>

        <label>
          <span>Assistant</span>
          <select
            aria-label="Assistant provider"
            value={settings.assistantProvider}
            onChange={(event) => {
              const nextProvider = assistantCatalog.providers.find(
                (provider) => provider.id === event.target.value,
              );
              if (!nextProvider) return;
              updateSetting({
                assistantProvider: nextProvider.id,
                assistantModel: nextProvider.models[0] ?? settings.assistantModel,
              });
            }}
          >
            {assistantCatalog.providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Assistant model</span>
          <select
            aria-label="Assistant model"
            value={settings.assistantModel}
            onChange={(event) => updateSetting({ assistantModel: event.target.value })}
          >
            {selectedProvider?.models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="document-card">
        <div className="workspace-header">
          <span className="label">Document</span>
        </div>
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
