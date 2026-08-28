import { Type } from "typebox";
import { Value } from "typebox/value";
import { unityJsonArgs } from "./unity-json";
import type { UnityCommandRunner, UnityRunResult } from "./unity-runner";

const unityCliMessageSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: true },
);

const unityStatusEnvelopeSchema = Type.Object(
  {
    success: Type.Boolean(),
    command: Type.String(),
    data: Type.Object(
      {
        count: Type.Integer({ minimum: 0 }),
        instances: Type.Array(Type.Record(Type.String(), Type.Unknown())),
      },
      { additionalProperties: true },
    ),
    errors: Type.Array(unityCliMessageSchema),
    warnings: Type.Array(unityCliMessageSchema),
  },
  { additionalProperties: true },
);

export interface UnityCliMessage {
  code: string;
  message: string;
}

export interface UnityEditorInstance {
  [key: string]: unknown;
}

export interface UnityStatusDetails {
  state: "connected" | "disconnected" | "unavailable" | "error";
  ok: boolean;
  command: readonly string[];
  exitCode: number | null;
  durationMs: number;
  instances: UnityEditorInstance[];
  errors: UnityCliMessage[];
  warnings: UnityCliMessage[];
  stderr?: string;
}

export interface UnityStatusOptions {
  projectPath?: string;
  signal?: AbortSignal;
}

export const unityStatusArgs = [...unityJsonArgs, "status"] as const;

export async function getUnityStatus(
  runner: UnityCommandRunner,
  options: UnityStatusOptions = {},
): Promise<UnityStatusDetails> {
  const args = [
    ...unityStatusArgs,
    ...(options.projectPath ? ["--project-path", options.projectPath] : []),
  ];
  const run = await runner.run(args, { signal: options.signal });
  const command = [run.executable, ...run.args];

  if (run.spawnError) {
    return failure(
      run,
      command,
      "unavailable",
      "UNITY_CLI_UNAVAILABLE",
      run.spawnError,
    );
  }
  if (run.aborted) {
    return failure(
      run,
      command,
      "error",
      "UNITY_CLI_ABORTED",
      "Unity status was cancelled.",
    );
  }
  if (run.timedOut) {
    return failure(
      run,
      command,
      "error",
      "UNITY_CLI_TIMEOUT",
      "Unity status timed out.",
    );
  }
  if (run.outputLimitExceeded) {
    return failure(
      run,
      command,
      "error",
      "UNITY_CLI_OUTPUT_LIMIT",
      "Unity status exceeded the output limit.",
    );
  }

  let input: unknown;
  try {
    input = JSON.parse(run.stdout);
  } catch {
    return failure(
      run,
      command,
      "error",
      "UNITY_CLI_INVALID_JSON",
      "Unity status returned invalid JSON.",
    );
  }
  if (!Value.Check(unityStatusEnvelopeSchema, input)) {
    return failure(
      run,
      command,
      "error",
      "UNITY_CLI_INVALID_RESPONSE",
      "Unity status returned an unexpected response.",
    );
  }

  const disconnected =
    input.data.instances.length === 0 &&
    input.errors.some((error) => error.code === "STATUS_NO_INSTANCES");
  return {
    state:
      input.data.instances.length > 0
        ? "connected"
        : disconnected
          ? "disconnected"
          : "error",
    ok: run.ok && input.success,
    command,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    instances: input.data.instances,
    errors: input.errors,
    warnings: input.warnings,
    ...(run.stderr.trim() ? { stderr: run.stderr.trim() } : {}),
  };
}

function failure(
  run: UnityRunResult,
  command: readonly string[],
  state: UnityStatusDetails["state"],
  code: string,
  message: string,
): UnityStatusDetails {
  return {
    state,
    ok: false,
    command,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    instances: [],
    errors: [{ code, message }],
    warnings: [],
    ...(run.stderr.trim() ? { stderr: run.stderr.trim() } : {}),
  };
}
