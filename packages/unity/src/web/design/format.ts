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
