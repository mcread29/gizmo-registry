import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contextLengthFromShow,
  createOllamaClient,
  OllamaRequestError,
} from "./ollama-client.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createOllamaClient", () => {
  it("reports the server version", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ version: "0.5.7" })),
    );
    const client = createOllamaClient();
    await expect(client.version()).resolves.toBe("0.5.7");
  });

  it("returns null when nothing is listening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const client = createOllamaClient();
    await expect(client.version()).resolves.toBeNull();
  });

  it("surfaces Ollama error bodies as OllamaRequestError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "model not found" }, 404)),
    );
    const client = createOllamaClient();
    await expect(client.show("missing")).rejects.toMatchObject({
      name: "OllamaRequestError",
      status: 404,
      message: "model not found",
    });
  });

  it("lists tags and tolerates a missing models array", async () => {
    const model = {
      name: "qwen3:8b",
      model: "qwen3:8b",
      size: 5_000_000_000,
      digest: "abc",
      modified_at: "2025-01-01T00:00:00Z",
      details: {
        family: "qwen3",
        families: ["qwen3"],
        parameter_size: "8.2B",
        quantization_level: "Q4_K_M",
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ models: [model] })),
    );
    const client = createOllamaClient();
    await expect(client.tags()).resolves.toEqual([model]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );
    await expect(client.tags()).resolves.toEqual([]);
  });

  it("sends DELETE with the model name", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const client = createOllamaClient();
    await client.remove("qwen3:8b");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit & { body?: string },
    ];
    expect(url).toBe("http://localhost:11434/api/delete");
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(init.body ?? "{}")).toEqual({ model: "qwen3:8b" });
  });

  it("streams NDJSON pull progress and rejects on error lines", async () => {
    const lines = [
      JSON.stringify({ status: "pulling manifest" }),
      JSON.stringify({ status: "downloading", total: 100, completed: 40 }),
      JSON.stringify({ status: "success" }),
    ];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(lines.join("\n") + "\n"));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const client = createOllamaClient();
    const progress: string[] = [];
    await client.pull("qwen3:8b", (line) => progress.push(line.status));
    expect(progress).toEqual(["pulling manifest", "downloading", "success"]);

    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(JSON.stringify({ error: "no such model" })),
        );
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(errorStream, { status: 200 })),
    );
    await expect(client.pull("nope", () => {})).rejects.toMatchObject({
      name: "OllamaRequestError",
      message: "no such model",
    });
  });

  it("buffers partial NDJSON lines across chunks", async () => {
    const chunks = [
      new TextEncoder().encode('{"status":"downloading","tot'),
      new TextEncoder().encode('al":10,"completed":5}\n{"status":"success"}\n'),
    ];
    let index = 0;
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(chunks[index] ?? new Uint8Array());
        index += 1;
        if (index > chunks.length) controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(stream, { status: 200 })),
    );
    const client = createOllamaClient();
    const progress: unknown[] = [];
    await client.pull("m", (line) => progress.push(line));
    expect(progress).toHaveLength(2);
  });

  it("passes an abort signal through to fetch", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ version: "1" }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const client = createOllamaClient();
    await client.version(controller.signal);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("contextLengthFromShow", () => {
  it("finds the architecture-keyed context length", () => {
    expect(
      contextLengthFromShow({ model_info: { "qwen3.context_length": 40_960 } }),
    ).toBe(40_960);
  });

  it("returns undefined when absent", () => {
    expect(contextLengthFromShow({ model_info: {} })).toBeUndefined();
    expect(contextLengthFromShow({})).toBeUndefined();
  });
});

describe("request errors", () => {
  it("is an Error subclass", () => {
    expect(new OllamaRequestError(500, "boom")).toBeInstanceOf(Error);
  });
});
