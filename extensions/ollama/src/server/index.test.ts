import { describe, expect, it, vi } from "vitest";
import { parseView, type View } from "@gizmo/extension-api";
import type { OllamaClient } from "../shared/ollama-client.ts";
import type { HostStatus, ManagedModel } from "../shared/types.ts";
import {
  createOllamaController,
  createOllamaExtension,
  InvalidInputError,
} from "./index.ts";
import { JobActiveError, JobRegistry } from "./jobs.ts";

function stubClient(overrides: Partial<OllamaClient> = {}): OllamaClient {
  return {
    baseUrl: "http://localhost:11434",
    version: vi.fn(async () => "0.5.7"),
    tags: vi.fn(async () => []),
    show: vi.fn(async () => ({})),
    remove: vi.fn(async () => {}),
    pull: vi.fn(async () => {}),
    ...overrides,
  } as OllamaClient;
}

const sampleModel: ManagedModel = {
  name: "qwen3:8b",
  size: 5_000_000_000,
  digest: "abc",
  modifiedAt: "2025-01-01T00:00:00Z",
  family: "qwen3",
  parameterSize: "8.2B",
  quantization: "Q4_K_M",
  contextLength: 40_960,
  capabilities: ["completion", "thinking"],
};

const hostStatus: HostStatus = {
  platform: "linux",
  installed: true,
  version: "0.5.7",
  serverReachable: true,
  serverVersion: "0.5.7",
  latestVersion: "0.5.8",
  updateAvailable: true,
};

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function taggedSample() {
  return {
    name: sampleModel.name,
    model: sampleModel.name,
    size: sampleModel.size,
    digest: sampleModel.digest,
    modified_at: sampleModel.modifiedAt,
    details: {
      family: "qwen3",
      families: null,
      parameter_size: "8.2B",
      quantization_level: "Q4_K_M",
    },
  };
}

describe("ollama controller", () => {
  it("answers host status from the detection seam", async () => {
    const controller = createOllamaController({
      client: stubClient(),
      detectHost: async () => hostStatus,
    });
    await expect(controller.status()).resolves.toEqual(hostStatus);
  });

  it("lists models", async () => {
    const client = stubClient();
    (client.tags as ReturnType<typeof vi.fn>).mockResolvedValue([
      taggedSample(),
    ]);
    (client.show as ReturnType<typeof vi.fn>).mockResolvedValue({
      capabilities: ["completion", "thinking"],
      model_info: { "qwen3.context_length": 40_960 },
    });
    const controller = createOllamaController({ client });
    await expect(controller.models()).resolves.toEqual([sampleModel]);
  });

  it("validates model and version input", () => {
    const controller = createOllamaController({ client: stubClient() });
    expect(() => controller.pull(" ")).toThrow(InvalidInputError);
    expect(controller.remove(" ")).rejects.toThrow(InvalidInputError);
    expect(() => controller.install("banana")).toThrow(InvalidInputError);
  });

  it("pulls a model and reports job progress", async () => {
    const gate = deferred();
    const pull = vi.fn(async (_name, onProgress, _signal) => {
      onProgress({ status: "downloading", total: 100, completed: 40 });
      await gate.promise;
    });
    const client = stubClient({
      pull: pull as unknown as OllamaClient["pull"],
    });
    const controller = createOllamaController({ client });

    const snapshot = controller.pull("qwen3:8b");
    expect(snapshot.status).toBe("running");
    expect(snapshot.target).toBe("qwen3:8b");
    await vi.waitFor(() => expect(controller.pullJob()?.percent).toBe(40));
    gate.resolve();
    await vi.waitFor(() =>
      expect(controller.pullJob()?.status).toBe("succeeded"),
    );
  });

  it("refuses a second concurrent pull", async () => {
    const gate = deferred();
    const client = stubClient({
      pull: vi.fn(async () => {
        await gate.promise;
      }) as unknown as OllamaClient["pull"],
    });
    const controller = createOllamaController({ client });
    controller.pull("m");
    expect(() => controller.pull("m2")).toThrow(JobActiveError);
    gate.resolve();
  });

  it("cancels an active pull", async () => {
    const client = stubClient({
      pull: vi.fn(async (_name, _progress, signal) => {
        await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      }) as unknown as OllamaClient["pull"],
    });
    const controller = createOllamaController({
      client,
      jobs: new JobRegistry(),
    });
    controller.pull("m");
    expect(controller.cancelPull()).toBe(true);
    await vi.waitFor(() =>
      expect(controller.pullJob()?.status).toBe("cancelled"),
    );
  });

  it("removes a model", async () => {
    const client = stubClient();
    const controller = createOllamaController({ client });
    await expect(controller.remove("qwen3:8b")).resolves.toEqual({
      removed: "qwen3:8b",
    });
    expect(client.remove).toHaveBeenCalledWith(
      "qwen3:8b",
      expect.any(AbortSignal),
    );
  });
});

describe("ollama view", () => {
  function fakeContext() {
    const updates: View[] = [];
    return {
      updates,
      context: {
        workspacePath: "/ws",
        settings: {},
        update: (view: View) => updates.push(view),
      },
    };
  }

  it("pushes a valid view on open and clears its timer on dispose", async () => {
    vi.useFakeTimers();
    try {
      const client = stubClient();
      (client.tags as ReturnType<typeof vi.fn>).mockResolvedValue([
        taggedSample(),
      ]);
      const extension = createOllamaExtension({
        client,
        detectHost: async () => hostStatus,
      });
      const { updates, context } = fakeContext();
      const handle = await extension.views.models.open(context);
      expect(updates).toHaveLength(1);
      expect(parseView(updates[0])).toEqual(updates[0]);
      expect(vi.getTimerCount()).toBe(1);
      await vi.waitFor(() => expect(updates.length).toBeGreaterThan(1));
      const loaded = updates.at(-1)!;
      expect(parseView(loaded)).toEqual(loaded);
      expect(JSON.stringify(loaded)).toContain("qwen3:8b");
      await handle.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("removes the selected model through an action", async () => {
    const client = stubClient();
    const extension = createOllamaExtension({
      client,
      detectHost: async () => hostStatus,
    });
    const { context } = fakeContext();
    const handle = await extension.views.models.open(context);
    const result = await handle.action?.({
      actionId: "remove",
      selection: { blockId: "models", itemId: "qwen3:8b" },
      cancelled: false,
    });
    expect(result?.status).toBe("succeeded");
    expect(client.remove).toHaveBeenCalled();
    await handle.dispose();
  });
});
