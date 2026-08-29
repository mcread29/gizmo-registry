import { GitCommit, RefreshCw } from "@lucide/svelte";
import type { Component } from "svelte";
import { toasts } from "@gizmo/ui";
import ChangesPanel from "./ChangesPanel.svelte";
import type { GitHostStore } from "./host";

/**
 * A tab a web extension contributes to the workspace inspector. Mirrors the
 * app's `InspectorTabContribution`; kept local so the package never imports
 * the app.
 */
export interface GitInspectorTab {
  id: string;
  label: string;
  badge?: number;
  component: Component<any>;
  props: Record<string, unknown>;
}

/** Mirrors the app's `CommandContribution`; kept local so the package never imports the app. */
export interface GitCommand {
  id: string;
  label: string;
  keywords?: string[];
  icon?: Component;
  run(): void;
}

/** Mirrors the app's `StatusBarContribution`; kept local so the package never imports the app. */
export interface GitStatusBarItem {
  id: string;
  label: string;
  tone?: "default" | "accent" | "danger";
}

export interface GitCommandStore extends GitHostStore {
  selectedProjectPath?: string;
  invokeProjectExtension(
    projectPath: string,
    extensionId: string,
    operation: string,
    input?: unknown,
  ): Promise<unknown>;
}

async function commitAll(store: GitHostStore): Promise<void> {
  try {
    const message = await store.generateCommitMessage();
    const result = await store.commitAll(message);
    toasts.show(`Committed ${result.commit.slice(0, 7)}`);
  } catch (error) {
    toasts.show(
      error instanceof Error ? error.message : String(error),
      "danger",
    );
  }
}

async function refreshGitStatus(store: GitHostStore): Promise<void> {
  try {
    await store.refreshGitStatus();
  } catch (error) {
    toasts.show(
      error instanceof Error ? error.message : String(error),
      "danger",
    );
  }
}

/** Git's single entry point into Gizmo's generic web extension contract. */
export { patchFileName } from "./thread-changes";
export const gizmoWebExtension = {
  id: "git",
  name: "Git",
  inspectorTabs(context: {
    store: GitCommandStore;
    projectPath?: string;
  }): GitInspectorTab[] {
    const updateStage = async (
      operation: "stage" | "unstage",
      path: string,
    ) => {
      if (!context.projectPath) throw new Error("No project selected");
      await context.store.invokeProjectExtension(
        context.projectPath,
        "git",
        operation,
        { path },
      );
      await context.store.refreshGitStatus();
    };
    return [
      {
        id: "git",
        label: "Git",
        badge: context.store.gitStatus?.files.length ?? 0,
        component: ChangesPanel as Component<any>,
        props: {
          stageFile: (path: string) => updateStage("stage", path),
          unstageFile: (path: string) => updateStage("unstage", path),
        },
      },
    ];
  },
  statusBar(context: { store: GitHostStore }): GitStatusBarItem[] {
    const status = context.store.gitStatus;
    if (!status) return [];
    return [
      {
        id: "git.branch",
        label: status.clean
          ? status.branch
          : `${status.branch} (${status.files.length})`,
        tone: status.clean ? "default" : "accent",
      },
    ];
  },
  commands(context: { store: GitCommandStore }): GitCommand[] {
    const { store } = context;
    if (!store.selectedProjectPath) return [];
    return [
      {
        id: "git.commit-all",
        label: "Commit all changes",
        keywords: ["git", "commit"],
        icon: GitCommit,
        run: () => void commitAll(store),
      },
      {
        id: "git.refresh-status",
        label: "Refresh Git status",
        keywords: ["git"],
        icon: RefreshCw,
        run: () => void refreshGitStatus(store),
      },
    ];
  },
};
