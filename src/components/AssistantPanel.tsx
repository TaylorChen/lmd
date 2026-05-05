import type { AppSettings, AssistantDraft, AssistantEvent, QueryContext } from "../types";

type AssistantPanelProps = {
  busy: boolean;
  queryContext: QueryContext | null;
  draft: AssistantDraft | null;
  events: AssistantEvent[];
  settings: AppSettings;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSummarize: () => void;
  onRunTask: (task: string) => void;
  onSubmitPrompt: (prompt: string) => void;
  onSaveDraft: () => void;
  onInsertDraft: () => void;
  onReplaceSelection: () => void;
};

export function AssistantPanel({
  busy,
  queryContext,
  draft,
  events,
  settings,
  prompt,
  onPromptChange,
  onSummarize,
  onRunTask,
  onSubmitPrompt,
  onSaveDraft,
  onInsertDraft,
  onReplaceSelection,
}: AssistantPanelProps) {
  const canRun = !busy && Boolean(queryContext && queryContext.items.length > 0);
  const canUseDraft = !busy && Boolean(draft);

  return (
    <aside className="knowledge-panel" aria-label="AI 助手面板">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">AI 助手</span>
          <small>{settings.assistantModel}</small>
        </div>
        <p className="knowledge-empty">已准备 {queryContext?.items.length.toLocaleString() ?? "0"} 条上下文。</p>
        <form
          className="assistant-prompt"
          onSubmit={(event) => {
            event.preventDefault();
            const nextPrompt = prompt.trim();
            if (!nextPrompt) return;
            onSubmitPrompt(nextPrompt);
            onPromptChange("");
          }}
        >
          <textarea
            aria-label="输入 AI 指令"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="输入问题、改写要求或整理方向..."
            disabled={busy}
            rows={4}
          />
          <button type="submit" disabled={!canRun || !prompt.trim()}>
            发送
          </button>
        </form>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">快捷动作</span>
          <small>写作辅助</small>
        </div>
        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onSummarize}
            disabled={!canRun}
          >
            总结笔记
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={() => onRunTask("polish")}
            disabled={!canRun}
          >
            优化文字
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={() => onRunTask("todos")}
            disabled={!canRun}
          >
            提取待办
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={() => onRunTask("title")}
            disabled={!canRun}
          >
            生成标题
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={() => onRunTask("wiki")}
            disabled={!canRun}
          >
            整理 Wiki
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onSaveDraft}
            disabled={!canUseDraft}
          >
            保存为 Wiki 页面
          </button>
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">写回编辑器</span>
          <small>{draft ? "可用" : "无草稿"}</small>
        </div>
        <div className="knowledge-actions">
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onInsertDraft}
            disabled={!canUseDraft}
          >
            插入到光标
          </button>
          <button
            type="button"
            className="knowledge-action-button"
            onClick={onReplaceSelection}
            disabled={!canUseDraft}
          >
            替换选区
          </button>
        </div>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">运行日志</span>
          <small>{events.length.toLocaleString()}</small>
        </div>
        {events.length > 0 ? (
          <ol className="assistant-events" aria-label="AI 助手运行日志">
            {events.map((event, index) => (
              <li key={`${event.label}-${index}`} className={`assistant-event ${event.tone}`}>
                <strong>{event.label}</strong>
                <span>{event.detail}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="knowledge-empty">暂无 AI 助手活动。</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">当前草稿</span>
          <small>{draft ? draft.title : "无"}</small>
        </div>
        {draft ? (
          <div className="assistant-draft">
            <h2>{draft.title}</h2>
            <pre>{draft.content}</pre>
          </div>
        ) : (
          <p className="knowledge-empty">暂无 AI 输出。可以基于当前查询上下文生成总结。</p>
        )}
      </section>
    </aside>
  );
}
