import { afterEach, describe, expect, it } from "vitest";
import {
  PostizApiError,
  PostizCfAccessChallengeError,
  PostizRateLimitGuardError,
  PostizTimeoutError,
} from "../src/postiz-client.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";
import { TEST_API_KEY, TEST_BASE_URL, makeTestClient } from "./helpers.ts";

describe("PostizClient — request shape", () => {
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

describe("PostizClient — error handling", () => {
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

describe("PostizClient — rate-limit tracking + guard", () => {
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
});
