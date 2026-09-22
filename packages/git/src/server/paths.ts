/**
 * Whether a repository path is the given path or sits beneath it. The tree's
 * folder rows act on a directory, so both the verbs and the diff have to ask
 * what a path covers.
 */
export function underPath(candidate: string, path: string): boolean {
  return candidate === path || candidate.startsWith(`${path}/`);
}

/**
 * Where Gizmo keeps a workspace's memory journal, digests and facts. They
 * change on every turn, so left in they would swamp the status and the
 * diff with pages of the agent's own notes.
 */
export const journalPath = ".gizmo/memory";

export function isJournalPath(path: string): boolean {
  return underPath(path, journalPath);
}
