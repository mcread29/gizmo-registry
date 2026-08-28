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

function absolutePath(file: string, projectPath?: string): string {
  if (file.startsWith("/") || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return projectPath ? `${projectPath.replace(/[\\/]$/, "")}/${file}` : file;
}
