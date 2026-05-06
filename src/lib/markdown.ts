import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import texmath from "markdown-it-texmath";
import katex from "katex";
import hljs from "highlight.js/lib/common";

const htmlEscape = new MarkdownIt().utils.escapeHtml;

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
  return defaultFence(tokens, index, options, env, self);
};

export function renderMarkdownBody(content: string) {
  return markdown.render(stripFrontmatter(content));
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
