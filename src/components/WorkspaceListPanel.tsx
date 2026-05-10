import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { fileName } from "../lib/format";
import type {
  AppSettings,
  AssistantCatalog,
  EditorMode,
  GitStatus,
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
  gitStatus: GitStatus | null;
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
  onCreateMarkdownInFolder: (directory: string) => void;
  onCreateFolder: (directory: string) => void;
  onDeleteFolder: (directory: string) => void;
  onMoveWorkspaceFile: (file: WorkspaceFile) => void;
  onRenameWorkspaceFile: (file: WorkspaceFile) => void;
  onDeleteWorkspaceFile: (file: WorkspaceFile) => void;
  onRevealWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onRefreshHistorySnapshots: () => void;
  onOpenHistorySnapshot: (snapshot: HistorySnapshot) => void;
  onRestoreHistorySnapshot: (snapshot: HistorySnapshot) => void;
  onRefreshGitStatus: () => void;
  onGitCommit: () => void;
  onOpenRecentFile: (path: string, name: string) => void;
  onRemoveRecentFile: (path: string) => void;
  onSettingsChange: (settings: AppSettings) => void;
  onTestAssistantConnection: () => void;
};

type FileTreeNode = {
  name: string;
  path: string;
  type: "folder" | "file";
  file?: WorkspaceFile;
  children: FileTreeNode[];
};

type FileContextMenuState = {
  file: WorkspaceFile;
  x: number;
  y: number;
};

