import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatContext, formatPercent } from "./format";
import { gizmoWebExtension } from "./index";
import { OllamaStore } from "./store.svelte";
import type { HostStatus, JobSnapshot, ManagedModel } from "../shared/types";

describe("format", () => {
  it("formats bytes and context windows", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
    expect(formatContext(40_960)).toBe("40k ctx");
    expect(formatContext(undefined)).toBe("");
    expect(formatPercent(41.4)).toBe("41%");
    expect(formatPercent(undefined)).toBe("");
  });
});

describe("gizmoWebExtension", () => {
  it("contributes a static Ollama inspector tab", () => {
    const tabs = gizmoWebExtension.inspectorTabs();
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe("ollama.models");
    expect(tabs[0].label).toBe("Ollama");
  });
});

describe("OllamaStore", () => {
  function job(partial: Partial<JobSnapshot>): JobSnapshot {
    return {
      kind: "pull",
      target: "qwen3:8b",
      status: "running",
      stage: "downloading",
      startedAt: 0,
      ...partial,
    };
  }

  const host: HostStatus = {
    platform: "windows",
    installed: true,
    version: "0.5.7",
    binaryPath: "C:/ollama/ollama.exe",
    serverReachable: true,
    serverVersion: "0.5.7",
    latestVersion: "0.6.0",
    updateAvailable: true,
  };

  const model: ManagedModel = {
    name: "qwen3:8b",
    size: 5_000_000_000,
    digest: "abc",
    modifiedAt: "2025-01-01T00:00:00Z",
    parameterSize: "8.2B",
    quantization: "Q4_K_M",
    contextLength: 40_960,
    capabilities: ["completion", "thinking"],
  };

  it("refreshes host, jobs, and models", async () => {
    const invoke = vi.fn(async (operation: string) => {
      if (operation === "host.status") return host;
      if (operation === "host.job") return null;
      if (operation === "models.pullJob") return job({});
      if (operation === "models.list") return { models: [model] };
      throw new Error(`unexpected ${operation}`);
    });
    const store = new OllamaStore(invoke);
    await store.refresh();
    expect(store.host).toEqual(host);
    expect(store.models).toEqual([model]);
    expect(store.pullJob?.status).toBe("running");
    expect(store.error).toBeNull();
  });

  it("clears models when the server is unreachable", async () => {
    const invoke = vi.fn(async (operation: string) => {
      if (operation === "host.status")
        return { ...host, serverReachable: false };
      if (operation === "host.job") return null;
      if (operation === "models.pullJob") return null;
      throw new Error(`unexpected ${operation}`);
    });
    const store = new OllamaStore(invoke);
    await store.refresh();
    expect(store.models).toEqual([]);
    expect(invoke).not.toHaveBeenCalledWith("models.list", undefined);
  });

  it("records invoke failures as an error", async () => {
    const store = new OllamaStore(
      vi.fn(async () => {
        throw new Error("server down");
      }),
    );
    await store.refresh();
    expect(store.error).toBe("server down");
  });

  it("pulls, removes, and refreshes afterwards", async () => {
    const invoke = vi.fn(async (operation: string, input?: unknown) => {
      if (operation === "models.pull")
        return job({ target: String((input as { name: string }).name) });
      if (operation === "models.remove")
        return { removed: (input as { name: string }).name };
      if (operation === "host.status") return host;
      if (operation === "host.job") return null;
      if (operation === "models.pullJob") return null;
      if (operation === "models.list") return { models: [model] };
      throw new Error(`unexpected ${operation}`);
    });
    const store = new OllamaStore(invoke);
    const snapshot = await store.pull("gemma3");
    expect(snapshot?.target).toBe("gemma3");
    const removed = await store.remove("qwen3:8b");
    expect(removed?.removed).toBe("qwen3:8b");
    expect(invoke).toHaveBeenCalledWith("models.pull", { name: "gemma3" });
    expect(invoke).toHaveBeenCalledWith("models.remove", { name: "qwen3:8b" });
    // both operations trigger a trailing refresh
    expect(invoke).toHaveBeenCalledWith("host.status");
    expect(invoke).toHaveBeenCalledWith("host.job");
    expect(invoke).toHaveBeenCalledWith("models.pullJob");
  });
});
