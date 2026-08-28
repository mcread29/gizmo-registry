import type { ChangedFile } from "./thread-changes";

export interface ChangeFolderNode {
  kind: "folder";
  name: string;
  path: string;
  children: ChangeTreeNode[];
}

export interface ChangeFileNode {
  kind: "file";
  name: string;
  path: string;
  entry: ChangedFile;
}

export type ChangeTreeNode = ChangeFolderNode | ChangeFileNode;

export interface ChangeTreeRow {
  node: ChangeTreeNode;
  depth: number;
}

/** Builds the visible project-relative hierarchy without duplicating folders. */
export function changeTree(
  files: ChangedFile[],
  projectPath?: string,
): ChangeTreeNode[] {
  const root: ChangeFolderNode = {
    kind: "folder",
    name: "",
    path: "",
    children: [],
  };
  for (const entry of files) {
    const parts = relativeFile(entry.file, projectPath)
      .split("/")
      .filter(Boolean);
    if (!parts.length) continue;
    let parent = root;
    for (const [index, part] of parts.entries()) {
      const path = parts.slice(0, index + 1).join("/");
      if (index === parts.length - 1) {
        parent.children.push({ kind: "file", name: part, path, entry });
        continue;
      }
      let folder = parent.children.find(
        (node): node is ChangeFolderNode =>
          node.kind === "folder" && node.name === part,
      );
      if (!folder) {
        folder = { kind: "folder", name: part, path, children: [] };
        parent.children.push(folder);
      }
      parent = folder;
    }
  }
  sortNodes(root.children);
  return root.children;
}

export function changeTreeRows(
  nodes: ChangeTreeNode[],
  collapsed: ReadonlySet<string> = new Set(),
): ChangeTreeRow[] {
  const rows: ChangeTreeRow[] = [];
  const walk = (children: ChangeTreeNode[], depth: number) => {
    for (const node of children) {
      rows.push({ node, depth });
      if (node.kind === "folder" && !collapsed.has(node.path)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(nodes, 0);
  return rows;
}

function relativeFile(file: string, projectPath?: string): string {
  const normalized = file.replaceAll("\\", "/");
  const project = projectPath?.replaceAll("\\", "/").replace(/\/$/, "");
  if (project && normalized.startsWith(`${project}/`)) {
    return normalized.slice(project.length + 1);
  }
  return normalized.replace(/^\.\//, "").replace(/^\//, "");
}

function sortNodes(nodes: ChangeTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
  for (const node of nodes) {
    if (node.kind === "folder") sortNodes(node.children);
  }
}
