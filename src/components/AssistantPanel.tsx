import type { AssistantDraft, QueryContext } from "../types";

type AssistantPanelProps = {
  busy: boolean;
  queryContext: QueryContext | null;
  draft: AssistantDraft | null;
  onSummarize: () => void;
  onSaveDraft: () => void;
};

export function AssistantPanel({
  busy,
  queryContext,
  draft,
  onSummarize,
  onSaveDraft,
}: AssistantPanelProps) {
  return (
    <aside className="knowledge-panel" aria-label="Assistant panel">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Assistant</span>
          <small>{queryContext?.items.length.toLocaleString() ?? "0"} context items</small>
        </div>
        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onSummarize}
            disabled={busy || !queryContext || queryContext.items.length === 0}
          >
            Summarize Context
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onSaveDraft}
            disabled={busy || !draft}
          >
            Save as Wiki Page
          </button>
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Current Draft</span>
          <small>{draft ? draft.title : "None"}</small>
        </div>
        {draft ? (
          <div className="assistant-draft">
            <h2>{draft.title}</h2>
            <pre>{draft.content}</pre>
          </div>
        ) : (
          <p className="knowledge-empty">No assistant output yet. Run a summary from the current query context.</p>
        )}
      </section>
    </aside>
  );
}
