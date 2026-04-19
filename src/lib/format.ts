import type { DocumentStats } from "../types";

export function fileName(path: string | null) {
  if (!path) return "Untitled";
  return path.split(/[\\/]/).pop() || path;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function localStats(content: string): DocumentStats {
  return {
    byteSize: new TextEncoder().encode(content).length,
    lineCount: content ? content.split(/\r\n|\r|\n/).length : 0,
  };
}

export function isPathInsideRoot(pathToCheck: string, rootPath: string) {
  if (pathToCheck === rootPath) return true;
  const normalizedRoot = rootPath.endsWith("/") ? rootPath : `${rootPath}/`;
  return pathToCheck.startsWith(normalizedRoot);
}

export function countSearchMatches(content: string, query: string) {
  const term = query.trim();
  if (!term) return 0;

  let count = 0;
  let index = 0;
  const haystack = content.toLowerCase();
  const needle = term.toLowerCase();

  while (index <= haystack.length) {
    const found = haystack.indexOf(needle, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(needle.length, 1);
  }

  return count;
}
