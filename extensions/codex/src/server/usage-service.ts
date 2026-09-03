import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseUsageSnapshot, type CodexUsageSnapshot } from "../usage.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const CACHE_TTL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

export interface AuthTokens {
  accessToken: string;
  accountId: string;
}

/** Codex CLI's home (overridable exactly like the CLI itself). */
export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/**
 * Read the ChatGPT sign-in the Codex CLI stores in `<home>/auth.json`.
 * Throws a user-facing message for every state the extension cannot use:
 * no sign-in, API-key mode, or a malformed file. It never touches the file
 * beyond reading — refreshing tokens stays Codex's job.
 */
export function readAuthTokens(home: string = codexHome()): AuthTokens {
  const file = path.join(home, "auth.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      "Codex is not signed in (no ~/.codex/auth.json). Run `codex login` first.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Codex auth file is not valid JSON: ${file}`);
  }
  const auth = parsed as {
    auth_mode?: unknown;
    tokens?: { access_token?: unknown; account_id?: unknown } | null;
  };
  if (auth.auth_mode === "api_key") {
    throw new Error(
      "Codex is signed in with an API key; usage and limits are only available with ChatGPT sign-in.",
    );
  }
  const accessToken = auth.tokens?.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error(
      "Codex auth file has no access token. Run `codex login` to sign in.",
    );
  }
  const accountId = auth.tokens?.account_id;
  return {
    accessToken,
    accountId: typeof accountId === "string" ? accountId : "",
  };
}

export interface UsageDeps {
  fetchImpl?: typeof fetch;
  home?: string;
  now?: () => number;
}

/**
 * Fetches Codex usage/limits and serves them to the web UI with a short
 * cache and single-flight, so the status bar poll, the inspector tab, and a
 * manual refresh share one request.
 */
export function createUsageService(deps: UsageDeps = {}) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now;
  let cache: { at: number; snapshot: CodexUsageSnapshot } | null = null;
  let inflight: Promise<CodexUsageSnapshot> | null = null;

  async function load(signal?: AbortSignal): Promise<CodexUsageSnapshot> {
    const auth = readAuthTokens(deps.home);
    let response: Response;
    try {
      // A blackholed connection must not wedge the panel: bound every
      // request, and let the caller's abort cut it short too.
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      response = await fetchImpl(USAGE_URL, {
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
          Accept: "application/json",
          "User-Agent": "gizmo-codex-extension",
        },
      });
    } catch (error) {
      throw new Error(
        `Could not reach ChatGPT for Codex usage: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (response.status === 401) {
      throw new Error(
        "Codex sign-in has expired. Run `codex login` to refresh it, then refresh again.",
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 200);
      throw new Error(
        `Codex usage request failed (${response.status}): ${body}`,
      );
    }
    const snapshot = parseUsageSnapshot(await response.json(), now());
    if (!snapshot) {
      throw new Error("Codex usage response had an unexpected shape.");
    }
    return snapshot;
  }

  return {
    async getUsage(signal?: AbortSignal): Promise<CodexUsageSnapshot> {
      if (cache && now() - cache.at < CACHE_TTL_MS) return cache.snapshot;
      // Single-flight shares one request, but that request is bounded by the
      // first caller's abort plus the timeout, so a stalled one clears itself
      // and the next call retries rather than inheriting a dead promise.
      inflight ??= load(signal)
        .then((snapshot) => {
          cache = { at: now(), snapshot };
          return snapshot;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
