import { forwardRef, type ForwardedRef, type ReactNode } from "react";
import type { SidebarView } from "../types";

type WorkspaceRibbonProps = {
  activeView: SidebarView;
  panelOpen: boolean;
  disabled: boolean;
  onSelectView: (view: SidebarView) => void;
  onToggleActiveView: () => void;
  onOpenSettings: () => void;
};

const viewItems: Array<{ view: SidebarView; label: string; icon: ReactNode }> = [
  {
    view: "tree",
    label: "文件",
    icon: <path d="M4 5.5h5l1.5 2H20v11H4zM4 9h16" />,
  },
  {
    view: "search",
    label: "搜索",
    icon: <><circle cx="10.5" cy="10.5" r="5.5" /><path d="m15 15 4 4" /></>,
  },
  {
    view: "recent",
    label: "最近",
    icon: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
  },
];

function assignRef(ref: ForwardedRef<HTMLButtonElement>, node: HTMLButtonElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

export const WorkspaceRibbon = forwardRef<HTMLButtonElement, WorkspaceRibbonProps>(
  function WorkspaceRibbon(
    { activeView, panelOpen, disabled, onSelectView, onToggleActiveView, onOpenSettings },
    activeButtonRef,
  ) {
    return (
      <nav className="workspace-ribbon" aria-label="工作区工具">
        <div className="workspace-ribbon-views">
          {viewItems.map((item) => {
            const active = activeView === item.view;
            return (
              <button
                key={item.view}
                ref={active ? (node) => assignRef(activeButtonRef, node) : undefined}
                type="button"
                className="workspace-ribbon-button"
                aria-label={item.label}
                title={item.label}
                aria-pressed={active && panelOpen}
                disabled={disabled}
                onClick={() => {
                  if (active && panelOpen) onToggleActiveView();
                  else onSelectView(item.view);
                }}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  {item.icon}
                </svg>
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className="workspace-ribbon-button workspace-ribbon-settings"
          aria-label="设置"
          title="设置"
          disabled={disabled}
          onClick={onOpenSettings}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A7 7 0 0 0 15 6l-.3-2.6h-4L10.4 6a7 7 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.5.9l.3 2.6h4l.3-2.6a7 7 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1z" />
          </svg>
        </button>
      </nav>
    );
  },
);
