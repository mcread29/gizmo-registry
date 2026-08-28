import { executeUnityCommand } from "./unity-command";
import { sourceLocation } from "./unity-diagnostics";
import { asRecord, finiteNumber, type UnityCliMessage } from "./unity-json";
import type { UnityCommandRunner } from "./unity-runner";

export type UnityTestMode = "all" | "editor" | "playmode";
export type UnityTestFilterType = "testName" | "assembly" | "category";

export interface RunUnityTestsOptions {
  projectPath: string;
  mode?: UnityTestMode;
  filter?: string;
  filterType?: UnityTestFilterType;
  includeExplicit?: boolean;
  timeoutSeconds?: number;
  signal?: AbortSignal;
}

export interface UnityTestResult {
  name: string;
  status: string;
  durationMs: number;
  message?: string;
  stackTrace?: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface UnityTestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  inconclusive: number;
}

export interface UnityTestDetails {
  ok: boolean;
  state: "passed" | "failed" | "no_tests" | "disconnected" | "error";
  mode: UnityTestMode;
  filter?: string;
  durationMs: number;
  summary: UnityTestSummary;
  tests: UnityTestResult[];
  errors: UnityCliMessage[];
  warnings: UnityCliMessage[];
}

export async function runUnityTests(
  runner: UnityCommandRunner,
  options: RunUnityTestsOptions,
): Promise<UnityTestDetails> {
  const mode = options.mode ?? "editor";
  const details = await executeUnityCommand(runner, {
    projectPath: options.projectPath,
    command: "run_tests",
    parameters: {
      mode,
      filter: options.filter ?? "",
      filter_type: options.filterType ?? "testName",
      include_explicit: options.includeExplicit ?? false,
      async_tests: false,
      timeout: options.timeoutSeconds ?? 300,
    },
    timeoutSeconds: (options.timeoutSeconds ?? 300) + 15,
    signal: options.signal,
  });
  if (!details.ok) {
    return {
      ok: false,
      state: details.state === "disconnected" ? "disconnected" : "error",
      mode,
      ...(options.filter ? { filter: options.filter } : {}),
      durationMs: details.durationMs,
      summary: emptySummary(),
      tests: [],
      errors: details.errors,
      warnings: details.warnings,
    };
  }

  const result = commandResult(details.data);
  const summary = testSummary(field(result, "summary"));
  const tests = array(field(result, "results"))
    .map(testResult)
    .filter((test) => test !== undefined);
  const total = summary.total || tests.length;
  const resultSuccess = field(result, "success");
  const durationSeconds = finiteNumber(field(result, "duration"));
  const failed = summary.failed > 0 || resultSuccess === false;
  const noTests = total === 0;
  const errors = [...details.errors];
  if (noTests) {
    errors.push({
      code: "UNITY_TESTS_NOT_FOUND",
      message: options.filter
        ? `No Unity tests matched ${options.filter}.`
        : "Unity did not discover any tests for this run.",
    });
  } else if (failed) {
    errors.push({
      code: "UNITY_TESTS_FAILED",
      message: `${summary.failed || tests.filter((test) => test.status.toLowerCase() === "failed").length} of ${total} Unity tests failed.`,
    });
  }
  return {
    ok: !failed && !noTests,
    state: noTests ? "no_tests" : failed ? "failed" : "passed",
    mode,
    ...(options.filter ? { filter: options.filter } : {}),
    durationMs:
      durationSeconds === undefined
        ? details.durationMs
        : durationSeconds * 1_000,
    summary: { ...summary, total },
    tests,
    errors,
    warnings: details.warnings,
  };
}

function testSummary(value: unknown): UnityTestSummary {
  const summary = asRecord(value);
  return {
    total: finiteNumber(field(summary, "total")) ?? 0,
    passed: finiteNumber(field(summary, "passed")) ?? 0,
    failed: finiteNumber(field(summary, "failed")) ?? 0,
    skipped: finiteNumber(field(summary, "skipped")) ?? 0,
    inconclusive: finiteNumber(field(summary, "inconclusive")) ?? 0,
  };
}

function testResult(value: unknown): UnityTestResult | undefined {
  const result = asRecord(value);
  const name = string(field(result, "fullName"));
  if (!name) return;
  const message = string(field(result, "message"));
  const stackTrace = string(field(result, "stackTrace"));
  const location = sourceLocation(`${message ?? ""}\n${stackTrace ?? ""}`);
  return {
    name,
    status: string(field(result, "status")) ?? "Unknown",
    durationMs: (finiteNumber(field(result, "duration")) ?? 0) * 1_000,
    ...(message ? { message } : {}),
    ...(stackTrace ? { stackTrace } : {}),
    ...location,
  };
}

function commandResult(data: unknown): Record<string, unknown> | undefined {
  const outer = asRecord(data);
  let result: unknown = field(outer, "result");
  if (typeof result === "string") {
    try {
      result = JSON.parse(result);
    } catch {
      return;
    }
  }
  return asRecord(result);
}

function field(
  recordValue: Record<string, unknown> | undefined,
  name: string,
): unknown {
  if (!recordValue) return;
  const match = Object.keys(recordValue).find(
    (key) => key.toLowerCase() === name.toLowerCase(),
  );
  return match ? recordValue[match] : undefined;
}

function emptySummary(): UnityTestSummary {
  return { total: 0, passed: 0, failed: 0, skipped: 0, inconclusive: 0 };
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
