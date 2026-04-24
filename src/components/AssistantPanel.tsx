import type { AppSettings, AssistantDraft, AssistantEvent, QueryContext } from "../types";

type AssistantPanelProps = {
  busy: boolean;
  queryContext: QueryContext | null;
  draft: AssistantDraft | null;
  events: AssistantEvent[];
  settings: AppSettings;
  onSummarize: () => void;
  onSaveDraft: () => void;
};

export function AssistantPanel({
  busy,
  queryContext,
  draft,
  events,
  settings,
  onSummarize,
  onSaveDraft,
}: AssistantPanelProps) {
  return (
    <aside className="knowledge-panel" aria-label="Assistant panel">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Assistant</span>
          <small>{settings.assistantModel}</small>
        </div>
        <p className="knowledge-empty">{queryContext?.items.length.toLocaleString() ?? "0"} context items ready.</p>
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
          <span className="label">Run Log</span>
          <small>{events.length.toLocaleString()}</small>
        </div>
        {events.length > 0 ? (
          <ol className="assistant-events" aria-label="Assistant run log">
            {events.map((event, index) => (
              <li key={`${event.label}-${index}`} className={`assistant-event ${event.tone}`}>
                <strong>{event.label}</strong>
                <span>{event.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="knowledge-empty">No assistant activity yet.</p>
        )}
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
