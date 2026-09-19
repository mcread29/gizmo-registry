/**
 * Whether a repository path is the given path or sits beneath it. The tree's
 * folder rows act on a directory, so both the verbs and the diff have to ask
 * what a path covers.
 */
export function underPath(candidate: string, path: string): boolean {
  return candidate === path || candidate.startsWith(`${path}/`);
}
