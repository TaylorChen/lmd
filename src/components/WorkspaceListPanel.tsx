import { fileName } from "../lib/format";
import type {
  AppSettings,
  AssistantCatalog,
  EditorMode,
  HistorySnapshot,
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
  historySnapshots: HistorySnapshot[];
  recentFiles: RecentFile[];
  path: string | null;
  isLarge: boolean;
  visibleStartLine: number;
  visibleEndLine: number;
  settings: AppSettings;
  assistantCatalog: AssistantCatalog;
  onWorkspaceQueryChange: (query: string) => void;
  onWorkspaceSearch: () => void;
  onOpenWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onRefreshHistorySnapshots: () => void;
  onOpenHistorySnapshot: (snapshot: HistorySnapshot) => void;
  onOpenRecentFile: (path: string, name: string) => void;
  onRemoveRecentFile: (path: string) => void;
  onSettingsChange: (settings: AppSettings) => void;
};

function sourceKindForPath(relativePath: string) {
  if (relativePath.startsWith("wiki/inbox/")) return "收件箱";
  if (relativePath.startsWith("wiki/")) return "知识库";
  if (relativePath.startsWith("sources/")) return "资料";
  if (relativePath.startsWith("notes/")) return "笔记";
  return "文件";
}

function assistantProviderLabel(provider: AssistantCatalog["providers"][number]) {
  if (provider.id === "deepseek") return "DeepSeek";
  if (provider.id === "minimax") return "MiniMax";
  if (provider.id === "kimi") return "Kimi";
  if (provider.id === "zhipu") return "智谱 GLM";
  if (provider.id === "external_command") return "外部命令";
  return provider.label;
}

