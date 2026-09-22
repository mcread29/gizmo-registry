/**
 * The live half of Git's Changes view: it polls the working tree, keeps the
 * state the renderer draws, and runs the verbs the user picks.
 */

import type {
  ActionEvent,
  ActionResult,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import {
  changeTree,
  type ChangeGroup,
  type ChangeTreeNode,
} from "./change-tree";
import {
  groupFiles,
  renderChangesView,
  type ChangesState,
} from "./changes-render";
import { suggestCommitMessage } from "./commit-message";
import type { GitService } from "./git-service";
import { underPath } from "./paths";

const POLL_MS = 3_000;

/** The row an action was run on, rebuilt from the state the view was drawn from. */
function selectedNode(
  state: ChangesState,
  itemId: string | undefined,
): ChangeTreeNode | undefined {
  if (!itemId) return undefined;
  const files = state.status?.files ?? [];
  for (const group of ["unstaged", "staged"] as ChangeGroup[]) {
    if (!itemId.startsWith(`${group}/`)) continue;
    const found = find(changeTree(groupFiles(files, group), group), itemId);
    if (found) return found;
  }
  return undefined;
}

function find(nodes: ChangeTreeNode[], id: string): ChangeTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
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
    const node = selectedNode(state, event.selection?.itemId);
    const path = node?.path;
    // A folder stands for the files under it: the verbs take it, the diff
    // pane does not, since a directory is not one file to read.
    const folder = Boolean(node?.children?.length);
    try {
      switch (event.actionId) {
        case "refresh":
          await refresh();
          return { status: "succeeded" };
        case "show-diff": {
          // Picking a folder opens it; the diff stays on the file it had.
          if (!path || folder) return { status: "succeeded" };
          state.selected = event.selection?.itemId;
          state.diff = await service.diff(context.workspacePath, path);
          push();
          return { status: "succeeded" };
        }
        case "stage":
        case "unstage": {
          if (!path) return { status: "failed", message: "Select a file" };
          // `git add`/`git reset` take a directory, so a folder row stages or
          // unstages everything beneath it in one call.
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
          // Nothing under a reverted path has a diff left to read.
          if (state.diff && underPath(state.diff.file, path))
            state.diff = undefined;
          await refresh();
          return { status: "succeeded", message: `Reverted ${path}` };
        }
        case "suggest": {
          state.suggesting = true;
          push();
          try {
            state.suggestion = await suggestCommitMessage(
              context,
              await service.commitContext(context.workspacePath),
            );
          } finally {
            state.suggesting = false;
            push();
          }
          return { status: "succeeded", message: "Commit message drafted" };
        }
        case "commit": {
          const message = event.value?.trim();
          if (!message)
            return { status: "failed", message: "Write a commit message" };
          const result = await service.commitAll(
            context.workspacePath,
            message,
          );
          state.suggestion = undefined;
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
