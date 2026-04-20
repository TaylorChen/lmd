import { invoke } from "@tauri-apps/api/core";

type TestApi = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

declare global {
  interface Window {
    __LMD_TEST_API__?: TestApi;
  }
}

export function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (window.__LMD_TEST_API__?.invoke) {
    return window.__LMD_TEST_API__.invoke<T>(command, args);
  }

  return invoke<T>(command, args);
}
