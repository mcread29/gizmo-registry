import type { ConsoleCounts, ConsoleEntry } from "./console-types";

export interface ConsoleSnapshot {
  revision?: string;
  counts: ConsoleCounts;
  entries: ConsoleEntry[];
}

/**
 * Validates the Unity Console package's snapshot payload. Unity owns this
 * shape end to end, so it is parsed here rather than by the host.
 */
export function parseSnapshot(value: unknown): ConsoleSnapshot | undefined {
  const snapshot = record(value);
  const counts = consoleCounts(snapshot?.counts);
  if (
    snapshot?.state !== "ready" ||
    !counts ||
    !Array.isArray(snapshot.entries)
  ) {
    return undefined;
  }
  return {
    ...(typeof snapshot.revision === "string"
      ? { revision: snapshot.revision }
      : {}),
    counts,
    entries: snapshot.entries
      .map(consoleEntry)
      .filter((entry): entry is ConsoleEntry => entry !== undefined),
  };
}

export function consoleTotal(counts: ConsoleCounts): number {
  return counts.logs + counts.warnings + counts.errors;
}

function consoleEntry(value: unknown): ConsoleEntry | undefined {
  const entry = record(value);
  if (!entry || typeof entry.message !== "string") return undefined;
  const level =
    entry.level === "error" || entry.level === "warn" ? entry.level : "log";
  return {
    level,
    message: entry.message,
    ...(integer(entry.seq) === undefined ? {} : { seq: integer(entry.seq) }),
    ...(typeof entry.timestamp === "string"
      ? { timestamp: entry.timestamp }
      : {}),
    ...(typeof entry.stackTrace === "string" && entry.stackTrace
      ? { stackTrace: entry.stackTrace }
      : {}),
    ...(typeof entry.file === "string" && entry.file
      ? { file: entry.file }
      : {}),
    ...(integer(entry.line) === undefined ? {} : { line: integer(entry.line) }),
    ...(integer(entry.column) === undefined
      ? {}
      : { column: integer(entry.column) }),
  };
}

function consoleCounts(value: unknown): ConsoleCounts | undefined {
  const counts = record(value);
  const logs = integer(counts?.logs);
  const warnings = integer(counts?.warnings);
  const errors = integer(counts?.errors);
  return logs === undefined || warnings === undefined || errors === undefined
    ? undefined
    : { logs, warnings, errors };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : undefined;
}
