import type { Backlink, DocumentKnowledge, KnowledgeLintReport, QueryContext } from "../types";

type KnowledgePanelProps = {
  knowledge: DocumentKnowledge | null;
  lint: KnowledgeLintReport | null;
  queryContext: QueryContext | null;
  workspaceIndexPath: string | null;
  workspaceLogPath: string | null;
  busy: boolean;
  onOpenPath: (path: string, name: string) => void;
};

function sourceKindLabel(value: Backlink["sourceKind"] | "unknown" | null) {
  if (value === "wiki") return "Wiki";
  if (value === "source") return "Source";
  if (value === "note") return "Note";
  return "Unknown";
}

function reasonLabel(value: QueryContext["items"][number]["reason"]) {
  if (value === "current_document") return "Current note";
  if (value === "linked_wiki") return "Linked wiki";
  if (value === "source_reference") return "Source reference";
  if (value === "backlink") return "Backlink";
  if (value === "index_hint") return "Index hint";
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

export function KnowledgePanel({
  knowledge,
  lint,
  queryContext,
  workspaceIndexPath,
  workspaceLogPath,
  busy,
  onOpenPath,
}: KnowledgePanelProps) {
  if (!knowledge) {
    return (
      <aside className="knowledge-panel" aria-label="Knowledge panel">
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Knowledge</span>
            <small>Ready</small>
          </div>
          <p className="knowledge-empty">Open a saved note in this workspace to inspect links, tags, and source context.</p>
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
    <aside className="knowledge-panel" aria-label="Knowledge panel">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Knowledge</span>
          <small>{knowledge.currentRelativePath}</small>
        </div>
        <div className="knowledge-stats" aria-label="Knowledge summary">
          <StatChip label="tags" value={knowledge.tags.length} />
          <StatChip label="links" value={knowledge.outgoingLinks.length} />
          <StatChip label="backlinks" value={knowledge.backlinks.length} />
          <StatChip label="issues" value={lint?.issues.length ?? 0} />
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
                Open index.md
              </button>
            )}
            {workspaceLogPath && (
              <button
                type="button"
                className="knowledge-action-button"
                onClick={() => onOpenPath(workspaceLogPath, "log.md")}
                disabled={busy}
              >
                Open log.md
              </button>
            )}
          </div>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Query Context</span>
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
                <em>{item.excerpt || "No excerpt available."}</em>
              </button>
            ))}
          </div>
        ) : (
          <p className="knowledge-empty">Context will appear here after this note is indexed.</p>
        )}
      </section>

      {hasMetadata && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Metadata</span>
            <small>{(knowledge.frontmatter.length + knowledge.tags.length).toLocaleString()}</small>
          </div>
          {knowledge.tags.length > 0 && (
            <div className="knowledge-tag-list">
              {knowledge.tags.map((tag) => (
                <span key={tag} className="knowledge-tag">
                  #{tag}
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

      {knowledge.outgoingLinks.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Outgoing</span>
            <small>{knowledge.outgoingLinks.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.outgoingLinks.map((link, index) =>
              link.resolvedPath ? (
                <button
                  type="button"
                  key={`${link.target}:${index}`}
                  className="knowledge-link-item"
                  onClick={() => onOpenPath(link.resolvedPath!, link.resolvedName ?? link.label)}
                  disabled={busy}
                  title={link.resolvedRelativePath ?? link.target}
                >
                  <strong>{link.label}</strong>
                  <span>{link.resolvedRelativePath ?? link.target}</span>
                  <small>{sourceKindLabel(link.sourceKind)}</small>
                </button>
              ) : (
                <div key={`${link.target}:${index}`} className="knowledge-link-item unresolved">
                  <strong>{link.label}</strong>
                  <span>{link.target}</span>
                  <small>Unresolved</small>
                </div>
              ),
            )}
          </div>
        </section>
      )}

      {knowledge.backlinks.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Backlinks</span>
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
            <span className="label">Related Wiki</span>
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
            <span className="label">Source References</span>
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
            <span className="label">Unresolved</span>
            <small>{knowledge.unresolvedLinks.length.toLocaleString()}</small>
          </div>
          <div className="knowledge-link-list">
            {knowledge.unresolvedLinks.map((link, index) => (
              <div key={`${link.target}:${index}`} className="knowledge-link-item unresolved">
                <strong>{link.label}</strong>
                <span>{link.target}</span>
                <small>Missing target</small>
              </div>
            ))}
          </div>
        </section>
      )}

      {lint && lint.issues.length > 0 && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Checks</span>
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
                <small>{issue.severity}</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {!hasGraphDetails && (
        <section className="knowledge-section">
          <div className="knowledge-header">
            <span className="label">Graph</span>
            <small>Quiet</small>
          </div>
          <p className="knowledge-empty">No links, source references, or content issues yet.</p>
        </section>
      )}
    </aside>
  );
}
