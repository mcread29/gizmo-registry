<script lang="ts">
  import {
    formatBytes,
    formatContext,
    formatPercent,
  } from "./format";
  import "./ollama.css";
  import { OllamaStore } from "./store.svelte";
  import type { OllamaCommandStore } from "./types";

  let {
    store: agentStore,
    projectPath,
  }: { store: OllamaCommandStore; projectPath?: string } = $props();

  let ollama = $state<OllamaStore | null>(null);
  let pullName = $state("");
  let confirmRemove = $state<string | null>(null);

  const SUGGESTIONS = ["qwen3", "llama3.2", "gemma3", "deepseek-r1", "phi4-mini"];

  $effect(() => {
    if (!projectPath) return;
    const store = new OllamaStore((operation, input) =>
      agentStore.invokeProjectExtension(
        projectPath,
        "ollama",
        operation,
        input,
      ),
    );
    ollama = store;
    store.start();
    return () => {
      store.stop();
      ollama = null;
    };
  });

  let canMutate = $derived(
    ollama !== null &&
      !ollama.busy &&
      ollama.hostJob?.status !== "running" &&
      ollama.pullJob?.status !== "running",
  );

  let latestVersion = $derived(ollama?.host?.latestVersion);

  function targetVersion(): string {
    return latestVersion ?? "";
  }

  async function submitPull(event: SubmitEvent) {
    event.preventDefault();
    if (!ollama || !pullName.trim()) return;
    const name = pullName.trim();
    pullName = "";
    await ollama.pull(name);
  }
</script>

