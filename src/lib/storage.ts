import type { RecentFile } from "../types";

export const recentFileLimit = 8;

export const storageKeys = {
  lastDocumentPath: "lmd:last-document-path",
  lastWorkspaceRoot: "lmd:last-workspace-root",
  recentFiles: "lmd:recent-files",
};

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
