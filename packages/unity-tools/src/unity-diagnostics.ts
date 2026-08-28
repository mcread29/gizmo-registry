import type { UnityCliMessage } from "./unity-json";

export function unityDiagnostic(
  message: string,
  code?: string,
): UnityCliMessage {
  const location = sourceLocation(message);
  return {
    code: code ?? message.match(/\b(CS\d+)\b/)?.[1] ?? "UNITY_DIAGNOSTIC",
    message,
    ...location,
  };
}

export function sourceLocation(
  value: string,
): Pick<UnityCliMessage, "file" | "line" | "column"> {
  const compiler = value.match(
    /(^|\n)(.+?\.cs)(?:\((\d+),(\d+)\)|:(\d+)(?::(\d+))?)\s*:/,
  );
  if (compiler?.[2]) {
    return {
      file: compiler[2],
      line: Number(compiler[3] ?? compiler[5]),
      ...(compiler[4] || compiler[6]
        ? { column: Number(compiler[4] ?? compiler[6]) }
        : {}),
    };
  }
  const stack =
    value.match(/\(at (.+?\.cs):(\d+)\)/) ??
    value.match(/\bin (.+?\.cs):line (\d+)/);
  return stack?.[1] ? { file: stack[1], line: Number(stack[2]) } : {};
}
