import { createHash } from "node:crypto";
import type { GitFileStatus } from "./git-types";

type Tone = "default" | "muted" | "info" | "success" | "warning" | "error";

export interface ChangeTreeNode {
  id: string;
  label: string;
  detail?: string;
  path?: string;
  tone?: Tone;
  actions?: string[];
  icon?: string;
  badge?: { text: string; tone?: Tone };
  expanded?: boolean;
  children?: ChangeTreeNode[];
}

/** Which half of the working tree a file is listed under. */
export type ChangeGroup = "unstaged" | "staged";

interface Folder {
  name: string;
  children: Map<string, Folder>;
  files: { name: string; file: GitFileStatus }[];
}

/**
 * The status letter that matters in a given group: the index column for a
 * staged row, the working-tree column for an unstaged one. An untracked file
 * has no letter of its own, so it keeps git's own `??`.
 */
export function statusLetter(file: GitFileStatus, group: ChangeGroup): string {
  if (file.index === "?") return "??";
  const letter = (group === "staged" ? file.index : file.workingTree).trim();
  return letter || "·";
}

const tones: Record<string, Tone> = {
  M: "info",
  A: "success",
  "??": "success",
  D: "warning",
  R: "info",
  C: "info",
  U: "error",
  "!": "muted",
};

export function statusTone(letter: string): Tone {
  return tones[letter] ?? "default";
}

const icons: Record<string, string> = {
  M: "file-diff",
  A: "file-plus",
  "??": "file-plus",
  D: "circle-x",
  R: "corner-up-left",
  C: "file-plus",
  U: "triangle-alert",
};

export function statusIcon(letter: string): string {
  return icons[letter] ?? "file";
}

/**
 * Groups changed files into the folder hierarchy the old panel drew. Node
 * ids hash the path so refreshes never move a selection to another file;
 * a folder's id keeps the trailing slash, so a directory and a file of the
 * same name are never the same row. `folderActions` names the verbs a folder
 * carries, which is fewer than a file's: a directory has nothing to open.
 * A repository path is not a legal view identifier; the real path travels in
 * `path`, which is what the host's `openFile` intent reads.
 */
export function changeTree(
  files: GitFileStatus[],
  group: ChangeGroup,
  folderActions?: string[],
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
    `${group}/${createHash("sha256").update(path).digest("hex")}`;
  const build = (folder: Folder, parent = ""): ChangeTreeNode[] => [
    ...[...folder.children.values()].sort(byName).map((child) => {
      const path = `${parent}${child.name}`;
      return {
        id: id(`${path}/`),
        label: child.name,
        // A folder row stands for the directory beneath it, so it carries
        // that path and the verbs that can take one.
        path,
        ...(folderActions?.length ? { actions: folderActions } : {}),
        expanded: true,
        children: build(child, `${path}/`),
      };
    }),
    ...folder.files.sort(byName).map(({ name, file }) => {
      const letter = statusLetter(file, group);
      return {
        id: id(file.path),
        label: name,
        // The badge says what changed, so the detail is left for the one
        // thing a letter cannot carry: where a renamed file came from.
        ...(file.originalPath ? { detail: `from ${file.originalPath}` } : {}),
        path: file.path,
        icon: statusIcon(letter),
        badge: { text: letter, tone: statusTone(letter) },
      };
    }),
  ];
  return build(root);
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}
