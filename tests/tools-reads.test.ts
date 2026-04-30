import { afterEach, describe, expect, it } from "vitest";
import { createListIntegrationsTool } from "../src/tools/list-integrations.ts";
import { createCheckIntegrationTool } from "../src/tools/check-integration.ts";
import { createFindNextSlotTool } from "../src/tools/find-next-slot.ts";
import { createListPostsTool } from "../src/tools/list-posts.ts";
import { createGetMissingContentTool } from "../src/tools/get-missing-content.ts";
import { createListNotificationsTool } from "../src/tools/list-notifications.ts";
import { createGetPlatformAnalyticsTool } from "../src/tools/get-platform-analytics.ts";
import { createGetPostAnalyticsTool } from "../src/tools/get-post-analytics.ts";
import { createListVoicesTool } from "../src/tools/list-voices.ts";
import { TEST_BASE_URL, makeTestClient } from "./helpers.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";

describe("read tools — request shape + result", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("postiz_list_integrations hits /api/integrations/list", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [{ id: "abc", name: "X" }] });
    const client = makeTestClient();
    const tool = createListIntegrationsTool(() => client);
    const res = await tool.execute("t", {});
    expect(fake.calls[0].url).toBe(`${TEST_BASE_URL}/api/public/v1/integrations`);
    expect(fake.calls[0].method).toBe("GET");
    expect(res.details).toMatchObject({
      count: 1,
      integrations: [{ id: "abc", name: "X" }],
    });
    expect((res.details as { rateLimit: unknown }).rateLimit).toBeDefined();
  });

  it("postiz_check_integration hits /api/integrations/check", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { name: "main-org" } });
    const client = makeTestClient();
    const tool = createCheckIntegrationTool(() => client);
    const res = await tool.execute("t", {});
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/integrations/check`,
    );
    expect((res.details as { ok: boolean }).ok).toBe(true);
  });

  it("postiz_find_next_slot encodes integrationId in query string", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { date: "2026-05-01T14:00:00.000Z" } });
    const client = makeTestClient();
    const tool = createFindNextSlotTool(() => client);
    await tool.execute("t", { integrationId: "abc-123" });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/integrations/find-slot?id=abc-123`,
    );
  });

  it("postiz_find_next_slot rejects unsafe ids before sending", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const tool = createFindNextSlotTool(() => client);
    await expect(
      tool.execute("t", { integrationId: "../../../etc/passwd" }),
    ).rejects.toThrow(/Invalid integration id/);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_list_posts forwards window params", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    const tool = createListPostsTool(() => client);
    await tool.execute("t", {
      startDate: "2026-04-01T00:00:00.000Z",
      endDate: "2026-04-30T00:00:00.000Z",
      display: "week",
    });
    expect(fake.calls[0].url).toContain(
      "startDate=2026-04-01T00%3A00%3A00.000Z",
    );
    expect(fake.calls[0].url).toContain(
      "endDate=2026-04-30T00%3A00%3A00.000Z",
    );
    expect(fake.calls[0].url).toContain("display=week");
  });

  it("postiz_list_posts fills a default ISO window when none is supplied", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    const tool = createListPostsTool(() => client);
    await tool.execute("t", {});
    expect(fake.calls[0].url).toMatch(
      /startDate=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}/,
    );
    expect(fake.calls[0].url).toMatch(
      /endDate=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}/,
    );
    expect(fake.calls[0].url).toContain("display=week");
  });

  it("postiz_get_missing_content uses postId query", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    const tool = createGetMissingContentTool(() => client);
    await tool.execute("t", { postId: "post-1" });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/posts/missing-content?postId=post-1`,
    );
  });

  it("postiz_list_notifications defaults page to 1", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    const tool = createListNotificationsTool(() => client);
    await tool.execute("t", {});
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/notifications?page=1`,
    );
  });

  it("postiz_get_platform_analytics passes integrationId + date", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { followers: 1234 } });
    const client = makeTestClient();
    const tool = createGetPlatformAnalyticsTool(() => client);
    await tool.execute("t", { integrationId: "i1", date: 30 });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/analytics/i1?date=30`,
    );
  });

  it("postiz_get_post_analytics hits /api/analytics/post", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { likes: 10 } });
    const client = makeTestClient();
    const tool = createGetPostAnalyticsTool(() => client);
    await tool.execute("t", { postId: "p1" });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/analytics/post/p1`,
    );
  });

  it("postiz_list_voices uses functionName=voices", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: [] });
    const client = makeTestClient();
    const tool = createListVoicesTool(() => client);
    await tool.execute("t", { integrationId: "i1" });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/video/function?functionName=voices&integrationId=i1`,
    );
  });
});
