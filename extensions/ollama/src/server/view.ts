/**
 * The Ollama view: host state, the running job, and the installed models,
 * with the actions the old panel's buttons used to run. Polling lives here
 * now — fast while a job runs, a slow heartbeat otherwise — so the browser
 * only ever receives rendered views.
 */

import type {
  ActionEvent,
  ActionResult,
  View,
  ViewContext,
  ViewHandle,
} from "@gizmo/extension-api";
import {
  formatBytes,
  formatContext,
  formatPercent,
} from "../shared/format.ts";
import type { HostStatus, JobSnapshot, ManagedModel } from "../shared/types.ts";
import type { OllamaController } from "./index.ts";

const FAST_POLL_MS = 700;
const SLOW_POLL_MS = 15_000;

const SUGGESTIONS = ["qwen3", "llama3.2", "gemma3", "deepseek-r1", "phi4-mini"];

interface OllamaViewState {
  host: HostStatus | null;
  models: ManagedModel[];
  hostJob: JobSnapshot | null;
  pullJob: JobSnapshot | null;
  error: string | null;
  loading: boolean;
}

function jobBlocks(job: JobSnapshot | null, title: string): View["blocks"] {
  if (!job) return [];
  const head = `${job.target} · ${job.stage}`;
  if (job.status === "running") {
    return [
      {
        type: "progress",
        value: job.percent ?? 0,
        max: 100,
        label: `${head} ${formatPercent(job.percent)}`.trim(),
      },
    ];
  }
  return [
    {
      type: "text",
      text: `${title}: ${head} — ${job.error ?? job.status}`,
      tone: job.status === "failed" ? "error" : "muted",
    },
  ];
}

function modelDetail(model: ManagedModel): string {
  return [
    model.parameterSize,
    model.quantization,
    formatBytes(model.size),
    formatContext(model.contextLength),
    model.capabilities.includes("thinking") ? "thinking" : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

export function renderOllamaView(state: OllamaViewState): View {
  const blocks: View["blocks"] = [];
  const actions: NonNullable<View["actions"]> = [
    { id: "refresh", label: "Refresh" },
  ];
  const host = state.host;
  const latest = host?.latestVersion;
  const busy =
    state.hostJob?.status === "running" || state.pullJob?.status === "running";

  if (state.error) {
    blocks.push({ type: "text", text: state.error, tone: "error" });
  }

  if (!host) {
    blocks.push({
      type: "text",
      text: state.loading
        ? "Loading… Ollama status will appear here."
        : "Ollama status is unavailable.",
      tone: "muted",
    });
  } else {
    blocks.push({
      type: "keyValue",
      entries: [
        {
          label: "Ollama",
          value: host.installed
            ? (host.version ?? "installed")
            : "not installed",
          tone: host.installed ? "default" : "warning",
        },
        { label: "Latest release", value: latest ?? "unknown" },
        {
          label: "Server",
          value: host.serverReachable
            ? `running ${host.serverVersion ?? ""}`.trim()
            : "unreachable",
          tone: host.serverReachable ? "success" : "warning",
        },
        { label: "Platform", value: host.platform },
      ],
    });
    if (host.note) blocks.push({ type: "text", text: host.note, tone: "muted" });
    blocks.push(...jobBlocks(state.hostJob, "Host"));

    if (!host.installed) {
      actions.push({
        id: "install",
        label: latest ? `Install Ollama ${latest}` : "Install Ollama",
        tone: "primary",
        disabled: busy || !latest,
      });
    } else if (host.updateAvailable) {
      actions.push({
        id: "update",
        label: latest ? `Update to ${latest}` : "Update",
        tone: "primary",
        disabled: busy || !latest,
      });
    }

    blocks.push(...jobBlocks(state.pullJob, "Pull"));
    if (state.pullJob?.status === "running") {
      actions.push({ id: "cancel-pull", label: "Cancel pull" });
    }

    actions.push({
      id: "pull",
      label: "Pull model",
      disabled: busy || !host.serverReachable,
      // The protocol has no combobox, so the suggestions the old panel
      // offered as chips are a hint next to a free-text field.
      input: {
        kind: "text",
        label: "Model to pull",
        placeholder: "model, e.g. qwen3:8b",
        required: true,
      },
    });
    blocks.push({
      type: "text",
      text: `Try: ${SUGGESTIONS.join(", ")}`,
      tone: "muted",
    });

    if (!host.serverReachable) {
      blocks.push({
        type: "text",
        text: "Server unreachable — start Ollama to see and pull models.",
        tone: "warning",
      });
    } else {
      blocks.push({
        type: "list",
        id: "models",
        empty: "No models yet — pull one to make it available as a provider.",
        items: state.models.map((model) => ({
          id: model.name,
          label: model.name,
          detail: modelDetail(model),
        })),
      });
      actions.push({
        id: "remove",
        label: "Remove model",
        tone: "danger",
        disabled: busy || state.models.length === 0,
        selection: { blockId: "models", required: true },
        confirm: {
          title: "Remove model",
          message: "Delete this model from the local Ollama store?",
        },
      });
    }
  }

  return {
    title: "Ollama",
    status: state.error
      ? "error"
      : busy
        ? "running"
        : state.loading
          ? "running"
          : "idle",
    blocks,
    actions,
  };
}

export function openOllamaView(
  controller: OllamaController,
  context: ViewContext,
): ViewHandle {
  const state: OllamaViewState = {
    host: null,
    models: [],
    hostJob: null,
    pullJob: null,
    error: null,
    loading: true,
  };
  let disposed = false;
  let ticks = 0;

  const push = () => {
    if (!disposed) context.update(renderOllamaView(state));
  };

  async function refresh(): Promise<void> {
    try {
      state.host = await controller.status();
      state.hostJob = controller.hostJob();
      state.pullJob = controller.pullJob();
      state.models = state.host?.serverReachable
        ? await controller.models()
        : [];
      state.error = null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    } finally {
      state.loading = false;
      push();
    }
  }

  const timer = setInterval(() => {
    ticks += 1;
    const running =
      state.pullJob?.status === "running" ||
      state.hostJob?.status === "running";
    // Fast cadence while a job runs; otherwise a slow status heartbeat.
    if (running || ticks % Math.round(SLOW_POLL_MS / FAST_POLL_MS) === 0) {
      void refresh();
    }
  }, FAST_POLL_MS);
  timer.unref?.();

  push();
  void refresh();

  async function action(event: ActionEvent): Promise<ActionResult> {
    if (event.cancelled) return { status: "rejected" };
    try {
      switch (event.actionId) {
        case "refresh":
          await refresh();
          return { status: "succeeded" };
        case "install":
        case "update": {
          const version = state.host?.latestVersion;
          if (!version) {
            return { status: "failed", message: "Latest version is unknown" };
          }
          state.hostJob =
            event.actionId === "install"
              ? controller.install(version)
              : controller.update(version);
          push();
          return { status: "succeeded" };
        }
        case "pull": {
          if (!event.value) {
            return { status: "failed", message: "No model name given" };
          }
          state.pullJob = controller.pull(event.value);
          push();
          return { status: "succeeded" };
        }
        case "cancel-pull":
          return controller.cancelPull()
            ? { status: "succeeded" }
            : { status: "failed", message: "No pull is running" };
        case "remove": {
          const name = event.selection?.itemId;
          if (!name) return { status: "failed", message: "No model selected" };
          await controller.remove(name);
          await refresh();
          return { status: "succeeded", message: `Removed ${name}` };
        }
        default:
          return { status: "failed", message: "Unknown action" };
      }
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    action,
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}
