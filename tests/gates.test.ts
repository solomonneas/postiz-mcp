import { afterEach, describe, expect, it } from "vitest";
import { PostizGateError } from "../src/gates.ts";
import { createCreatePostTool } from "../src/tools/create-post.ts";
import { createConnectIntegrationTool } from "../src/tools/connect-integration.ts";
import { createDeleteIntegrationTool } from "../src/tools/delete-integration.ts";
import { createDeletePostTool } from "../src/tools/delete-post.ts";
import { createDeletePostGroupTool } from "../src/tools/delete-post-group.ts";
import { makeTestClient, makeTestConfig } from "./helpers.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";

describe("write gate (POSTIZ_ENABLE_WRITE)", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("create_post throws PostizGateError when enableWrite is false", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: false });
    const tool = createCreatePostTool(() => client, config);
    await expect(
      tool.execute("t", {
        type: "draft",
        date: "2026-05-01T10:00:00.000Z",
        posts: [
          { integrationId: "i", value: [{ content: "hi" }] },
        ],
      }),
    ).rejects.toBeInstanceOf(PostizGateError);
    // No outbound call should have been made.
    expect(fake.calls).toHaveLength(0);
  });

  it("connect_integration is gated by enableWrite", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: false });
    const tool = createConnectIntegrationTool(() => client, config);
    await expect(
      tool.execute("t", { provider: "x" }),
    ).rejects.toBeInstanceOf(PostizGateError);
    expect(fake.calls).toHaveLength(0);
  });
});

describe("delete gate (POSTIZ_ENABLE_DELETE) + confirm", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("delete_integration requires enableDelete on top of enableWrite", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const writeOnly = makeTestConfig({ enableWrite: true, enableDelete: false });
    const tool = createDeleteIntegrationTool(() => client, writeOnly);
    await expect(
      tool.execute("t", { integrationId: "i1", confirm: true }),
    ).rejects.toMatchObject({
      gate: "delete",
      tool: "postiz_delete_integration",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("delete_post throws when confirm is missing even with both gates open", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true, enableDelete: true });
    const tool = createDeletePostTool(() => client, config);
    await expect(
      tool.execute("t", { postId: "p1", confirm: false }),
    ).rejects.toMatchObject({
      gate: "confirm",
      tool: "postiz_delete_post",
    });
    expect(fake.calls).toHaveLength(0);
  });

  it("delete_post_group succeeds with both gates + confirm=true", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { ok: true } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true, enableDelete: true });
    const tool = createDeletePostGroupTool(() => client, config);
    const res = await tool.execute("t", { group: "g1", confirm: true });
    expect(fake.calls[0].method).toBe("DELETE");
    expect((res.details as { ok: boolean }).ok).toBe(true);
  });

  it("delete_post returns ok:false / not_found on 404 instead of throwing", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 404, body: { error: "Not Found" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true, enableDelete: true });
    const tool = createDeletePostTool(() => client, config);
    const res = await tool.execute("t", { postId: "p1", confirm: true });
    expect((res.details as { ok: boolean; reason: string }).ok).toBe(false);
    expect((res.details as { reason: string }).reason).toBe("not_found");
  });
});
