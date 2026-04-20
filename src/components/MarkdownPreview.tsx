import { renderMarkdownBody } from "../lib/markdown";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <article className="markdown-preview" aria-label="Markdown preview">
      {content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownBody(content) }} />
      ) : (
        <p className="preview-empty">Nothing to preview yet.</p>
      )}
    </article>
  );
}
