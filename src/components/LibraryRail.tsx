import type { LibrarySection, Workspace } from "../types";

type LibraryRailProps = {
  busy: boolean;
  readOnly: boolean;
  isDirty: boolean;
  workspace: Workspace | null;
  leftPanelOpen: boolean;
  activeSection: LibrarySection;
  onToggleLeftPanel: () => void;
  onSectionChange: (section: LibrarySection) => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenWorkspace: () => void;
  onSave: () => void;
  onRename: () => void;
  onImportAttachment: () => void;
  onCreateWikiPage: () => void;
  onOpenCommandPalette: () => void;
  onInitializeKnowledgeWorkspace: () => void;
  onRefreshWorkspace: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
  onExportDocx: () => void;
};

const libraryItems: Array<{ id: LibrarySection; label: string; requiresWorkspace: boolean }> = [
  { id: "inbox", label: "收件箱", requiresWorkspace: true },
  { id: "all-notes", label: "全部笔记", requiresWorkspace: true },
  { id: "notes", label: "笔记", requiresWorkspace: true },
  { id: "sources", label: "资料", requiresWorkspace: true },
  { id: "wiki", label: "知识库", requiresWorkspace: true },
  { id: "recent", label: "最近", requiresWorkspace: false },
];

export function LibraryRail({
  busy,
  readOnly,
  isDirty,
  workspace,
  leftPanelOpen,
  activeSection,
  onToggleLeftPanel,
  onSectionChange,
  onNew,
  onOpen,
  onOpenWorkspace,
  onSave,
  onRename,
  onImportAttachment,
  onCreateWikiPage,
  onOpenCommandPalette,
  onInitializeKnowledgeWorkspace,
  onRefreshWorkspace,
  onExportHtml,
  onExportPdf,
  onExportDocx,
}: LibraryRailProps) {
  return (
    <aside className="library-rail" aria-label="资料库">
      <div className="app-brand">
        <div className="app-mark">LMD</div>
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleLeftPanel}
          aria-label={leftPanelOpen ? "隐藏笔记栏" : "显示笔记栏"}
          title={leftPanelOpen ? "隐藏笔记栏" : "显示笔记栏"}
        >
          {leftPanelOpen ? "<" : ">"}
        </button>
      </div>

      <div className="sidebar-actions" aria-label="文件操作">
        <button type="button" onClick={onNew} disabled={busy}>
          新建
        </button>
        <button type="button" onClick={onOpen} disabled={busy}>
          打开
        </button>
        <button type="button" onClick={onOpenWorkspace} disabled={busy}>
          工作区
        </button>
        <button type="button" onClick={onSave} disabled={busy || readOnly || !isDirty}>
          保存
        </button>
        <details className="sidebar-more">
          <summary>更多</summary>
          <div className="sidebar-more-actions">
            {workspace && (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onCreateWikiPage();
                  }}
                  disabled={busy}
                >
                  新建 Wiki 页面
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onInitializeKnowledgeWorkspace();
                  }}
                  disabled={busy || workspace.knowledge.isInitialized}
                >
                  初始化知识库
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onRefreshWorkspace();
                  }}
                  disabled={busy}
                >
                  刷新工作区
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onRename();
              }}
              disabled={busy || readOnly || isDirty}
            >
              重命名当前文件
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onImportAttachment();
              }}
              disabled={busy || readOnly}
            >
              添加附件
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onOpenCommandPalette();
              }}
              disabled={busy}
            >
              命令面板
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExportHtml();
              }}
              disabled={busy}
            >
              导出 HTML
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExportPdf();
              }}
              disabled={busy}
            >
              导出 PDF
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExportDocx();
              }}
              disabled={busy}
            >
              导出 DOCX
            </button>
          </div>
        </details>
      </div>

      <nav className="library-nav" aria-label="资料库分区">
        {libraryItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === activeSection ? "active" : ""}
            disabled={item.requiresWorkspace && !workspace}
            onClick={() => onSectionChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
