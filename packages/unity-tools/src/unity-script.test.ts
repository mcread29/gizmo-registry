import { describe, expect, it } from "vitest";
import { executeUnityScript, unityScriptDeclarations } from "./unity-script";
import type {
  UnityCommandRunner,
  UnityRunOptions,
  UnityRunResult,
} from "./unity-runner";

class ScriptRunner implements UnityCommandRunner {
  readonly calls: string[][] = [];

  async run(
    args: readonly string[],
    _options?: UnityRunOptions,
  ): Promise<UnityRunResult> {
    this.calls.push([...args]);
    const command = args.includes("list")
      ? {
          success: true,
          command: "list",
          data: {
            commands: [
              {
                name: "scene.validate",
                parameters: [
                  {
                    name: "includeInactive",
                    type: "boolean",
                    required: false,
                  },
                ],
              },
            ],
          },
          errors: [],
          warnings: [],
        }
      : args.includes("command")
        ? {
            success: true,
            command: "command",
            data: { valid: true },
            errors: [],
            warnings: [],
          }
        : {
            success: true,
            command: "status",
            data: { editors: 1 },
            errors: [],
            warnings: [],
          };
    return {
      ok: true,
      executable: "unity",
      args,
      exitCode: 0,
      signal: null,
      stdout: JSON.stringify(command),
      stderr: "",
      durationMs: 1,
      aborted: false,
      timedOut: false,
      outputLimitExceeded: false,
    };
  }
}

describe("Unity TypeScript runtime", () => {
  it("generates declarations from live Editor command schemas", () => {
    const declarations = unityScriptDeclarations([
      {
        name: "scene.validate",
        parameters: [
          {
            name: "includeInactive",
            type: "boolean",
            required: false,
          },
        ],
      },
    ]);

    expect(declarations).toContain(
      '"scene.validate": (parameters?: { "includeInactive"?: boolean;',
    );
  });

  it("type-checks and executes a live typed command in one call", async () => {
    const runner = new ScriptRunner();
    const result = await executeUnityScript(
      `const result = await unity.commands["scene.validate"]({ includeInactive: true });
return result;`,
      { projectPath: "/project", runner },
    );

    expect(result).toMatchObject({
      ok: true,
      phase: "execute",
      value: { ok: true, data: { valid: true } },
      discoveredCommands: 1,
    });
    expect(runner.calls.filter((args) => args.includes("list"))).toHaveLength(
      2,
    );
    expect(runner.calls.some((args) => args.includes("scene.validate"))).toBe(
      true,
    );
  });

  it("returns compiler diagnostics without executing invalid code", async () => {
    const runner = new ScriptRunner();
    const result = await executeUnityScript(
      `await unity.commands["scene.validte"]({});`,
      { projectPath: "/project", runner },
    );

    expect(result).toMatchObject({ ok: false, phase: "typecheck" });
    expect(result.diagnostics[0]?.message).toContain("scene.validte");
    expect(runner.calls).toHaveLength(1);
  });

  it("rejects CLI administration outside the agent boundary", async () => {
    const runner = new ScriptRunner();
    const result = await executeUnityScript(
      `return await unity.exec(["install", "6000.0.1f1"]);`,
      { projectPath: "/project", runner },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "execute",
      error: expect.stringContaining("not available to scripts"),
    });
    expect(runner.calls).toHaveLength(1);
  });

  it("does not expose the worker realm through runtime functions", async () => {
    const runner = new ScriptRunner();
    const result = await executeUnityScript(
      `return unity.exec.constructor("return process")();`,
      { projectPath: "/project", runner },
    );

    expect(result).toMatchObject({
      ok: false,
      phase: "execute",
      error: expect.stringMatching(/code generation|not a function/i),
    });
  });

  it("honors cancellation before script execution", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped by user"));
    const result = await executeUnityScript(`return 1;`, {
      projectPath: "/project",
      runner: new ScriptRunner(),
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      ok: false,
      phase: "execute",
      error: "Stopped by user",
    });
  });
});