export function WorkspaceListPanel({
  busy,
  workspace,
  librarySection,
  workspaceFiles,
  workspaceQuery,
  workspaceMatches,
  workspaceSearchActive,
  historySnapshots,
  recentFiles,
  path,
  isLarge,
  visibleStartLine,
  visibleEndLine,
  settings,
  assistantCatalog,
  onWorkspaceQueryChange,
  onWorkspaceSearch,
  onOpenWorkspaceFile,
  onOpenSearchMatch,
  onRefreshHistorySnapshots,
  onOpenHistorySnapshot,
  onOpenRecentFile,
  onRemoveRecentFile,
  onSettingsChange,
}: WorkspaceListPanelProps) {
  function updateSetting(nextSettings: Partial<AppSettings>) {
    onSettingsChange({ ...settings, ...nextSettings });
  }

  const selectedProvider =
    assistantCatalog.providers.find((provider) => provider.id === settings.assistantProvider) ??
    assistantCatalog.providers[0];
  const primaryAssistantProviders = assistantCatalog.providers.filter(
    (provider) => provider.id !== "external_command",
  );
  const externalCommandProvider = assistantCatalog.providers.find(
    (provider) => provider.id === "external_command",
  );
  const primarySelectedProvider =
    selectedProvider?.id === "external_command"
      ? primaryAssistantProviders[0]
      : selectedProvider;
  const providerNeedsKey =
    selectedProvider?.id !== "external_command" && Boolean(selectedProvider?.apiKeyEnv);
  const providerHasEndpoint =
    selectedProvider?.id !== "external_command" && Boolean(selectedProvider?.baseUrl);
  const sectionLabel = {
    inbox: "收件箱",
    "all-notes": "工作区",
    notes: "笔记",
    sources: "资料",
    wiki: "知识库",
    recent: "最近",
  }[librarySection];
  const showRecentPanel = !workspace && librarySection !== "recent" && recentFiles.length > 0;

  return (
    <aside className="workspace-list-panel" aria-label="工作区笔记">
      <div className="workspace-panel">
        <div className="workspace-header">
          <span className="label">{sectionLabel}</span>
          <small>
            {librarySection === "recent"
              ? `${recentFiles.length.toLocaleString()} 个文件`
              : workspace
                ? `${workspaceFiles.length.toLocaleString()} 个文件`
                : "无"}
          </small>
        </div>

        {librarySection === "recent" ? (
          recentFiles.length > 0 ? (
            <div className="file-list" aria-label="工作区文件">
              {recentFiles.map((file) => (
                <div
                  key={file.path}
                  className={`recent-file-row ${file.path === path ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="file-item"
                    onClick={() => onOpenRecentFile(file.path, file.name)}
                    disabled={busy}
                    title={file.path}
                  >
                    <span>{file.name}</span>
                    <small className="file-kind">最近</small>
                    <em>{file.path}</em>
                  </button>
                  <button
                    type="button"
                    className="recent-remove-button"
                    onClick={() => onRemoveRecentFile(file.path)}
                    disabled={busy}
                    aria-label={`移除最近文件 ${file.name}`}
                    title="从最近列表移除"
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="empty-workspace">暂无最近文件。</p>
          )
        ) : workspace ? (
          <>
            <div className="workspace-summary">
              <strong title={workspace.rootPath}>{fileName(workspace.rootPath)}</strong>
              <span className={`workspace-mode ${workspace.knowledge.isInitialized ? "ready" : "pending"}`}>
                {workspace.knowledge.isInitialized ? "知识库工作区已就绪" : "标准工作区"}
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
                aria-label="搜索工作区"
                value={workspaceQuery}
                onChange={(event) => onWorkspaceQueryChange(event.target.value)}
                placeholder="搜索工作区，支持 #标签 path:wiki"
                disabled={busy}
              />
              <button type="submit" disabled={busy || !workspaceQuery.trim()}>
                查找
              </button>
            </form>
            {workspaceSearchActive && (
              <div className="workspace-header workspace-subheader">
                <span className="label">匹配结果</span>
                <small>{workspaceMatches.length.toLocaleString()}</small>
              </div>
            )}
            <div className="file-list" aria-label="工作区文件">
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
                      <small className="file-kind">第 {match.lineNumber.toLocaleString()} 行</small>
                      <em>{match.lineText}</em>
                    </button>
                  ))
                ) : (
                  <p className="empty-workspace">未找到匹配结果。</p>
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
                  </button>
                ))
              ) : (
                <p className="empty-workspace">{sectionLabel}中未找到 Markdown 文件。</p>
              )}
            </div>
          </>
        ) : (
          <div className="workspace-empty-state">
            <strong>工作区</strong>
            <p className="empty-workspace">打开文件夹以浏览笔记。</p>
          </div>
        )}
      </div>

      {showRecentPanel && (
        <div className="recent-panel">
          <div className="workspace-header">
            <span className="label">最近</span>
            <small>{recentFiles.length.toLocaleString()}</small>
          </div>
          <div className="recent-list" aria-label="最近文件">
            {recentFiles.map((file) => (
              <div
                key={file.path}
                className={`recent-compact-row ${file.path === path ? "active" : ""}`}
              >
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenRecentFile(file.path, file.name)}
                  disabled={busy}
                  title={file.path}
                >
                  {file.name}
                </button>
                <button
                  type="button"
                  className="recent-remove-icon"
                  onClick={() => onRemoveRecentFile(file.path)}
                  disabled={busy}
                  aria-label={`移除最近文件 ${file.name}`}
                  title="从最近列表移除"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <details className="history-panel">
        <summary className="settings-summary">
          <span className="label">保存快照</span>
          <small>{historySnapshots.length.toLocaleString()}</small>
        </summary>
        <div className="recent-list" aria-label="保存快照">
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onRefreshHistorySnapshots}
            disabled={busy || !path}
          >
            刷新快照
          </button>
          {historySnapshots.length > 0 ? (
            historySnapshots.map((snapshot) => (
              <button
                type="button"
                key={snapshot.path}
                className="recent-item"
                onClick={() => onOpenHistorySnapshot(snapshot)}
                disabled={busy}
                title={snapshot.path}
              >
                {snapshot.name}
              </button>
            ))
          ) : (
            <p className="empty-workspace">暂无快照。</p>
          )}
        </div>
      </details>

      <details className="settings-panel">
        <summary className="settings-summary">
          <span className="label">设置</span>
          <small>本地</small>
        </summary>

        <div className="settings-content">
          <label>
            <span>默认视图</span>
            <select
              aria-label="默认视图"
              value={settings.defaultEditorMode}
              onChange={(event) => updateSetting({ defaultEditorMode: event.target.value as EditorMode })}
            >
              <option value="edit">编辑</option>
              <option value="split">分屏</option>
              <option value="preview">预览</option>
            </select>
          </label>

          <label>
            <span>搜索结果</span>
            <select
              aria-label="搜索结果"
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
            <span>文件检查</span>
            <select
              aria-label="文件检查"
              value={settings.externalCheckSeconds}
              onChange={(event) => updateSetting({ externalCheckSeconds: Number(event.target.value) })}
            >
              <option value={2}>2 秒</option>
              <option value={5}>5 秒</option>
              <option value={10}>10 秒</option>
              <option value={30}>30 秒</option>
            </select>
          </label>

          <label>
            <span>AI 助手</span>
            <select
              aria-label="AI 助手提供方"
              value={primarySelectedProvider?.id ?? ""}
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
              {primaryAssistantProviders.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {assistantProviderLabel(provider)}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>AI 模型</span>
            <select
              aria-label="AI 模型"
              value={
                selectedProvider?.id === "external_command"
                  ? primarySelectedProvider?.models[0] ?? ""
                  : settings.assistantModel
              }
              onChange={(event) =>
                updateSetting({
                  assistantProvider: primarySelectedProvider?.id ?? settings.assistantProvider,
                  assistantModel: event.target.value,
                })
              }
            >
              {primarySelectedProvider?.models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>

          {selectedProvider?.id !== "external_command" && selectedProvider && (
            <>
              {providerNeedsKey && (
                <label>
                  <span>API Key</span>
                  <input
                    aria-label="AI API Key"
                    type="password"
                    value={settings.assistantApiKeys[selectedProvider.id] ?? ""}
                    onChange={(event) =>
                      updateSetting({
                        assistantApiKeys: {
                          ...settings.assistantApiKeys,
                          [selectedProvider.id]: event.target.value,
                        },
                      })
                    }
                    placeholder={selectedProvider.apiKeyEnv ?? "API Key"}
                  />
                </label>
              )}

              {providerHasEndpoint && (
                <label>
                  <span>接口地址</span>
                  <input
                    aria-label="AI 接口地址"
                    value={settings.assistantBaseUrls[selectedProvider.id] ?? selectedProvider.baseUrl ?? ""}
                    onChange={(event) =>
                      updateSetting({
                        assistantBaseUrls: {
                          ...settings.assistantBaseUrls,
                          [selectedProvider.id]: event.target.value,
                        },
                      })
                    }
                    placeholder={selectedProvider.baseUrl ?? "https://.../chat/completions"}
                  />
                </label>
              )}
            </>
          )}

          {externalCommandProvider && (
            <details className="advanced-settings-panel">
              <summary>高级 AI 设置</summary>
              <div className="advanced-settings-content">
                <p className="advanced-settings-note">
                  当前高级模式：{selectedProvider?.id === "external_command" ? "外部命令" : "未启用"}
                </p>
                <button
                  type="button"
                  className="knowledge-action-button"
                  onClick={() =>
                    updateSetting({
                      assistantProvider: externalCommandProvider.id,
                      assistantModel: externalCommandProvider.models[0] ?? settings.assistantModel,
                    })
                  }
                >
                  使用外部命令
                </button>

                <label>
                  <span>命令路径</span>
                  <input
                    aria-label="外部命令路径"
                    value={settings.assistantExternalCommand}
                    onChange={(event) =>
                      updateSetting({
                        assistantExternalCommand: event.target.value,
                      })
                    }
                    placeholder="例如 /absolute/path/to/assistant"
                  />
                </label>

                <label>
                  <span>超时时间</span>
                  <select
                    aria-label="外部命令超时时间"
                    value={settings.assistantExternalTimeoutSeconds}
                    onChange={(event) =>
                      updateSetting({
                        assistantExternalTimeoutSeconds: Number(event.target.value),
                      })
                    }
                  >
                    <option value={30}>30 秒</option>
                    <option value={60}>60 秒</option>
                    <option value={120}>120 秒</option>
                    <option value={300}>300 秒</option>
                    <option value={600}>600 秒</option>
                  </select>
                </label>
              </div>
            </details>
          )}
        </div>
      </details>

      {isLarge && (
        <div className="large-file-card">
          <span className="label">大文件</span>
          <strong>只读窗口</strong>
          <small>
            第 {visibleStartLine.toLocaleString()}-{visibleEndLine.toLocaleString()} 行
          </small>
        </div>
      )}
    </aside>
  );
}
