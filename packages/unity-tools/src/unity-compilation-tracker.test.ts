import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  affectsUnityCompilation,
  UnityCompilationTracker,
} from "./unity-compilation-tracker";
import { createUnityTrackedFileTools } from "./unity-file-tools";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Unity compilation tracking", () => {
  it("recognizes Unity compilation inputs", () => {
    expect(affectsUnityCompilation("Assets/Player.cs")).toBe(true);
    expect(affectsUnityCompilation("Assets/Game.asmdef")).toBe(true);
    expect(affectsUnityCompilation("Packages/manifest.json")).toBe(true);
    expect(affectsUnityCompilation("Assets/Player.prefab")).toBe(false);
  });

  it("marks successful C# writes as pending compilation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "unity-file-tools-"));
    temporaryDirectories.push(cwd);
    const tracker = new UnityCompilationTracker();
    const write = createUnityTrackedFileTools(cwd, tracker).find(
      (tool) => tool.name === "write",
    )!;

    const result = await write.execute(
      "tool-1",
      { path: "Assets/Player.cs", content: "class Player {}" },
      undefined,
      undefined,
      {} as never,
    );

    expect(await readFile(join(cwd, "Assets/Player.cs"), "utf8")).toBe(
      "class Player {}",
    );
    expect(result.details).toMatchObject({
      compilationPending: true,
      compilationPaths: ["Assets/Player.cs"],
    });
    expect(tracker.paths).toEqual(["Assets/Player.cs"]);
  });
});
