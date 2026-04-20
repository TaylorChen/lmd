import { useMemo } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

export function useEditorExtensions(isLarge: boolean, readOnly: boolean, visibleStartLine: number) {
  return useMemo(
    () => [
      lineNumbers({
        formatNumber: (lineNo) => String(isLarge ? visibleStartLine + lineNo - 1 : lineNo),
      }),
      history(),
      markdown(),
      highlightSelectionMatches(),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
    ],
    [isLarge, readOnly, visibleStartLine],
  );
}
