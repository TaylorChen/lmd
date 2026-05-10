import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { fileName } from "../lib/format";
import type {
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
  visibleStartLine: number;
  visibleEndLine: number;
  onWorkspaceQueryChange: (query: string) => void;
  onWorkspaceSearch: () => void;
  onOpenWorkspace: () => void;
  onOpenWorkspaceFile: (file: WorkspaceFile) => void;
  onCreateMarkdownInFolder: (directory: string) => void;
  onCreateFolder: (directory: string) => void;
  onDeleteFolder: (directory: string) => void;
  onMoveWorkspaceFile: (file: WorkspaceFile) => void;
  onRenameWorkspaceFile: (file: WorkspaceFile) => void;
  onDeleteWorkspaceFile: (file: WorkspaceFile) => void;
  onRevealWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onOpenRecentFile: (path: string, name: string) => void;
  onRemoveRecentFile: (path: string) => void;
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

function createFolderNode(name: string, path: string): FileTreeNode {
  return { name, path, type: "folder", children: [] };
}

function searchHighlightTerms(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .map((token) => {
      if (token.startsWith("path:")) return "";
      if (token.startsWith("#")) return "";
      if (token.startsWith("block:")) return `^${token.slice("block:".length).replace(/^\^/, "")}`;
      return token;
    })
    .filter(Boolean);
}

function highlightedSearchLine(match: SearchMatch, query: string) {
  const terms = searchHighlightTerms(query);
  const lowerText = match.lineText.toLowerCase();
  const ranges = terms
    .map((term) => {
      const start = lowerText.indexOf(term.toLowerCase());
      return start === -1 ? null : { start, end: start + term.length };
    })
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((left, right) => left.start - right.start);

  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      mergedRanges.push({ ...range });
    }
  }

  if (mergedRanges.length === 0 && match.matchEnd > match.matchStart) {
    mergedRanges.push({
      start: Math.max(0, match.matchStart),
      end: Math.min(match.lineText.length, match.matchEnd),
    });
  }

  if (mergedRanges.length === 0) return match.lineText;

  const parts = [];
  let cursor = 0;
  for (const range of mergedRanges) {
    if (range.start > cursor) {
      parts.push(<span key={`text-${cursor}`}>{match.lineText.slice(cursor, range.start)}</span>);
    }
    parts.push(
      <mark key={`mark-${range.start}-${range.end}`} className="search-highlight">
        {match.lineText.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  }
  if (cursor < match.lineText.length) {
    parts.push(<span key={`text-${cursor}`}>{match.lineText.slice(cursor)}</span>);
  }
  return parts;
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
  recentFiles,
  path,
  isLarge,
  visibleStartLine,
  visibleEndLine,
  onWorkspaceQueryChange,
  onWorkspaceSearch,
  onOpenWorkspace,
  onOpenWorkspaceFile,
  onCreateMarkdownInFolder,
  onCreateFolder,
  onDeleteFolder,
  onMoveWorkspaceFile,
  onRenameWorkspaceFile,
  onDeleteWorkspaceFile,
  onRevealWorkspaceFile,
  onOpenSearchMatch,
  onOpenRecentFile,
  onRemoveRecentFile,
}: WorkspaceListPanelProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set(["notes", "sources", "wiki", "wiki/inbox"]));
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);

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

  function collapseAllFolders() {
    setExpandedFolders(new Set());
  }

  function expandAllFolders() {
    setExpandedFolders((current) => {
      const next = new Set(current);
      const visit = (node: FileTreeNode) => {
        if (node.type === "folder") {
          next.add(node.path);
          node.children.forEach(visit);
        }
      };
      fileTree.forEach(visit);
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
        <div className="workspace-header resource-tree-header">
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
              <div className="workspace-title-row">
                <strong title={workspace.rootPath}>{fileName(workspace.rootPath)}</strong>
                <span className={`workspace-mode ${workspace.knowledge.isInitialized ? "ready" : "pending"}`}>
                  {workspace.knowledge.isInitialized ? "知识库" : "本地"}
                </span>
              </div>
              <div className="resource-tree-toolbar" aria-label="资源树操作">
                <button
                  type="button"
                  onClick={() => onCreateMarkdownInFolder("")}
                  disabled={busy}
                  aria-label="新建 Markdown"
                  title="新建 Markdown"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => onCreateFolder("")}
                  disabled={busy}
                  aria-label="新建文件夹"
                  title="新建文件夹"
                >
                  ⊞
                </button>
                <button
                  type="button"
                  onClick={expandAllFolders}
                  disabled={busy}
                  aria-label="展开全部文件夹"
                  title="展开全部文件夹"
                >
                  ⇅
                </button>
                <button
                  type="button"
                  onClick={collapseAllFolders}
                  disabled={busy}
                  aria-label="折叠全部文件夹"
                  title="折叠全部文件夹"
                >
                  ×
                </button>
              </div>
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
                      <em>{highlightedSearchLine(match, workspaceQuery)}</em>
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
            <button type="button" onClick={onOpenWorkspace} disabled={busy}>
              打开工作区
            </button>
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
