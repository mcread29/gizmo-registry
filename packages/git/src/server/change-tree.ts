import { createHash } from "node:crypto";
import type { GitFileStatus } from "./git-types";

export interface ChangeTreeNode {
  id: string;
  label: string;
  detail?: string;
  path?: string;
  tone?: "default" | "muted" | "info" | "success" | "warning" | "error";
  expanded?: boolean;
  children?: ChangeTreeNode[];
}

interface Folder {
  name: string;
  children: Map<string, Folder>;
  files: { name: string; file: GitFileStatus }[];
}

const statusLabels: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
  "?": "untracked",
  "!": "ignored",
};

export function statusDetail(file: GitFileStatus): string {
  const letter = file.workingTree.trim() || file.index.trim() || "?";
  const label = statusLabels[letter] ?? letter;
  const staged = file.index.trim() && file.index !== "?" ? " · staged" : "";
  const from = file.originalPath ? ` · from ${file.originalPath}` : "";
  return `${label}${staged}${from}`;
}

export function statusTone(file: GitFileStatus): ChangeTreeNode["tone"] {
  if (file.index === "U" || file.workingTree === "U") return "error";
  if (file.workingTree === "D" || file.index === "D") return "warning";
  if (file.index === "?") return "muted";
  return "default";
}

/**
 * Groups changed files into the folder hierarchy the old panel drew. Node
 * ids hash the path so refreshes never move a selection to another file.
 * A repository path is not a legal
 * view identifier; the real path travels in `path`, which is what the host's
 * `openFile`/`openDiff` intents read.
 */
export function changeTree(
  files: GitFileStatus[],
  idPrefix: string,
): ChangeTreeNode[] {
  const root: Folder = { name: "", children: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.replaceAll("\\", "/").split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) continue;
    let folder = root;
    for (const part of parts) {
      let next = folder.children.get(part);
      if (!next) {
        next = { name: part, children: new Map(), files: [] };
        folder.children.set(part, next);
      }
      folder = next;
    }
    folder.files.push({ name, file });
  }

  const id = (path: string) =>
    `${idPrefix}/${createHash("sha256").update(path).digest("hex")}`;
  const build = (folder: Folder, parent = ""): ChangeTreeNode[] => [
    ...[...folder.children.values()].sort(byName).map((child) => ({
      id: id(`${parent}${child.name}/`),
      label: child.name,
      expanded: true,
      children: build(child, `${parent}${child.name}/`),
    })),
    ...folder.files.sort(byName).map(({ name, file }) => ({
      id: id(file.path),
      label: name,
      detail: statusDetail(file),
      path: file.path,
      ...(statusTone(file) === "default" ? {} : { tone: statusTone(file) }),
    })),
  ];
  return build(root);
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
