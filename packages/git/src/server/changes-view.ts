/**
 * Git's Changes view: the working tree as a tree of staged and unstaged
 * files, the selected file's diff, and the actions the old browser panel
 * offered — stage, unstage, revert, commit, push, refresh. All of it is
 * data; the host renders it.
 */

import type {
  ActionEvent,
  ActionResult,
  Block,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import { changeTree, type ChangeTreeNode } from "./change-tree";
import type { GitService } from "./git-service";
import type { GitFileStatus, GitStatus } from "./git-types";
import type { GitPushState } from "../push";

const POLL_MS = 3_000;
const treeBlockId = "changes";

export interface ChangesState {
  status?: GitStatus;
  push?: GitPushState;
  selected?: string;
  diff?: { file: string; diff: string };
  error?: string;
  loading: boolean;
}

const staged = (file: GitFileStatus) =>
  file.index !== " " && file.index !== "?";
const unstaged = (file: GitFileStatus) =>
  file.workingTree !== " " || file.index === "?";

function pushSummary(push: GitPushState | undefined): string {
  if (!push) return "unknown";
  if (!push.hasCommits) return "no commits yet";
  if (!push.upstream) return "not published";
  const parts = [
    push.ahead ? `${push.ahead} ahead` : undefined,
    push.behind ? `${push.behind} behind` : undefined,
  ].filter(Boolean);
  return parts.length ? `${push.upstream} — ${parts.join(", ")}` : push.upstream;
}

export function renderChangesView(state: ChangesState): View {
  const status = state.status;
  const files = status?.files ?? [];
  const blocks: Block[] = [];
  const actions: NonNullable<View["actions"]> = [
    { id: "refresh", label: "Refresh" },
  ];

  if (state.error) blocks.push({ type: "text", text: state.error, tone: "error" });

  blocks.push({
    type: "keyValue",
    entries: [
      { label: "Branch", value: status?.branch ?? "unknown" },
      { label: "Upstream", value: pushSummary(state.push) },
      {
        label: "Changes",
        value: status ? (status.clean ? "clean" : `${files.length} files`) : "—",
        tone: status?.clean ? "success" : "info",
      },
    ],
  });

  const groups: { label: string; files: GitFileStatus[]; prefix: string }[] = [
    { label: "Unstaged", files: files.filter(unstaged), prefix: "unstaged" },
    { label: "Staged", files: files.filter(staged), prefix: "staged" },
  ];
  const nodes: ChangeTreeNode[] = groups
    .filter((group) => group.files.length > 0)
    .map((group) => ({
      id: group.prefix,
      label: `${group.label} (${group.files.length})`,
      expanded: true,
      children: changeTree(group.files, group.prefix),
    }));

  blocks.push({
    type: "tree",
    id: treeBlockId,
    nodes,
    ...(state.selected ? { selectedId: state.selected } : {}),
    empty: status
      ? "The working tree is clean."
      : state.loading
        ? "Reading the working tree…"
        : "No Git repository here.",
  });

  if (state.diff) {
    blocks.push({
      type: "section",
      title: state.diff.file,
      blocks: state.diff.diff.trim()
        ? [{ type: "diff", diff: state.diff.diff, file: state.diff.file }]
        : [{ type: "text", text: "No textual diff for this file.", tone: "muted" }],
    });
  }

  const selection = { blockId: treeBlockId, required: true } as const;
  actions.push(
    {
      id: "open",
      label: "Open file",
      selection,
      intent: { kind: "openFile", target: { kind: "selection", blockId: treeBlockId } },
    },
    {
      id: "open-diff",
      label: "Open diff",
      selection,
      intent: { kind: "openDiff", target: { kind: "selection", blockId: treeBlockId } },
    },
    { id: "show-diff", label: "Show diff here", selection },
    { id: "stage", label: "Stage", selection },
    { id: "unstage", label: "Unstage", selection },
    {
      id: "revert",
      label: "Revert",
      tone: "danger",
      selection,
      confirm: {
        title: "Revert file",
        message:
          "Throw away every uncommitted change to this file? This cannot be undone.",
      },
    },
    {
      id: "commit",
      label: "Commit all",
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
      disabled: !state.push?.hasCommits,
      confirm: {
        title: "Push commits",
        message: "Publish this branch's commits to the remote?",
      },
    },
  );

  return {
    title: "Changes",
    status: state.error ? "error" : state.loading ? "running" : "idle",
    ...(files.length ? { badge: files.length, badgeTone: "accent" as const } : {}),
    blocks,
    actions,
  };
}

/** The path a selected tree node stands for, or undefined for a folder. */
function selectedPath(state: ChangesState, itemId: string | undefined): string | undefined {
  if (!itemId) return undefined;
  const files = state.status?.files ?? [];
  const groups: [string, GitFileStatus[]][] = [
    ["unstaged", files.filter(unstaged)],
    ["staged", files.filter(staged)],
  ];
  for (const [prefix, groupFiles] of groups) {
    if (!itemId.startsWith(`${prefix}/`)) continue;
    const found = find(changeTree(groupFiles, prefix), itemId);
    if (found) return found;
  }
  return undefined;
}

function find(nodes: ChangeTreeNode[], id: string): string | undefined {
  for (const node of nodes) {
    if (node.id === id) return node.path;
    const child = node.children && find(node.children, id);
    if (child) return child;
  }
  return undefined;
}

export function openChangesView(
  service: GitService,
  context: ViewContext,
): ViewHandle {
  const state: ChangesState = { loading: true };
  let disposed = false;

  const push = () => {
    if (!disposed) context.update(renderChangesView(state));
  };

  async function refresh(): Promise<void> {
    try {
      state.status = await service.status(context.workspacePath);
      try {
        state.push = await service.pushState(context.workspacePath);
      } catch {
        // A repository without a remote still shows its changes.
        state.push = undefined;
      }
      if (state.diff) {
        const file = state.diff.file;
        state.diff = state.status.files.some((entry) => entry.path === file)
          ? await service.diff(context.workspacePath, file)
          : undefined;
      }
      state.error = undefined;
    } catch (error) {
      state.status = undefined;
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      push();
    }
  }

  const timer = setInterval(() => void refresh(), POLL_MS);
  timer.unref?.();
  push();
  void refresh();

  async function action(event: ActionEvent): Promise<ActionResult> {
    if (event.cancelled) return { status: "rejected" };
    const path = selectedPath(state, event.selection?.itemId);
    try {
      switch (event.actionId) {
        case "refresh":
          await refresh();
          return { status: "succeeded" };
        case "show-diff": {
          if (!path) return { status: "failed", message: "Select a file" };
          state.selected = event.selection?.itemId;
          state.diff = await service.diff(context.workspacePath, path);
          push();
          return { status: "succeeded" };
        }
        case "stage":
        case "unstage": {
          if (!path) return { status: "failed", message: "Select a file" };
          if (event.actionId === "stage") {
            await service.stageFile(context.workspacePath, path);
          } else {
            await service.unstageFile(context.workspacePath, path);
          }
          await refresh();
          return { status: "succeeded" };
        }
        case "revert": {
          if (!path) return { status: "failed", message: "Select a file" };
          await service.discardFile(context.workspacePath, path);
          if (state.diff?.file === path) state.diff = undefined;
          await refresh();
          return { status: "succeeded", message: `Reverted ${path}` };
        }
        case "commit": {
          const message = event.value?.trim();
          if (!message) return { status: "failed", message: "Write a commit message" };
          const result = await service.commitAll(context.workspacePath, message);
          await refresh();
          return {
            status: "succeeded",
            message: `Committed ${result.commit.slice(0, 7)}`,
          };
        }
        case "push": {
          const publishing = !state.push?.upstream;
          const result = await service.push(context.workspacePath, {
            setUpstream: publishing,
          });
          await refresh();
          return {
            status: "succeeded",
            message: publishing
              ? `Published ${result.branch} to origin`
              : `Pushed ${result.branch}`,
          };
        }
        default:
          return { status: "failed", message: "Unknown action" };
      }
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    action,
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}
