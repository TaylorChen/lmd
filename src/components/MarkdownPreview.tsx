import type { ReactNode } from "react";

type MarkdownPreviewProps = {
  content: string;
};

type ListItem = {
  text: string;
  ordered: boolean;
};

type CodeFence = {
  lines: string[];
};

function safeLinkTarget(href: string) {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  return "";
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}-strong`)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}-em`)}</em>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = linkMatch ? safeLinkTarget(linkMatch[2]) : "";
      nodes.push(
        href ? (
          <a key={key} href={href} target="_blank" rel="noreferrer">
            {linkMatch?.[1]}
          </a>
        ) : (
          linkMatch?.[1] ?? token
        ),
      );
    }

    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }

  return nodes;
}

function flushParagraph(lines: string[], blocks: ReactNode[]) {
  if (lines.length === 0) return;
  const text = lines.join(" ");
  blocks.push(<p key={`p-${blocks.length}`}>{renderInline(text, `p-${blocks.length}`)}</p>);
  lines.length = 0;
}

function flushList(items: ListItem[], blocks: ReactNode[]) {
  if (items.length === 0) return;
  const ordered = items[0].ordered;
  const children = items.map((item, index) => (
    <li key={`${blocks.length}-${index}`}>{renderInline(item.text, `li-${blocks.length}-${index}`)}</li>
  ));
  blocks.push(
    ordered ? (
      <ol key={`ol-${blocks.length}`}>{children}</ol>
    ) : (
      <ul key={`ul-${blocks.length}`}>{children}</ul>
    ),
  );
  items.length = 0;
}

function renderHeading(level: number, children: ReactNode[], key: string) {
  if (level === 1) return <h1 key={key}>{children}</h1>;
  if (level === 2) return <h2 key={key}>{children}</h2>;
  if (level === 3) return <h3 key={key}>{children}</h3>;
  if (level === 4) return <h4 key={key}>{children}</h4>;
  if (level === 5) return <h5 key={key}>{children}</h5>;
  return <h6 key={key}>{children}</h6>;
}

function renderBlocks(content: string) {
  const blocks: ReactNode[] = [];
  const paragraphLines: string[] = [];
  const listItems: ListItem[] = [];
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let codeFence: CodeFence | null = null;

  for (const [lineIndex, line] of lines.entries()) {
    const fence = /^```(\S*)\s*$/.exec(line);
    if (fence) {
      if (codeFence) {
        blocks.push(
          <pre key={`code-${blocks.length}`}>
            <code>{codeFence.lines.join("\n")}</code>
          </pre>,
        );
        codeFence = null;
      } else {
        flushParagraph(paragraphLines, blocks);
        flushList(listItems, blocks);
        codeFence = { lines: [] };
      }
      continue;
    }

    if (codeFence) {
      codeFence.lines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      const level = heading[1].length;
      blocks.push(renderHeading(level, renderInline(heading[2], `h-${lineIndex}`), `h-${lineIndex}`));
      continue;
    }

    if (/^[-*_]\s*[-*_]\s*[-*_][\s\-*_]*$/.test(line.trim())) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      blocks.push(<hr key={`hr-${lineIndex}`} />);
      continue;
    }

    const quote = /^>\s?(.+)$/.exec(line);
    if (quote) {
      flushParagraph(paragraphLines, blocks);
      flushList(listItems, blocks);
      blocks.push(
        <blockquote key={`quote-${lineIndex}`}>{renderInline(quote[1], `quote-${lineIndex}`)}</blockquote>,
      );
      continue;
    }

    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph(paragraphLines, blocks);
      const isOrdered = Boolean(ordered);
      if (listItems.length > 0 && listItems[0].ordered !== isOrdered) {
        flushList(listItems, blocks);
      }
      listItems.push({ text: (ordered ?? unordered)?.[1] ?? "", ordered: isOrdered });
      continue;
    }

    paragraphLines.push(line.trim());
  }

  const unclosedFence = codeFence;
  if (unclosedFence) {
    blocks.push(
      <pre key={`code-${blocks.length}`}>
        <code>{unclosedFence.lines.join("\n")}</code>
      </pre>,
    );
  }

  flushParagraph(paragraphLines, blocks);
  flushList(listItems, blocks);
  return blocks;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <article className="markdown-preview" aria-label="Markdown preview">
      {content.trim() ? renderBlocks(content) : <p className="preview-empty">Nothing to preview yet.</p>}
    </article>
  );
}
