import { useEffect, useRef } from "react";
import { renderMarkdownBody } from "../lib/markdown";

type MarkdownPreviewProps = {
  content: string;
};

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const nodes = previewRef.current?.querySelectorAll<HTMLElement>(".mermaid");
    if (!nodes || nodes.length === 0) return;
    let cancelled = false;
    void import("mermaid").then(({ default: mermaid }) => {
      if (cancelled) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "neutral",
      });
      void mermaid.run({ nodes: Array.from(nodes), suppressErrors: true });
    });
    return () => {
      cancelled = true;
    };
  });

  return (
    <article ref={previewRef} className="markdown-preview" aria-label="Markdown 预览">
      {content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownBody(content) }} />
      ) : (
        <p className="preview-empty">暂无可预览内容。</p>
      )}
    </article>
  );
}
