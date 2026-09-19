/**
 * The shapes Git's tools and view speak. These used to live in the shell's
 * protocol package; an extension owns its own payloads, so they live here.
 */

export interface GitFileStatus {
  path: string;
  /** Present for a rename or copy: where the file came from. */
  originalPath?: string;
  /** Index (staged) status letter from `git status --porcelain`. */
  index: string;
  /** Working-tree (unstaged) status letter. */
  workingTree: string;
}

export interface GitStatus {
  rootPath: string;
  branch: string;
  clean: boolean;
  files: GitFileStatus[];
}

export interface GitCommitResult {
  rootPath: string;
  commit: string;
  message: string;
}
