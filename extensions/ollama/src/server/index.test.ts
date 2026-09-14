import { describe, expect, it, vi } from "vitest";
import type { OllamaClient } from "../shared/ollama-client.ts";
import type { ManagedModel } from "../shared/types.ts";
import { createOllamaExtension, InvalidInputError } from "./index.ts";
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

function deferred<T = void>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

describe("ollama gizmoExtension", () => {
	it("describes its operations", async () => {
		const extension = createOllamaExtension({ client: stubClient() });
		const [descriptor] = await extension.list!("/ws", new AbortController().signal);
		expect(descriptor.id).toBe("ollama");
		expect(descriptor.apiVersion).toBe(1);
		const ids = descriptor.operations.map((operation) => operation.id);
		expect(ids).toContain("host.status");
		expect(ids).toContain("models.remove");
		const remove = descriptor.operations.find(
			(operation) => operation.id === "models.remove",
		);
		expect(remove?.requiresConfirmation).toBe(true);
	});

	it("rejects foreign extension ids and unknown operations", async () => {
		const extension = createOllamaExtension({ client: stubClient() });
		await expect(
			extension.invoke!("/ws", "other", "models.list", {}, undefined),
		).rejects.toThrow("Extension is not installed: other");
		await expect(
			extension.invoke!("/ws", "ollama", "nope", {}, undefined),
		).rejects.toThrow("does not expose operation: nope");
	});

	it("answers host.status from the detection seam", async () => {
		const status = {
			platform: "windows" as const,
			installed: true,
			version: "0.5.7",
			serverReachable: true,
			serverVersion: "0.5.7",
			updateAvailable: false,
		};
		const extension = createOllamaExtension({
			client: stubClient(),
			detectHost: async () => status,
		});
		await expect(
			extension.invoke!("/ws", "ollama", "host.status", {}, undefined),
		).resolves.toEqual(status);
	});

	it("lists models", async () => {
		const client = stubClient();
		const extension = createOllamaExtension({ client });
		(client.tags as ReturnType<typeof vi.fn>).mockResolvedValue([
			{
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
			},
		]);
		(client.show as ReturnType<typeof vi.fn>).mockResolvedValue({
			capabilities: ["completion", "thinking"],
			model_info: { "qwen3.context_length": 40_960 },
		});
		await expect(
			extension.invoke!("/ws", "ollama", "models.list", {}, undefined),
		).resolves.toEqual({ models: [sampleModel] });
	});

	it("validates model input", async () => {
		const extension = createOllamaExtension({ client: stubClient() });
		await expect(
			extension.invoke!("/ws", "ollama", "models.remove", {}, undefined),
		).rejects.toThrow(InvalidInputError);
		await expect(
			extension.invoke!(
				"/ws",
				"ollama",
				"models.remove",
				{ name: " " },
				undefined,
			),
		).rejects.toThrow(InvalidInputError);
	});

	it("pulls a model and reports job progress", async () => {
		const gate = deferred();
		const pull = vi.fn(async (_name, onProgress, _signal) => {
			onProgress({ status: "downloading", total: 100, completed: 40 });
			await gate.promise;
		});
		const client = stubClient({ pull: pull as unknown as OllamaClient["pull"] });
		const extension = createOllamaExtension({ client });

		const snapshot = (await extension.invoke!(
			"/ws",
			"ollama",
			"models.pull",
			{ name: "qwen3:8b" },
			undefined,
		)) as { status: string; target: string };
		expect(snapshot.status).toBe("running");
		expect(snapshot.target).toBe("qwen3:8b");

		await vi.waitFor(() => {
			expect((client.pull as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
			return true;
		});
		await vi.waitFor(async () => {
			const job = (await extension.invoke!(
				"/ws",
				"ollama",
				"models.pullJob",
				{},
				undefined,
			)) as { percent?: number };
			expect(job.percent).toBe(40);
		});
		gate.resolve();
		await vi.waitFor(async () => {
			const job = (await extension.invoke!(
				"/ws",
				"ollama",
				"models.pullJob",
				{},
				undefined,
			)) as { status: string };
			expect(job.status).toBe("succeeded");
		});
	});

	it("refuses a second concurrent pull", async () => {
		const gate = deferred();
		const client = stubClient({
			pull: vi.fn(async () => {
				await gate.promise;
			}) as unknown as OllamaClient["pull"],
		});
		const extension = createOllamaExtension({ client });
		await extension.invoke!("/ws", "ollama", "models.pull", { name: "m" }, undefined);
		await expect(
			extension.invoke!("/ws", "ollama", "models.pull", { name: "m2" }, undefined),
		).rejects.toThrow(JobActiveError);
		gate.resolve();
	});

	it("cancels an active pull", async () => {
		const registry = new JobRegistry();
		const client = stubClient({
			pull: vi.fn(async (_name, _progress, signal) => {
				await vi.waitFor(() => expect(signal?.aborted).toBe(true));
			}) as unknown as OllamaClient["pull"],
		});
		const extension = createOllamaExtension({ client, jobs: registry });
		await extension.invoke!("/ws", "ollama", "models.pull", { name: "m" }, undefined);
		await expect(
			extension.invoke!("/ws", "ollama", "models.pullCancel", {}, undefined),
		).resolves.toEqual({ cancelled: true });
		await vi.waitFor(async () => {
			const job = (await extension.invoke!(
				"/ws",
				"ollama",
				"models.pullJob",
				{},
				undefined,
			)) as { status: string };
			expect(job.status).toBe("cancelled");
		});
	});

	it("removes a model", async () => {
		const client = stubClient();
		const extension = createOllamaExtension({ client });
		await expect(
			extension.invoke!(
				"/ws",
				"ollama",
				"models.remove",
				{ name: "qwen3:8b" },
				undefined,
			),
		).resolves.toEqual({ removed: "qwen3:8b" });
		expect(client.remove).toHaveBeenCalledWith(
			"qwen3:8b",
			expect.any(AbortSignal),
		);
	});

	it("validates version input for host jobs", async () => {
		const extension = createOllamaExtension({ client: stubClient() });
		await expect(
			extension.invoke!("/ws", "ollama", "host.install", {}, undefined),
		).rejects.toThrow(InvalidInputError);
		await expect(
			extension.invoke!(
				"/ws",
				"ollama",
				"host.install",
				{ version: "banana" },
				undefined,
			),
		).rejects.toThrow(InvalidInputError);
	});
});
