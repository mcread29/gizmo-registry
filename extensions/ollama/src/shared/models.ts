/**
 * Model listing shared by the server extension's `models.list` operation and
 * the Pi provider's `refreshModels`: `/api/tags` enriched per model with
 * `/api/show` details (context length, capabilities) at bounded concurrency.
 */

import type { OllamaClient, OllamaShowResponse, OllamaTaggedModel } from "./ollama-client.ts";
import { contextLengthFromShow } from "./ollama-client.ts";
import type { ManagedModel } from "./types.ts";

const SHOW_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(items.length);
	let next = 0;
	async function worker(): Promise<void> {
		while (next < items.length) {
			const index = next;
			next += 1;
			try {
				results[index] = { status: "fulfilled", value: await fn(items[index], index) };
			} catch (error) {
				results[index] = { status: "rejected", reason: error };
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, () => worker()),
	);
	return results;
}

function showToModelDetails(
	show: OllamaShowResponse,
): Pick<ManagedModel, "contextLength" | "capabilities"> {
	return {
		contextLength: contextLengthFromShow(show),
		capabilities: show.capabilities ?? [],
	};
}

export function managedModelFromTagged(
	tagged: OllamaTaggedModel,
): Omit<ManagedModel, "contextLength"> {
	return {
		name: tagged.name,
		size: tagged.size,
		digest: tagged.digest,
		modifiedAt: tagged.modified_at,
		family: tagged.details?.family,
		parameterSize: tagged.details?.parameter_size,
		quantization: tagged.details?.quantization_level,
		capabilities: [],
	};
}

export async function listManagedModels(
	client: OllamaClient,
	signal?: AbortSignal,
): Promise<ManagedModel[]> {
	const tagged = await client.tags(signal);
	const shows = await mapWithConcurrency(tagged, SHOW_CONCURRENCY, (model) =>
		client.show(model.name, signal),
	);
	return tagged.map((model, index) => {
		const base = managedModelFromTagged(model);
		const show = shows[index];
		if (show.status === "fulfilled") {
			return { ...base, ...showToModelDetails(show.value) };
		}
		// A model can vanish between tags and show; keep the tag-level data.
		return base;
	});
}
