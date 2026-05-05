import type { EditorMode } from "../types";

export type MarkdownAction = "h1" | "h2" | "bold" | "italic" | "code" | "link";

type EditorToolbarProps = {
  isLarge: boolean;
  canFormat: boolean;
  busy: boolean;
  canPageBack: boolean;
  canPageForward: boolean;
  search: string;
  matches: number;
  mode: EditorMode;
  onPreviousWindow: () => void;
  onNextWindow: () => void;
  onSearchChange: (search: string) => void;
  onModeChange: (mode: EditorMode) => void;
  onMarkdownAction: (action: MarkdownAction) => void;
};

export function EditorToolbar({
  isLarge,
  canFormat,
  busy,
  canPageBack,
  canPageForward,
  search,
  matches,
  mode,
  onPreviousWindow,
  onNextWindow,
  onSearchChange,
  onModeChange,
  onMarkdownAction,
}: EditorToolbarProps) {
  return (
    <header className="toolbar">
      <div className="format-toolbar" aria-label="Markdown shortcuts">
        <button type="button" onClick={() => onMarkdownAction("h1")} disabled={!canFormat}>
          H1
        </button>
        <button type="button" onClick={() => onMarkdownAction("h2")} disabled={!canFormat}>
          H2
        </button>
        <button type="button" onClick={() => onMarkdownAction("bold")} disabled={!canFormat}>
          B
        </button>
        <button type="button" onClick={() => onMarkdownAction("italic")} disabled={!canFormat}>
          I
        </button>
        <button type="button" onClick={() => onMarkdownAction("code")} disabled={!canFormat}>
          Code
        </button>
        <button type="button" onClick={() => onMarkdownAction("link")} disabled={!canFormat}>
          Link
        </button>
      </div>

      <div className="toolbar-controls">
        {isLarge && (
          <div className="range-controls">
            <button type="button" onClick={onPreviousWindow} disabled={busy || !canPageBack}>
              Previous
            </button>
            <button type="button" onClick={onNextWindow} disabled={busy || !canPageForward}>
              Next
            </button>
          </div>
        )}

        <div className="toolbar-group">
          <div className="mode-switch" aria-label="Editor mode">
            {(["edit", "split", "preview"] as const).map((nextMode) => (
              <button
                type="button"
                key={nextMode}
                className={mode === nextMode ? "active" : ""}
                onClick={() => onModeChange(nextMode)}
              >
                {nextMode === "edit" ? "Edit" : nextMode === "split" ? "Split" : "Preview"}
              </button>
            ))}
          </div>
        </div>

      </div>

      <label className="search-box toolbar-search">
        <span>{isLarge ? "Search window" : "Search"}</span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Find in document"
        />
        <strong>{search.trim() ? matches : 0}</strong>
      </label>
    </header>
  );
}
