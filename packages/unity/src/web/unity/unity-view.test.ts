import type { ToolCallView, UnityStatus } from "../types";
import { describe, expect, it } from "vitest";
import { createUnityView } from "./unity-view";

describe("createUnityView lifecycle", () => {
  it("shows live compilation progress from the reload tool", () => {
    const view = viewFor({
      id: "tool-1",
      name: "unity_wait_for_command",
      status: "running",
      statusText: "Unity compilation: compiling",
    });

    expect(view.lifecycle).toMatchObject({
      state: "compiling",
      label: "Compiling scripts",
    });
  });

  it("keeps compiler errors and their locations visible after failure", () => {
    const view = viewFor({
      id: "tool-1",
      name: "unity_wait_for_command",
      status: "error",
      statusText: "Failed",
      result: {
        state: "compile_failed",
        errors: [
          {
            code: "CS1002",
            message: "Assets/Foo.cs(2,3): error CS1002: ; expected",
          },
        ],
      },
    });

    expect(view.lifecycle.state).toBe("failed");
    expect(view.lifecycle.errors[0]).toMatchObject({
      file: "Assets/Foo.cs",
      line: 2,
      column: 3,
    });
  });

  it("marks Unity source edits pending until a later compile completes", () => {
    const pending = viewFor({
      id: "tool-edit",
      name: "edit",
      status: "complete",
      statusText: "Completed",
      result: {
        compilationPending: true,
        compilationPaths: ["Assets/Player.cs"],
      },
    });

    expect(pending.lifecycle).toMatchObject({
      state: "pending",
      pendingPaths: ["Assets/Player.cs"],
    });
  });

  it("surfaces new console diagnostics collected after compilation", () => {
    const view = viewFor({
      id: "tool-compile",
      name: "unity_wait_for_compile",
      status: "complete",
      statusText: "Completed",
      result: {
        state: "ready",
        consoleEntries: [
          {
            level: "warn",
            message: "Assets/Player.cs(8,2): warning CS0414: unused",
          },
        ],
      },
    });

    expect(view.lifecycle.state).toBe("ready");
    expect(view.consoleDiagnostics[0]).toMatchObject({
      severity: "warning",
      file: "Assets/Player.cs",
      line: 8,
    });
  });
});

function viewFor(tool: ToolCallView) {
  return createUnityView({
    messages: [
      {
        id: "message-1",
        role: "assistant",
        content: "",
        createdAt: 1,
        complete: true,
        tools: [tool],
      },
    ],
    projects: [],
    projectStatus: connectedStatus,
    projectsLoading: false,
  });
}

const connectedStatus: UnityStatus = {
  state: "connected",
  ok: true,
  command: ["unity", "status"],
  exitCode: 0,
  durationMs: 1,
  instances: [],
  errors: [],
  warnings: [],
};
