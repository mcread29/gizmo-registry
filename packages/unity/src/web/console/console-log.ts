import type { ConsoleEntry } from "./console-types";

export function matchesConsoleFilter(
  entry: ConsoleEntry,
  visibleLevels: ReadonlySet<ConsoleEntry["level"]>,
  text: string,
): boolean {
  if (!visibleLevels.has(entry.level)) return false;
  const needle = text.trim().toLowerCase();
  if (!needle) return true;
  return `${entry.message} ${entry.file ?? ""}`.toLowerCase().includes(needle);
}

/** One line of plain text, for copying out to an issue or a message. */
export function consoleLine(entry: ConsoleEntry): string {
  const location = entry.file
    ? ` (${entry.file}${entry.line ? `:${entry.line}` : ""})`
    : "";
  const stamp = entry.timestamp ? `${entry.timestamp} ` : "";
  return `${stamp}[${entry.level}] ${entry.message}${location}`;
}

export function consoleErrorCount(entries: ConsoleEntry[]): number {
  return entries.filter((entry) => entry.level === "error").length;
}

export function consoleTimeLabel(timestamp: string): string {
  return timestamp.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ?? timestamp;
}

export function consoleSourceLabel(file: string, line?: number): string {
  const parts = file.split(/[\\/]/).filter(Boolean);
  const path = parts.slice(-2).join("/") || file;
  return line ? `${path}:${line}` : path;
}
