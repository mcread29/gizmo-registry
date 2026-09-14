/**
 * Ollama — local LLM/SLM models for Gizmo.
 *
 * Pi only needs a valid extension factory here; the management surface lives
 * in `gizmoExtension` (src/server), which the paired browser bundle drives
 * through the workspace inspector.
 *
 * The factory registers an `ollama` provider whose model catalog refreshes
 * live from Ollama's `/api/tags` — no static model list, no persistence.
 * Registering unconditionally (even when Ollama is down) keeps the provider
 * present; `refreshModels` degrades to an empty catalog instead of failing
 * the model refresh.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import { listManagedModels } from "./src/shared/models.ts";
import { createOllamaClient } from "./src/shared/ollama-client.ts";
import type { ManagedModel } from "./src/shared/types.ts";
import { gizmoExtension } from "./src/server/index.ts";

export { gizmoExtension };

const OLLAMA_HOST = "http://localhost:11434";
/** Fallback when /api/show does not report a context length. */
const FALLBACK_CONTEXT_WINDOW = 8192;
/** Output cap: Ollama itself would generate until the context is full. */
const MAX_OUTPUT_TOKENS = 16_384;

function toProviderModel(model: ManagedModel): ProviderModelConfig {
	const contextWindow = model.contextLength ?? FALLBACK_CONTEXT_WINDOW;
	return {
		id: model.name,
		name: model.name,
		reasoning: model.capabilities.includes("thinking"),
		input: model.capabilities.includes("vision")
			? ["text", "image"]
			: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: Math.min(contextWindow, MAX_OUTPUT_TOKENS),
	};
}

export default async function ollama(_pi: ExtensionAPI) {
	const client = createOllamaClient();

	_pi.registerProvider("ollama", {
		name: "Ollama",
		baseUrl: `${OLLAMA_HOST}/v1`,
		// Ollama ignores credentials, but pi requires one for the provider.
		apiKey: "ollama",
		api: "openai-completions",
		async refreshModels({ signal }) {
			try {
				const models = await listManagedModels(client, signal);
				return models.map(toProviderModel);
			} catch {
				// Server down or mid-restart: an empty catalog beats a failed refresh.
				return [];
			}
		},
	});
}
