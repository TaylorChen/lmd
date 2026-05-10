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

type HeadingEntry = {
  level: number;
  title: string;
  slug: string;
};

type FootnoteEntry = {
  id: string;
  content: string;
};

type CalloutEntry = {
  type: string;
  title: string;
  content: string;
  folded: boolean;
};

type RenderContext = {
  headings: HeadingEntry[];
  footnotes: FootnoteEntry[];
  callouts: CalloutEntry[];
  marks: string[];
};

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

function stripInlineMarkdown(content: string) {
  return content
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/#+\s*/g, "")
    .trim();
}

function slugifyHeading(title: string, used: Map<string, number>) {
  const base =
    title
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .replace(/\s+/g, "-") || "section";
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function collectHeadings(source: string) {
  const headings: HeadingEntry[] = [];
  const used = new Map<string, number>();
  let inFence = false;

  for (const line of source.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;

    const title = stripInlineMarkdown(match[2]);
    if (!title) continue;
    headings.push({
      level: match[1].length,
      title,
      slug: slugifyHeading(title, used),
    });
  }

  return headings;
}

function extractFootnotes(source: string) {
  const footnotes: FootnoteEntry[] = [];
  const output: string[] = [];
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^\[\^([^\]\s]+)\]:\s*(.*)$/.exec(lines[index]);
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const content = [match[2]];
    while (index + 1 < lines.length && /^(?: {2,}|\t)/.test(lines[index + 1])) {
      index += 1;
      content.push(lines[index].replace(/^(?: {2,}|\t)/, ""));
    }

    footnotes.push({
      id: match[1],
      content: content.join("\n").trim(),
    });
  }

  return { source: output.join("\n"), footnotes };
}

function replaceMarksOutsideFences(source: string, context: RenderContext) {
  let inFence = false;
  return source
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/==([^=\n]+)==/g, (_match, value: string) => {
        const index = context.marks.push(value.trim()) - 1;
        return `LMD_MARK_${index}_`;
      });
    })
    .join("\n");
}

function replaceCallouts(source: string, context: RenderContext) {
  const lines = source.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const match = /^>\s*\[!([A-Za-z][A-Za-z0-9_-]*)\]([+-]?)(?:\s+(.*))?\s*$/.exec(lines[index]);
    if (!match) {
      output.push(lines[index]);
      continue;
    }

    const content: string[] = [];
    while (index + 1 < lines.length && /^>\s?/.test(lines[index + 1])) {
      index += 1;
      content.push(lines[index].replace(/^>\s?/, ""));
    }

    const type = match[1].toLowerCase();
    const calloutIndex =
      context.callouts.push({
        type,
        title: match[3]?.trim() || type.toUpperCase(),
        content: content.join("\n").trim(),
        folded: match[2] === "-",
      }) - 1;
    output.push(`LMD_CALLOUT_${calloutIndex}_`);
  }

  return output.join("\n");
}

function prepareExtendedMarkdown(source: string) {
  const context: RenderContext = {
    headings: collectHeadings(source),
    footnotes: [],
    callouts: [],
    marks: [],
  };
  const footnoteResult = extractFootnotes(source);
  context.footnotes = footnoteResult.footnotes;

  const byFootnoteId = new Map(context.footnotes.map((footnote, index) => [footnote.id, index]));
  let prepared = footnoteResult.source.replace(/^\s*\[TOC\]\s*$/gim, "LMD_TOC_MARKER");
  prepared = replaceCallouts(prepared, context);
  prepared = replaceMarksOutsideFences(prepared, context);
  prepared = prepared.replace(/\[\^([^\]\s]+)\]/g, (match, id: string) => {
    const index = byFootnoteId.get(id);
    return index === undefined ? match : `LMD_FOOTNOTE_REF_${index}_`;
  });

  return { source: prepared, context };
}

function renderToc(headings: HeadingEntry[]) {
  if (headings.length === 0) {
    return '<nav class="markdown-toc empty" aria-label="目录"><p>当前文档还没有标题。</p></nav>';
  }

  const items = headings
    .map(
      (heading) =>
        `<li class="toc-level-${heading.level}"><a href="#${markdown.utils.escapeHtml(heading.slug)}">${markdown.utils.escapeHtml(heading.title)}</a></li>`,
    )
    .join("");
  return `<nav class="markdown-toc" aria-label="目录"><strong>目录</strong><ol>${items}</ol></nav>`;
}

