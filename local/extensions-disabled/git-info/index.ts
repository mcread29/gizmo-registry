import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  emptyGitInfoState,
  GIT_INFO_CHANNEL,
  REFRESH_CHANNEL,
  type PullRequestInfo,
} from "../shared/dashboard-state.ts";
import {
  createDeclarativeView,
  supportsDeclarativeUi,
  type DeclarativeBlock,
} from "../../packages/pi-declarative-ui/src/index.ts";
import {
  loadChangedFiles,
  showChangedFiles,
  type ChangedFile,
} from "./changed-files-view.ts";

const POLL_INTERVAL_MS = 15_000;
// Once a directory is known to be outside a git repository, stop probing it
// every tick; re-check at this slower rate in case the session cd's into a repo.
const NOT_A_REPO_BACKOFF_MS = 60_000;
const GIT_TIMEOUT_MS = 3_000;
const GH_TIMEOUT_MS = 10_000;
const DECLARATIVE_DIFF_MAX_CHARS = 28 * 1024;
const DECLARATIVE_DIFF_MAX_LINES = 500;

function countChangedFiles(status: string) {
  if (!status.trim()) return 0;
  return status.split("\n").filter(Boolean).length;
}

function parsePullRequest(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  if (!("number" in value) || typeof value.number !== "number") return null;
  if (!("url" in value) || typeof value.url !== "string") return null;
  if (!("state" in value) || value.state !== "OPEN") return null;

  return {
    number: value.number,
    url: value.url,
    isDraft: "isDraft" in value && value.isDraft === true,
  } satisfies PullRequestInfo;
}

