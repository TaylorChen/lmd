import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js";

const htmlEscape = new MarkdownIt().utils.escapeHtml;

export type TransclusionEntry = {
  title: string;
  content: string;
  missing?: boolean;
};

export type TransclusionMap = Record<string, TransclusionEntry>;

export function stripFrontmatter(content: string) {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---\n")) return content;

  const closingIndex = normalized.indexOf("\n---", 4);
  if (closingIndex === -1) return content;

  const afterClosing = normalized.slice(closingIndex + 4);
  return afterClosing.startsWith("\n") ? afterClosing.slice(1) : afterClosing;
}

function highlightCode(code: string, language: string): string {
  const normalizedLanguage = language.trim().toLowerCase();
  if (normalizedLanguage && hljs.getLanguage(normalizedLanguage)) {
    try {
      return hljs.highlight(code, { language: normalizedLanguage }).value;
    } catch {
      return htmlEscape(code);
    }
  }
  return htmlEscape(code);
}

const markdown: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: highlightCode,
})
  .enable(["table", "strikethrough"])
  .use(taskLists, { enabled: false, label: true, labelAfter: true })
  .use(texmath, {
    engine: katex,
    delimiters: "dollars",
    katexOptions: {
      throwOnError: false,
      strict: false,
    },
  });

const defaultLinkOpen =
  markdown.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const href = token.attrGet("href") ?? "";

  if (/^(https?:|mailto:)/i.test(href)) {
    token.attrSet("target", "_blank");
    token.attrSet("rel", "noreferrer");
  }

  return defaultLinkOpen(tokens, index, options, env, self);
};

const defaultFence =
  markdown.renderer.rules.fence ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));

markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0]?.toLowerCase();
  if (language === "mermaid") {
    return `<pre class="mermaid">${markdown.utils.escapeHtml(token.content)}</pre>`;
  }
  if (language === "plantuml" || language === "puml") {
    return `<figure class="plantuml-block"><figcaption>PlantUML</figcaption><pre><code>${markdown.utils.escapeHtml(token.content)}</code></pre></figure>`;
  }
  return defaultFence(tokens, index, options, env, self);
};

function withBlockAnchors(html: string) {
  return html
    .replace(/<p>\^([A-Za-z0-9_-]+)<\/p>/g, '<span id="$1" class="block-anchor">^$1</span>')
    .replace(
      /<p>(.*?)\s+\^([A-Za-z0-9_-]+)<\/p>/g,
      '<p id="$2">$1 <span class="block-anchor">^$2</span></p>',
    );
}

function normalizeInternalAnchor(anchor: string) {
  return anchor.trim().replace(/^\^/, "");
}

function transclusionKey(target: string) {
  return target.trim();
}

function renderEmbeddedMarkdown(content: string) {
  return withWikiLinks(withBlockAnchors(markdown.render(stripFrontmatter(content))));
}

function withTransclusions(html: string, transclusions: TransclusionMap = {}) {
  const replaced = html.replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = (rawLabel ?? target).trim();
    const entry = transclusions[transclusionKey(target)];
    const title = entry?.title || label;
    const stateClass = entry?.missing ? " missing" : "";
    const body = entry?.missing
      ? `<p class="markdown-transclusion-empty">未找到可嵌入的页面或块。</p>`
      : renderEmbeddedMarkdown(entry?.content || "");

    return `<aside class="markdown-transclusion${stateClass}" data-wiki-target="${markdown.utils.escapeHtml(target)}"><header>${markdown.utils.escapeHtml(title)}</header><div>${body}</div></aside>`;
  });
  return replaced.replace(/<p>\s*(<aside class="markdown-transclusion[\s\S]*?<\/aside>)\s*<\/p>/g, "$1");
}

function withWikiLinks(html: string) {
  return html.replace(/(^|[^!])\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, prefix: string, rawTarget: string, rawLabel?: string) => {
    const target = rawTarget.trim();
    const label = (rawLabel ?? target).trim();
    const [, anchor] = target.split("#");
    const href = anchor ? `#${normalizeInternalAnchor(anchor)}` : "#";
    return `${prefix}<a class="wiki-link" href="${markdown.utils.escapeHtml(href)}" data-wiki-target="${markdown.utils.escapeHtml(target)}">${markdown.utils.escapeHtml(label)}</a>`;
  });
}

export function renderMarkdownBody(content: string, transclusions?: TransclusionMap) {
  return withWikiLinks(withTransclusions(withBlockAnchors(markdown.render(stripFrontmatter(content))), transclusions));
}

export function renderMarkdownDocument(title: string, content: string) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${markdown.utils.escapeHtml(title)}</title>
  <style>
    body { max-width: 860px; margin: 48px auto; padding: 0 24px; color: #1f2522; font: 16px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    h1, h2, h3, h4, h5, h6 { line-height: 1.22; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 1em; }
    th, td { border: 1px solid #d5e0da; padding: 8px 10px; text-align: left; }
    th { background: #f6faf8; }
    code, pre { font-family: "SF Mono", Menlo, Consolas, monospace; }
    code { background: #f6faf8; padding: 0.1em 0.32em; border: 1px solid #dce7e2; border-radius: 6px; }
    pre { overflow: auto; padding: 14px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    pre code { border: 0; padding: 0; }
    blockquote { margin-left: 0; padding: 10px 14px; border-left: 4px solid #6d8f81; background: #f6faf8; color: #4c5d56; }
    a { color: #24594a; }
    img { max-width: 100%; height: auto; }
    .contains-task-list { list-style: none; padding-left: 0; }
    .task-list-item-checkbox { margin-right: 8px; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
    .mermaid { display: flex; justify-content: center; padding: 18px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    .plantuml-block { margin: 0 0 1em; padding: 12px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    .plantuml-block figcaption { margin-bottom: 8px; color: #6f7f78; font-size: 0.85em; }
    .plantuml-block pre { margin: 0; }
  </style>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.25/dist/katex.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css">
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, securityLevel: "strict" });
  </script>
</head>
<body>
${renderMarkdownBody(content)}
</body>
</html>
`;
}
