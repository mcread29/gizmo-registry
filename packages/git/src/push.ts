/**
 * Push shapes shared by the server (which produces them) and the web panel
 * (which consumes them). Kept free of imports so the browser bundle can use
 * the types without pulling in the server's Pi dependencies.
 */

export interface GitPushState {
  branch: string;
  /** Tracking branch, absent until the branch has been published. */
  upstream?: string;
  /** Commits on this branch the upstream does not have yet. */
  ahead: number;
  /** Commits on the upstream this branch does not have yet. */
  behind: number;
  /** False in a repository with no commits yet. */
  hasCommits: boolean;
}

export interface GitPushResult {
  branch: string;
  /** True when this push also published the branch to `origin`. */
  setUpstream: boolean;
  /** Git's own report of what it did; git writes progress to stderr. */
  output: string;
}
