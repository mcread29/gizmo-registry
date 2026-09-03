import { describe, expect, it } from "vitest";
import {
  changeKey,
  gitPathToProjectPath,
  projectRelativePath,
} from "./change-paths";

describe("gitPathToProjectPath", () => {
  it("keeps root-relative paths when the workspace is the repository root", () => {
    expect(gitPathToProjectPath("src/a.ts", "/repo", "/repo")).toBe("src/a.ts");
    expect(gitPathToProjectPath("src/a.ts", "/repo", "/repo/")).toBe(
      "src/a.ts",
    );
  });

  it("rebases onto a workspace that is a subdirectory of the repository", () => {
    expect(gitPathToProjectPath("apps/web/src/a.ts", "/repo", "/repo/apps/web"))
      .toBe("src/a.ts");
    expect(gitPathToProjectPath("README.md", "/repo", "/repo/apps/web")).toBe(
      "../README.md",
    );
  });

  it("ignores case and separators on Windows", () => {
    expect(
      gitPathToProjectPath(
        "Apps/Web/src/a.ts",
        "C:/Repo",
        "c:\\repo\\apps\\web",
      ),
    ).toBe("src/a.ts");
  });

  it("passes through when the root is unknown", () => {
    expect(gitPathToProjectPath("src/a.ts", undefined, "/repo")).toBe(
      "src/a.ts",
    );
  });
});

describe("changeKey", () => {
  it("matches agent edit paths against rebased git paths", () => {
    const projectPath = "/repo/apps/web";
    const agent = changeKey("/repo/apps/web/src/a.ts", projectPath);
    const git = changeKey(
      gitPathToProjectPath("apps/web/src/a.ts", "/repo", projectPath),
      projectPath,
    );
    expect(agent).toBe(git);
  });

  it("folds case on Windows only", () => {
    expect(changeKey("Src\\A.ts", "C:\\repo")).toBe("src/a.ts");
    expect(changeKey("Src/A.ts", "/repo")).toBe("Src/A.ts");
  });
});

describe("projectRelativePath", () => {
  it("strips the workspace prefix and leaves relative paths alone", () => {
    expect(projectRelativePath("/repo/src/a.ts", "/repo")).toBe("src/a.ts");
    expect(projectRelativePath("./src/a.ts", "/repo")).toBe("src/a.ts");
    expect(projectRelativePath("/repo2/src/a.ts", "/repo")).toBe(
      "/repo2/src/a.ts",
    );
  });
});
