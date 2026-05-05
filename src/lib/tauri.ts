import { invoke } from "@tauri-apps/api/core";

type TestApi = {
  invoke?: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

type TauriInternals = {
  invoke?: unknown;
};

declare global {
  interface Window {
    __LMD_TEST_API__?: TestApi;
    __TAURI_INTERNALS__?: TauriInternals;
  }
}

export const nativeRuntimeRequiredMessage =
  "Native file and workspace actions require the Tauri desktop app. Run `npm run tauri:dev` to use this command.";

export function isNativeRuntime() {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

export function invokeCommand<T>(command: string, args?: Record<string, unknown>) {
  if (window.__LMD_TEST_API__?.invoke) {
    return window.__LMD_TEST_API__.invoke<T>(command, args);
  }

  if (!isNativeRuntime()) {
    return Promise.reject(new Error(nativeRuntimeRequiredMessage));
  }

  return invoke<T>(command, args);
}
