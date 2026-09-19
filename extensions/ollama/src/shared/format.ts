/** Byte and token formatting for the Ollama view. */

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function formatContext(tokens: number | undefined): string {
  if (tokens === undefined) return "";
  if (tokens >= 1024) return `${Math.round(tokens / 1024)}k ctx`;
  return `${tokens} ctx`;
}

export function formatPercent(percent: number | undefined): string {
  if (percent === undefined) return "";
  return `${Math.round(percent)}%`;
}
