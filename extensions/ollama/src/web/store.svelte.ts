import type { HostStatus, JobSnapshot, ManagedModel } from "../shared/types.ts";

export type OllamaInvoke = (
  operation: string,
  input?: unknown,
) => Promise<unknown>;

const FAST_POLL_MS = 700;
const SLOW_POLL_MS = 15_000;

/**
 * Reactive view of the agent-server Ollama operations: host status, models,
 * and job progress, with polling that speeds up while a job is running.
 */
export class OllamaStore {
  host = $state<HostStatus | null>(null);
  models = $state<ManagedModel[]>([]);
  hostJob = $state<JobSnapshot | null>(null);
  pullJob = $state<JobSnapshot | null>(null);
  error = $state<string | null>(null);
  loading = $state(true);
  /** A mutating operation is in flight (pull/install/update/remove). */
  busy = $state(false);

  #invoke: OllamaInvoke;
  #timer: ReturnType<typeof setInterval> | undefined;
  #ticks = 0;

  constructor(invoke: OllamaInvoke) {
    this.#invoke = invoke;
  }

  async refresh(): Promise<void> {
    try {
      const host = (await this.#invoke("host.status")) as HostStatus | null;
      this.host = host;
      this.hostJob = (await this.#invoke("host.job")) as JobSnapshot | null;
      this.pullJob = (await this.#invoke(
        "models.pullJob",
      )) as JobSnapshot | null;
      if (host?.serverReachable) {
        const { models } = (await this.#invoke("models.list")) as {
          models: ManagedModel[];
        };
        this.models = models;
      } else {
        this.models = [];
      }
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.loading = false;
    }
  }

  async run<T>(operation: string, input?: unknown): Promise<T | undefined> {
    this.busy = true;
    try {
      const result = (await this.#invoke(operation, input)) as T;
      this.error = null;
      return result;
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      return undefined;
    } finally {
      this.busy = false;
      await this.refresh();
    }
  }

  pull(name: string): Promise<JobSnapshot | undefined> {
    return this.run<JobSnapshot>("models.pull", { name });
  }

  install(version: string): Promise<JobSnapshot | undefined> {
    return this.run<JobSnapshot>("host.install", { version });
  }

  update(version: string): Promise<JobSnapshot | undefined> {
    return this.run<JobSnapshot>("host.update", { version });
  }

  remove(name: string): Promise<{ removed: string } | undefined> {
    return this.run<{ removed: string }>("models.remove", { name });
  }

  cancelPull(): Promise<{ cancelled: boolean } | undefined> {
    return this.run<{ cancelled: boolean }>("models.pullCancel");
  }

  start(): void {
    this.stop();
    void this.refresh();
    this.#timer = setInterval(() => {
      this.#ticks += 1;
      const jobRunning =
        this.pullJob?.status === "running" ||
        this.hostJob?.status === "running";
      // Fast cadence while a job runs; otherwise a slow status heartbeat.
      if (
        jobRunning ||
        this.#ticks % Math.round(SLOW_POLL_MS / FAST_POLL_MS) === 0
      ) {
        void this.refresh();
      }
    }, FAST_POLL_MS);
  }

  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}
