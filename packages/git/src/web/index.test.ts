import { describe, expect, it } from "vitest";
import { gizmoWebExtension } from "./index";
import type { GitHostStore } from "./host";

function store(gitStatus: GitHostStore["gitStatus"]): GitHostStore {
  return { gitStatus } as unknown as GitHostStore;
}

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
