import type { EditorMode } from "../types";

export type MarkdownAction =
  | "h1"
  | "h2"
  | "bold"
  | "italic"
  | "code"
  | "link"
  | "table"
  | "format-table"
  | "block-id"
  | "block-ref";

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
      <div className="format-toolbar" aria-label="Markdown 快捷格式">
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
          代码
        </button>
        <button type="button" onClick={() => onMarkdownAction("link")} disabled={!canFormat}>
          链接
        </button>
        <button type="button" onClick={() => onMarkdownAction("table")} disabled={!canFormat}>
          表格
        </button>
        <button type="button" onClick={() => onMarkdownAction("format-table")} disabled={!canFormat}>
          对齐表格
        </button>
        <button type="button" onClick={() => onMarkdownAction("block-id")} disabled={!canFormat}>
          块 ID
        </button>
        <button type="button" onClick={() => onMarkdownAction("block-ref")} disabled={!canFormat}>
          块引用
        </button>
      </div>

      <div className="toolbar-controls">
        {isLarge && (
          <div className="range-controls">
            <button type="button" onClick={onPreviousWindow} disabled={busy || !canPageBack}>
              上一段
            </button>
            <button type="button" onClick={onNextWindow} disabled={busy || !canPageForward}>
              下一段
            </button>
          </div>
        )}

        <div className="toolbar-group">
          <div className="mode-switch" aria-label="编辑模式">
            {(["edit", "split", "preview"] as const).map((nextMode) => (
              <button
                type="button"
                key={nextMode}
                className={mode === nextMode ? "active" : ""}
                onClick={() => onModeChange(nextMode)}
              >
                {nextMode === "edit" ? "编辑" : nextMode === "split" ? "分屏" : "预览"}
              </button>
            ))}
          </div>
        </div>

      </div>

      <label className="search-box toolbar-search">
        <span>{isLarge ? "搜索当前窗口" : "搜索"}</span>
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="在文档中查找"
        />
        <strong>{search.trim() ? matches : 0}</strong>
      </label>
    </header>
  );
}
