export function formatToolResult(result: unknown): string {
  if (result === undefined || result === null) return "";
  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

export function recordValue(value: unknown, key: string): unknown | undefined {
  if (!value || typeof value !== "object") return;
  return (value as Record<string, unknown>)[key];
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
}

/**
 * Time only for today, date and time otherwise — a bare "03:05" on a thread
 * resumed a week later says nothing useful.
 */
export function formatMessageTime(timestamp: number, now = Date.now()): string {
  const sameDay =
    new Date(timestamp).toDateString() === new Date(now).toDateString();
  return new Intl.DateTimeFormat([], {
    hour: "2-digit",
    minute: "2-digit",
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
  }).format(timestamp);
}
