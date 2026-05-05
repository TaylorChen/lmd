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
  onInitializeKnowledgeWorkspace: () => void;
  onRefreshWorkspace: () => void;
  onExportHtml: () => void;
  onExportPdf: () => void;
};

const libraryItems: Array<{ id: LibrarySection; label: string; requiresWorkspace: boolean }> = [
  { id: "inbox", label: "Inbox", requiresWorkspace: true },
  { id: "all-notes", label: "All Notes", requiresWorkspace: true },
  { id: "notes", label: "Notes", requiresWorkspace: true },
  { id: "sources", label: "Sources", requiresWorkspace: true },
  { id: "wiki", label: "Wiki", requiresWorkspace: true },
  { id: "recent", label: "Recent", requiresWorkspace: false },
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
  onInitializeKnowledgeWorkspace,
  onRefreshWorkspace,
  onExportHtml,
  onExportPdf,
}: LibraryRailProps) {
  return (
    <aside className="library-rail" aria-label="Library">
      <div className="app-brand">
        <div className="app-mark">LMD</div>
        <button
          type="button"
          className="panel-toggle"
          onClick={onToggleLeftPanel}
          aria-label={leftPanelOpen ? "Hide note library" : "Show note library"}
          title={leftPanelOpen ? "Hide library" : "Show library"}
        >
          {leftPanelOpen ? "<" : ">"}
        </button>
      </div>

      <div className="sidebar-actions" aria-label="File actions">
        <button type="button" onClick={onNew} disabled={busy}>
          New
        </button>
        <button type="button" onClick={onOpen} disabled={busy}>
          Open
        </button>
        <button type="button" onClick={onOpenWorkspace} disabled={busy}>
          Workspace
        </button>
        <button type="button" onClick={onSave} disabled={busy || readOnly || !isDirty}>
          Save
        </button>
        <details className="sidebar-more">
          <summary>More</summary>
          <div className="sidebar-more-actions">
            {workspace && (
              <>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onInitializeKnowledgeWorkspace();
                  }}
                  disabled={busy || workspace.knowledge.isInitialized}
                >
                  Init Knowledge
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.currentTarget.closest("details")?.removeAttribute("open");
                    onRefreshWorkspace();
                  }}
                  disabled={busy}
                >
                  Refresh Workspace
                </button>
              </>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExportHtml();
              }}
              disabled={busy}
            >
              Export HTML
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onExportPdf();
              }}
              disabled={busy}
            >
              Export PDF
            </button>
          </div>
        </details>
      </div>

      <nav className="library-nav" aria-label="Library sections">
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
