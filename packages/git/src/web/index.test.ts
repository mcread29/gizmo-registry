import { describe, expect, it, vi } from "vitest";
import { gizmoWebExtension, type GitCommandStore } from "./index";
import type { GitHostStore } from "./host";

function store(gitStatus: GitHostStore["gitStatus"]): GitHostStore {
  return { gitStatus } as unknown as GitHostStore;
}

describe("git inspector", () => {
  it("invokes extension-owned staging operations through the generic bridge", async () => {
    const invokeProjectExtension = vi.fn(async () => undefined);
    const refreshGitStatus = vi.fn(async () => undefined);
    const gitStore = {
      gitStatus: undefined,
      invokeProjectExtension,
      refreshGitStatus,
    } as unknown as GitCommandStore;
    const [tab] = gizmoWebExtension.inspectorTabs({
      store: gitStore,
      projectPath: "/repo",
    });

    await (tab.props.stageFile as (path: string) => Promise<void>)("file.ts");
    await (tab.props.unstageFile as (path: string) => Promise<void>)("file.ts");

    expect(invokeProjectExtension).toHaveBeenNthCalledWith(
      1,
      "/repo",
      "git",
      "stage",
      { path: "file.ts" },
    );
    expect(invokeProjectExtension).toHaveBeenNthCalledWith(
      2,
      "/repo",
      "git",
      "unstage",
      { path: "file.ts" },
    );
    expect(refreshGitStatus).toHaveBeenCalledTimes(2);
  });
});

describe("git statusBar", () => {
  it("returns nothing before status has loaded", () => {
    expect(gizmoWebExtension.statusBar({ store: store(undefined) })).toEqual(
      [],
    );
  });

  it("shows just the branch when clean", () => {
    const items = gizmoWebExtension.statusBar({
      store: store({
        rootPath: "/repo",
        branch: "main",
        clean: true,
        files: [],
      }),
    });
    expect(items).toEqual([
      { id: "git.branch", label: "main", tone: "default" },
    ]);
  });

  it("shows the dirty file count with an accent tone", () => {
    const items = gizmoWebExtension.statusBar({
      store: store({
        rootPath: "/repo",
        branch: "main",
        clean: false,
        files: [{ path: "a.ts", index: "M", workingTree: " " }],
      }),
    });
    expect(items).toEqual([
      { id: "git.branch", label: "main (1)", tone: "accent" },
    ]);
  });
});