type FolderContextMenuState = {
  node: FileTreeNode;
  x: number;
  y: number;
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

function createFolderNode(name: string, path: string): FileTreeNode {
  return { name, path, type: "folder", children: [] };
}

function buildFileTree(files: WorkspaceFile[]) {
  const root = createFolderNode("", "");
  const folders = new Map<string, FileTreeNode>([["", root]]);
  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    let parent = root;
    let currentPath = "";
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = createFolderNode(part, currentPath);
        folders.set(currentPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({
      name: parts[parts.length - 1] ?? file.name,
      path: file.relativePath,
      type: "file",
      file,
      children: [],
    });
  }
  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(root.children);
  return root.children;
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
  gitStatus,
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
  onCreateMarkdownInFolder,
  onCreateFolder,
  onDeleteFolder,
  onMoveWorkspaceFile,
  onRenameWorkspaceFile,
  onDeleteWorkspaceFile,
  onRevealWorkspaceFile,
  onOpenSearchMatch,
  onRefreshHistorySnapshots,
  onOpenHistorySnapshot,
  onRestoreHistorySnapshot,
  onRefreshGitStatus,
  onGitCommit,
  onOpenRecentFile,
  onRemoveRecentFile,
  onSettingsChange,
  onTestAssistantConnection,
}: WorkspaceListPanelProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(["notes", "sources", "wiki", "wiki/inbox"]));
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);

  function updateSetting(nextSettings: Partial<AppSettings>) {
    onSettingsChange({ ...settings, ...nextSettings });
  }

  const fileTree = useMemo(() => buildFileTree(workspaceFiles), [workspaceFiles]);

  useEffect(() => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const file of workspaceFiles) {
        const parts = file.relativePath.split("/").filter(Boolean);
        let currentPath = "";
        for (const part of parts.slice(0, -1)) {
          currentPath = currentPath ? `${currentPath}/${part}` : part;
          next.add(currentPath);
        }
      }
      return next;
    });
  }, [workspaceFiles]);

  useEffect(() => {
    if (!fileContextMenu && !folderContextMenu) return;
    function closeContextMenu() {
      setFileContextMenu(null);
      setFolderContextMenu(null);
    }
    window.addEventListener("click", closeContextMenu);
    window.addEventListener("keydown", closeContextMenu);
    window.addEventListener("resize", closeContextMenu);
    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("keydown", closeContextMenu);
      window.removeEventListener("resize", closeContextMenu);
    };
  }, [fileContextMenu, folderContextMenu]);

  function toggleFolder(folderPath: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  function handleFileContextMenu(event: MouseEvent, file: WorkspaceFile) {
    event.preventDefault();
    event.stopPropagation();
    setFolderContextMenu(null);
    setFileContextMenu({ file, x: event.clientX, y: event.clientY });
  }

  function handleFolderContextMenu(event: MouseEvent, node: FileTreeNode) {
    event.preventDefault();
    event.stopPropagation();
    setFileContextMenu(null);
    setFolderContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  function renderTreeNode(node: FileTreeNode, depth = 0) {
    if (node.type === "folder") {
      const expanded = expandedFolders.has(node.path);
      return (
        <div key={node.path} className="file-tree-node">
          <button
            type="button"
            className="file-tree-folder"
            onClick={() => toggleFolder(node.path)}
            onContextMenu={(event) => handleFolderContextMenu(event, node)}
            aria-expanded={expanded}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <span className="folder-caret">{expanded ? "▾" : "▸"}</span>
            <span>{node.name}</span>
            <small>{node.children.length.toLocaleString()}</small>
          </button>
          {expanded && <div className="file-tree-children">{node.children.map((child) => renderTreeNode(child, depth + 1))}</div>}
        </div>
      );
    }

    const file = node.file;
    if (!file) return null;
    return (
      <button
        type="button"
        key={file.path}
        className={`file-item tree-file-item ${file.path === path ? "active" : ""}`}
        onClick={() => onOpenWorkspaceFile(file)}
        onContextMenu={(event) => handleFileContextMenu(event, file)}
        disabled={busy}
        title={file.relativePath}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
      >
        <span>{fileName(file.relativePath)}</span>
        <small className="file-kind">{sourceKindForPath(file.relativePath)}</small>
        <em>{file.relativePath}</em>
      </button>
    );
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
                <div className="file-tree" aria-label="工作区目录树">
                  {fileTree.map((node) => renderTreeNode(node))}
                </div>
              ) : (
                <p className="empty-workspace">{sectionLabel}中未找到 Markdown 文件。</p>
              )}
            </div>
            {fileContextMenu && (
              <div
                className="file-context-menu"
                role="menu"
                aria-label="文件菜单"
                style={{ left: fileContextMenu.x, top: fileContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onOpenWorkspaceFile(fileContextMenu.file);
                    setFileContextMenu(null);
                  }}
                >
                  打开
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onRenameWorkspaceFile(fileContextMenu.file);
                    setFileContextMenu(null);
                  }}
                  disabled={busy}
                >
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onMoveWorkspaceFile(fileContextMenu.file);
                    setFileContextMenu(null);
                  }}
                  disabled={busy}
                >
                  移动到目录
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    void navigator.clipboard?.writeText(fileContextMenu.file.relativePath);
                    setFileContextMenu(null);
                  }}
                >
                  复制相对路径
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onRevealWorkspaceFile(fileContextMenu.file);
                    setFileContextMenu(null);
                  }}
                  disabled={busy}
                >
                  在 Finder 中显示
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    onDeleteWorkspaceFile(fileContextMenu.file);
                    setFileContextMenu(null);
                  }}
                  disabled={busy}
                >
                  删除
                </button>
              </div>
            )}
            {folderContextMenu && (
              <div
                className="file-context-menu"
                role="menu"
                aria-label="文件夹菜单"
                style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCreateMarkdownInFolder(folderContextMenu.node.path);
                    setFolderContextMenu(null);
                  }}
                  disabled={busy}
                >
                  新建 Markdown
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCreateFolder(folderContextMenu.node.path);
                    setFolderContextMenu(null);
                  }}
                  disabled={busy}
                >
                  新建文件夹
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    onDeleteFolder(folderContextMenu.node.path);
                    setFolderContextMenu(null);
                  }}
                  disabled={busy || folderContextMenu.node.children.length > 0}
                >
                  删除空文件夹
                </button>
              </div>
            )}
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
              <div
                key={snapshot.path}
                className="history-snapshot-row"
              >
                <button
                  type="button"
                  className="recent-item"
                  onClick={() => onOpenHistorySnapshot(snapshot)}
                  disabled={busy}
                  title={snapshot.path}
                >
                  {snapshot.name}
                </button>
                <button
                  type="button"
                  className="snapshot-restore-button"
                  onClick={() => onRestoreHistorySnapshot(snapshot)}
                  disabled={busy || !path}
                  title="用该快照覆盖当前文件"
                >
                  恢复
                </button>
              </div>
            ))
          ) : (
            <p className="empty-workspace">暂无快照。</p>
          )}
        </div>
      </details>

      <details className="history-panel">
        <summary className="settings-summary">
          <span className="label">Git</span>
          <small>
            {gitStatus?.isRepository
              ? `${gitStatus.changes.length.toLocaleString()} 个改动`
              : "未启用"}
          </small>
        </summary>
        <div className="recent-list git-panel" aria-label="Git 状态">
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onRefreshGitStatus}
            disabled={busy || !workspace}
          >
            刷新 Git 状态
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onGitCommit}
            disabled={busy || !gitStatus?.isRepository || gitStatus.changes.length === 0}
          >
            提交改动
          </button>
          {gitStatus?.isRepository ? (
            <>
              <p className="git-summary">
                分支：<strong>{gitStatus.branch ?? "detached"}</strong>
              </p>
              {gitStatus.changes.length > 0 ? (
                <ul className="git-change-list">
                  {gitStatus.changes.slice(0, 8).map((change) => (
                    <li key={`${change.status}:${change.path}`}>
                      <strong>{change.status}</strong>
                      <span>{change.path}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-workspace">暂无未提交改动。</p>
              )}
              {gitStatus.currentFileDiff && (
                <details className="git-diff-panel">
                  <summary>当前文件 diff</summary>
                  <pre>{gitStatus.currentFileDiff}</pre>
                </details>
              )}
              {gitStatus.recentCommits.length > 0 && (
                <div className="git-log-panel">
                  <span className="label">最近提交</span>
                  {gitStatus.recentCommits.map((commit) => (
                    <p key={commit.hash}>
                      <strong>{commit.hash}</strong>
                      <span>{commit.subject}</span>
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="empty-workspace">当前工作区不是 Git 仓库。</p>
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

          <button
            type="button"
            className="knowledge-action-button"
            onClick={onTestAssistantConnection}
            disabled={busy}
          >
            测试 AI 连接
          </button>
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
