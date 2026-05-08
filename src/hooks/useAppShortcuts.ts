import { useEffect } from "react";
import type { EditorMode, Workspace } from "../types";

type AppShortcutsOptions = {
  busy: boolean;
  readOnly: boolean;
  isDirty: boolean;
  workspace: Workspace | null;
  onSave: () => void;
  onOpen: () => void;
  onOpenWorkspace: () => void;
  onNew: () => void;
  onRefreshWorkspace: () => void;
  onOpenCommandPalette: () => void;
  onFocusDocumentSearch: () => void;
  onSetEditorMode: (mode: EditorMode) => void;
};

export function useAppShortcuts({
  busy,
  readOnly,
  isDirty,
  workspace,
  onSave,
  onOpen,
  onOpenWorkspace,
  onNew,
  onRefreshWorkspace,
  onOpenCommandPalette,
  onFocusDocumentSearch,
  onSetEditorMode,
}: AppShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (!busy && !readOnly && isDirty) onSave();
      } else if (key === "k") {
        event.preventDefault();
        onOpenCommandPalette();
      } else if (key === "f") {
        event.preventDefault();
        onFocusDocumentSearch();
      } else if (key === "e" && event.shiftKey) {
        event.preventDefault();
        onSetEditorMode("edit");
      } else if (key === "e") {
        event.preventDefault();
        onSetEditorMode("preview");
      } else if (event.key === "\\") {
        event.preventDefault();
        onSetEditorMode("split");
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        if (!busy) onOpenWorkspace();
      } else if (key === "o") {
        event.preventDefault();
        if (!busy) onOpen();
      } else if (key === "n") {
        event.preventDefault();
        if (!busy) onNew();
      } else if (key === "r") {
        event.preventDefault();
        if (!busy && workspace) onRefreshWorkspace();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    busy,
    isDirty,
    onFocusDocumentSearch,
    onNew,
    onOpen,
    onOpenCommandPalette,
    onOpenWorkspace,
    onRefreshWorkspace,
    onSave,
    onSetEditorMode,
    readOnly,
    workspace,
  ]);
}
