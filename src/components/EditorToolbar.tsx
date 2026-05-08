import type { MouseEvent } from "react";

export type MarkdownAction =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "h6"
  | "no-heading"
  | "bold"
  | "italic"
  | "code"
  | "code-block"
  | "link"
  | "markdown-link"
  | "annotation"
  | "highlight"
  | "strikethrough"
  | "math-inline"
  | "math-block"
  | "comment"
  | "footnote"
  | "unordered-list"
  | "ordered-list"
  | "task-list"
  | "fold-block"
  | "fold-all"
  | "unfold-all"
  | "fold-current"
  | "unfold-current"
  | "table"
  | "format-table"
  | "table-row"
  | "table-column"
  | "csv-table"
  | "block-id"
  | "block-ref";

type EditorToolbarProps = {
  isLarge: boolean;
  canFormat: boolean;
  showInlineFormat: boolean;
  busy: boolean;
  canPageBack: boolean;
  canPageForward: boolean;
  onPreviousWindow: () => void;
  onNextWindow: () => void;
  onMarkdownAction: (action: MarkdownAction) => void;
};

export function EditorToolbar({
  isLarge,
  canFormat,
  showInlineFormat,
  busy,
  canPageBack,
  canPageForward,
  onPreviousWindow,
  onNextWindow,
  onMarkdownAction,
}: EditorToolbarProps) {
  function handleMenuAction(event: MouseEvent<HTMLButtonElement>, action: MarkdownAction) {
    onMarkdownAction(action);
    event.currentTarget.closest("details")?.removeAttribute("open");
  }

  return (
    <header className="toolbar">
      {showInlineFormat ? (
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
          <details className="toolbar-menu">
            <summary>格式</summary>
            <div className="toolbar-menu-popover" role="menu">
              <button type="button" onClick={(event) => handleMenuAction(event, "code")} disabled={!canFormat}>
                代码
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "link")} disabled={!canFormat}>
                链接
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "table")} disabled={!canFormat}>
                插入表格
              </button>
              <button
                type="button"
                onClick={(event) => handleMenuAction(event, "format-table")}
                disabled={!canFormat}
              >
                对齐表格
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "table-row")} disabled={!canFormat}>
                加行
              </button>
              <button
                type="button"
                onClick={(event) => handleMenuAction(event, "table-column")}
                disabled={!canFormat}
              >
                加列
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "csv-table")} disabled={!canFormat}>
                CSV 表格
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "block-id")} disabled={!canFormat}>
                块 ID
              </button>
              <button type="button" onClick={(event) => handleMenuAction(event, "block-ref")} disabled={!canFormat}>
                块引用
              </button>
            </div>
          </details>
        </div>
      ) : (
        <div className="format-toolbar native-format-placeholder" aria-label="Markdown 快捷格式" />
      )}

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

      </div>

    </header>
  );
}
