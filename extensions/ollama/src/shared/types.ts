/**
 * Shapes shared between the agent-server extension and the browser bundle.
 * Type-only: safe to import from either side since types are erased.
 */

export type JobKind = "pull" | "host";
export type JobStatus = "running" | "succeeded" | "failed" | "cancelled";

export interface JobSnapshot {
  kind: JobKind;
  /** Model name for pulls, target version for host installs/updates. */
  target: string;
  status: JobStatus;
  stage: string;
  /** 0-100 when the stage reports a determinate size, undefined otherwise. */
  percent?: number;
  /** Human-readable progress detail, e.g. "1.2 GB of 4.9 GB". */
  message?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type HostPlatform = "windows" | "macos" | "linux" | "unknown";

export interface HostStatus {
  platform: HostPlatform;
  installed: boolean;
  /** Installed binary version, when one was found. */
  version?: string;
  /** Resolved binary path; `ollama` (bare) when it only exists on PATH. */
  binaryPath?: string;
  serverReachable: boolean;
  serverVersion?: string;
  /** Latest upstream release, undefined when the lookup failed. */
  latestVersion?: string;
  updateAvailable: boolean;
  /** Human hint for odd situations, e.g. a PATH binary we cannot update in place. */
  note?: string;
}

export interface ManagedModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  contextLength?: number;
  capabilities: string[];
}

/** Operations exposed through the extension descriptor, in display order. */
export interface OllamaOperation {
  id: string;
  mutates: boolean;
  requiresConfirmation: boolean;
}
