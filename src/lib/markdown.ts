import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})
  .enable(["table", "strikethrough"])
  .use(taskLists, { enabled: false, label: true, labelAfter: true });

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

export function renderMarkdownBody(content: string) {
  return markdown.render(content);
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
  </style>
</head>
<body>
${renderMarkdownBody(content)}
</body>
</html>
`;
}
