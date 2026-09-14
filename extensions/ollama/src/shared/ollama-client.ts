/**
 * Typed HTTP client for a local Ollama server's REST API.
 *
 * A pure fetch wrapper: no process interaction, no job state, no provider
 * knowledge. Everything the server extension needs to inspect and mutate
 * Ollama's model store, and the single seam tests stub out.
 */

export interface OllamaModelDetails {
  family: string;
  families: string[] | null;
  parameter_size: string;
  quantization_level: string;
}

export interface OllamaTaggedModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details: OllamaModelDetails;
}

export interface OllamaShowResponse {
  license?: string;
  modelfile?: string;
  parameters?: string;
  template?: string;
  details?: OllamaModelDetails;
  model_info?: Record<string, unknown>;
  capabilities?: string[];
}

export interface PullProgressLine {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export class OllamaRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OllamaRequestError";
    this.status = status;
  }
}

export interface OllamaClientOptions {
  /** Base URL of the Ollama server, default `http://localhost:11434`. */
  baseUrl?: string;
  /** Per-request timeout for simple (non-streaming) calls. */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 10_000;

export function createOllamaClient(options: OllamaClientOptions = {}) {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<Response> {
    const { json, ...rest } = init;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const external = rest.signal;
    const signal = external
      ? AbortSignal.any([controller.signal, external])
      : controller.signal;
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...rest,
        signal,
        headers: { "Content-Type": "application/json", ...rest.headers },
        body: json === undefined ? rest.body : JSON.stringify(json),
      });
      if (!response.ok) {
        let detail = `${response.status} ${response.statusText}`;
        try {
          const body = (await response.json()) as { error?: string };
          if (body.error) detail = body.error;
        } catch {
          // keep the status-line detail
        }
        throw new OllamaRequestError(response.status, detail);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestJson<T>(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<T> {
    const response = await request(path, init);
    return (await response.json()) as T;
  }

  return {
    baseUrl,

    /**
     * `/api/version` — the server's version, or `null` when nothing is
     * listening (connection-level failure only; HTTP errors propagate).
     */
    async version(signal?: AbortSignal): Promise<string | null> {
      try {
        const body = await requestJson<{ version?: string }>("/api/version", {
          method: "GET",
          signal,
        });
        return body.version ?? null;
      } catch (error) {
        if (error instanceof OllamaRequestError) throw error;
        return null;
      }
    },

    /** `/api/tags` — every model in the local store. */
    async tags(signal?: AbortSignal): Promise<OllamaTaggedModel[]> {
      const body = await requestJson<{ models?: OllamaTaggedModel[] }>(
        "/api/tags",
        { method: "GET", signal },
      );
      return body.models ?? [];
    },

    /** `/api/show` — details for one model. */
    async show(
      name: string,
      signal?: AbortSignal,
    ): Promise<OllamaShowResponse> {
      return requestJson<OllamaShowResponse>("/api/show", {
        method: "POST",
        json: { model: name },
        signal,
      });
    },

    /** `/api/delete` — remove one model from the local store. */
    async remove(name: string, signal?: AbortSignal): Promise<void> {
      await request("/api/delete", {
        method: "DELETE",
        json: { model: name },
        signal,
      });
    },

    /**
     * `/api/pull` — stream download progress as NDJSON lines. Resolves when
     * the pull finishes; rejects on HTTP errors, `{"error": ...}` lines, or
     * abortion. Throws `OllamaRequestError` with status 0 on abort.
     */
    async pull(
      name: string,
      onProgress: (line: PullProgressLine) => void,
      signal?: AbortSignal,
    ): Promise<void> {
      const response = await request("/api/pull", {
        method: "POST",
        json: { model: name, stream: true },
        signal,
      });
      if (!response.body) {
        throw new OllamaRequestError(0, "Ollama returned no response body");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const emit = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        const parsed = JSON.parse(trimmed) as PullProgressLine;
        if (parsed.error) {
          throw new OllamaRequestError(0, parsed.error);
        }
        onProgress(parsed);
      };
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let newlineAt = buffered.indexOf("\n");
          while (newlineAt !== -1) {
            emit(buffered.slice(0, newlineAt));
            buffered = buffered.slice(newlineAt + 1);
            newlineAt = buffered.indexOf("\n");
          }
        }
        emit(buffered);
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export type OllamaClient = ReturnType<typeof createOllamaClient>;

/**
 * Pull the context window out of a `/api/show` response. Ollama reports it in
 * `model_info` under an architecture-keyed field like `llama.context_length`.
 */
export function contextLengthFromShow(
  show: OllamaShowResponse,
): number | undefined {
  for (const [key, value] of Object.entries(show.model_info ?? {})) {
    if (key.endsWith(".context_length") && typeof value === "number") {
      return value;
    }
  }
  return undefined;
}
