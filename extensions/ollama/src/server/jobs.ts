/**
 * A tiny registry of long-running background jobs, keyed by kind
 * ("pull", "host"). One active job per kind; the last finished job of a kind
 * stays visible until the next one starts, so the UI can render its outcome.
 *
 * Pure bookkeeping: the actual work (Ollama HTTP streams, installers) is
 * handed in as the `run` callback and drives the job through its handle.
 */

import type { JobKind, JobSnapshot, JobStatus } from "../shared/types.ts";

export type { JobKind, JobSnapshot, JobStatus };

export interface JobHandle {
	setStage(stage: string, message?: string): void;
	setProgress(progress: {
		completed?: number;
		total?: number;
		message?: string;
	}): void;
}

export class JobActiveError extends Error {
	constructor(kind: JobKind) {
		super(`A ${kind} job is already running`);
		this.name = "JobActiveError";
	}
}

export class JobRegistry {
	readonly #jobs = new Map<JobKind, JobSnapshot & { controller: AbortController }>();

	/**
	 * Start a job of `kind`. Throws `JobActiveError` if one is already
	 * running. The returned snapshot is the state at start; observe later
	 * state through `snapshot(kind)`.
	 */
	start(
		kind: JobKind,
		target: string,
		run: (job: JobHandle, signal: AbortSignal) => Promise<void>,
	): JobSnapshot {
		const existing = this.#jobs.get(kind);
		if (existing?.status === "running") throw new JobActiveError(kind);

		const controller = new AbortController();
		const job: JobSnapshot & { controller: AbortController } = {
			kind,
			target,
			status: "running",
			stage: "starting",
			percent: undefined,
			message: undefined,
			error: undefined,
			startedAt: Date.now(),
			finishedAt: undefined,
			controller,
		};
		this.#jobs.set(kind, job);

		const handle: JobHandle = {
			setStage: (stage, message) => {
				if (job.status !== "running") return;
				job.stage = stage;
				job.message = message;
				job.percent = undefined;
			},
			setProgress: ({ completed, total, message }) => {
				if (job.status !== "running") return;
				if (message !== undefined) job.message = message;
				if (typeof total === "number" && total > 0) {
					job.percent = Math.min(
						100,
						Math.max(0, ((completed ?? 0) / total) * 100),
					);
				}
			},
		};

		void run(handle, controller.signal)
			.then(() => {
				if (job.status !== "running") return;
				// A run that resolves after cancellation is still a cancellation.
				job.status = controller.signal.aborted ? "cancelled" : "succeeded";
				if (!controller.signal.aborted) job.percent = 100;
				job.finishedAt = Date.now();
			})
			.catch((error: unknown) => {
				if (job.status !== "running") return;
				job.status = controller.signal.aborted ? "cancelled" : "failed";
				job.error =
					error instanceof Error ? error.message : String(error ?? "failed");
				job.finishedAt = Date.now();
			});

		return this.snapshot(kind)!;
	}

	snapshot(kind: JobKind): JobSnapshot | null {
		const job = this.#jobs.get(kind);
		if (!job) return null;
		const { controller: _controller, ...rest } = job;
		return rest;
	}

	/** Whether a job of `kind` is currently accepting cancel requests. */
	cancel(kind: JobKind): boolean {
		const job = this.#jobs.get(kind);
		if (job?.status !== "running") return false;
		job.controller.abort();
		return true;
	}
}
