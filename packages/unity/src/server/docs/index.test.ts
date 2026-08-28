import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerUnityDocs } from "./index";

describe("registerUnityDocs", () => {
  it("registers documentation tools and commands without indexing eagerly", () => {
    const registerTool = vi.fn();
    const registerCommand = vi.fn();

    registerUnityDocs({
      registerTool,
      registerCommand,
    } as unknown as ExtensionAPI);

    expect(registerTool.mock.calls.map(([tool]) => tool.name)).toEqual([
      "unity_docs_status",
      "unity_docs_index",
      "unity_docs_core_stage",
      "unity_docs_search",
      "unity_docs_read",
    ]);
    expect(registerCommand.mock.calls.map(([name]) => name)).toEqual([
      "unity-docs-status",
      "unity-docs-index",
      "unity-docs-core-stage",
    ]);
  });
});
