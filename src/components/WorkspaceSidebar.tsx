import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { RecentFile, SearchMatch, SidebarView, Workspace, WorkspaceFile } from "../types";
import {
  ancestorFolderPaths,
  buildWorkspaceTree,
  visibleWorkspaceTreeNodes,
  type WorkspaceTreeNode,
} from "../lib/workspaceTree";
import { readWorkspaceTreeExpanded, writeWorkspaceTreeExpanded } from "../lib/storage";

type FileContextMenuState = { file: WorkspaceFile; x: number; y: number };
type FolderContextMenuState = {
  node: Extract<WorkspaceTreeNode, { kind: "folder" }>;
  x: number;
  y: number;
};

type WorkspaceSidebarProps = {
  busy: boolean;
  workspace: Workspace | null;
  view: SidebarView;
  files: WorkspaceFile[];
  recentFiles: RecentFile[];
  activePath: string | null;
  searchQuery: string;
  searchMatches: SearchMatch[];
  searchActive: boolean;
  revealPath: string | null;
  onViewChange: (view: SidebarView) => void;
  onRevealComplete: () => void;
  onOpenWorkspace: () => void;
  onRefreshWorkspace: () => void;
  onRevealWorkspace: () => void;
  onOpenSettings: () => void;
  onCreateMarkdown: (directory: string) => void;
  onCreateFolder: (directory: string) => void;
  onDeleteFolder: (directory: string) => void;
  onMoveWorkspaceFile: (file: WorkspaceFile) => void;
  onRenameWorkspaceFile: (file: WorkspaceFile) => void;
  onDeleteWorkspaceFile: (file: WorkspaceFile) => void;
  onRevealWorkspaceFile: (file: WorkspaceFile) => void;
  onOpenFile: (file: WorkspaceFile) => void;
  onOpenRecent: (path: string, name: string) => void;
  onRemoveRecent: (path: string) => void;
  onSearchQueryChange: (query: string) => void;
  onSearch: () => void;
  onOpenSearchMatch: (match: SearchMatch) => void;
  onCollapse: () => void;
};

function searchHighlightTerms(query: string) {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => {
      if (term.startsWith("block:")) return `^${term.slice("block:".length).replace(/^\^/, "")}`;
      return term.replace(/^(#|path:|file:)/i, "");
    })
    .filter(Boolean);
}

function highlightedSearchLine(match: SearchMatch, query: string) {
  const lowerText = match.lineText.toLowerCase();
  const ranges = searchHighlightTerms(query)
    .map((term) => {
      const start = lowerText.indexOf(term.toLowerCase());
      return start === -1 ? null : { start, end: start + term.length };
    })
    .filter((range): range is { start: number; end: number } => Boolean(range))
    .sort((left, right) => left.start - right.start);
  const mergedRanges: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const previous = mergedRanges[mergedRanges.length - 1];
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else mergedRanges.push({ ...range });
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
    if (range.start > cursor) parts.push(<span key={`text-${cursor}`}>{match.lineText.slice(cursor, range.start)}</span>);
    parts.push(<mark key={`mark-${range.start}-${range.end}`} className="search-highlight">{match.lineText.slice(range.start, range.end)}</mark>);
    cursor = range.end;
  }
  if (cursor < match.lineText.length) parts.push(<span key={`text-${cursor}`}>{match.lineText.slice(cursor)}</span>);
  return parts;
}

function displayWorkspaceFileName(name: string) {
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}

