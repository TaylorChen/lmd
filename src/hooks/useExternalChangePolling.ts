import { useEffect } from "react";
import { invokeCommand } from "../lib/tauri";
import type { ExternalChange, FileMetadata } from "../types";

type ExternalChangePollingOptions = {
  path: string | null;
  knownModifiedMs: number | null;
  intervalMs: number;
  onExternalChange: (change: ExternalChange) => void;
};

export function useExternalChangePolling({
  path,
  knownModifiedMs,
  intervalMs,
  onExternalChange,
}: ExternalChangePollingOptions) {
  useEffect(() => {
    if (!path || !knownModifiedMs) return;

    let cancelled = false;
    async function checkCurrentFile() {
      try {
        const metadata = await invokeCommand<FileMetadata>("file_metadata", { path });
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
    }, intervalMs);
    void checkCurrentFile();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [intervalMs, knownModifiedMs, onExternalChange, path]);
}
