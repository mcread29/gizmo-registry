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

export interface UnityStatus {
  state: "connected" | "disconnected" | "unavailable" | "error";
  instances: Record<string, unknown>[];
  errors: Array<{ message: string }>;
}
