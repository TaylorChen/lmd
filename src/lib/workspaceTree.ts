import type { WorkspaceFile } from "../types";

export type WorkspaceTreeNode =
  | { kind: "folder"; name: string; relativePath: string; children: WorkspaceTreeNode[] }
  | { kind: "file"; file: WorkspaceFile; relativePath: string };

export type VisibleWorkspaceTreeNode = {
  node: WorkspaceTreeNode;
  depth: number;
  parentPath: string | null;
};

type MutableFolderNode = Extract<WorkspaceTreeNode, { kind: "folder" }>;

function createFolder(name: string, relativePath: string): MutableFolderNode {
  return { kind: "folder", name, relativePath, children: [] };
}

function sortNodes(nodes: WorkspaceTreeNode[]) {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    const leftName = left.kind === "folder" ? left.name : left.file.name;
    const rightName = right.kind === "folder" ? right.name : right.file.name;
    return leftName.localeCompare(rightName);
  });
  for (const node of nodes) {
    if (node.kind === "folder") sortNodes(node.children);
  }
}

export function buildWorkspaceTree(files: WorkspaceFile[]): WorkspaceTreeNode[] {
  const root = createFolder("", "");
  const folders = new Map<string, MutableFolderNode>([["", root]]);

  for (const file of files) {
    const parts = file.relativePath.split("/").filter(Boolean);
    if (parts.length === 0) continue;

    let parent = root;
    let currentPath = "";
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let folder = folders.get(currentPath);
      if (!folder) {
        folder = createFolder(part, currentPath);
        folders.set(currentPath, folder);
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ kind: "file", file, relativePath: file.relativePath });
  }

  sortNodes(root.children);
  return root.children;
}

export function visibleWorkspaceTreeNodes(
  nodes: WorkspaceTreeNode[],
  expandedPaths: Set<string>,
): VisibleWorkspaceTreeNode[] {
  const visible: VisibleWorkspaceTreeNode[] = [];
  const visit = (children: WorkspaceTreeNode[], depth: number, parentPath: string | null) => {
    for (const node of children) {
      visible.push({ node, depth, parentPath });
      if (node.kind === "folder" && expandedPaths.has(node.relativePath)) {
        visit(node.children, depth + 1, node.relativePath);
      }
    }
  };

  visit(nodes, 0, null);
  return visible;
}

export function ancestorFolderPaths(relativePath: string): string[] {
  const parts = relativePath.split("/").filter(Boolean);
  const paths: string[] = [];
  let currentPath = "";
  for (const part of parts.slice(0, -1)) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    paths.push(currentPath);
  }
  return paths;
}
