import type { AppSettings, AssistantProvider, EditorMode, RecentFile } from "../types";

export const recentFileLimit = 8;
export const defaultSettings: AppSettings = {
  defaultEditorMode: "split",
  searchResultLimit: 80,
  externalCheckSeconds: 5,
  assistantProvider: "builtin",
  assistantModel: "local-summary-v1",
};

export const storageKeys = {
  lastDocumentPath: "lmd:last-document-path",
  lastWorkspaceRoot: "lmd:last-workspace-root",
  recentFiles: "lmd:recent-files",
  settings: "lmd:settings",
};

function isEditorMode(value: unknown): value is EditorMode {
  return value === "edit" || value === "split" || value === "preview";
}

function isAssistantProvider(value: unknown): value is AssistantProvider {
  return value === "builtin" || value === "mock_openai" || value === "external_command";
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function readRecentFiles() {
  try {
    const rawValue = window.localStorage.getItem(storageKeys.recentFiles);
    if (!rawValue) return [];
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue
      .filter(
        (item): item is RecentFile =>
          typeof item?.path === "string" && typeof item?.name === "string",
      )
      .slice(0, recentFileLimit);
  } catch {
    return [];
  }
}

export function writeRecentFiles(files: RecentFile[]) {
  window.localStorage.setItem(storageKeys.recentFiles, JSON.stringify(files.slice(0, recentFileLimit)));
}

export function readSettings(): AppSettings {
  try {
    const rawValue = window.localStorage.getItem(storageKeys.settings);
    if (!rawValue) return defaultSettings;
    const parsedValue = JSON.parse(rawValue);

    return {
      defaultEditorMode: isEditorMode(parsedValue?.defaultEditorMode)
        ? parsedValue.defaultEditorMode
        : defaultSettings.defaultEditorMode,
      searchResultLimit: clampNumber(
        parsedValue?.searchResultLimit,
        defaultSettings.searchResultLimit,
        20,
        200,
      ),
      externalCheckSeconds: clampNumber(
        parsedValue?.externalCheckSeconds,
        defaultSettings.externalCheckSeconds,
        2,
        30,
      ),
      assistantProvider: isAssistantProvider(parsedValue?.assistantProvider)
        ? parsedValue.assistantProvider
        : defaultSettings.assistantProvider,
      assistantModel:
        typeof parsedValue?.assistantModel === "string" && parsedValue.assistantModel.trim()
          ? parsedValue.assistantModel.trim()
          : defaultSettings.assistantModel,
    };
  } catch {
    return defaultSettings;
  }
}

export function writeSettings(settings: AppSettings) {
  window.localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
}
