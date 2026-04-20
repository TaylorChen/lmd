import { useEffect } from "react";
import type { Workspace } from "../types";

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
}: AppShortcutsOptions) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!event.metaKey || event.altKey || event.ctrlKey) return;

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (!busy && !readOnly && isDirty) onSave();
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
  }, [busy, isDirty, onNew, onOpen, onOpenWorkspace, onRefreshWorkspace, onSave, readOnly, workspace]);
}
