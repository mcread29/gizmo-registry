import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitService } from "./git-service";

const execFileAsync = promisify(execFile);

describe("GitService", () => {
  let directory: string;
  const remotes: string[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "gizmo-git-"));
    await git(directory, ["init", "-b", "main"]);
    await git(directory, ["config", "user.name", "Gizmo Test"]);
    await git(directory, ["config", "user.email", "gizmo@example.test"]);
    await writeFile(join(directory, "tracked.txt"), "before\n");
    await git(directory, ["add", "--all"]);
    await git(directory, ["commit", "-m", "Initial commit"]);
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
    for (const remote of remotes) {
      await rm(remote, { recursive: true, force: true });
    }
    remotes.length = 0;
  });

  it("reports staged, unstaged, and untracked files", async () => {
    await writeFile(join(directory, "tracked.txt"), "after\n");
    await writeFile(join(directory, "new.txt"), "new\n");

    const status = await new GitService().status(directory);

    expect(status).toMatchObject({ branch: "main", clean: false });
    expect(status.files).toEqual(
      expect.arrayContaining([
        { path: "new.txt", index: "?", workingTree: "?" },
        { path: "tracked.txt", index: " ", workingTree: "M" },
      ]),
    );

    const result = await new GitService()
      .createStatusTool(directory)
      .execute("tool-1", {}, undefined, undefined, {} as never);
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("+after"),
    });
  });

  it("stages and unstages individual files", async () => {
    await writeFile(join(directory, "tracked.txt"), "after\n");
    await writeFile(join(directory, "other.txt"), "other\n");
    const service = new GitService();

    await service.stageFile(directory, "tracked.txt");
    expect(await service.status(directory)).toMatchObject({
      files: expect.arrayContaining([
        { path: "tracked.txt", index: "M", workingTree: " " },
        { path: "other.txt", index: "?", workingTree: "?" },
      ]),
    });

    await service.unstageFile(directory, "tracked.txt");
    expect(await service.status(directory)).toMatchObject({
      files: expect.arrayContaining([
        { path: "tracked.txt", index: " ", workingTree: "M" },
      ]),
    });
  });

  it("stages and commits the entire working tree", async () => {
    await writeFile(join(directory, "new.txt"), "new\n");
    const service = new GitService();

    const result = await service.commitAll(directory, "Add new file");

    expect(result.message).toBe("Add new file");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await service.status(directory)).clean).toBe(true);
  });

  it("reports an unpublished branch with no upstream", async () => {
    const state = await new GitService().pushState(directory);

    expect(state).toEqual({
      branch: "main",
      ahead: 0,
      behind: 0,
      hasCommits: true,
    });
  });

  it("publishes a branch and then tracks how far ahead it is", async () => {
    const remote = await mkdtemp(join(tmpdir(), "gizmo-git-remote-"));
    remotes.push(remote);
    await execFileAsync("git", ["init", "--bare", join(remote, "remote.git")]);
    await git(directory, [
      "remote",
      "add",
      "origin",
      join(remote, "remote.git"),
    ]);
    const service = new GitService();

    const published = await service.push(directory, { setUpstream: true });
    expect(published.branch).toBe("main");
    expect(published.setUpstream).toBe(true);

    const publishedState = await service.pushState(directory);
    expect(publishedState.upstream).toBe("origin/main");
    expect(publishedState).toMatchObject({ ahead: 0, behind: 0 });

    await writeFile(join(directory, "tracked.txt"), "after\n");
    await service.commitAll(directory, "Second commit");
    expect(await service.pushState(directory)).toMatchObject({
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
    });

    const pushed = await service.push(directory);
    expect(pushed.setUpstream).toBe(false);
    expect(await service.pushState(directory)).toMatchObject({
      ahead: 0,
      behind: 0,
    });
  });

  it("surfaces git's own error when there is no remote to push to", async () => {
    const service = new GitService();

    await expect(service.push(directory)).rejects.toThrow(/origin|remote/i);
  });
});

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}
