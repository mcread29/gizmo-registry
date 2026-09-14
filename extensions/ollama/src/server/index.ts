/**
 * Gizmo agent-server integration for the Ollama extension.
 *
 * Answers the web UI's management operations: host detection and
 * install/update (driven through the job registry), model listing, pulling,
 * and removal — all against the local Ollama REST API. Ollama is
 * machine-global, so the workspace path is ignored here.
 */

import { createOllamaClient } from "../shared/ollama-client.ts";
import type { OllamaClient } from "../shared/ollama-client.ts";
import { listManagedModels } from "../shared/models.ts";
import type {
  HostStatus,
  JobSnapshot,
  OllamaOperation,
} from "../shared/types.ts";
import {
  fetchLatestVersion,
  hostPlatform,
  installOrUpdate,
  isNewerVersion,
  readOllamaVersion,
  resolveOllamaBinary,
} from "./host.ts";
import { JobRegistry } from "./jobs.ts";

/** Mirrors Gizmo's `ExtensionDescriptor` without importing `@gizmo/protocol`. */
interface ExtensionDescriptor {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  capabilities: string[];
  operations: Array<{
    id: string;
    mutates: boolean;
    requiresConfirmation: boolean;
  }>;
}

/** Mirrors Gizmo's `GizmoServerExtension` without importing `@gizmo/extensions`. */
interface GizmoServerExtension {
  id: string;
  name: string;
  list?(
    workspacePath: string,
    signal: AbortSignal,
  ): Promise<ExtensionDescriptor[]>;
  invoke?(
    workspacePath: string,
    extensionId: string,
    operationId: string,
    input: unknown,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

const apiVersion = 1;

const operations: OllamaOperation[] = [
  { id: "host.status", mutates: false, requiresConfirmation: false },
  { id: "host.install", mutates: true, requiresConfirmation: false },
  { id: "host.update", mutates: true, requiresConfirmation: false },
  { id: "host.job", mutates: false, requiresConfirmation: false },
  { id: "models.list", mutates: false, requiresConfirmation: false },
  { id: "models.show", mutates: false, requiresConfirmation: false },
  { id: "models.pull", mutates: true, requiresConfirmation: false },
  { id: "models.pullJob", mutates: false, requiresConfirmation: false },
  { id: "models.pullCancel", mutates: true, requiresConfirmation: false },
  { id: "models.remove", mutates: true, requiresConfirmation: true },
];

function descriptor(): ExtensionDescriptor {
  return {
    id: "ollama",
    name: "Ollama",
    version: "1.0.0",
    apiVersion,
    capabilities: [],
    operations: [...operations],
  };
}

// --- Input validation --------------------------------------------------------

class InvalidInputError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation}: ${detail}`);
    this.name = "InvalidInputError";
  }
}

function requireRecord(
  operation: string,
  input: unknown,
): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidInputError(operation, "input must be an object");
  }
  return input as Record<string, unknown>;
}

function requireModelName(operation: string, input: unknown): string {
  const record = requireRecord(operation, input);
  const name = record.name;
  if (typeof name !== "string" || !name.trim()) {
    throw new InvalidInputError(operation, "missing model name");
  }
  return name.trim();
}

function requireVersion(operation: string, input: unknown): string {
  const record = requireRecord(operation, input);
  const version = record.version;
  if (typeof version !== "string" || !/^v?\d+\.\d+\.\d+/.test(version)) {
    throw new InvalidInputError(operation, "missing or malformed version");
  }
  return version.replace(/^v/, "");
}

// --- Extension factory ---------------------------------------------------------

export interface OllamaExtensionDeps {
  client?: OllamaClient;
  jobs?: JobRegistry;
  /** Test seam: skip the real filesystem/network host detection. */
  detectHost?: () => Promise<HostStatus>;
}

export function createOllamaExtension(
  deps: OllamaExtensionDeps = {},
): GizmoServerExtension {
  const client = deps.client ?? createOllamaClient();
  const jobs = deps.jobs ?? new JobRegistry();
  const detect =
    deps.detectHost ?? ((signal: AbortSignal) => detectHost(client, signal));

  const ping = (): Promise<string | null> => client.version();

  const startHostJob = (version: string): JobSnapshot =>
    jobs.start("host", version, (job, signal) =>
      installOrUpdate(version, { job, signal, ping }),
    );

  const startPull = (name: string): JobSnapshot =>
    jobs.start("pull", name, async (job, signal) => {
      job.setStage("starting", `Pulling ${name}`);
      await client.pull(
        name,
        (line) => {
          job.setStage(line.status);
          job.setProgress({
            completed: line.completed,
            total: line.total,
          });
        },
        signal,
      );
    });

  async function invoke(
    operationId: string,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (operationId) {
      case "host.status":
        return detect(signal);
      case "host.install":
      case "host.update": {
        const version = requireVersion(operationId, input);
        return startHostJob(version);
      }
      case "host.job":
        return jobs.snapshot("host");
      case "models.list": {
        const models = await listManagedModels(client, signal);
        return { models };
      }
      case "models.show": {
        const name = requireModelName(operationId, input);
        return client.show(name, signal);
      }
      case "models.pull": {
        const name = requireModelName(operationId, input);
        return startPull(name);
      }
      case "models.pullJob":
        return jobs.snapshot("pull");
      case "models.pullCancel":
        return { cancelled: jobs.cancel("pull") };
      case "models.remove": {
        const name = requireModelName(operationId, input);
        await client.remove(name, signal);
        return { removed: name };
      }
      default:
        throw new Error(
          `Extension ollama does not expose operation: ${operationId}`,
        );
    }
  }

  return {
    id: "ollama",
    name: "Ollama",
    list: async () => [descriptor()],
    invoke: async (
      _workspacePath: string,
      extensionId: string,
      operationId: string,
      input: unknown,
      signal?: AbortSignal,
    ) => {
      if (extensionId !== "ollama") {
        throw new Error(`Extension is not installed: ${extensionId}`);
      }
      if (!operations.some((operation) => operation.id === operationId)) {
        throw new Error(
          `Extension ollama does not expose operation: ${operationId}`,
        );
      }
      return invoke(operationId, input, signal ?? new AbortController().signal);
    },
  };
}

/** Host detection: binary + server + upstream version, all fail-soft. */
async function detectHost(
  client: OllamaClient,
  signal?: AbortSignal,
): Promise<HostStatus> {
  const platform = hostPlatform();
  const binary = await resolveOllamaBinary(platform);
  const [version, serverVersion, latestVersion] = await Promise.all([
    binary ? readOllamaVersion(binary) : Promise.resolve(undefined),
    pingServer(client),
    fetchLatestVersion(signal),
  ]);
  return {
    platform,
    installed: binary !== undefined || serverVersion !== null,
    version,
    binaryPath: binary?.path,
    serverReachable: serverVersion !== null,
    serverVersion: serverVersion ?? undefined,
    latestVersion,
    updateAvailable: Boolean(
      version && latestVersion && isNewerVersion(latestVersion, version),
    ),
    note:
      binary?.path === "ollama"
        ? "Found on PATH; installing a managed copy for updates."
        : undefined,
  };
}

async function pingServer(client: OllamaClient): Promise<string | null> {
  try {
    return await client.version();
  } catch {
    return null;
  }
}

/** The singleton the Pi extension exports. */
export const gizmoExtension = createOllamaExtension();

export { JobActiveError } from "./jobs.ts";
export { InvalidInputError };
