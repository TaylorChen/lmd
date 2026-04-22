import type { Backlink, DocumentKnowledge, KnowledgeLintReport } from "../types";

type KnowledgePanelProps = {
  knowledge: DocumentKnowledge | null;
  lint: KnowledgeLintReport | null;
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

export function KnowledgePanel({
  knowledge,
  lint,
  workspaceIndexPath,
  workspaceLogPath,
  busy,
  onOpenPath,
}: KnowledgePanelProps) {
  if (!knowledge) {
    return (
      <aside className="knowledge-panel" aria-label="Knowledge panel">
        <p className="knowledge-empty">Open a saved file inside a knowledge workspace to inspect links and metadata.</p>
      </aside>
    );
  }

  return (
    <aside className="knowledge-panel" aria-label="Knowledge panel">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Knowledge</span>
          <small>{knowledge.currentRelativePath}</small>
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
          <span className="label">Frontmatter</span>
          <small>{knowledge.frontmatter.length.toLocaleString()}</small>
        </div>
        {knowledge.frontmatter.length > 0 ? (
          <div className="knowledge-kv-list">
            {knowledge.frontmatter.map((field) => (
              <div key={field.key} className="knowledge-kv-item">
                <strong>{field.key}</strong>
                <span>{field.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="knowledge-empty">No frontmatter fields.</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Tags</span>
          <small>{knowledge.tags.length.toLocaleString()}</small>
        </div>
        {knowledge.tags.length > 0 ? (
          <div className="knowledge-tag-list">
            {knowledge.tags.map((tag) => (
              <span key={tag} className="knowledge-tag">
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <p className="knowledge-empty">No tags found.</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Outgoing</span>
          <small>{knowledge.outgoingLinks.length.toLocaleString()}</small>
        </div>
        {knowledge.outgoingLinks.length > 0 ? (
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
        ) : (
          <p className="knowledge-empty">No wikilinks found.</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Backlinks</span>
          <small>{knowledge.backlinks.length.toLocaleString()}</small>
        </div>
        {knowledge.backlinks.length > 0 ? (
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
        ) : (
          <p className="knowledge-empty">No backlinks yet.</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Related Wiki</span>
          <small>{knowledge.relatedWikiPages.length.toLocaleString()}</small>
        </div>
        {knowledge.relatedWikiPages.length > 0 ? (
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
        ) : (
          <p className="knowledge-empty">No related wiki pages yet.</p>
        )}
      </section>

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Source References</span>
          <small>{knowledge.sourceReferences.length.toLocaleString()}</small>
        </div>
        {knowledge.sourceReferences.length > 0 ? (
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
        ) : (
          <p className="knowledge-empty">No source references yet.</p>
        )}
      </section>

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

      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">Lint</span>
          <small>{lint?.issues.length.toLocaleString() ?? "0"}</small>
        </div>
        {lint && lint.issues.length > 0 ? (
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
        ) : (
          <p className="knowledge-empty">No lint issues in the current workspace.</p>
        )}
      </section>
    </aside>
  );
}
