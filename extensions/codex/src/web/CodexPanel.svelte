<script lang="ts">
  import { CodexRuntime } from "./codex-runtime.svelte";
  import {
    formatDuration,
    usageTone,
    windowLabel,
    type CodexUsageWindow,
  } from "../usage.ts";
  import "./codex.css";

  let { runtime }: { runtime: CodexRuntime } = $props();

  let showEmail = $state(false);

  let windows = $derived(
    [runtime.usage?.primary, runtime.usage?.secondary].filter(
      (window): window is CodexUsageWindow => window !== null,
    ),
  );

  function barWidth(window: CodexUsageWindow): string {
    return `${Math.min(100, Math.max(0, window.usedPercent))}%`;
  }

  function usedText(window: CodexUsageWindow): string {
    return `${Math.round(window.usedPercent)}% used · resets in ${formatDuration(window.resetAfterSeconds)}`;
  }
</script>

<div data-ui="codex-panel">
  {#if runtime.error}
    <p data-ui="codex-error">{runtime.error}</p>
  {:else if !runtime.usage}
    <div data-ui="empty-state">
      <strong>Loading…</strong>
      <span>Codex usage and limits will appear here.</span>
    </div>
  {:else}
    {#if runtime.usage.limitReached}
      <p data-ui="codex-limit-reached">
        Limit reached — Codex pauses requests until the window resets.
      </p>
    {/if}

    <section data-ui="codex-windows">
      {#each windows as window (window.windowSeconds)}
        <div data-ui="codex-window" data-tone={usageTone(window.usedPercent)}>
          <div data-ui="codex-window-head">
            <strong>{windowLabel(window.windowSeconds)} window</strong>
            <span>{usedText(window)}</span>
          </div>
          <div
            data-ui="codex-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(window.usedPercent)}
            aria-label={`${windowLabel(window.windowSeconds)} window usage`}
          >
            <div
              data-ui="codex-bar-fill"
              style={`width:${barWidth(window)}`}
            ></div>
          </div>
        </div>
      {/each}
    </section>

    {#if runtime.usage.additional.length > 0}
      <section data-ui="codex-additional">
        <h3>Additional limits</h3>
        {#each runtime.usage.additional as limit (limit.name)}
          <div data-ui="codex-additional-limit">
            <strong>{limit.name}</strong>
            <span>
              {#if limit.primary}
                {windowLabel(limit.primary.windowSeconds)}
                {Math.round(limit.primary.usedPercent)}%
              {/if}
              {#if limit.secondary}
                {#if limit.primary}·{/if}
                {windowLabel(limit.secondary.windowSeconds)}
                {Math.round(limit.secondary.usedPercent)}%
              {/if}
              {#if !limit.primary && !limit.secondary}no usage tracked{/if}
            </span>
          </div>
        {/each}
      </section>
    {/if}

    {#if runtime.usage.credits?.hasCredits || runtime.usage.credits?.unlimited}
      <p data-ui="codex-credits">
        {#if runtime.usage.credits?.unlimited}
          Unlimited credits
        {:else}
          Credit balance: {runtime.usage.credits?.balance}
        {/if}
      </p>
    {/if}

    <footer data-ui="codex-footer">
      <span>
        Updated {new Date(runtime.updatedAt).toLocaleTimeString()}
      </span>
      {#if runtime.usage.email}
        {#if showEmail}
          <span data-ui="codex-email">{runtime.usage.email}</span>
        {/if}
        <button
          type="button"
          data-ui="codex-email-toggle"
          aria-expanded={showEmail}
          onclick={() => (showEmail = !showEmail)}
        >
          {showEmail ? "Hide email" : "Show email"}
        </button>
      {/if}
    </footer>
  {/if}
</div>
