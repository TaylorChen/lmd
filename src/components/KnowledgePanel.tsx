import type { Backlink, DocumentKnowledge, KnowledgeIndexStatus, KnowledgeLintReport, QueryContext } from "../types";

type KnowledgePanelProps = {
  knowledge: DocumentKnowledge | null;
  lint: KnowledgeLintReport | null;
  queryContext: QueryContext | null;
  frontmatterDraft: {
    title: string;
    tags: string;
    status: string;
  };
  workspaceIndexPath: string | null;
  workspaceLogPath: string | null;
  indexStatus: KnowledgeIndexStatus | null;
  busy: boolean;
  onOpenPath: (path: string, name: string, anchor?: string | null) => void;
  onCreateWikiPage: (target: string) => void;
  onRebuildIndex: () => void;
  onApplyFrontmatter: (draft: { title: string; tags: string; status: string }) => void;
};

function sourceKindLabel(value: Backlink["sourceKind"] | "unknown" | null) {
  if (value === "wiki") return "知识库";
  if (value === "source") return "资料";
  if (value === "note") return "笔记";
  return "未知";
}

function reasonLabel(value: QueryContext["items"][number]["reason"]) {
  if (value === "current_document") return "当前笔记";
  if (value === "linked_wiki") return "关联 Wiki";
  if (value === "source_reference") return "资料引用";
  if (value === "backlink") return "反向链接";
  if (value === "index_hint") return "索引提示";
  return value;
}

function severityLabel(value: KnowledgeLintReport["issues"][number]["severity"]) {
  if (value === "info") return "提示";
  if (value === "warning") return "警告";
  if (value === "error") return "错误";
  return value;
}

function StatChip({ label, value }: { label: string; value: number }) {
  return (
    <div className="knowledge-stat">
      <strong>{value.toLocaleString()}</strong>
      <span>{label}</span>
    </div>
  );
}

function tagLevels(tag: string) {
  return tag.split("/").filter(Boolean);
}

