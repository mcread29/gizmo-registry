import { describe, expect, it } from "vitest";
import { createUnityTools, unityToolNames } from "./index";

describe("Unity harness tools", () => {
  it("exposes the complete project-bound tool set", () => {
    const names = createUnityTools({ projectPath: "/projects/game" }).map(
      (tool) => tool.name,
    );

    expect(names.filter((name) => name.startsWith("unity_"))).toEqual([
      ...unityToolNames,
    ]);
    expect(names.slice(0, 2)).toEqual(["edit", "write"]);
    expect(names).toContain("unity_wait_for_command");
    expect(names).toContain("unity_command_template");
  });
});
