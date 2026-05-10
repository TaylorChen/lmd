import type { LibrarySection, Workspace } from "../types";

type LibraryRailProps = {
  busy: boolean;
  workspace: Workspace | null;
  leftPanelOpen: boolean;
  activeSection: LibrarySection;
  onToggleLeftPanel: () => void;
  onSectionChange: (section: LibrarySection) => void;
  onOpenSettings: () => void;
};

const libraryItems: Array<{ id: LibrarySection; label: string; icon: string; requiresWorkspace: boolean }> = [
  { id: "all-notes", label: "文件", icon: "▣", requiresWorkspace: true },
  { id: "inbox", label: "收件箱", icon: "↙", requiresWorkspace: true },
  { id: "notes", label: "笔记", icon: "□", requiresWorkspace: true },
  { id: "sources", label: "资料", icon: "◇", requiresWorkspace: true },
  { id: "wiki", label: "知识库", icon: "◎", requiresWorkspace: true },
  { id: "recent", label: "最近", icon: "◷", requiresWorkspace: false },
];

export function LibraryRail({
  busy,
  workspace,
  leftPanelOpen,
  activeSection,
  onToggleLeftPanel,
  onSectionChange,
  onOpenSettings,
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

      <nav className="library-nav" aria-label="资料库分区">
        {libraryItems.map((item) => (
          <button
            type="button"
            key={item.id}
            className={item.id === activeSection ? "active" : ""}
            disabled={item.requiresWorkspace && !workspace}
            onClick={() => onSectionChange(item.id)}
            aria-label={item.label}
            title={item.label}
          >
            <span aria-hidden="true">{item.icon}</span>
          </button>
        ))}
      </nav>

      <button
        type="button"
        className="rail-settings-button"
        onClick={onOpenSettings}
        disabled={busy}
        aria-label="设置"
        title="设置"
      >
        ⚙
      </button>
    </aside>
  );
}
