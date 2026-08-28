import type {
  GitCommitResult,
  GitStatus,
  ConversationMessage,
} from "@gizmo/protocol";

/**
 * The slice of the app's agent store the Git panel reads. The app's
 * `AgentStore` satisfies this structurally; the package never imports it.
 */
export interface GitHostStore {
  messages: ConversationMessage[];
  gitStatus?: GitStatus;
  gitLoading: boolean;
  gitCommitting: boolean;
  refreshGitStatus(): Promise<void>;
  commitAll(message: string): Promise<GitCommitResult>;
  generateCommitMessage(): Promise<string>;
  revertFile(file: string, patch: string): Promise<void>;
  invokeProjectExtension(
    projectPath: string,
    extensionId: string,
    operation: string,
    input?: unknown,
  ): Promise<unknown>;
}
