import { describe, expect, it } from "vitest";
import { unityCommandTemplate } from "./unity-command-template";

describe("unityCommandTemplate", () => {
  it("creates a Pipeline command starter with a stable path", () => {
    const template = unityCommandTemplate({
      command: "scene.describe-selection",
      description: "Describe the current selection.",
    });

    expect(template.suggestedPath).toBe(
      "Assets/Editor/Gizmo/SceneDescribeSelectionCommand.cs",
    );
    expect(template.source).toContain(
      '[CliCommand("scene.describe-selection", "Describe the current selection.")]',
    );
    expect(template.source).toContain('[CliArg("dry_run"');
  });

  it("escapes command metadata embedded in C# strings", () => {
    const template = unityCommandTemplate({
      command: "scene.describe",
      description: 'Describe "Assets\\Scenes".',
      namespace: "Game.Editor.Commands",
      className: "DescribeSceneCommand",
    });

    expect(template.source).toContain("namespace Game.Editor.Commands");
    expect(template.source).toContain('Describe \\"Assets\\\\Scenes\\".');
  });
});
