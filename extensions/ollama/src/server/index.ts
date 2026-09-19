/**
 * Gizmo integration for the Ollama extension.
 *
 * Owns the local Ollama host and its models: detection, install/update
 * (through the job registry), listing, pulling, and removal against the
 * local Ollama REST API. Ollama is machine-global, so the workspace path is
 * ignored here. The Ollama view polls this controller in-process; the
 * browser only receives rendered views.
 */

import { defineExtension } from "@gizmo/extension-api";
import { createOllamaClient } from "../shared/ollama-client.ts";
import type { OllamaClient } from "../shared/ollama-client.ts";
import { listManagedModels } from "../shared/models.ts";
import type { HostStatus, JobSnapshot } from "../shared/types.ts";
import {
  fetchLatestVersion,
  hostPlatform,
  installOrUpdate,
  isNewerVersion,
  readOllamaVersion,
  resolveOllamaBinary,
} from "./host.ts";
import { JobRegistry } from "./jobs.ts";
import { openOllamaView } from "./view.ts";

class InvalidInputError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation}: ${detail}`);
    this.name = "InvalidInputError";
  }
}

function requireModelName(operation: string, name: unknown): string {
  if (typeof name !== "string" || !name.trim()) {
    throw new InvalidInputError(operation, "missing model name");
  }
  return name.trim();
}

function requireVersion(operation: string, version: unknown): string {
  if (typeof version !== "string" || !/^v?\d+\.\d+\.\d+/.test(version)) {
    throw new InvalidInputError(operation, "missing or malformed version");
  }
  return version.replace(/^v/, "");
}

/**
 * Everything the Ollama view needs, as plain methods. It replaces the
 * `invoke` operations the browser used to poll: the view runs in the same
 * process, so there is no RPC surface left to describe.
 */
export interface OllamaController {
  status(signal?: AbortSignal): Promise<HostStatus>;
  models(signal?: AbortSignal): Promise<ManagedModelList>;
  hostJob(): JobSnapshot | null;
  pullJob(): JobSnapshot | null;
  install(version: string): JobSnapshot;
  update(version: string): JobSnapshot;
  pull(name: string): JobSnapshot;
  cancelPull(): boolean;
  remove(name: string, signal?: AbortSignal): Promise<{ removed: string }>;
}

type ManagedModelList = Awaited<ReturnType<typeof listManagedModels>>;

export interface OllamaExtensionDeps {
  client?: OllamaClient;
  jobs?: JobRegistry;
  /** Test seam: skip the real filesystem/network host detection. */
  detectHost?: (signal?: AbortSignal) => Promise<HostStatus>;
}

export function createOllamaController(
  deps: OllamaExtensionDeps = {},
): OllamaController {
  const client = deps.client ?? createOllamaClient();
  const jobs = deps.jobs ?? new JobRegistry();
  const detect =
    deps.detectHost ?? ((signal?: AbortSignal) => detectHost(client, signal));
  const ping = (): Promise<string | null> => client.version();

  const startHostJob = (operation: string, version: string): JobSnapshot => {
    const target = requireVersion(operation, version);
    return jobs.start("host", target, (job, signal) =>
      installOrUpdate(target, { job, signal, ping }),
    );
  };

  return {
    status: (signal) => detect(signal),
    models: async (signal) => listManagedModels(client, signal),
    hostJob: () => jobs.snapshot("host"),
    pullJob: () => jobs.snapshot("pull"),
    install: (version) => startHostJob("host.install", version),
    update: (version) => startHostJob("host.update", version),
    pull(name) {
      const model = requireModelName("models.pull", name);
      return jobs.start("pull", model, async (job, signal) => {
        job.setStage("starting", `Pulling ${model}`);
        await client.pull(
          model,
          (line) => {
            job.setStage(line.status);
            job.setProgress({ completed: line.completed, total: line.total });
          },
          signal,
        );
      });
    },
    cancelPull: () => jobs.cancel("pull"),
    async remove(name, signal) {
      const model = requireModelName("models.remove", name);
      await client.remove(model, signal ?? new AbortController().signal);
      return { removed: model };
    },
  };
}

export function createOllamaExtension(deps: OllamaExtensionDeps = {}) {
  const controller = createOllamaController(deps);
  return defineExtension({
    id: "ollama",
    name: "Ollama",
    views: {
      models: {
        label: "Ollama",
        open: (context) => openOllamaView(controller, context),
      },
    },
    commands: () => [
      {
        id: "ollama.models",
        label: "Ollama: Manage models",
        keywords: ["ollama", "models", "llm"],
        icon: "boxes",
        view: "models",
      },
    ],
  });
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