export function WorkspaceSidebar({
  busy,
  workspace,
  view,
  files,
  recentFiles,
  activePath,
  searchQuery,
  searchMatches,
  searchActive,
  revealPath,
  onViewChange,
  onRevealComplete,
  onOpenWorkspace,
  onRefreshWorkspace,
  onRevealWorkspace,
  onOpenSettings,
  onCreateMarkdown,
  onCreateFolder,
  onDeleteFolder,
  onMoveWorkspaceFile,
  onRenameWorkspaceFile,
  onDeleteWorkspaceFile,
  onRevealWorkspaceFile,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
  onSearchQueryChange,
  onSearch,
  onOpenSearchMatch,
  onCollapse,
}: WorkspaceSidebarProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [focusedNodePath, setFocusedNodePath] = useState<string | null>(null);
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenuState | null>(null);
  const [folderContextMenu, setFolderContextMenu] = useState<FolderContextMenuState | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTriggerRef = useRef<HTMLButtonElement | null>(null);
  const previousTreeFocusPathRef = useRef<string | null>(null);
  const fileTree = useMemo(() => buildWorkspaceTree(files), [files]);
  const visibleFileTree = useMemo(
    () => visibleWorkspaceTreeNodes(fileTree, expandedFolders),
    [expandedFolders, fileTree],
  );

  useEffect(() => {
    setExpandedFolders(workspace ? readWorkspaceTreeExpanded(workspace.rootPath) : new Set());
    setFocusedNodePath(null);
    previousTreeFocusPathRef.current = null;
  }, [workspace?.rootPath]);

  useEffect(() => {
    const visiblePaths = new Set(visibleFileTree.map(({ node }) => nodePath(node)));
    if (visiblePaths.size === 0) {
      if (focusedNodePath !== null) setFocusedNodePath(null);
      return;
    }
    if (focusedNodePath && visiblePaths.has(focusedNodePath)) return;

    const activeFilePath = files.find((file) => file.path === activePath)?.relativePath;
    setFocusedNodePath(activeFilePath && visiblePaths.has(activeFilePath)
      ? activeFilePath
      : nodePath(visibleFileTree[0].node));
  }, [activePath, files, focusedNodePath, visibleFileTree]);

  useEffect(() => {
    if (!workspace || !revealPath) return;
    setFocusedNodePath(revealPath);
    updateExpanded((current) => new Set([...current, ...ancestorFolderPaths(revealPath)]));
  }, [revealPath, workspace?.rootPath]);

  useEffect(() => {
    if (!focusedNodePath || view !== "tree") return;
    const item = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("[data-workspace-path]") ?? [])
      .find((candidate) => candidate.dataset.workspacePath === focusedNodePath);
    item?.focus();
  }, [focusedNodePath, view, visibleFileTree]);

  useEffect(() => {
    if (!revealPath) return;
    if (ancestorFolderPaths(revealPath).some((folder) => !expandedFolders.has(folder))) return;
    const item = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>("[data-workspace-path]") ?? [])
      .find((candidate) => candidate.dataset.workspacePath === revealPath);
    if (!item) {
      onRevealComplete();
      return;
    }
    item.scrollIntoView({ block: "nearest" });
    item.focus();
    onRevealComplete();
  }, [expandedFolders, onRevealComplete, revealPath, visibleFileTree]);

  useEffect(() => {
    if (view !== "search") return;
    searchInputRef.current?.focus();
  }, [view]);

  useEffect(() => {
    if (!fileContextMenu && !folderContextMenu) return;
    const closeMenus = () => {
      setFileContextMenu(null);
      setFolderContextMenu(null);
    };
    window.addEventListener("click", closeMenus);
    window.addEventListener("keydown", closeMenus);
    window.addEventListener("resize", closeMenus);
    return () => {
      window.removeEventListener("click", closeMenus);
      window.removeEventListener("keydown", closeMenus);
      window.removeEventListener("resize", closeMenus);
    };
  }, [fileContextMenu, folderContextMenu]);

  function updateExpanded(updater: (current: Set<string>) => Set<string>) {
    setExpandedFolders((current) => {
      const next = updater(current);
      if (workspace) writeWorkspaceTreeExpanded(workspace.rootPath, next);
      return next;
    });
  }

  function toggleFolder(folderPath: string) {
    updateExpanded((current) => {
      const next = new Set(current);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });
  }

  function nodePath(node: WorkspaceTreeNode) {
    return node.relativePath;
  }

  function focusNode(path: string | null) {
    if (!path) return;
    setFocusedNodePath(path);
  }

  function focusVisibleNode(index: number) {
    const next = visibleFileTree[Math.max(0, Math.min(index, visibleFileTree.length - 1))];
    if (next) focusNode(nodePath(next.node));
  }

  function handleTreeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = visibleFileTree.findIndex(({ node }) => nodePath(node) === focusedNodePath);
    const currentIndex = index === -1 ? -1 : index;
    const current = currentIndex === -1 ? null : visibleFileTree[currentIndex];
    const folder = current?.node.kind === "folder" ? current.node : null;
    const file = current?.node.kind === "file" ? current.node.file : null;
    const expanded = folder ? expandedFolders.has(folder.relativePath) : false;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusVisibleNode(currentIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusVisibleNode(currentIndex - 1);
    } else if (event.key === "ArrowRight" && folder && !expanded) {
      event.preventDefault();
      updateExpanded((currentFolders) => new Set([...currentFolders, folder.relativePath]));
    } else if (event.key === "ArrowRight" && folder && expanded) {
      event.preventDefault();
      focusVisibleNode(currentIndex + 1);
    } else if (event.key === "ArrowLeft" && folder && expanded) {
      event.preventDefault();
      updateExpanded((currentFolders) => {
        const next = new Set(currentFolders);
        next.delete(folder.relativePath);
        return next;
      });
    } else if (event.key === "ArrowLeft" && current?.parentPath) {
      event.preventDefault();
      focusNode(current.parentPath);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusVisibleNode(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusVisibleNode(visibleFileTree.length - 1);
    } else if (event.key === "Enter" && file) {
      event.preventDefault();
      onOpenFile(file);
    }
  }

  function openTemporaryView(nextView: Extract<SidebarView, "search" | "recent">) {
    previousTreeFocusPathRef.current = focusedNodePath;
    onViewChange(nextView);
  }

  function restoreTreeFocus() {
    const visiblePaths = new Set(visibleFileTree.map(({ node }) => nodePath(node)));
    const activeFilePath = files.find((file) => file.path === activePath)?.relativePath ?? null;
    const candidates: Array<string | null> = [
      previousTreeFocusPathRef.current,
      activeFilePath,
      visibleFileTree[0] ? nodePath(visibleFileTree[0].node) : null,
    ];
    const fallbackPath = candidates.find((candidate): candidate is string => (
      candidate !== null && visiblePaths.has(candidate)
    ));
    onViewChange("tree");
    if (fallbackPath) setFocusedNodePath(fallbackPath);
    else searchTriggerRef.current?.focus();
  }

  function expandAllFolders() {
    updateExpanded((current) => {
      const next = new Set(current);
      const visit = (node: WorkspaceTreeNode) => {
        if (node.kind === "folder") {
          next.add(node.relativePath);
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

  function handleFolderContextMenu(
    event: MouseEvent,
    node: Extract<WorkspaceTreeNode, { kind: "folder" }>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    setFileContextMenu(null);
    setFolderContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  function renderTreeNode(node: WorkspaceTreeNode, depth: number) {
    const path = nodePath(node);
    if (node.kind === "folder") {
      const expanded = expandedFolders.has(node.relativePath);
      return (
        <div key={node.relativePath} className="file-tree-node">
          <button
            type="button"
            className="file-tree-folder"
            onClick={() => {
              focusNode(path);
              toggleFolder(node.relativePath);
            }}
            onContextMenu={(event) => handleFolderContextMenu(event, node)}
            role="treeitem"
            aria-label={node.name}
            aria-level={depth + 1}
            aria-expanded={expanded}
            tabIndex={path === focusedNodePath ? 0 : -1}
            title={node.relativePath}
            data-workspace-path={path}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
          >
            <span className="folder-caret">{expanded ? "▾" : "▸"}</span>
            <span>{node.name}</span>
          </button>
        </div>
      );
    }

    const file = node.file;
    return (
      <button
        type="button"
        key={file.path}
        className={`file-item tree-file-item ${file.path === activePath ? "active" : ""}`}
        onClick={() => {
          focusNode(path);
          onOpenFile(file);
        }}
        onContextMenu={(event) => handleFileContextMenu(event, file)}
        disabled={busy}
        role="treeitem"
        aria-label={file.name}
        aria-level={depth + 1}
        aria-selected={file.path === activePath}
        tabIndex={path === focusedNodePath ? 0 : -1}
        title={file.relativePath}
        data-workspace-path={path}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
      >
        <span className="tree-file-name">{displayWorkspaceFileName(file.name)}</span>
      </button>
    );
  }

  return (
    <aside
      ref={sidebarRef}
      className="workspace-list-panel workspace-sidebar"
      aria-label="工作区笔记"
      onKeyDown={(event) => {
        if (event.key === "Escape" && (view === "search" || view === "recent")) {
          event.preventDefault();
          restoreTreeFocus();
        }
      }}
    >
      <div className="workspace-panel">
        <div className="workspace-header resource-tree-header">
          <details className="workspace-menu">
            <summary aria-label="工作区菜单" title="工作区操作">
              <span className="label">{workspace ? workspace.rootPath.split(/[\\/]/).filter(Boolean).pop() : "工作区"}</span>
            </summary>
            <div className="workspace-menu-actions" role="menu" aria-label="工作区操作">
              <button type="button" role="menuitem" onClick={onOpenWorkspace} disabled={busy}>打开工作区</button>
              <button type="button" role="menuitem" onClick={() => openTemporaryView("recent")}>最近文件</button>
              <button type="button" role="menuitem" onClick={onRefreshWorkspace} disabled={busy || !workspace}>刷新</button>
              <button type="button" role="menuitem" onClick={onRevealWorkspace} disabled={busy || !workspace}>在 Finder 中显示</button>
              <button type="button" role="menuitem" onClick={onOpenSettings} disabled={busy}>设置</button>
            </div>
          </details>
          <div className="resource-tree-header-actions">
            <button ref={searchTriggerRef} type="button" onClick={() => openTemporaryView("search")} disabled={!workspace} aria-label="搜索工作区" title="搜索工作区">搜索</button>
            <button type="button" onClick={() => onCreateMarkdown("")} disabled={busy || !workspace} aria-label="新建 Markdown" title="新建 Markdown">+</button>
            <details className="workspace-more-menu">
              <summary aria-label="更多工作区操作" title="更多工作区操作">…</summary>
              <div className="workspace-menu-actions" role="menu" aria-label="更多工作区操作">
                <button type="button" role="menuitem" onClick={expandAllFolders} disabled={busy || !workspace}>展开全部文件夹</button>
                <button type="button" role="menuitem" onClick={() => updateExpanded(() => new Set())} disabled={busy || !workspace}>折叠全部文件夹</button>
              </div>
            </details>
            <button type="button" className="panel-toggle workspace-panel-toggle" onClick={onCollapse} disabled={busy} aria-label="隐藏笔记栏" title="隐藏笔记栏">◧</button>
          </div>
        </div>

        {view === "search" && workspace && (
          <form className="workspace-search" onSubmit={(event) => { event.preventDefault(); onSearch(); }}>
            <input
              autoFocus
              ref={searchInputRef}
              aria-label="搜索工作区输入"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                event.stopPropagation();
                restoreTreeFocus();
              }}
              placeholder="搜索工作区，支持 #标签 path:wiki"
              disabled={busy}
            />
            <button type="submit" disabled={busy || !searchQuery.trim()}>查找</button>
          </form>
        )}

        <div className="file-list" aria-label="工作区文件">
          {view === "recent" ? (
            recentFiles.length > 0 ? recentFiles.map((file) => (
              <div key={file.path} className={`recent-file-row ${file.path === activePath ? "active" : ""}`}>
                <button type="button" className="file-item" onClick={() => onOpenRecent(file.path, file.name)} disabled={busy} title={file.path}>
                  <span>{file.name}</span>
                </button>
                <button type="button" className="recent-remove-button" onClick={() => onRemoveRecent(file.path)} disabled={busy} aria-label={`移除最近文件 ${file.name}`}>移除</button>
              </div>
            )) : <p className="empty-workspace">暂无最近文件。</p>
          ) : !workspace ? (
            <div className="workspace-empty-state"><strong>工作区</strong><p className="empty-workspace">打开文件夹以浏览笔记。</p><button type="button" onClick={onOpenWorkspace} disabled={busy}>打开工作区</button></div>
          ) : view === "search" && searchActive ? (
            searchMatches.length > 0 ? searchMatches.map((match, index) => (
              <button type="button" key={`${match.path}:${match.lineNumber}:${index}`} className={`file-item search-result ${match.path === activePath ? "active" : ""}`} onClick={() => onOpenSearchMatch(match)} disabled={busy} title={`${match.relativePath}:${match.lineNumber}`}>
                <span>{match.relativePath}</span><small className="file-kind">第 {match.lineNumber.toLocaleString()} 行</small><em>{highlightedSearchLine(match, searchQuery)}</em>
              </button>
            )) : <p className="empty-workspace">未找到匹配结果。</p>
          ) : files.length > 0 ? (
            <div className="file-tree" role="tree" aria-label="工作区目录" tabIndex={-1} onKeyDown={handleTreeKeyDown}>{visibleFileTree.map(({ node, depth }) => renderTreeNode(node, depth))}</div>
          ) : <p className="empty-workspace">工作区中未找到 Markdown 文件。</p>}
        </div>
      </div>

      {fileContextMenu && (
        <div className="file-context-menu" role="menu" aria-label="文件菜单" style={{ left: fileContextMenu.x, top: fileContextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { onOpenFile(fileContextMenu.file); setFileContextMenu(null); }}>打开</button>
          <button type="button" role="menuitem" onClick={() => { onRenameWorkspaceFile(fileContextMenu.file); setFileContextMenu(null); }} disabled={busy}>重命名</button>
          <button type="button" role="menuitem" onClick={() => { onMoveWorkspaceFile(fileContextMenu.file); setFileContextMenu(null); }} disabled={busy}>移动到目录</button>
          <button type="button" role="menuitem" onClick={() => { void navigator.clipboard?.writeText(fileContextMenu.file.relativePath); setFileContextMenu(null); }}>复制相对路径</button>
          <button type="button" role="menuitem" onClick={() => { onRevealWorkspaceFile(fileContextMenu.file); setFileContextMenu(null); }} disabled={busy}>在 Finder 中显示</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { onDeleteWorkspaceFile(fileContextMenu.file); setFileContextMenu(null); }} disabled={busy}>删除</button>
        </div>
      )}
      {folderContextMenu && (
        <div className="file-context-menu" role="menu" aria-label="文件夹菜单" style={{ left: folderContextMenu.x, top: folderContextMenu.y }} onClick={(event) => event.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { onCreateMarkdown(folderContextMenu.node.relativePath); setFolderContextMenu(null); }} disabled={busy}>新建 Markdown</button>
          <button type="button" role="menuitem" onClick={() => { onCreateFolder(folderContextMenu.node.relativePath); setFolderContextMenu(null); }} disabled={busy}>新建文件夹</button>
          <button type="button" role="menuitem" className="danger" onClick={() => { onDeleteFolder(folderContextMenu.node.relativePath); setFolderContextMenu(null); }} disabled={busy || folderContextMenu.node.children.length > 0}>删除空文件夹</button>
        </div>
      )}
    </aside>
  );
}