function renderFootnotes(footnotes: FootnoteEntry[]) {
  if (footnotes.length === 0) return "";
  const items = footnotes
    .map((footnote, index) => {
      const number = index + 1;
      return `<li id="fn-${number}"><span>${markdown.renderInline(footnote.content || footnote.id)}</span> <a href="#fnref-${number}" class="footnote-backref" aria-label="返回正文">↩</a></li>`;
    })
    .join("");
  return `<section class="footnotes" aria-label="脚注"><hr><ol>${items}</ol></section>`;
}

function renderCallout(callout: CalloutEntry) {
  const title = markdown.utils.escapeHtml(callout.title);
  const body = callout.content ? markdown.render(callout.content) : "";
  if (callout.folded) {
    return `<details class="markdown-callout callout-${markdown.utils.escapeHtml(callout.type)}"><summary>${title}</summary>${body}</details>`;
  }
  return `<aside class="markdown-callout callout-${markdown.utils.escapeHtml(callout.type)}"><strong>${title}</strong>${body}</aside>`;
}

function applyExtendedMarkdownHtml(html: string, context: RenderContext) {
  let rendered = html;

  for (const [index, heading] of context.headings.entries()) {
    const escapedTitle = markdown.utils.escapeHtml(heading.title);
    const headingPattern = new RegExp(
      `<h${heading.level}>\\s*${escapedTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h${heading.level}>`,
    );
    rendered = rendered.replace(headingPattern, `<h${heading.level} id="${markdown.utils.escapeHtml(heading.slug)}">${escapedTitle}</h${heading.level}>`);
    if (index > 200) break;
  }

  rendered = rendered.replace(/<p>LMD_TOC_MARKER<\/p>/g, renderToc(context.headings));
  rendered = rendered.replace(/LMD_MARK_(\d+)_/g, (_match, rawIndex: string) => {
    const value = context.marks[Number(rawIndex)] ?? "";
    return `<mark>${markdown.utils.escapeHtml(value)}</mark>`;
  });
  rendered = rendered.replace(/LMD_FOOTNOTE_REF_(\d+)_/g, (_match, rawIndex: string) => {
    const number = Number(rawIndex) + 1;
    return `<sup id="fnref-${number}" class="footnote-ref"><a href="#fn-${number}">${number}</a></sup>`;
  });
  rendered = rendered.replace(/<p>LMD_CALLOUT_(\d+)_<\/p>/g, (_match, rawIndex: string) => {
    const callout = context.callouts[Number(rawIndex)];
    return callout ? renderCallout(callout) : "";
  });

  return `${rendered}${renderFootnotes(context.footnotes)}`;
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
  const { source, context } = prepareExtendedMarkdown(stripFrontmatter(content));
  return withWikiLinks(withBlockAnchors(applyExtendedMarkdownHtml(markdown.render(source), context)));
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
  const { source, context } = prepareExtendedMarkdown(stripFrontmatter(content));
  return withWikiLinks(withTransclusions(withBlockAnchors(applyExtendedMarkdownHtml(markdown.render(source), context)), transclusions));
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
    mark { background: #fff2a8; padding: 0.05em 0.2em; border-radius: 4px; }
    pre { overflow: auto; padding: 14px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    pre code { border: 0; padding: 0; }
    blockquote { margin-left: 0; padding: 10px 14px; border-left: 4px solid #6d8f81; background: #f6faf8; color: #4c5d56; }
    a { color: #24594a; }
    img { max-width: 100%; height: auto; }
    .contains-task-list { list-style: none; padding-left: 0; }
    .task-list-item-checkbox { margin-right: 8px; }
    .katex-display { overflow-x: auto; overflow-y: hidden; }
    .mermaid { display: flex; justify-content: center; padding: 18px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    .markdown-callout { margin: 0 0 1em; padding: 12px 14px; border-left: 4px solid #6d8f81; background: #f6faf8; border-radius: 8px; }
    .markdown-toc { margin: 0 0 1.25em; padding: 12px 16px; background: #f6faf8; border: 1px solid #dce7e2; border-radius: 8px; }
    .markdown-toc ol { margin: 8px 0 0; padding-left: 18px; }
    .footnotes { margin-top: 2em; color: #5f6d67; font-size: 0.92em; }
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
