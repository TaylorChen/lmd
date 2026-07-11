import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { renderMarkdownBody, type TransclusionMap } from "../lib/markdown";

type MarkdownPreviewProps = {
  content: string;
  transclusions?: TransclusionMap;
  onOpenWikiLink?: (target: string) => void;
};

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the legacy copy path below in browser previews.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function MarkdownPreview({ content, transclusions, onOpenWikiLink }: MarkdownPreviewProps) {
  const previewRef = useRef<HTMLElement | null>(null);
  const [renderContent, setRenderContent] = useState(content);
  const renderedHtml = useMemo(
    () => renderMarkdownBody(renderContent, transclusions),
    [renderContent, transclusions],
  );

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setRenderContent(content), 100);
    return () => window.clearTimeout(timeoutId);
  }, [content]);

  useEffect(() => {
    const nodes = previewRef.current?.querySelectorAll<HTMLElement>(".mermaid");
    if (!nodes || nodes.length === 0) return;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void import("mermaid").then(({ default: mermaid }) => {
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "neutral",
        });
        void mermaid.run({ nodes: Array.from(nodes), suppressErrors: true });
      });
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  });

  useEffect(() => {
    const blocks = previewRef.current?.querySelectorAll<HTMLPreElement>("pre:not(.mermaid)");
    if (!blocks) return;

    blocks.forEach((block) => {
      if (block.querySelector(".code-copy-button")) return;
      const code = block.querySelector("code")?.textContent ?? block.textContent ?? "";
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy-button";
      button.textContent = "复制";
      button.setAttribute("aria-label", "复制代码块");
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        void copyTextToClipboard(code)
          .then(() => {
            button.textContent = "已复制";
            window.setTimeout(() => {
              button.textContent = "复制";
            }, 1200);
          })
          .catch(() => {
            button.textContent = "复制失败";
            window.setTimeout(() => {
              button.textContent = "复制";
            }, 1200);
          });
      });
      block.appendChild(button);
    });
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
      {renderContent.trim() ? (
        <div dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      ) : (
        <p className="preview-empty">暂无可预览内容。</p>
      )}
    </article>
  );
}
