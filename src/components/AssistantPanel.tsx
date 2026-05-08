import type { AppSettings, AssistantDraft, AssistantEvent, AssistantMessage, QueryContext } from "../types";

type AssistantPanelProps = {
  busy: boolean;
  queryContext: QueryContext | null;
  hasCurrentContent: boolean;
  draft: AssistantDraft | null;
  messages: AssistantMessage[];
  events: AssistantEvent[];
  settings: AppSettings;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onSummarize: () => void;
  onRunTask: (task: string) => void;
  onSubmitPrompt: (prompt: string) => void;
  onSaveDraft: () => void;
  onSaveChat: () => void;
  onInsertDraft: () => void;
  onReplaceSelection: () => void;
};

export function AssistantPanel({
  busy,
  queryContext,
  hasCurrentContent,
  draft,
  messages,
  events,
  settings,
  prompt,
  onPromptChange,
  onSummarize,
  onRunTask,
  onSubmitPrompt,
  onSaveDraft,
  onSaveChat,
  onInsertDraft,
  onReplaceSelection,
}: AssistantPanelProps) {
  const canChat = !busy;
  const canRunWithContext = !busy && (hasCurrentContent || Boolean(queryContext && queryContext.items.length > 0));
  const canUseDraft = !busy && Boolean(draft);
  const canSaveChat = !busy && messages.length > 0;

  return (
    <aside className="assistant-chat-panel" aria-label="AI 助手面板">
      <header className="assistant-chat-header">
        <div>
          <strong>AI 助手</strong>
          <span>{queryContext?.items.length.toLocaleString() ?? "0"} 条上下文</span>
        </div>
        <small>{settings.assistantModel}</small>
      </header>

      <div className="assistant-message-list" aria-label="AI 对话">
        {messages.length === 0 ? (
          <div className="assistant-empty-chat">
            <strong>开始记录，随时让 AI 帮你整理。</strong>
            <span>可以直接提问，也可以用快捷动作处理当前笔记。</span>
          </div>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`assistant-message ${message.role}`}>
              <div className="assistant-message-body">
                <pre>{message.content}</pre>
              </div>
            </article>
          ))
        )}
        {busy && (
          <article className="assistant-message assistant">
            <div className="assistant-working" aria-label="AI 正在生成">
              <span className="assistant-working-mark" />
              <span>Working on it...</span>
            </div>
          </article>
        )}
      </div>

      <div className="assistant-chat-footer">
        <div className="assistant-quick-actions" aria-label="AI 快捷动作">
          <button type="button" onClick={onSummarize} disabled={!canRunWithContext}>
            总结笔记
          </button>
          <button type="button" onClick={() => onRunTask("polish")} disabled={!canRunWithContext}>
            优化文字
          </button>
          <button type="button" onClick={() => onRunTask("todos")} disabled={!canRunWithContext}>
            提取待办
          </button>
          <button type="button" onClick={() => onRunTask("title")} disabled={!canRunWithContext}>
            生成标题
          </button>
          <button type="button" onClick={() => onRunTask("outline")} disabled={!canRunWithContext}>
            生成大纲
          </button>
          <button type="button" onClick={() => onRunTask("continue")} disabled={!canRunWithContext}>
            续写
          </button>
        </div>

        {draft && (
          <div className="assistant-draft-actions" aria-label="AI 回复操作">
            <button type="button" onClick={onInsertDraft} disabled={!canUseDraft}>
              插入到光标
            </button>
            <button type="button" onClick={onReplaceSelection} disabled={!canUseDraft}>
              替换选区
            </button>
            <button type="button" onClick={onSaveDraft} disabled={!canUseDraft}>
              保存为 Wiki 页面
            </button>
          </div>
        )}

        {messages.length > 0 && (
          <div className="assistant-draft-actions" aria-label="对话存档操作">
            <button type="button" onClick={onSaveChat} disabled={!canSaveChat}>
              保存对话
            </button>
          </div>
        )}

        {queryContext && queryContext.items.length > 0 && (
          <details className="assistant-sources" open>
            <summary>引用来源 {queryContext.items.length.toLocaleString()}</summary>
            <ol>
              {queryContext.items.slice(0, 6).map((item) => (
                <li key={`${item.reason}:${item.path}`}>
                  <strong>{item.relativePath}</strong>
                  <span>{item.excerpt}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        <form
          className="assistant-composer"
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
            placeholder="输入消息..."
            disabled={busy}
            rows={3}
          />
          <div className="assistant-composer-bar">
            <button type="button" className="assistant-plus-button" disabled>
              +
            </button>
            <span>{settings.assistantModel}</span>
            <button
              type="submit"
              className="assistant-send-button"
              disabled={!canChat || !prompt.trim()}
              aria-label="发送"
            >
              {busy ? "…" : "↑"}
            </button>
          </div>
        </form>

        <details className="assistant-debug-log" open={events.length > 0}>
          <summary>运行日志 {events.length.toLocaleString()}</summary>
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
        </details>
      </div>
    </aside>
  );
}
