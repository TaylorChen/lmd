import { renderMarkdownBody } from "../lib/markdown";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <article className="markdown-preview" aria-label="Markdown 预览">
      {content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownBody(content) }} />
      ) : (
        <p className="preview-empty">暂无可预览内容。</p>
      )}
    </article>
  );
}
