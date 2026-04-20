import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ExternalChange, FileMetadata } from "../types";

type ExternalChangePollingOptions = {
  path: string | null;
  knownModifiedMs: number | null;
  onExternalChange: (change: ExternalChange) => void;
};

export function useExternalChangePolling({
  path,
  knownModifiedMs,
  onExternalChange,
}: ExternalChangePollingOptions) {
  useEffect(() => {
    if (!path || !knownModifiedMs) return;

    let cancelled = false;
    async function checkCurrentFile() {
      try {
        const metadata = await invoke<FileMetadata>("file_metadata", { path });
        if (cancelled) return;

        if (!metadata.exists) {
          onExternalChange({ kind: "missing" });
          return;
        }

        if (metadata.modifiedMs && metadata.modifiedMs !== knownModifiedMs) {
          onExternalChange({
            kind: "modified",
            modifiedMs: metadata.modifiedMs,
            byteSize: metadata.byteSize,
          });
        }
      } catch {
        // External change checks should not interrupt editing.
      }
    }

    const interval = window.setInterval(() => {
      void checkCurrentFile();
    }, 5000);
    void checkCurrentFile();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [knownModifiedMs, onExternalChange, path]);
}
