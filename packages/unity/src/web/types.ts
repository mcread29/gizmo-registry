export interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "complete" | "error";
  statusText: string;
  input?: unknown;
  result?: unknown;
}

export interface ConversationMessage {
  tools: ToolCallView[];
}

export interface StoredProject {
  title: string;
  path: string;
}

/** The full wire shape is owned by the extension; see `unity-wire.ts`. */
export type { UnityStatus } from "./unity-wire";