export function KnowledgePanel({
  knowledge,
  lint,
  queryContext,
  frontmatterDraft,
  workspaceIndexPath,
  workspaceLogPath,
  indexStatus,
  busy,
  onOpenPath,
  onCreateWikiPage,
  onRebuildIndex,
  onApplyFrontmatter,
}: KnowledgePanelProps) {
  if (!knowledge) {
    return (
      <aside className="knowledge-panel" aria-label="知识面板">
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">知识</span>
            <small>就绪</small>
          </div>
          <p className="knowledge-empty">打开该工作区中已保存的笔记，即可查看链接、标签和资料上下文。</p>
        </section>
      </aside>
    );
  }

  const hasMetadata = knowledge.frontmatter.length > 0 || knowledge.tags.length > 0;
  const hasGraphDetails =
    knowledge.outgoingLinks.length > 0 ||
    knowledge.backlinks.length > 0 ||
    knowledge.relatedWikiPages.length > 0 ||
    knowledge.sourceReferences.length > 0 ||
    knowledge.unresolvedLinks.length > 0 ||
    Boolean(lint && lint.issues.length > 0);

  return (
    <aside className="knowledge-panel" aria-label="知识面板">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">知识</span>
          <small>{knowledge.currentRelativePath}</small>
        </div>
        <div className="knowledge-stats" aria-label="知识摘要">
          <StatChip label="标签" value={knowledge.tags.length} />
          <StatChip label="链接" value={knowledge.outgoingLinks.length} />
          <StatChip label="反链" value={knowledge.backlinks.length} />
          <StatChip label="问题" value={lint?.issues.length ?? 0} />
        </div>
        {(workspaceIndexPath || workspaceLogPath) && (
          <div className="knowledge-actions">
            {workspaceIndexPath && (
              <button
                type="button"
                className="knowledge-action-button"
                onClick={() => onOpenPath(workspaceIndexPath, "index.md")}
                disabled={busy}
              >
                打开 index.md
              </button>
            )}
            {workspaceLogPath && (
              <button
                type="button"
                className="knowledge-action-button"
                onClick={() => onOpenPath(workspaceLogPath, "log.md")}
                disabled={busy}
              >
                打开 log.md
              </button>
            )}
            <button type="button" className="knowledge-action-button" onClick={onRebuildIndex} disabled={busy}>
              重建索引
            </button>
          </div>
        )}
        {indexStatus && (
          <div className="knowledge-index-status" title={indexStatus.databasePath}>
            <span>SQLite 索引</span>
            <strong>
              {indexStatus.indexedCount.toLocaleString()} / {indexStatus.documentCount.toLocaleString()}
            </strong>
            <small>移除 {indexStatus.removedCount.toLocaleString()}</small>
          </div>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Front Matter</span>
          <small>可编辑</small>
        </div>
        <form
          key={`${frontmatterDraft.title}:${frontmatterDraft.tags}:${frontmatterDraft.status}`}
          className="frontmatter-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            onApplyFrontmatter({
              title: String(data.get("title") ?? ""),
              tags: String(data.get("tags") ?? ""),
              status: String(data.get("status") ?? ""),
            });
          }}
        >
          <label>
            <span>标题</span>
            <input name="title" defaultValue={frontmatterDraft.title} disabled={busy} />
          </label>
          <label>
            <span>标签</span>
            <input name="tags" defaultValue={frontmatterDraft.tags} disabled={busy} placeholder="writing, focus" />
          </label>
          <label>
            <span>状态</span>
            <input name="status" defaultValue={frontmatterDraft.status} disabled={busy} placeholder="draft" />
          </label>
          <button type="submit" disabled={busy}>
            应用到笔记
          </button>
        </form>
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">查询上下文</span>
          <small>{queryContext?.items.length.toLocaleString() ?? "0"}</small>
        </div>
        {queryContext && queryContext.items.length > 0 ? (
          <div className="knowledge-link-list">
            {queryContext.items.map((item, index) => (
              <button
                type="button"
                key={`${item.path}:${item.reason}:${index}`}
                className="knowledge-link-item"
                onClick={() => onOpenPath(item.path, item.name)}
                disabled={busy}
                title={item.relativePath}
              >
                <strong>{item.name}</strong>
                <span>{item.relativePath}</span>
                <small>{reasonLabel(item.reason)}</small>
                <em>{item.excerpt || "暂无摘录。"}</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="knowledge-empty">该笔记完成索引后，上下文会显示在这里。</p>
        )}
      </section>

      {hasMetadata && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">元数据</span>
            <small>{(knowledge.frontmatter.length + knowledge.tags.length).toLocaleString()}</small>
          </div>
          {knowledge.tags.length > 0 && (
            <div className="knowledge-tag-list">
              {knowledge.tags.map((tag) => (
                <span key={tag} className="knowledge-tag" title={`#${tag}`}>
                  {tagLevels(tag).map((level, index) => (
                    <span key={`${tag}:${index}`}>
                      {index === 0 ? "#" : "/"}
                      {level}
                    </span>
                  ))}
                </span>
              ))}
            </div>
          )}
          {knowledge.frontmatter.length > 0 && (
            <div className="knowledge-kv-list">
              {knowledge.frontmatter.map((field) => (
                <div key={field.key} className="knowledge-kv-item">
                  <strong>{field.key}</strong>
                  <span>{field.value}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {knowledge.outgoingLinks.some((link) => link.isBlockReference) && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">块引用</span>
            <small>{knowledge.outgoingLinks.filter((link) => link.isBlockReference).length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.outgoingLinks
              .filter((link) => link.isBlockReference)
              .map((link, index) =>
                link.resolvedPath ? (
                  <button
                    type="button"
                    key={`${link.target}:${index}`}
                    className="knowledge-link-item"
                    onClick={() => onOpenPath(link.resolvedPath!, link.resolvedName ?? link.label, link.anchor)}
                    disabled={busy}
                    title={link.resolvedRelativePath ?? link.target}
                  >
                    <strong>{link.label}</strong>
                    <span>
                      {link.resolvedRelativePath ?? link.target}
                      {link.anchor ? `#${link.anchor}` : ""}
                    </span>
                    <small>块引用</small>
                  </button>
                ) : (
                  <div key={`${link.target}:${index}`} className="knowledge-link-item unresolved">
                    <strong>{link.label}</strong>
                    <span>{link.target}</span>
                    <small>未解析</small>
                  </div>
                ),
              )}
          </div>
        </section>
      )}

      {knowledge.outgoingLinks.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">出站链接</span>
            <small>{knowledge.outgoingLinks.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.outgoingLinks.map((link, index) =>
              link.resolvedPath ? (
                <button
                  type="button"
                  key={`${link.target}:${index}`}
                  className="knowledge-link-item"
                  onClick={() => onOpenPath(link.resolvedPath!, link.resolvedName ?? link.label, link.anchor)}
                  disabled={busy}
                  title={link.resolvedRelativePath ?? link.target}
                >
                  <strong>{link.label}</strong>
                  <span>
                    {link.resolvedRelativePath ?? link.target}
                    {link.anchor ? `#${link.anchor}` : ""}
                  </span>
                  <small>{link.isBlockReference ? "块引用" : sourceKindLabel(link.sourceKind)}</small>
                </button>
              ) : (
                <div key={`${link.target}:${index}`} className="knowledge-link-item unresolved">
                  <strong>{link.label}</strong>
                  <span>{link.target}</span>
                  <small>未解析</small>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {knowledge.backlinks.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">反向链接</span>
            <small>{knowledge.backlinks.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.backlinks.map((link) => (
              <button
                type="button"
                key={link.path}
                className="knowledge-link-item"
                onClick={() => onOpenPath(link.path, link.name)}
                disabled={busy}
                title={link.relativePath}
              >
                <strong>{link.name}</strong>
                <span>{link.relativePath}</span>
                <small>{sourceKindLabel(link.sourceKind)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {knowledge.relatedWikiPages.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">相关 Wiki</span>
            <small>{knowledge.relatedWikiPages.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.relatedWikiPages.map((link) => (
              <button
                type="button"
                key={`related:${link.path}`}
                className="knowledge-link-item"
                onClick={() => onOpenPath(link.path, link.name)}
                disabled={busy}
                title={link.relativePath}
              >
                <strong>{link.name}</strong>
                <span>{link.relativePath}</span>
                <small>{sourceKindLabel(link.sourceKind)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {knowledge.sourceReferences.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">资料引用</span>
            <small>{knowledge.sourceReferences.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.sourceReferences.map((link) => (
              <button
                type="button"
                key={`source:${link.path}`}
                className="knowledge-link-item"
                onClick={() => onOpenPath(link.path, link.name)}
                disabled={busy}
                title={link.relativePath}
              >
                <strong>{link.name}</strong>
                <span>{link.relativePath}</span>
                <small>{sourceKindLabel(link.sourceKind)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {knowledge.unresolvedLinks.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">未解析链接</span>
            <small>{knowledge.unresolvedLinks.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.unresolvedLinks.map((link, index) => (
              <div key={`${link.target}:${index}`} className="knowledge-link-item unresolved">
                <strong>{link.label}</strong>
                <span>{link.target}</span>
                <button
                  type="button"
                  className="knowledge-inline-action"
                  onClick={() => onCreateWikiPage(link.target)}
                  disabled={busy}
                >
                  创建页面
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {lint && lint.issues.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">检查</span>
            <small>{lint.issues.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {lint.issues.map((issue, index) => (
              <button
                type="button"
                key={`${issue.kind}:${issue.path}:${index}`}
                className={`knowledge-link-item lint-${issue.severity}`}
                onClick={() => onOpenPath(issue.path, issue.relativePath)}
                disabled={busy}
                title={issue.relativePath}
              >
                <strong>{issue.message}</strong>
                <span>{issue.relativePath}</span>
                <small>{severityLabel(issue.severity)}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {!hasGraphDetails && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">图谱</span>
            <small>暂无变化</small>
          </div>
          <p className="knowledge-empty">暂无链接、资料引用或内容问题。</p>
        </section>
      )}
    </aside>
  );
}
