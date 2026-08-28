import { describe, expect, it } from "vitest";
import { changeTree, changeTreeRows } from "./change-tree";
import type { ChangedFile } from "./thread-changes";

function file(path: string): ChangedFile {
  return { file: path, changes: [], added: 1, removed: 0 };
}

describe("change tree", () => {
  it("groups project-relative paths into shared folders", () => {
    const tree = changeTree(
      [
        file("/game/Assets/Scripts/Editor/Build.cs"),
        file("/game/Assets/Scripts/Player.cs"),
        file("/game/Assets/Prefabs/Player.prefab"),
      ],
      "/game",
    );
    const rows = changeTreeRows(tree);

    expect(rows.map(({ node, depth }) => [node.path, depth])).toEqual([
      ["Assets", 0],
      ["Assets/Prefabs", 1],
      ["Assets/Prefabs/Player.prefab", 2],
      ["Assets/Scripts", 1],
      ["Assets/Scripts/Editor", 2],
      ["Assets/Scripts/Editor/Build.cs", 3],
      ["Assets/Scripts/Player.cs", 2],
    ]);
  });

  it("hides descendants of collapsed folders", () => {
    const tree = changeTree([file("Assets/Scripts/Player.cs")]);
    expect(
      changeTreeRows(tree, new Set(["Assets/Scripts"])).map(
        ({ node }) => node.path,
      ),
    ).toEqual(["Assets", "Assets/Scripts"]);
  });
});
