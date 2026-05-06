import { useMemo } from "react";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import type { WorkspaceFile } from "../types";

export function useEditorExtensions(
  isLarge: boolean,
  readOnly: boolean,
  visibleStartLine: number,
  workspaceFiles: WorkspaceFile[],
) {
  return useMemo(
    () => [
      lineNumbers({
        formatNumber: (lineNo) => String(isLarge ? visibleStartLine + lineNo - 1 : lineNo),
      }),
      history(),
      markdown(),
      highlightSelectionMatches(),
      autocompletion({
        override: [
          (context: CompletionContext) => {
            const before = context.matchBefore(/\[\[[^\]\n]*/);
            if (!before) return null;
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
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
    ],
    [isLarge, readOnly, visibleStartLine, workspaceFiles],
  );
}
