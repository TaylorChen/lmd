import type { DropPathInfo } from "../types";

export type DropPlan = {
  workspacePath: string | null;
  markdownPaths: string[];
  extraFolderPaths: string[];
  unsupportedPaths: string[];
};

export function classifyDropPaths(items: DropPathInfo[]): DropPlan {
  const plan: DropPlan = {
    workspacePath: null,
    markdownPaths: [],
    extraFolderPaths: [],
    unsupportedPaths: [],
  };

  for (const item of items) {
    if (item.kind === "markdown") {
      plan.markdownPaths.push(item.path);
    } else if (item.kind === "directory" && !plan.workspacePath) {
      plan.workspacePath = item.path;
    } else if (item.kind === "directory") {
      plan.extraFolderPaths.push(item.path);
    } else {
      plan.unsupportedPaths.push(item.path);
    }
  }

  return plan;
}

export function dropOverlayMessage(plan: DropPlan) {
  if (plan.workspacePath && plan.markdownPaths.length > 0) {
    return `打开工作区和 ${plan.markdownPaths.length.toLocaleString()} 个 Markdown 文件`;
  }
  if (plan.workspacePath) {
    const name = plan.workspacePath.split(/[\\/]/).filter(Boolean).pop() ?? plan.workspacePath;
    return `将 ${name} 作为工作区打开`;
  }
  if (plan.markdownPaths.length > 0) {
    return `打开 ${plan.markdownPaths.length.toLocaleString()} 个 Markdown 文件`;
  }
  return "检查拖入的文件";
}
