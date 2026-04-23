import type { LibrarySection, Workspace } from "../types";

type LibraryRailProps = {
  busy: boolean;
  workspace: Workspace | null;
  isDirty: boolean;
  activeSection: LibrarySection;
  onSectionChange: (section: LibrarySection) => void;
  onNew: () => void;
  onOpen: () => void;
  onOpenWorkspace: () => void;
  onInitializeKnowledgeWorkspace: () => void;
  onRefreshWorkspace: () => void;
  onSave: () => void;
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
  workspace,
  isDirty,
  activeSection,
  onSectionChange,
  onNew,
  onOpen,
  onOpenWorkspace,
  onInitializeKnowledgeWorkspace,
  onRefreshWorkspace,
  onSave,
  onExportHtml,
  onExportPdf,
}: LibraryRailProps) {
  return (
    <aside className="library-rail" aria-label="Library">
      <div>
        <div className="app-mark">LMD</div>
        <p className="sidebar-copy">Light Markdown</p>
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
        <button
          type="button"
          onClick={onInitializeKnowledgeWorkspace}
          disabled={busy || !workspace || workspace.knowledge.isInitialized}
        >
          Init Knowledge
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
        <button type="button" onClick={onExportPdf} disabled={busy}>
          Export PDF
        </button>
      </div>
    </aside>
  );
}
