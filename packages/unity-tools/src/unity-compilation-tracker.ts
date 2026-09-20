import { isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Names a file the way Unity does: relative to the project root, with forward
 * slashes.
 *
 * The edit and write tools accept either an absolute path or one relative to
 * the project, and both reach the tracker. Storing whatever the caller typed
 * meant one file edited both ways was tracked as two pending files, which is
 * what the Unity panel was listing. Normalizing here also keeps the panel
 * readable, since an absolute path is mostly the part every row shares.
 *
 * `relative` and `sep` come from `node:path`, so this is correct on Windows
 * separators and on POSIX ones without special-casing either.
 */
export function projectRelativePath(path: string, projectPath: string): string {
  const absolute = isAbsolute(path) ? path : resolve(projectPath, path);
  const within = relative(projectPath, absolute);
  // A file outside the project has no project-relative name worth showing;
  // leaving it absolute says plainly that it is somewhere else.
  if (!within || within.startsWith("..")) return absolute;
  return within.split(sep).join("/");
}

export class UnityCompilationTracker {
  readonly #paths = new Set<string>();

  mark(path: string, projectPath: string): readonly string[] {
    this.#paths.add(projectRelativePath(path, projectPath));
    return this.paths;
  }

  clear(): void {
    this.#paths.clear();
  }

  get paths(): readonly string[] {
    return [...this.#paths].sort();
  }
}

export function affectsUnityCompilation(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return (
    /\.(cs|asmdef|asmref|rsp)$/.test(normalized) ||
    normalized.endsWith("/packages/manifest.json") ||
    normalized === "packages/manifest.json"
  );
}
