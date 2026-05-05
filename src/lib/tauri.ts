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
  "本地文件和工作区操作需要在 Tauri 桌面应用中使用。请运行 `npm run tauri:dev` 后再执行此命令。";

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
