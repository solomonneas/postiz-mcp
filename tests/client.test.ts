import { afterEach, describe, expect, it } from "vitest";
import {
  PostizApiError,
  PostizCfAccessChallengeError,
  PostizRateLimitGuardError,
  PostizTimeoutError,
} from "../src/postiz-client.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";
import { TEST_API_KEY, TEST_BASE_URL, makeTestClient } from "./helpers.ts";

describe("PostizClient - request shape", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("sends Authorization header without a Bearer prefix (Postiz quirk)", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    await client.listIntegrations();
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].url).toBe(`${TEST_BASE_URL}/api/public/v1/integrations`);
    expect(fake.calls[0].method).toBe("GET");
    expect(fake.calls[0].headers["authorization"]).toBe(TEST_API_KEY);
    expect(fake.calls[0].headers["authorization"]).not.toMatch(/^bearer/i);
  });

  it("includes Cloudflare Access service tokens when configured", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient({
      cfAccessClientId: "cf-id-123",
      cfAccessClientSecret: "cf-secret-456",
    });
    await client.checkIntegration();
    expect(fake.calls[0].headers["cf-access-client-id"]).toBe("cf-id-123");
    expect(fake.calls[0].headers["cf-access-client-secret"]).toBe(
      "cf-secret-456",
    );
  });

  it("omits CF Access headers when env not configured", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    await client.checkIntegration();
    expect(fake.calls[0].headers["cf-access-client-id"]).toBeUndefined();
    expect(fake.calls[0].headers["cf-access-client-secret"]).toBeUndefined();
  });

  it("strips trailing slashes from baseUrl", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    await client.listIntegrations();
    expect(fake.calls[0].url.startsWith(`${TEST_BASE_URL}/api/public/v1/`)).toBe(true);
    // No double slashes between base and path.
    expect(fake.calls[0].url).not.toMatch(/\/\/api\//);
  });
});

describe("PostizClient - error handling", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("redacts API key from error messages", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 500,
      body: { message: `Postgres exploded: key=${TEST_API_KEY} on call` },
    });
    const client = makeTestClient();
    await expect(client.listIntegrations()).rejects.toThrow(/REDACTED/);
  });

  it("redacts CF Access client secret from error messages", async () => {
    fake = makeFakeFetch();
    const cfSecret = "cf-secret-very-long-token-abc123";
    fake.queue({
      status: 500,
      body: { message: `internal error reflected secret=${cfSecret} ...` },
    });
    const client = makeTestClient({
      cfAccessClientId: "cf-id-12345678",
      cfAccessClientSecret: cfSecret,
    });
    let captured: string | undefined;
    try {
      await client.listIntegrations();
    } catch (err) {
      captured = err instanceof Error ? err.message : String(err);
    }
    expect(captured).toContain("REDACTED");
    expect(captured).not.toContain(cfSecret);
  });

  it("normalizes 4xx into PostizApiError with code + path", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 404,
      body: { error: "Not Found", message: "no such integration" },
    });
    const client = makeTestClient();
    try {
      await client.deleteIntegration("abc123");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PostizApiError);
      const e = err as PostizApiError;
      expect(e.status).toBe(404);
      expect(e.code).toBe("not_found");
      expect(e.path).toBe("/api/public/v1/integrations/abc123");
    }
  });

  it("parses Retry-After on 429 into retryAfterSec", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 429,
      body: { message: "slow down" },
      headers: { "Retry-After": "42" },
    });
    const client = makeTestClient();
    try {
      await client.listIntegrations();
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PostizApiError);
      const e = err as PostizApiError;
      expect(e.status).toBe(429);
      expect(e.code).toBe("rate_limited");
      expect(e.retryAfterSec).toBe(42);
    }
  });

  it("detects Cloudflare Access challenge", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 403,
      text: "<html><title>Cloudflare Access</title></html>",
      headers: {
        "Content-Type": "text/html",
        "cf-mitigated": "challenge",
      },
    });
    const client = makeTestClient();
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizCfAccessChallengeError,
    );
  });

  it("surfaces PostizTimeoutError when a request hangs past timeout", async () => {
    fake = makeFakeFetch();
    fake.queue({ hangUntilAbort: true });
    const client = makeTestClient({ timeoutMs: 25 });
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizTimeoutError,
    );
  });
});

