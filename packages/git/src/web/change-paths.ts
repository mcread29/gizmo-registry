/**
 * Git status paths are repository-root-relative (status runs with the repo
 * root as cwd) while agent edit paths are workspace-relative. When the Gizmo
 * workspace is a subdirectory of the repository the two only line up after
 * both are rebased onto the workspace, which is what these helpers do.
 */

function slashes(path: string): string {
  return path.replaceAll("\\", "/").replace(/\/$/, "");
}

/** Windows paths (drive letter or backslashes) compare case-insensitively. */
export function isWindowsPath(path: string | undefined): boolean {
  return Boolean(path && (/^[A-Za-z]:/.test(path) || path.includes("\\")));
}

/** Comparison key for a path already expressed relative to the workspace. */
export function changeKey(path: string, projectPath?: string): string {
  const relative = projectRelativePath(path, projectPath);
  return isWindowsPath(projectPath) ? relative.toLowerCase() : relative;
}

/** Strips the workspace prefix from an absolute path; other paths pass through. */
export function projectRelativePath(
  path: string,
  projectPath?: string,
): string {
  const normalized = slashes(path).replace(/^\.\//, "");
  const workspace = projectPath ? slashes(projectPath) : "";
  if (workspace && startsWithSegment(normalized, workspace, projectPath)) {
    return normalized.slice(workspace.length + 1);
  }
  return normalized;
}

/**
 * Rebases a repository-root-relative Git status path onto the workspace.
 * Falls back to the root-relative path when the workspace is not inside the
 * repository (or the root is unknown), so nothing is ever hidden.
 */
export function gitPathToProjectPath(
  statusPath: string,
  rootPath: string | undefined,
  projectPath?: string,
): string {
  const relative = slashes(statusPath).replace(/^\.\//, "");
  if (!rootPath || !projectPath) return relative;
  const root = slashes(rootPath);
  const workspace = slashes(projectPath);
  if (equalPath(root, workspace, projectPath)) return relative;
  if (!startsWithSegment(workspace, root, projectPath)) return relative;
  const prefix = workspace.slice(root.length + 1);
  return startsWithSegment(relative, prefix, projectPath)
    ? relative.slice(prefix.length + 1)
    : `../${relative}`;
}

function equalPath(left: string, right: string, hint?: string): boolean {
  return isWindowsPath(hint)
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function startsWithSegment(path: string, prefix: string, hint?: string) {
  return (
    path.length > prefix.length &&
    path[prefix.length] === "/" &&
    equalPath(path.slice(0, prefix.length), prefix, hint)
  );
}
