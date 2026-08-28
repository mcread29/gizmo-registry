export interface CompilerDiagnostic {
  code: string;
  message: string;
  severity?: "log" | "warning" | "error";
  file?: string;
  line?: number;
  column?: number;
}

export function compilerDiagnostics(value: unknown): CompilerDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.map(compilerDiagnostic).filter((item) => item !== undefined);
}

export function compilerDiagnostic(
  value: unknown,
): CompilerDiagnostic | undefined {
  if (typeof value === "string") return fromMessage(value);
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  const message =
    typeof record.message === "string" ? record.message : undefined;
  if (!message) return;
  const severity = diagnosticSeverity(record.level ?? record.severity);
  const parsed = fromMessage(message, severity);
  return {
    code:
      typeof record.code === "string" && record.code
        ? record.code
        : parsed.code,
    message,
    ...(severity ? { severity } : {}),
    ...(typeof record.file === "string"
      ? { file: record.file }
      : parsed.file
        ? { file: parsed.file }
        : {}),
    ...((positiveInteger(record.line) ?? parsed.line)
      ? { line: positiveInteger(record.line) ?? parsed.line }
      : {}),
    ...((positiveInteger(record.column) ?? parsed.column)
      ? { column: positiveInteger(record.column) ?? parsed.column }
      : {}),
  };
}

/** Deep link that opens a project file in the user's editor at a position. */
export function sourceHref(
  file: string | undefined,
  projectPath?: string,
  line?: number,
  column?: number,
): string | undefined {
  if (!file) return;
  const path = absolutePath(file, projectPath);
  const location = line ? `:${line}${column ? `:${column}` : ""}` : "";
  return `vscode://file${encodeURI(path)}${location}`;
}

export function editorFileHref(
  diagnostic: CompilerDiagnostic,
  projectPath?: string,
): string | undefined {
  return sourceHref(
    diagnostic.file,
    projectPath,
    diagnostic.line,
    diagnostic.column,
  );
}

function fromMessage(
  message: string,
  severity?: CompilerDiagnostic["severity"],
): CompilerDiagnostic {
  const location = message.match(
    /^(.+?\.cs)(?:\((\d+),(\d+)\)|:(\d+)(?::(\d+))?)\s*:\s*/,
  );
  const code =
    message.match(/\b(CS\d+)\b/)?.[1] ??
    (severity === "warning"
      ? "UNITY_CONSOLE_WARNING"
      : severity === "error"
        ? "UNITY_CONSOLE_ERROR"
        : "UNITY_DIAGNOSTIC");
  return {
    code,
    message,
    ...(severity ? { severity } : {}),
    ...(location?.[1] ? { file: location[1] } : {}),
    ...(location?.[2] || location?.[4]
      ? { line: Number(location[2] ?? location[4]) }
      : {}),
    ...(location?.[3] || location?.[5]
      ? { column: Number(location[3] ?? location[5]) }
      : {}),
  };
}

function diagnosticSeverity(
  value: unknown,
): CompilerDiagnostic["severity"] | undefined {
  if (value === "warn" || value === "warning") return "warning";
  if (value === "error" || value === "failed") return "error";
  if (value === "log") return "log";
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

function absolutePath(file: string, projectPath?: string): string {
  if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return projectPath ? `${projectPath.replace(/[\\/]$/, "")}/${file}` : file;
}
