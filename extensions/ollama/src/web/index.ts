import OllamaPanel from "./OllamaPanel.svelte";
import type { OllamaInspectorTab } from "./types";

/**
 * Ollama's web presentation, paired with the Pi extension of the same id: a
 * workspace-inspector tab for managing the local Ollama host and its models.
 * Machine-global concerns, surfaced through the workspace's extension invoke
 * channel; no per-project activation required.
 */
export const gizmoWebExtension = {
  id: "ollama",
  inspectorTabs(): OllamaInspectorTab[] {
    return [
      {
        id: "ollama.models",
        label: "Ollama",
        component: OllamaPanel,
        props: {},
      },
    ];
  },
};