export default function gitInfo(pi: ExtensionAPI) {
  let state = emptyGitInfoState();
  let interval: ReturnType<typeof setInterval> | undefined;
  let currentContext: ExtensionContext | undefined;
  let generation = 0;
  let refreshing = false;
  let queriedPrBranch: string | null = null;
  let notARepoSince = 0;
  let changedFilesView: ReturnType<typeof createDeclarativeView> | undefined;
  let declarativeFiles: ChangedFile[] = [];
  let selectedPath: string | undefined;

  const selectedFile = () =>
    declarativeFiles.find((file) => file.path === selectedPath) ??
    declarativeFiles[0];
  const fileItemId = (file: ChangedFile) =>
    `file-${declarativeFiles.indexOf(file) + 1}`;

  const boundedDiff = (file: ChangedFile) => {
    const lines = file.diff.slice(0, DECLARATIVE_DIFF_MAX_LINES);
    let text = lines.join("\n");
    let truncated = file.diff.length > lines.length;
    if (text.length > DECLARATIVE_DIFF_MAX_CHARS) {
      text = text.slice(0, DECLARATIVE_DIFF_MAX_CHARS);
      truncated = true;
    }
    return { text, truncated };
  };

  const declarativeBlocks = (): DeclarativeBlock[] => {
    const file = selectedFile();
    const diff = file ? boundedDiff(file) : undefined;
    return [
      ...(declarativeFiles.length === 0
        ? [
            {
              type: "text" as const,
              text: "The working tree is clean.",
              tone: "success" as const,
            },
          ]
        : []),
      {
        type: "table",
        id: "changed-files",
        columns: [
          { id: "path", label: "Path" },
          { id: "status", label: "Status" },
          { id: "changes", label: "Changes", align: "end" },
        ],
        rows: declarativeFiles.map((changed) => ({
          id: fileItemId(changed),
          path: changed.path,
          cells: {
            path: changed.path,
            status: changed.status,
            changes:
              changed.additions === null || changed.deletions === null
                ? "binary"
                : `+${changed.additions} −${changed.deletions}`,
          },
          tone: changed.status === "??" ? "info" : "default",
        })),
        ...(file ? { selectedId: fileItemId(file) } : {}),
      },
      ...(file
        ? [
            {
              type: "keyValue" as const,
              entries: [
                { label: "Path", value: file.path },
                { label: "Status", value: file.status },
                {
                  label: "Changes",
                  value:
                    file.additions === null || file.deletions === null
                      ? "Binary"
                      : `+${file.additions} −${file.deletions}`,
                },
              ],
            },
            {
              type: "code" as const,
              code: diff?.text || "No textual diff available.",
              language: "diff",
              label: "Working-tree diff",
            },
            ...(diff?.truncated
              ? [
                  {
                    type: "text" as const,
                    text: "Diff preview truncated. Open the diff inspector for the complete repository view.",
                    tone: "warning" as const,
                  },
                ]
              : []),
          ]
        : []),
    ];
  };

  const publishChangedFiles = () => {
    if (!changedFilesView) return;
    changedFilesView.update({
      title: "Local changes",
      status: "idle",
      blocks: declarativeBlocks(),
      actions: [
        {
          id: "show-diff",
          label: "Show diff",
          tone: "primary",
          selection: { blockId: "changed-files", required: true },
          disabled: declarativeFiles.length === 0,
        },
        { id: "refresh", label: "Refresh" },
        {
          id: "open-file",
          label: "Open file",
          selection: { blockId: "changed-files", required: true },
          disabled: declarativeFiles.length === 0,
          intent: {
            kind: "openRepositoryFile",
            target: { kind: "selection", blockId: "changed-files" },
          },
        },
        {
          id: "open-diff",
          label: "Open diff",
          selection: { blockId: "changed-files", required: true },
          disabled: declarativeFiles.length === 0,
          intent: {
            kind: "openRepositoryDiff",
            target: { kind: "selection", blockId: "changed-files" },
          },
        },
        { id: "close", label: "Close" },
      ],
    });
  };

  const closeChangedFilesView = () => {
    changedFilesView?.close();
    changedFilesView = undefined;
    declarativeFiles = [];
    selectedPath = undefined;
  };

  const loadDeclarativeFiles = async (ctx: ExtensionContext) => {
    const files = await loadChangedFiles(pi, ctx);
    declarativeFiles = files ?? [];
    if (!declarativeFiles.some((file) => file.path === selectedPath)) {
      selectedPath = declarativeFiles[0]?.path;
    }
    publishChangedFiles();
  };

  const openChangedFilesView = async (ctx: ExtensionContext) => {
    closeChangedFilesView();
    currentContext = ctx;
    changedFilesView = createDeclarativeView(pi, ctx, {
      extensionId: "forker.git-info",
      viewId: "changed-files",
    });
    changedFilesView.onAction("show-diff", ({ selection }) => {
      const selected = selection
        ? declarativeFiles.find((file) => fileItemId(file) === selection.itemId)
        : undefined;
      if (selected) selectedPath = selected.path;
      publishChangedFiles();
    });
    changedFilesView.onAction("refresh", () => loadDeclarativeFiles(ctx));
    changedFilesView.onAction("close", closeChangedFilesView);
    await loadDeclarativeFiles(ctx);
  };

  const publish = () => pi.events.emit(GIT_INFO_CHANNEL, { ...state });

  async function run(
    command: string,
    args: string[],
    ctx: ExtensionContext,
    timeout: number,
  ) {
    return pi.exec(command, args, { cwd: ctx.cwd, timeout });
  }

  async function lookupPullRequest(ctx: ExtensionContext, branch: string) {
    const result = await run(
      "gh",
      ["pr", "view", branch, "--json", "number,url,state,isDraft"],
      ctx,
      GH_TIMEOUT_MS,
    );
    if (result.code !== 0) return null;

    try {
      return parsePullRequest(JSON.parse(result.stdout));
    } catch {
      return null;
    }
  }

  async function refresh(ctx: ExtensionContext, forcePullRequest = false) {
    if (refreshing) return;
    refreshing = true;
    currentContext = ctx;
    const refreshGeneration = generation;

    try {
      const repo = await run(
        "git",
        ["rev-parse", "--is-inside-work-tree"],
        ctx,
        GIT_TIMEOUT_MS,
      );
      if (refreshGeneration !== generation) return;

      if (repo.code !== 0 || repo.stdout.trim() !== "true") {
        notARepoSince = Date.now();
        queriedPrBranch = null;
        state = emptyGitInfoState();
        publish();
        return;
      }
      notARepoSince = 0;

      const [branchResult, statusResult] = await Promise.all([
        run("git", ["branch", "--show-current"], ctx, GIT_TIMEOUT_MS),
        run(
          "git",
          ["status", "--porcelain=v1", "--untracked-files=all"],
          ctx,
          GIT_TIMEOUT_MS,
        ),
      ]);
      if (refreshGeneration !== generation) return;

      const branchName = branchResult.stdout.trim();
      // The short HEAD hash is only needed to label a detached state, so the
      // extra spawn is deferred until we actually know we're detached.
      let branch = branchName;
      if (!branchName) {
        const headResult = await run(
          "git",
          ["rev-parse", "--short", "HEAD"],
          ctx,
          GIT_TIMEOUT_MS,
        );
        if (refreshGeneration !== generation) return;
        const shortHead = headResult.stdout.trim();
        branch = shortHead ? `detached@${shortHead}` : "detached";
      }
      const branchChanged = branchName !== queriedPrBranch;

      state = {
        ...state,
        isRepository: true,
        branch,
        changedFiles:
          statusResult.code === 0 ? countChangedFiles(statusResult.stdout) : 0,
        pullRequest: branchChanged ? null : state.pullRequest,
      };
      publish();

      if (!branchName) {
        // queriedPrBranch is never "", so branchChanged already cleared pullRequest.
        queriedPrBranch = null;
        return;
      }

      if (forcePullRequest || branchChanged) {
        queriedPrBranch = branchName;
        const pullRequest = await lookupPullRequest(ctx, branchName);
        if (refreshGeneration !== generation) return;
        state = { ...state, pullRequest };
        publish();
      }
    } catch {
      // pi.exec can reject before producing an exit code when Windows fails to
      // spawn the process (for example while a session/runtime is switching).
      // Timer and fire-and-forget refreshes must absorb that rejection or Node
      // treats it as an uncaught exception and terminates the entire pi process.
      if (refreshGeneration === generation) {
        queriedPrBranch = null;
        state = emptyGitInfoState();
        publish();
      }
    } finally {
      refreshing = false;
    }
  }

  pi.events.on(REFRESH_CHANNEL, () => {
    if (currentContext) void refresh(currentContext);
  });

  pi.on("session_start", async (_event, ctx) => {
    generation += 1;
    queriedPrBranch = null;
    if (interval) clearInterval(interval);

    await refresh(ctx);
    interval = setInterval(() => {
      if (!currentContext) return;
      if (notARepoSince && Date.now() - notARepoSince < NOT_A_REPO_BACKOFF_MS) {
        return;
      }
      void refresh(currentContext);
    }, POLL_INTERVAL_MS);
  });

  pi.on("input", (_event, ctx) => {
    void refresh(ctx);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    void refresh(ctx);
  });

  pi.on("session_shutdown", () => {
    generation += 1;
    closeChangedFilesView();
    currentContext = undefined;
    if (interval) {
      clearInterval(interval);
      interval = undefined;
    }
  });

  pi.registerCommand("lg", {
    description: "Browse changed files and their diffs",
    handler: async (_args, ctx) => {
      if (supportsDeclarativeUi(ctx)) {
        await openChangedFilesView(ctx);
        return;
      }
      if (ctx.mode !== "tui") {
        ctx.ui.notify(
          "The local changes viewer requires the interactive TUI or a declarative UI host",
          "warning",
        );
        return;
      }

      const files = await loadChangedFiles(pi, ctx);
      if (files === null) {
        ctx.ui.notify("Not a git repository", "warning");
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("Working tree is clean", "info");
        return;
      }

      await showChangedFiles(ctx, files);
    },
  });

  pi.registerCommand("pr", {
    description: "Refresh git and pull request information",
    handler: async (_args, ctx) => {
      await refresh(ctx, true);
      if (!state.isRepository) {
        ctx.ui.notify("Not a git repository", "warning");
      } else if (state.pullRequest) {
        ctx.ui.notify(
          `PR #${state.pullRequest.number}: ${state.pullRequest.url}`,
          "info",
        );
      } else {
        ctx.ui.notify(`No open PR found for ${state.branch}`, "info");
      }
    },
  });
}
