import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readGitOutput } from "./git-output";
import type { GitCommitResult, GitFileStatus, GitStatus } from "./git-types";
import { isJournalPath, underPath } from "./paths";
import type { GitPushResult, GitPushState } from "../push";

const execFileAsync = promisify(execFile);
const maxGitOutput = 4 * 1024 * 1024;
const maxPromptDiff = 60_000;

export class GitService {
  async status(projectPath: string, signal?: AbortSignal): Promise<GitStatus> {
    const rootPath = await this.#root(projectPath, signal);
    const [{ stdout: porcelain }, branch] = await Promise.all([
      this.#git(
        rootPath,
        ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        signal,
      ),
      this.#branch(rootPath, signal),
    ]);
    const files = parsePorcelain(porcelain).filter(
      (file) => !isJournalPath(file.path),
    );
    return { rootPath, branch, clean: files.length === 0, files };
  }

  async diff(projectPath: string, file: string, signal?: AbortSignal) {
    const rootPath = await this.#root(projectPath, signal);
    const tracked = await readGitOutput(
      rootPath,
      ["diff", "HEAD", "--no-ext-diff", "--unified=3", "--", file],
      maxGitOutput,
      { signal },
    );
    // An untracked file is in no diff git can take against HEAD, so rather
    // than show the reader nothing, read it as one long addition.
    const output = tracked.text.trim()
      ? tracked
      : await this.#addedDiff(rootPath, file, signal);
    return { file, diff: markTruncated(output) };
  }

  /**
   * `--no-index` compares two paths without consulting the index, so a file
   * against `/dev/null` reads as the whole of it added. It exits 1 when the
   * two differ, which is the ordinary case here rather than a failure, and
   * the diff it printed is on stdout either way.
   */
  async #addedDiff(rootPath: string, file: string, signal?: AbortSignal) {
    const args = [
      "--literal-pathspecs",
      "diff",
      "--no-index",
      "--no-ext-diff",
      "--unified=3",
      "--",
      "/dev/null",
      file,
    ];
    return readGitOutput(rootPath, args, maxGitOutput, {
      signal,
      acceptExitCodes: [1],
    });
  }

  async commitContext(
    projectPath: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const status = await this.status(projectPath, signal);
    if (status.clean) throw new Error("There are no changes to commit");
    // The diffs are scoped to the files the status kept, which is how the
    // journal stays out of them: pathspecs are literal here, so exclusion
    // magic is not available and listing the paths is the one way left.
    const paths = status.files.flatMap((file) =>
      file.originalPath ? [file.originalPath, file.path] : [file.path],
    );
    // Only the first `maxPromptDiff` characters reach the model, so git is
    // read no further than that: a tree with megabytes of changes must
    // not fail the call, it just gets cut where it would have been anyway.
    const read = (args: string[]) =>
      readGitOutput(status.rootPath, [...args, "--", ...paths], maxPromptDiff, {
        signal,
      });
    const [staged, unstaged, stat] = await Promise.all([
      read(["diff", "--cached", "--no-ext-diff", "--unified=2"]),
      read(["diff", "--no-ext-diff", "--unified=2"]),
      read(["diff", "HEAD", "--stat"]),
    ]);
    const fileList = status.files
      .map((file) => `${file.index}${file.workingTree} ${file.path}`)
      .join("\n");
    return [
      `Branch: ${status.branch}`,
      `Files:\n${fileList}`,
      `Stat:\n${markTruncated(stat).trim() || "(untracked files only)"}`,
      `Staged diff:\n${markTruncated(staged).trim() || "(none)"}`,
      `Unstaged diff:\n${markTruncated(unstaged).trim() || "(none)"}`,
    ]
      .join("\n\n")
      .slice(0, maxPromptDiff);
  }

  /**
   * What a push would do: whether the branch is published, and how far it
   * sits ahead of or behind its upstream. Unpublished and empty repositories
   * are legal states, not errors.
   */
  async pushState(
    projectPath: string,
    signal?: AbortSignal,
  ): Promise<GitPushState> {
    const rootPath = await this.#root(projectPath, signal);
    const branch = await this.#branch(rootPath, signal);
    const upstream = await this.#upstream(rootPath, signal);
    const hasCommits = await this.#hasCommits(rootPath, signal);
    let ahead = 0;
    let behind = 0;
    if (upstream && hasCommits) {
      // Left side is HEAD-only (ahead), right side is upstream-only (behind).
      const { stdout } = await this.#git(
        rootPath,
        ["rev-list", "--left-right", "--count", `HEAD...@{upstream}`],
        signal,
      );
      const [left, right] = stdout.trim().split(/\s+/);
      ahead = Number.parseInt(left ?? "0", 10) || 0;
      behind = Number.parseInt(right ?? "0", 10) || 0;
    }
    return {
      branch,
      ...(upstream ? { upstream } : {}),
      ahead,
      behind,
      hasCommits,
    };
  }

  /**
   * Pushes the current branch. Never force-pushes: a rejected push stays
   * rejected so the user decides what to do about it.
   */
  async push(
    projectPath: string,
    options: { setUpstream?: boolean } = {},
  ): Promise<GitPushResult> {
    const rootPath = await this.#root(projectPath);
    const branch = await this.#branch(rootPath);
    const setUpstream = options.setUpstream === true;
    const args = setUpstream
      ? ["push", "--set-upstream", "origin", branch]
      : ["push"];
    const { stdout, stderr } = await this.#git(rootPath, args);
    return { branch, setUpstream, output: (stderr || stdout).trim() };
  }

  async stageFile(projectPath: string, path: string): Promise<void> {
    const rootPath = await this.#root(projectPath);
    await this.#git(rootPath, ["add", "--", path]);
  }

  async unstageFile(projectPath: string, path: string): Promise<void> {
    const rootPath = await this.#root(projectPath);
    try {
      await this.#git(rootPath, ["reset", "--quiet", "HEAD", "--", path]);
    } catch {
      // An initial repository has no HEAD to reset to. Removing the path from
      // the index is the equivalent operation in that state.
      await this.#git(rootPath, ["rm", "--cached", "--quiet", "--", path]);
    }
  }

  /**
   * Throws away a file's uncommitted changes. A tracked file is restored
   * from HEAD (index and working tree both), an untracked one is deleted,
   * which is what "revert this change" means for a file git never saw.
   */
  /**
   * Throws away the uncommitted changes under a path. That path may be a
   * directory — the tree's folder rows act on everything beneath them — so
   * the work is done per changed file: a file git has never committed is
   * deleted, and one it has is restored from HEAD.
   */
  async discardFile(projectPath: string, path: string): Promise<void> {
    const rootPath = await this.#root(projectPath);
    const status = await this.status(rootPath);
    const files = status.files.filter((entry) => underPath(entry.path, path));
    if (!files.length) throw new Error("Select a changed file");

    const isNew = (file: GitFileStatus) =>
      file.index === "?" || file.index === "A";
    const added = files.filter((file) => isNew(file));
    const cached = added
      .filter((file) => file.index === "A")
      .map((file) => file.path);
    if (cached.length) {
      await this.#git(rootPath, ["rm", "--cached", "--force", "--", ...cached]);
    }
    for (const file of added) {
      await rm(resolve(rootPath, file.path), { force: true });
    }

    // A rename is discarded by restoring both names: the one HEAD knows and
    // the one the working tree invented.
    const restore = files
      .filter((file) => !isNew(file))
      .flatMap((file) =>
        file.originalPath ? [file.originalPath, file.path] : [file.path],
      );
    if (!restore.length) return;
    await this.#git(rootPath, [
      "restore",
      "--source=HEAD",
      "--staged",
      "--worktree",
      "--",
      ...restore,
    ]);
  }

  async commitAll(
    projectPath: string,
    message: string,
  ): Promise<GitCommitResult> {
    const cleanMessage = message.trim();
    if (!cleanMessage) throw new Error("Commit message cannot be empty");
    const rootPath = await this.#root(projectPath);
    await this.#git(rootPath, ["add", "--all"]);
    await this.#git(rootPath, ["commit", "-m", cleanMessage]);
    const { stdout } = await this.#git(rootPath, ["rev-parse", "HEAD"]);
    return { rootPath, commit: stdout.trim(), message: cleanMessage };
  }

  createStatusTool(projectPath: string) {
    return defineTool({
      name: "git_status",
      label: "Git status",
      description:
        "Inspect all staged, unstaged, and untracked files in the current project repository. Use this to understand which code changes are currently present.",
      promptSnippet: "Inspect the current Git working tree",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: async (_toolCallId, _params, signal) => {
        const details = await this.status(projectPath, signal);
        const text = details.clean
          ? JSON.stringify(details, null, 2)
          : await this.commitContext(projectPath, signal);
        return {
          content: [{ type: "text" as const, text }],
          details,
        };
      },
    });
  }

  async #root(projectPath: string, signal?: AbortSignal): Promise<string> {
    const { stdout } = await this.#git(
      projectPath,
      ["rev-parse", "--show-toplevel"],
      signal,
    );
    return stdout.trim();
  }

  async #branch(rootPath: string, signal?: AbortSignal): Promise<string> {
    try {
      const { stdout } = await this.#git(
        rootPath,
        ["symbolic-ref", "--short", "HEAD"],
        signal,
      );
      return stdout.trim();
    } catch {
      const { stdout } = await this.#git(
        rootPath,
        ["rev-parse", "--short", "HEAD"],
        signal,
      );
      return stdout.trim();
    }
  }

  async #upstream(
    rootPath: string,
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await this.#git(
        rootPath,
        ["rev-parse", "--abbrev-ref", "@{upstream}"],
        signal,
      );
      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  async #hasCommits(rootPath: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.#git(rootPath, ["rev-parse", "--verify", "HEAD"], signal);
      return true;
    } catch {
      return false;
    }
  }

  async #git(cwd: string, args: string[], signal?: AbortSignal) {
    try {
      return await execFileAsync("git", ["--literal-pathspecs", ...args], {
        cwd,
        encoding: "utf8",
        maxBuffer: maxGitOutput,
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      const stderr =
        typeof error === "object" && error && "stderr" in error
          ? String(error.stderr).trim()
          : "";
      throw new Error(
        stderr || (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/** The text, ending with a note when git had more than was read. */
function markTruncated(output: { text: string; truncated: boolean }): string {
  return output.truncated
    ? `${output.text}\n… (output truncated)\n`
    : output.text;
}

function parsePorcelain(output: string): GitFileStatus[] {
  const records = output.split("\0");
  const files: GitFileStatus[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index];
    if (!record) continue;
    const code = record.slice(0, 2);
    const path = record.slice(3);
    const renamed = code.includes("R") || code.includes("C");
    const originalPath = renamed ? records[++index] : undefined;
    files.push({
      path,
      index: code[0] ?? " ",
      workingTree: code[1] ?? " ",
      ...(originalPath ? { originalPath } : {}),
    });
  }
  return files;
}
