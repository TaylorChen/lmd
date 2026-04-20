import { fileName } from "../lib/format";

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
  onPreviousWindow: () => void;
  onNextWindow: () => void;
  onSearchChange: (search: string) => void;
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
  onPreviousWindow,
  onNextWindow,
  onSearchChange,
}: EditorToolbarProps) {
  return (
    <header className="toolbar">
      <div>
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

      <label className="search-box">
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
