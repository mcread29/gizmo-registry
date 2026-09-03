import type { Component } from "svelte";
import type { CodexUsageSnapshot } from "../usage.ts";
import type {
  ExtensionContext,
  InspectorTabContribution,
  WebExtensionRuntime,
} from "./types.ts";
import CodexPanel from "./CodexPanel.svelte";

const POLL_MS = 60_000;

/**
 * Module-scoped holder for the active runtime. The status bar contribution is
 * static — it receives no runtime handle — so it reads this instead; Svelte 5
 * module state keeps the titlebar reactive to whatever runtime was activated
 * for the selected workspace.
 */
const active = $state<{ runtime: CodexRuntime | undefined }>({
  runtime: undefined,
});

export function activeCodexRuntime(): CodexRuntime | undefined {
  return active.runtime;
}

/**
 * Codex's web runtime: polls the server-side `usage` operation (limits move
 * slowly, so once a minute is plenty) and feeds the inspector tab and status
 * bar indicator.
 */
export class CodexRuntime implements WebExtensionRuntime {
  usage = $state<CodexUsageSnapshot | undefined>(undefined);
  loading = $state(true);
  error = $state<string>();
  updatedAt = $state(0);

  readonly #context: ExtensionContext;
  readonly #timer: ReturnType<typeof setInterval>;
  #request?: Promise<void>;
  #disposed = false;

  constructor(context: ExtensionContext) {
    this.#context = context;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), POLL_MS);
    active.runtime = this;
  }

  get inspectorTabs(): InspectorTabContribution[] {
    const worst = this.worstUsedPercent;
    return [
      {
        id: "codex.usage",
        label: "Codex",
        badge: worst !== undefined ? Math.round(worst) : undefined,
        badgeTone: worst !== undefined && worst >= 90 ? "danger" : "accent",
        component: CodexPanel as Component<any>,
        props: { runtime: this },
      },
    ];
  }

  /** Highest consumption across the plan's windows; drives badge and tone. */
  get worstUsedPercent(): number | undefined {
    const primary = this.usage?.primary?.usedPercent;
    const secondary = this.usage?.secondary?.usedPercent;
    if (primary === undefined && secondary === undefined) return undefined;
    return Math.max(primary ?? 0, secondary ?? 0);
  }

  refresh(manual = false): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    if (this.#request) return this.#request;
    if (!manual && Date.now() - this.updatedAt < POLL_MS) {
      return Promise.resolve();
    }
    this.#request = this.#context
      .invoke("usage")
      .then((value) => {
        if (this.#disposed) return;
        if (
          typeof value !== "object" ||
          value === null ||
          !("fetchedAt" in value)
        ) {
          this.error = "Codex extension returned invalid data";
          return;
        }
        this.usage = value as CodexUsageSnapshot;
        this.updatedAt = Date.now();
        this.error = undefined;
        this.loading = false;
      })
      .catch((error) => {
        if (this.#disposed) return;
        this.error = error instanceof Error ? error.message : String(error);
        this.loading = false;
      })
      .finally(() => {
        this.#request = undefined;
      });
    return this.#request;
  }

  dispose(): void {
    this.#disposed = true;
    clearInterval(this.#timer);
    if (active.runtime === this) active.runtime = undefined;
  }
}
