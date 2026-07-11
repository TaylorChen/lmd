import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isNativeRuntime } from "../lib/tauri";

type TestDropEvent = { type: "enter" | "leave" | "drop"; paths: string[] };

declare global {
  interface Window {
    __LMD_TEST_DROP_EVENT__?: (event: TestDropEvent) => void;
  }
}

type NativeFileDropOptions = {
  enabled: boolean;
  onDropPaths: (paths: string[]) => void | Promise<void>;
};

export function useNativeFileDrop({ enabled, onDropPaths }: NativeFileDropOptions) {
  const [paths, setPaths] = useState<string[]>([]);
  const onDropPathsRef = useRef(onDropPaths);
  onDropPathsRef.current = onDropPaths;

  useEffect(() => {
    const handleEvent = (event: TestDropEvent) => {
      if (event.type === "enter") setPaths(event.paths);
      if (event.type === "leave") setPaths([]);
      if (event.type === "drop") {
        setPaths([]);
        if (enabled) void onDropPathsRef.current(event.paths);
      }
    };

    if (!isNativeRuntime()) {
      window.__LMD_TEST_DROP_EVENT__ = handleEvent;
      return () => {
        delete window.__LMD_TEST_DROP_EVENT__;
      };
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") handleEvent({ type: "enter", paths: payload.paths });
        if (payload.type === "leave") handleEvent({ type: "leave", paths: [] });
        if (payload.type === "drop") handleEvent({ type: "drop", paths: payload.paths });
      })
      .then((dispose) => {
        if (disposed) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // Keep browser previews and older WebViews usable without native drop events.
      });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);

  return { active: paths.length > 0, paths };
}
