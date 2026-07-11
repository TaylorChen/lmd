import { useMemo, type RefObject } from "react";
import { autocompletion, completionKeymap, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { foldGutter, foldKeymap, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { MarkdownAction } from "../components/EditorToolbar";
import type { WorkspaceFile } from "../types";

// Slash commands: typing `/` at the start of a line opens this insert menu. Each entry
// reuses the existing markdown action dispatcher, so there is one source of truth for
// what "insert a table" means. Keywords allow both English and Chinese lookup.
type SlashCommand = { label: string; detail: string; action: MarkdownAction; keywords: string[] };
const slashCommands: SlashCommand[] = [
  { label: "一级标题", detail: "# 标题", action: "h1", keywords: ["h1", "title", "heading", "标题"] },
  { label: "二级标题", detail: "## 标题", action: "h2", keywords: ["h2", "标题"] },
  { label: "三级标题", detail: "### 标题", action: "h3", keywords: ["h3", "标题"] },
  { label: "代码块", detail: "```", action: "code-block", keywords: ["code", "代码", "fence"] },
  { label: "数学公式", detail: "$$", action: "math-block", keywords: ["math", "公式", "数学", "latex"] },
  { label: "表格", detail: "插入 Markdown 表格", action: "table", keywords: ["table", "表格"] },
  { label: "CSV 表格", detail: "选中文本转表格", action: "csv-table", keywords: ["csv", "表格"] },
  { label: "任务列表", detail: "- [ ] 待办", action: "task-list", keywords: ["todo", "task", "任务", "清单"] },
  { label: "无序列表", detail: "- 列表项", action: "unordered-list", keywords: ["ul", "list", "列表", "无序"] },
  { label: "有序列表", detail: "1. 列表项", action: "ordered-list", keywords: ["ol", "list", "列表", "有序"] },
  { label: "脚注", detail: "插入脚注", action: "footnote", keywords: ["footnote", "脚注", "注释"] },
  { label: "链接", detail: "插入链接", action: "link", keywords: ["link", "链接", "url"] },
  { label: "块 ID", detail: "为当前块生成锚点", action: "block-id", keywords: ["block", "块", "id", "锚点"] },
  { label: "块引用", detail: "引用当前块", action: "block-ref", keywords: ["blockref", "块引用", "引用"] },
];

// Syntax highlighting driven by CSS variables so the editor matches both light and
// dark themes from a single definition (the variables flip in styles.css).
const editorHighlightStyle = HighlightStyle.define([
  { tag: t.heading, color: "var(--accent-strong)", fontWeight: "600" },
  { tag: t.strong, color: "var(--text)", fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: [t.link, t.list], color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, color: "var(--success)" },
  { tag: t.quote, color: "var(--muted)" },
  { tag: [t.meta, t.processingInstruction, t.comment], color: "var(--faint)" },
]);

// A theme built entirely from CSS variables. Because the variables are what change
// between light and dark, this one extension renders correctly in both. The `dark`
// flag only tells CodeMirror which built-in defaults to assume for anything unstyled.
export function createEditorTheme(isDark: boolean) {
  return EditorView.theme(
    {
      "&": { backgroundColor: "var(--panel)", color: "var(--text)" },
      ".cm-content": { caretColor: "var(--text)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--panel-muted)",
        color: "var(--faint)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "var(--accent-soft)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--accent-soft)", color: "var(--muted)" },
      ".cm-tooltip": {
        backgroundColor: "var(--overlay)",
        border: "1px solid var(--line)",
        color: "var(--text)",
      },
      ".cm-tooltip-autocomplete ul li[aria-selected]": {
        backgroundColor: "var(--accent-soft)",
        color: "var(--text)",
      },
    },
    { dark: isDark },
  );
}

export function useEditorExtensions(
  isLarge: boolean,
  readOnly: boolean,
  visibleStartLine: number,
  workspaceFiles: WorkspaceFile[],
  blockIds: string[],
  actionRef: RefObject<(action: MarkdownAction) => void>,
) {
  return useMemo(
    () => [
      lineNumbers({
        formatNumber: (lineNo) => String(isLarge ? visibleStartLine + lineNo - 1 : lineNo),
      }),
      foldGutter(),
      history(),
      markdown(),
      syntaxHighlighting(editorHighlightStyle, { fallback: true }),
      highlightSelectionMatches(),
      autocompletion({
        override: [
          (context: CompletionContext) => {
            const before = context.matchBefore(/\/[\w一-鿿-]*$/);
            if (!before) return null;
            // Only at line start or after whitespace, so URLs and paths don't trigger it.
            const charBefore =
              before.from > 0 ? context.state.sliceDoc(before.from - 1, before.from) : "\n";
            if (charBefore.trim() !== "") return null;
            const query = before.text.slice(1).toLowerCase();
            const options = slashCommands
              .filter(
                (command) =>
                  !query ||
                  command.label.toLowerCase().includes(query) ||
                  command.keywords.some((keyword) => keyword.includes(query)),
              )
              .map((command) => ({
                label: command.label,
                detail: command.detail,
                type: "keyword",
                apply: (view: EditorView, _completion: unknown, from: number, to: number) => {
                  view.dispatch({ changes: { from, to, insert: "" }, selection: { anchor: from } });
                  actionRef.current?.(command.action);
                },
              }));
            if (options.length === 0) return null;
            return { from: before.from, options, filter: false };
          },
          (context: CompletionContext) => {
            const before = context.matchBefore(/\[\[[^\]\n]*/);
            if (!before) return null;
            const blockMarkerIndex = before.text.lastIndexOf("#^");
            if (blockMarkerIndex !== -1) {
              const query = before.text.slice(blockMarkerIndex + 2).toLowerCase();
              const options = blockIds
                .filter((blockId) => blockId.toLowerCase().includes(query))
                .slice(0, 40)
                .map((blockId) => ({
                  label: blockId,
                  detail: "块引用",
                  apply: `${blockId}]]`,
                  type: "reference",
                }));
              return {
                from: before.from + blockMarkerIndex + 2,
                options,
                validFor: /^[A-Za-z0-9_-]*$/,
              };
            }

            const query = before.text.slice(2).toLowerCase();
            const options = workspaceFiles
              .filter((file) => file.relativePath.toLowerCase().includes(query))
              .slice(0, 40)
              .map((file) => {
                const label = file.name.replace(/\.(md|markdown|mdown)$/i, "");
                return {
                  label,
                  detail: file.relativePath,
                  apply: `[[${label}]]`,
                  type: "text",
                };
              });
            return {
              from: before.from,
              options,
              validFor: /^\[\[[^\]\n]*$/,
            };
          },
        ],
      }),
      keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
    ],
    [isLarge, readOnly, visibleStartLine, workspaceFiles, blockIds, actionRef],
  );
}
