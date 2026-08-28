import { Type } from "typebox";
import { Value } from "typebox/value";
import type {
  UnityCommandRunner,
  UnityRunOptions,
  UnityRunResult,
} from "./unity-runner";

export const unityJsonArgs = [
  "--non-interactive",
  "--no-banner",
  "--format",
  "json",
] as const;

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function parseCommandResult(
  data: unknown,
): Record<string, unknown> | undefined {
  let result: unknown = asRecord(data)?.result;
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return;
    }
  }
  return asRecord(result);
}

const unityCliMessageSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
  },
  { additionalProperties: true },
);

const unityJsonEnvelopeSchema = Type.Object(
  {
    success: Type.Boolean(),
    command: Type.String(),
    data: Type.Unknown(),
    errors: Type.Array(unityCliMessageSchema),
    warnings: Type.Array(unityCliMessageSchema),
  },
  { additionalProperties: true },
);

export interface UnityCliMessage {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface UnityJsonDetails {
  ok: boolean;
  command: readonly string[];
  exitCode: number | null;
  durationMs: number;
  data: unknown;
  errors: UnityCliMessage[];
  warnings: UnityCliMessage[];
  stderr?: string;
}

export async function runUnityJson(
  runner: UnityCommandRunner,
  args: readonly string[],
  options: UnityRunOptions = {},
): Promise<UnityJsonDetails> {
  const run = await runner.run(args, options);
  const command = [run.executable, ...run.args];
  const processFailure = getProcessFailure(run);
  if (processFailure) {
    return details(run, command, null, [processFailure], []);
  }

  let input: unknown;
  try {
    input = JSON.parse(run.stdout);
  } catch {
    return details(
      run,
      command,
      null,
      [
        {
          code: "UNITY_CLI_INVALID_JSON",
          message: "Unity CLI returned invalid JSON.",
        },
      ],
      [],
    );
  }
  if (!Value.Check(unityJsonEnvelopeSchema, input)) {
    return details(
      run,
      command,
      null,
      [
        {
          code: "UNITY_CLI_INVALID_RESPONSE",
          message: "Unity CLI returned an unexpected response.",
        },
      ],
      [],
    );
  }

  return details(
    run,
    command,
    input.data,
    input.errors,
    input.warnings,
    input.success,
  );
}

function getProcessFailure(run: UnityRunResult): UnityCliMessage | undefined {
  if (run.spawnError) {
    return { code: "UNITY_CLI_UNAVAILABLE", message: run.spawnError };
  }
  if (run.aborted) {
    return {
      code: "UNITY_CLI_ABORTED",
      message: "Unity CLI command was cancelled.",
    };
  }
  if (run.timedOut) {
    return {
      code: "UNITY_CLI_TIMEOUT",
      message: "Unity CLI command timed out.",
    };
  }
  if (run.outputLimitExceeded) {
    return {
      code: "UNITY_CLI_OUTPUT_LIMIT",
      message: "Unity CLI command exceeded the output limit.",
    };
  }
}

function details(
  run: UnityRunResult,
  command: readonly string[],
  data: unknown,
  errors: UnityCliMessage[],
  warnings: UnityCliMessage[],
  success = false,
): UnityJsonDetails {
  return {
    ok: run.ok && success,
    command,
    exitCode: run.exitCode,
    durationMs: run.durationMs,
    data,
    errors,
    warnings,
    ...(run.stderr.trim() ? { stderr: run.stderr.trim() } : {}),
  };
}
