import { describe, expect, it } from "vitest";
import { unitySystemPrompt } from "@gizmo/unity/server";

describe("unitySystemPrompt", () => {
  it("documents Unity tools without redefining core coding tools", () => {
    for (const tool of [
      "unity_status",
      "unity_command",
      "unity_wait_for_compile",
      "unity_test",
    ]) {
      expect(unitySystemPrompt).toContain(`- ${tool}:`);
    }
    expect(unitySystemPrompt).not.toContain("- read:");
  });
});
