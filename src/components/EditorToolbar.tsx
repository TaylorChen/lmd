import { fileName } from "../lib/format";
import type { EditorMode } from "../types";

type EditorToolbarProps = {
  path: string | null;
  readOnly: boolean;
  isDirty: boolean;
  isLarge: boolean;
  visibleStartLine: number;
  visibleEndLine: number;
  busy: boolean;
  canPageBack: boolean;
  canPageForward: boolean;
  search: string;
  matches: number;
  mode: EditorMode;
  inspectorTab: "preview" | "knowledge" | "assistant";
  canShowKnowledge: boolean;
  onPreviousWindow: () => void;
  onNextWindow: () => void;
  onSearchChange: (search: string) => void;
  onModeChange: (mode: EditorMode) => void;
  onInspectorTabChange: (tab: "preview" | "knowledge" | "assistant") => void;
};

export function EditorToolbar({
  path,
  readOnly,
  isDirty,
  isLarge,
  visibleStartLine,
  visibleEndLine,
  busy,
  canPageBack,
  canPageForward,
  search,
  matches,
  mode,
  inspectorTab,
  canShowKnowledge,
  onPreviousWindow,
  onNextWindow,
  onSearchChange,
  onModeChange,
  onInspectorTabChange,
}: EditorToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-main">
        <div className="document-title">
          <h1>{fileName(path)}</h1>
          <p>
            {readOnly
              ? `Read-only lines ${visibleStartLine.toLocaleString()}-${visibleEndLine.toLocaleString()}`
              : isDirty
                ? "Unsaved changes"
                : "All changes saved"}
          </p>
        </div>

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
      </div>

      <div className="toolbar-controls">
        <div className="toolbar-group">
          <span className="toolbar-label">View</span>
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

        {canShowKnowledge && (
          <div className="toolbar-group">
            <span className="toolbar-label">Inspector</span>
            <div className="mode-switch" aria-label="Inspector tab">
              <button
                type="button"
                className={inspectorTab === "preview" ? "active" : ""}
                onClick={() => onInspectorTabChange("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                className={inspectorTab === "knowledge" ? "active" : ""}
                onClick={() => onInspectorTabChange("knowledge")}
              >
                Knowledge
              </button>
              <button
                type="button"
                className={inspectorTab === "assistant" ? "active" : ""}
                onClick={() => onInspectorTabChange("assistant")}
              >
                Assistant
              </button>
            </div>
          </div>
        )}
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
