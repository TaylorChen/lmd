import { useEffect, useRef, type MouseEvent } from "react";
import { renderMarkdownBody, type TransclusionMap } from "../lib/markdown";

type MarkdownPreviewProps = {
  content: string;
  transclusions?: TransclusionMap;
  onOpenWikiLink?: (target: string) => void;
};

export function MarkdownPreview({ content, transclusions, onOpenWikiLink }: MarkdownPreviewProps) {
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

  function handleClick(event: MouseEvent<HTMLElement>) {
    const target = (event.target as HTMLElement | null)?.closest<HTMLAnchorElement>("[data-wiki-target]");
    if (!target) return;
    const wikiTarget = target.dataset.wikiTarget;
    if (!wikiTarget) return;
    event.preventDefault();
    onOpenWikiLink?.(wikiTarget);
  }

  return (
    <article ref={previewRef} className="markdown-preview" aria-label="Markdown 预览" onClick={handleClick}>
      {content.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdownBody(content, transclusions) }} />
      ) : (
        <p className="preview-empty">暂无可预览内容。</p>
      )}
    </article>
  );
}
