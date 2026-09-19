/**
 * Git's Changes view as data: the working tree split into staged and
 * unstaged trees above the selected file's diff, with the verbs that act on
 * a file sitting on that file's own row. The host draws all of it.
 */

import type { Action, Block, View } from "@gizmo/extension-api";
import { changeTree, type ChangeGroup } from "./change-tree";
import type { GitFileStatus, GitStatus } from "./git-types";
import type { GitPushState } from "../push";

export interface ChangesState {
  status?: GitStatus;
  push?: GitPushState;
  selected?: string;
  diff?: { file: string; diff: string };
  error?: string;
  loading: boolean;
}

export const staged = (file: GitFileStatus) =>
  file.index !== " " && file.index !== "?";
export const unstaged = (file: GitFileStatus) =>
  file.workingTree !== " " || file.index === "?";

export const groupFiles = (
  files: GitFileStatus[],
  group: ChangeGroup,
): GitFileStatus[] => files.filter(group === "staged" ? staged : unstaged);

function pushSummary(push: GitPushState | undefined): string {
  if (!push) return "unknown";
  if (!push.hasCommits) return "no commits yet";
  if (!push.upstream) return "not published";
  const parts = [
    push.ahead ? `${push.ahead} ahead` : undefined,
    push.behind ? `${push.behind} behind` : undefined,
  ].filter(Boolean);
  return parts.length
    ? `${push.upstream} — ${parts.join(", ")}`
    : push.upstream;
}

/** Why the tree is empty, which is not always "nothing changed". */
function emptyMessage(state: ChangesState): string {
  if (state.status) return "The working tree is clean.";
  return state.loading
    ? "Reading the working tree…"
    : "No Git repository here.";
}

/** A group's files as a section wrapping its own tree, or nothing. */
function groupSection(
  state: ChangesState,
  group: ChangeGroup,
  title: string,
): Block[] {
  const files = groupFiles(state.status?.files ?? [], group);
  if (!files.length) return [];
  return [
    {
      type: "section",
      title: `${title} · ${files.length}`,
      blocks: [
        {
          type: "tree",
          id: group,
          nodes: changeTree(files, group, folderActions(group)),
          // Picking a file shows its diff below, so the view needs no
          // "show me" button of its own.
          onSelect: "show-diff",
          ...(state.selected?.startsWith(`${group}/`)
            ? { selectedId: state.selected }
            : {}),
        },
      ],
    },
  ];
}

function diffBlocks(state: ChangesState): Block[] {
  if (!state.diff)
    return [
      { type: "text", text: "Pick a file to read its diff.", tone: "muted" },
    ];
  if (!state.diff.diff.trim())
    return [
      { type: "text", text: "No textual diff for this file.", tone: "muted" },
    ];
  return [{ type: "diff", diff: state.diff.diff, file: state.diff.file }];
}

/**
 * The verbs a folder row carries: staging or reverting a directory means
 * everything beneath it, while opening one would have no file to open.
 */
function folderActions(group: ChangeGroup): string[] {
  return group === "staged" ? ["unstage"] : ["stage", "revert"];
}

/** The verbs that act on one row, drawn on that row. */
function rowActions(group: ChangeGroup): Action[] {
  const selection = { blockId: group, required: true } as const;
  const open: Action = {
    id: `${group}-open`,
    label: "Open file",
    icon: "file",
    placement: "item",
    selection,
    intent: { kind: "openFile", target: { kind: "selection", blockId: group } },
  };
  if (group === "staged")
    return [
      open,
      {
        id: "unstage",
        label: "Unstage",
        icon: "minus",
        placement: "item",
        selection,
      },
    ];
  return [
    open,
    { id: "stage", label: "Stage", icon: "plus", placement: "item", selection },
    {
      id: "revert",
      label: "Revert",
      icon: "corner-up-left",
      tone: "danger",
      placement: "item",
      selection,
      confirm: {
        title: "Revert changes",
        message:
          "Throw away every uncommitted change under this row? This cannot be undone.",
      },
    },
  ];
}

function toolbar(state: ChangesState): Action[] {
  const status = state.status;
  return [
    {
      id: "commit",
      label: "Commit all",
      icon: "git-commit",
      tone: "primary",
      disabled: !status || status.clean,
      input: {
        kind: "multiline",
        label: "Commit message",
        placeholder: "What changed, and why",
        required: true,
      },
    },
    {
      id: "push",
      label: state.push && !state.push.upstream ? "Publish branch" : "Push",
      icon: "upload",
      disabled: !state.push?.hasCommits,
      confirm: {
        title: "Push commits",
        message: "Publish this branch's commits to the remote?",
      },
    },
    {
      id: "refresh",
      label: "Refresh",
      icon: "refresh-cw",
      group: "secondary",
    },
  ];
}

const titles: Record<ChangeGroup, string> = {
  unstaged: "Unstaged",
  staged: "Staged",
};

export function renderChangesView(state: ChangesState): View {
  const files = state.status?.files ?? [];
  const blocks: Block[] = [];
  const actions = toolbar(state);
  if (state.error)
    blocks.push({ type: "text", text: state.error, tone: "error" });

  blocks.push({
    type: "keyValue",
    entries: [
      { label: "Branch", value: state.status?.branch ?? "unknown" },
      { label: "Upstream", value: pushSummary(state.push) },
    ],
  });

  const groups: Block[] = [];
  for (const group of ["unstaged", "staged"] as const) {
    const section = groupSection(state, group, titles[group]);
    if (!section.length) continue;
    groups.push(...section);
    actions.push(...rowActions(group));
  }

  if (groups.length) {
    blocks.push({
      type: "split",
      direction: "vertical",
      panes: [
        { blocks: groups, grow: 2 },
        { blocks: diffBlocks(state), grow: 3 },
      ],
    });
    // Named by every tree's `onSelect`, which is how the diff pane follows
    // the selection; the host keeps it out of the action bar.
    actions.push({ id: "show-diff", label: "Show diff" });
  } else {
    blocks.push({ type: "text", text: emptyMessage(state), tone: "muted" });
  }

  return {
    title: "Changes",
    status: state.error ? "error" : state.loading ? "running" : "idle",
    ...(files.length
      ? { badge: files.length, badgeTone: "accent" as const }
      : {}),
    blocks,
    actions,
  };
}
