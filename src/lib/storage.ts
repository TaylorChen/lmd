import type { AppSettings, AssistantProvider, EditorMode, RecentFile, RecentWorkspace } from "../types";

export const recentFileLimit = 8;
export const defaultSettings: AppSettings = {
  defaultEditorMode: "split",
  searchResultLimit: 80,
  externalCheckSeconds: 5,
  assistantProvider: "deepseek",
  assistantModel: "deepseek-v4-flash",
  assistantApiKeys: {},
  assistantBaseUrls: {},
  assistantExternalCommand: "",
  assistantExternalTimeoutSeconds: 60,
};

export const storageKeys = {
  lastDocumentPath: "lmd:last-document-path",
  lastWorkspaceRoot: "lmd:last-workspace-root",
  recentFiles: "lmd:recent-files",
  recentWorkspaces: "lmd:recent-workspaces:v1",
  settings: "lmd:settings",
  workspaceSidebarOpen: "lmd:workspace-sidebar-open:v1",
};

export function readWorkspaceSidebarOpen(): boolean | null {
  try {
    const rawValue = window.localStorage.getItem(storageKeys.workspaceSidebarOpen);
    if (rawValue === null) return null;
    const parsedValue: unknown = JSON.parse(rawValue);
    return typeof parsedValue === "boolean" ? parsedValue : null;
  } catch {
    return null;
  }
}

export function writeWorkspaceSidebarOpen(open: boolean): void {
  window.localStorage.setItem(storageKeys.workspaceSidebarOpen, JSON.stringify(open));
}

export function workspaceTreeStorageKey(rootPath: string) {
  return `lmd:workspace-tree:v1:${rootPath}`;
}

export function readWorkspaceTreeExpanded(rootPath: string): Set<string> {
  try {
    const rawValue = window.localStorage.getItem(workspaceTreeStorageKey(rootPath));
    if (!rawValue) return new Set();
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return new Set();
    return new Set(
      parsedValue.filter((path): path is string => typeof path === "string" && path.length > 0),
    );
  } catch {
    return new Set();
  }
}

export function writeWorkspaceTreeExpanded(rootPath: string, paths: Set<string>) {
  const validPaths = [...paths].filter((path) => typeof path === "string" && path.length > 0);
  window.localStorage.setItem(workspaceTreeStorageKey(rootPath), JSON.stringify(validPaths));
}

function isEditorMode(value: unknown): value is EditorMode {
  return value === "edit" || value === "split" || value === "preview";
}

function isAssistantProvider(value: unknown): value is AssistantProvider {
  return (
    value === "deepseek" ||
    value === "minimax" ||
    value === "kimi" ||
    value === "zhipu" ||
    value === "ollama" ||
    value === "lmstudio" ||
    value === "external_command"
  );
}

function readProviderStringMap(value: unknown): Partial<Record<AssistantProvider, string>> {
  if (!value || typeof value !== "object") return {};

  const next: Partial<Record<AssistantProvider, string>> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!isAssistantProvider(key) || typeof rawValue !== "string") continue;
    const trimmedValue = rawValue.trim();
    if (trimmedValue) next[key] = trimmedValue;
  }
  return next;
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

export function promoteRecentWorkspace(
  workspaces: RecentWorkspace[],
  workspace: RecentWorkspace,
): RecentWorkspace[] {
  return [workspace, ...workspaces.filter((item) => item.path !== workspace.path)].slice(
    0,
    recentFileLimit,
  );
}

export function readRecentWorkspaces(): RecentWorkspace[] {
  try {
    const rawValue = window.localStorage.getItem(storageKeys.recentWorkspaces);
    if (!rawValue) return [];
    const parsedValue: unknown = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];
    return parsedValue
      .filter(
        (item): item is RecentWorkspace =>
          typeof item?.path === "string" &&
          typeof item?.name === "string" &&
          typeof item?.openedAt === "number" &&
          Number.isFinite(item.openedAt),
      )
      .slice(0, recentFileLimit);
  } catch {
    return [];
  }
}

export function writeRecentWorkspaces(workspaces: RecentWorkspace[]) {
  window.localStorage.setItem(
    storageKeys.recentWorkspaces,
    JSON.stringify(workspaces.slice(0, recentFileLimit)),
  );
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
      assistantApiKeys: readProviderStringMap(parsedValue?.assistantApiKeys),
      assistantBaseUrls: readProviderStringMap(parsedValue?.assistantBaseUrls),
      assistantExternalCommand:
        typeof parsedValue?.assistantExternalCommand === "string"
          ? parsedValue.assistantExternalCommand.trim()
          : defaultSettings.assistantExternalCommand,
      assistantExternalTimeoutSeconds: clampNumber(
        parsedValue?.assistantExternalTimeoutSeconds,
        defaultSettings.assistantExternalTimeoutSeconds,
        5,
        600,
      ),
    };
  } catch {
    return defaultSettings;
  }
}

export function writeSettings(settings: AppSettings) {
  window.localStorage.setItem(storageKeys.settings, JSON.stringify(settings));
}

export function writeSettingsWithoutApiKeys(settings: AppSettings) {
  window.localStorage.setItem(storageKeys.settings, JSON.stringify({ ...settings, assistantApiKeys: {} }));
}