<div data-ui="ollama-panel">
  <header data-ui="ollama-header">
    <strong>Ollama models</strong>
    {#if ollama?.host}
      <span data-ui="ollama-server" data-state={ollama.host.serverReachable ? "up" : "down"}>
        {ollama.host.serverReachable
          ? `server ${ollama.host.serverVersion ?? "running"}`
          : "server down"}
      </span>
    {/if}
    <button
      type="button"
      data-ui="ollama-refresh"
      disabled={ollama?.loading ?? true}
      onclick={() => void ollama?.refresh()}
    >
      Refresh
    </button>
  </header>

  {#if !projectPath}
    <div data-ui="empty-state">
      <strong>No workspace open</strong>
      <span>Ollama models are managed through a workspace connection.</span>
    </div>
  {:else if !ollama}
    <div data-ui="empty-state">
      <strong>Loading…</strong>
      <span>Ollama status will appear here.</span>
    </div>
  {:else if ollama.error}
    <p data-ui="ollama-error">{ollama.error}</p>
  {:else if ollama.host}
    <section data-ui="ollama-host">
      {#if !ollama.host.installed}
        <div data-ui="ollama-host-row">
          <div>
            <strong>Ollama is not installed</strong>
            <span data-ui="ollama-muted">
              {latestVersion
                ? `Installs Ollama ${latestVersion} for your platform.`
                : "Could not determine the latest version."}
            </span>
          </div>
          <button
            type="button"
            data-ui="ollama-action"
            disabled={!canMutate || !latestVersion}
            onclick={() => void ollama?.install(targetVersion())}
          >
            Install Ollama
          </button>
        </div>
      {:else}
        <div data-ui="ollama-host-row">
          <div>
            <strong>Ollama {ollama.host.version}</strong>
            <span data-ui="ollama-muted">
              {latestVersion
                ? `Latest release ${latestVersion}`
                : "Latest release unknown"}
            </span>
          </div>
          {#if ollama.host.updateAvailable}
            <button
              type="button"
              data-ui="ollama-action"
              disabled={!canMutate || !latestVersion}
              onclick={() => void ollama?.update(targetVersion())}
            >
              Update
            </button>
          {/if}
        </div>
        {#if ollama.host.note}
          <span data-ui="ollama-muted">{ollama.host.note}</span>
        {/if}
      {/if}
      {#if ollama.hostJob}
        <div data-ui="ollama-job" data-status={ollama.hostJob.status}>
          <div data-ui="ollama-job-head">
            <span>{ollama.hostJob.stage}</span>
            <span>{formatPercent(ollama.hostJob.percent)}</span>
          </div>
          {#if ollama.hostJob.status === "running"}
            <progress
              max="100"
              value={ollama.hostJob.percent ?? undefined}
            ></progress>
          {:else if ollama.hostJob.error}
            <span data-ui="ollama-muted">{ollama.hostJob.error}</span>
          {:else}
            <span data-ui="ollama-muted">
              {ollama.hostJob.status === "succeeded" ? "Done" : "Cancelled"}
            </span>
          {/if}
        </div>
      {/if}
    </section>

    <section data-ui="ollama-pull">
      <form data-ui="ollama-pull-form" onsubmit={submitPull}>
        <input
          type="text"
          placeholder="model, e.g. qwen3:8b"
          bind:value={pullName}
          disabled={!ollama.host.serverReachable}
          aria-label="Model to pull"
        />
        <button
          type="submit"
          data-ui="ollama-action"
          disabled={!canMutate || !ollama.host.serverReachable || !pullName.trim()}
        >
          Pull
        </button>
      </form>
      <div data-ui="ollama-suggestions">
        {#each SUGGESTIONS as suggestion (suggestion)}
          <button
            type="button"
            data-ui="ollama-chip"
            disabled={!ollama.host.serverReachable}
            onclick={() => {
              pullName = suggestion;
            }}
          >
            {suggestion}
          </button>
        {/each}
      </div>
      {#if ollama.pullJob}
        <div data-ui="ollama-job" data-status={ollama.pullJob.status}>
          <div data-ui="ollama-job-head">
            <span>{ollama.pullJob.target} · {ollama.pullJob.stage}</span>
            <span>{formatPercent(ollama.pullJob.percent)}</span>
          </div>
          {#if ollama.pullJob.status === "running"}
            <progress
              max="100"
              value={ollama.pullJob.percent ?? undefined}
            ></progress>
            <button
              type="button"
              data-ui="ollama-refresh"
              onclick={() => void ollama?.cancelPull()}
            >
              Cancel
            </button>
          {:else if ollama.pullJob.error}
            <span data-ui="ollama-muted">{ollama.pullJob.error}</span>
          {/if}
        </div>
      {/if}
    </section>

    <section data-ui="ollama-models">
      <h3>Installed models</h3>
      {#if !ollama.host.serverReachable}
        <div data-ui="empty-state">
          <strong>Server unreachable</strong>
          <span>Start Ollama to see and pull models.</span>
        </div>
      {:else if ollama.models.length === 0}
        <div data-ui="empty-state">
          <strong>No models yet</strong>
          <span>Pull a model above to make it available as a provider.</span>
        </div>
      {:else}
        <ul data-ui="ollama-model-list">
          {#each ollama.models as model (model.digest)}
            <li data-ui="ollama-model-row">
              <div data-ui="ollama-model-main">
                <strong>{model.name}</strong>
                <span data-ui="ollama-muted">
                  {[
                    model.parameterSize,
                    model.quantization,
                    formatBytes(model.size),
                    formatContext(model.contextLength),
                    model.capabilities.includes("thinking") ? "thinking" : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              {#if confirmRemove === model.name}
                <div data-ui="ollama-confirm">
                  <span>Remove?</span>
                  <button
                    type="button"
                    data-ui="ollama-action"
                    data-variant="danger"
                    disabled={!canMutate}
                    onclick={() => {
                      const name = model.name;
                      confirmRemove = null;
                      void ollama?.remove(name);
                    }}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    data-ui="ollama-refresh"
                    onclick={() => (confirmRemove = null)}
                  >
                    No
                  </button>
                </div>
              {:else}
                <button
                  type="button"
                  data-ui="ollama-refresh"
                  disabled={!canMutate}
                  onclick={() => (confirmRemove = model.name)}
                >
                  Remove
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</div>
