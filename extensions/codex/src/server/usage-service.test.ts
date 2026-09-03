import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUsageService, readAuthTokens } from "./usage-service.ts";

const AUTH = {
  auth_mode: "chatgpt",
  tokens: {
    id_token: "id",
    access_token: "at-123",
    refresh_token: "rt",
    account_id: "acc-1",
  },
};

const USAGE = {
  plan_type: "prolite",
  email: "user@example.com",
  rate_limit: {
    limit_reached: false,
    primary_window: {
      used_percent: 50,
      limit_window_seconds: 604800,
      reset_after_seconds: 100,
    },
    secondary_window: null,
  },
  additional_rate_limits: [],
};

let homes: string[] = [];
afterEach(() => {
  for (const home of homes) fs.rmSync(home, { recursive: true, force: true });
  homes = [];
});

function homeWith(auth: unknown): string {
  return homeWithRaw(JSON.stringify(auth));
}

function homeWithRaw(content: string): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "codex-home-"));
  fs.writeFileSync(path.join(home, "auth.json"), content);
  homes.push(home);
  return home;
}

describe("readAuthTokens", () => {
  it("reads the ChatGPT access token and account id", () => {
    const home = homeWith(AUTH);
    expect(readAuthTokens(home)).toEqual({
      accessToken: "at-123",
      accountId: "acc-1",
    });
  });

  it("explains every unusable state", () => {
    const missing = path.join(os.tmpdir(), "codex-home-does-not-exist");
    expect(() => readAuthTokens(missing)).toThrow("codex login");

    const apiKey = homeWith({ auth_mode: "api_key", OPENAI_API_KEY: "sk" });
    expect(() => readAuthTokens(apiKey)).toThrow("API key");

    const noToken = homeWith({ auth_mode: "chatgpt", tokens: {} });
    expect(() => readAuthTokens(noToken)).toThrow("no access token");

    const home = homeWithRaw("{not json");
    expect(() => readAuthTokens(home)).toThrow("not valid JSON");
  });
});

describe("createUsageService", () => {
  it("sends the bearer token and account header and parses the payload", async () => {
    const calls: RequestInit[] = [];
    const service = createUsageService({
      home: homeWith(AUTH),
      fetchImpl: (async (_url: unknown, init?: RequestInit) => {
        calls.push(init ?? {});
        return new Response(JSON.stringify(USAGE), { status: 200 });
      }) as unknown as typeof fetch,
    });
    const snapshot = await service.getUsage();
    expect(snapshot.planType).toBe("prolite");
    expect(calls).toHaveLength(1);
    const headers = new Headers(calls[0].headers);
    expect(headers.get("Authorization")).toBe("Bearer at-123");
    expect(headers.get("chatgpt-account-id")).toBe("acc-1");
  });

  it("caches within the TTL and refetches after it", async () => {
    const calls: RequestInit[] = [];
    let time = 0;
    const service = createUsageService({
      home: homeWith(AUTH),
      fetchImpl: (async () => {
        calls.push({});
        return new Response(JSON.stringify(USAGE), { status: 200 });
      }) as unknown as typeof fetch,
      now: () => time,
    });
    await service.getUsage();
    time = 10_000;
    await service.getUsage();
    expect(calls).toHaveLength(1);
    time = 31_000;
    await service.getUsage();
    expect(calls).toHaveLength(2);
  });

  it("turns a 401 into a sign-in hint and does not cache failures", async () => {
    let status = 401;
    const service = createUsageService({
      home: homeWith(AUTH),
      fetchImpl: (async () =>
        new Response(status === 401 ? "expired" : JSON.stringify(USAGE), {
          status,
        })) as unknown as typeof fetch,
    });
    await expect(service.getUsage()).rejects.toThrow("codex login");
    status = 200;
    // A failure is not cached: the retry hits the endpoint again and succeeds.
    await expect(service.getUsage()).resolves.toMatchObject({
      planType: "prolite",
    });
  });

  it("rejects unexpected payload shapes", async () => {
    const service = createUsageService({
      home: homeWith(AUTH),
      fetchImpl: (async () =>
        new Response(JSON.stringify({ hello: true }), {
          status: 200,
        })) as unknown as typeof fetch,
    });
    await expect(service.getUsage()).rejects.toThrow("unexpected shape");
  });
});