describe("PostizClient - rate-limit tracking + guard", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("captures X-RateLimit-Remaining and Reset from response headers", async () => {
    fake = makeFakeFetch();
    const resetEpoch = Math.floor(Date.now() / 1000) + 1800;
    fake.queue({
      status: 200,
      body: [],
      headers: {
        "X-RateLimit-Limit": "30",
        "X-RateLimit-Remaining": "25",
        "X-RateLimit-Reset": String(resetEpoch),
      },
    });
    const client = makeTestClient();
    await client.listIntegrations();
    const rl = client.getRateLimit();
    expect(rl.remaining).toBe(25);
    expect(rl.limitPerHour).toBe(30);
    expect(rl.resetAt).toBe(resetEpoch * 1000);
  });

  it("refuses to send once the local sliding window hits the limit", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient({ rateLimitPerHour: 3 });
    for (let i = 0; i < 3; i++) fake.queue({ status: 200, body: [] });
    await client.listIntegrations();
    await client.listIntegrations();
    await client.listIntegrations();
    expect(fake.calls).toHaveLength(3);
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizRateLimitGuardError,
    );
    // No new outbound call.
    expect(fake.calls).toHaveLength(3);
  });

  it("server-reported remaining=0 also blocks sends", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 200,
      body: [],
      headers: { "X-RateLimit-Remaining": "0" },
    });
    const client = makeTestClient({ rateLimitPerHour: 30 });
    await client.listIntegrations();
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizRateLimitGuardError,
    );
  });

  it("reserves slots pre-flight so concurrent calls cannot overshoot the budget", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient({ rateLimitPerHour: 3 });
    // Queue 3 successful responses; the 4th concurrent caller should never
    // hit the network because the local guard reserved a slot for the first
    // 3 before any of them awaited.
    for (let i = 0; i < 3; i++) fake.queue({ status: 200, body: [] });
    const calls = [
      client.listIntegrations(),
      client.listIntegrations(),
      client.listIntegrations(),
      client.listIntegrations(),
    ];
    const results = await Promise.allSettled(calls);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(reason).toBeInstanceOf(PostizRateLimitGuardError);
    expect(fake.calls).toHaveLength(3);
  });

  it("releases the reservation when the request never reached the server", async () => {
    fake = makeFakeFetch();
    fake.queue({ rejectWith: new Error("network refused") });
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient({ rateLimitPerHour: 1 });
    await expect(client.listIntegrations()).rejects.toThrow(/network refused/);
    // The first call's reservation should have been released since no
    // response was ever received; the second call should now succeed.
    await client.listIntegrations();
    expect(fake.calls).toHaveLength(2);
  });

  it("a 429 with Retry-After updates the local guard so the next call blocks", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 429,
      body: { message: "slow down" },
      headers: { "Retry-After": "60" },
    });
    const client = makeTestClient({ rateLimitPerHour: 30 });
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizApiError,
    );
    // Without queueing another response, the next call should be blocked
    // locally before fetching anything. Asserting that fake.calls only
    // grew by 1 confirms the local guard fired.
    await expect(client.listIntegrations()).rejects.toBeInstanceOf(
      PostizRateLimitGuardError,
    );
    expect(fake.calls).toHaveLength(1);
    const rl = client.getRateLimit();
    expect(rl.remaining).toBe(0);
    expect(rl.resetAt).not.toBeNull();
  });

  it("server zero-remaining without a reset header projects a 1h fallback instead of blocking forever", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 200,
      body: [],
      headers: { "X-RateLimit-Remaining": "0" },
    });
    const client = makeTestClient({ rateLimitPerHour: 30 });
    await client.listIntegrations();
    let captured: PostizRateLimitGuardError | undefined;
    try {
      await client.listIntegrations();
    } catch (err) {
      captured = err as PostizRateLimitGuardError;
    }
    expect(captured).toBeInstanceOf(PostizRateLimitGuardError);
    expect(captured?.resetAt).not.toBeNull();
    // resetAt should be roughly 1h from now (allow generous slack).
    const expected = Date.now() + 60 * 60 * 1000;
    const drift = Math.abs((captured!.resetAt ?? 0) - expected);
    expect(drift).toBeLessThan(5_000);
  });
});

describe("PostizClient - integration settings", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("getIntegrationSettings hits /integration-settings/{id} with GET", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 200,
      body: {
        output: {
          rules: "Be kind.",
          maxLength: 4000,
          settings: { __type: "x", optionA: true },
          tools: [{ name: "search-replies" }],
        },
      },
    });
    const client = makeTestClient();
    const result = await client.getIntegrationSettings("abc-123");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/integration-settings/abc-123`,
    );
    expect(fake.calls[0].method).toBe("GET");
    expect(result).toEqual({
      rules: "Be kind.",
      maxLength: 4000,
      settings: { __type: "x", optionA: true },
      tools: [{ name: "search-replies" }],
    });
  });

  it("getIntegrationSettings rejects unsafe ids before sending", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    await expect(
      client.getIntegrationSettings("../../../etc/passwd"),
    ).rejects.toThrow(/Invalid integration id/);
    expect(fake.calls).toHaveLength(0);
  });
});
