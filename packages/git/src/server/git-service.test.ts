import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    // Whatever this machine's global setting is, a checkout here has to come
    // back byte for byte or the assertions below are about line endings.
    await git(directory, ["config", "core.autocrlf", "false"]);
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

  it("summarises a working tree whose diff is larger than git's buffer", async () => {
    // Well past the 4 MB execFile cap the old implementation died on.
    await writeFile(
      join(directory, "tracked.txt"),
      `${"y".repeat(60)}\n`.repeat(90_000),
    );

    const service = new GitService();
    const context = await service.commitContext(directory);
    expect(context.length).toBeLessThanOrEqual(60_000);
    expect(context).toContain("Unstaged diff:");

    const { diff } = await service.diff(directory, "tracked.txt");
    expect(diff).toContain("+yyyy");
    expect(diff).toContain("(output truncated)");
    expect(diff.length).toBeLessThan(4 * 1024 * 1024 + 100);
  });

  it("keeps the memory journal out of the status and the diff", async () => {
    // A committed journal changes on every turn; an untracked one is noise.
    const journal = join(directory, ".gizmo", "memory", "journal");
    await mkdir(join(journal, "facts"), { recursive: true });
    await writeFile(join(journal, "2026-09-22.md"), "turn one\n");
    await git(directory, ["add", "--all"]);
    await git(directory, ["commit", "-m", "Add journal"]);
    await writeFile(join(journal, "2026-09-22.md"), "turn two\n");
    await writeFile(join(journal, "facts", "a.json"), "{}\n");
    await writeFile(join(directory, "tracked.txt"), "after\n");

    const service = new GitService();
    const status = await service.status(directory);
    expect(status.files.map((file) => file.path)).toEqual(["tracked.txt"]);

    const context = await service.commitContext(directory);
    expect(context).toContain("+after");
    expect(context).not.toContain("journal");
    expect(context).not.toContain("turn two");

    await writeFile(join(directory, "tracked.txt"), "before\n");
    expect((await service.status(directory)).clean).toBe(true);
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

  it("discards tracked, untracked, and newly staged files without touching other files", async () => {
    const service = new GitService();
    await writeFile(join(directory, "tracked.txt"), "changed\n");
    await service.stageFile(directory, "tracked.txt");
    await writeFile(join(directory, "new.txt"), "new\n");
    await service.stageFile(directory, "new.txt");
    await writeFile(join(directory, "untracked.txt"), "new\n");
    await writeFile(join(directory, "keep.txt"), "keep\n");
    for (const file of ["tracked.txt", "new.txt", "untracked.txt"]) {
      await service.discardFile(directory, file);
    }
    expect(await readFile(join(directory, "tracked.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(
      (await service.status(directory)).files.map(({ path }) => path),
    ).toEqual(["keep.txt"]);
    await expect(readFile(join(directory, "new.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      readFile(join(directory, "untracked.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      service.discardFile(directory, "../outside.txt"),
    ).rejects.toThrow("Select a changed file");
  });

  it("discards every change under a directory", async () => {
    const service = new GitService();
    await mkdir(join(directory, "src", "deep"), { recursive: true });
    await writeFile(join(directory, "src", "committed.txt"), "before\n");
    await service.commitAll(directory, "Add a directory");
    await writeFile(join(directory, "src", "committed.txt"), "changed\n");
    await writeFile(join(directory, "src", "deep", "untracked.txt"), "new\n");
    await writeFile(join(directory, "src", "added.txt"), "added\n");
    await service.stageFile(directory, "src/added.txt");
    await writeFile(join(directory, "outside.txt"), "keep\n");

    await service.discardFile(directory, "src");

    expect(await readFile(join(directory, "src/committed.txt"), "utf8")).toBe(
      "before\n",
    );
    expect(
      (await service.status(directory)).files.map(({ path }) => path),
    ).toEqual(["outside.txt"]);
  });

  it("treats selected paths literally instead of as Git pathspec patterns", async () => {
    const service = new GitService();
    await writeFile(join(directory, "[ab].txt"), "original\n");
    await writeFile(join(directory, "a.txt"), "original\n");
    await service.commitAll(directory, "Add literal paths");
    await writeFile(join(directory, "[ab].txt"), "changed\n");
    await writeFile(join(directory, "a.txt"), "keep\n");
    await service.discardFile(directory, "[ab].txt");
    expect(await readFile(join(directory, "[ab].txt"), "utf8")).toBe(
      "original\n",
    );
    expect(await readFile(join(directory, "a.txt"), "utf8")).toBe("keep\n");
  });

  it("discards a newly staged file before the first commit", async () => {
    const empty = await mkdtemp(join(tmpdir(), "gizmo-git-empty-"));
    remotes.push(empty);
    await git(empty, ["init", "-b", "main"]);
    await writeFile(join(empty, "new.txt"), "new\n");
    const service = new GitService();
    await service.stageFile(empty, "new.txt");
    await service.discardFile(empty, "new.txt");
    expect((await service.status(empty)).clean).toBe(true);
    await expect(readFile(join(empty, "new.txt"))).rejects.toMatchObject({
      code: "ENOENT",
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
