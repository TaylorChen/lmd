import type { DocumentHeading } from "../types";

type DocumentOutlineProps = {
  headings: DocumentHeading[];
  busy: boolean;
  onOpenHeading: (heading: DocumentHeading) => void;
};

export function DocumentOutline({ headings, busy, onOpenHeading }: DocumentOutlineProps) {
  return (
    <aside className="document-outline" aria-label="文档大纲">
      <section className="knowledge-section">
        <div className="knowledge-header">
          <span className="label">文档大纲</span>
          <small>{headings.length.toLocaleString()}</small>
        </div>
        {headings.length > 0 ? (
          <div className="outline-list">
            {headings.map((heading) => (
              <button
                type="button"
                key={heading.id}
                className="outline-item"
                style={{ paddingLeft: `${Math.max(0, heading.level - 1) * 12}px` }}
                onClick={() => onOpenHeading(heading)}
                disabled={busy}
                title={`第 ${heading.lineNumber.toLocaleString()} 行`}
              >
                <span>{heading.title}</span>
                <small>H{heading.level}</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="knowledge-empty">当前笔记还没有 Markdown 标题。</p>
        )}
      </section>
    </aside>
  );
}
