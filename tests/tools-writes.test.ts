import { afterEach, describe, expect, it } from "vitest";
import { createConnectIntegrationTool } from "../src/tools/connect-integration.ts";
import { createCreatePostTool } from "../src/tools/create-post.ts";
import { createUpdatePostStatusTool } from "../src/tools/update-post-status.ts";
import { createUpdatePostReleaseIdTool } from "../src/tools/update-post-release-id.ts";
import { createUploadFileTool } from "../src/tools/upload-file.ts";
import { createUploadFromUrlTool } from "../src/tools/upload-from-url.ts";
import { createGenerateVideoTool } from "../src/tools/generate-video.ts";
import { TEST_BASE_URL, makeTestClient, makeTestConfig } from "./helpers.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";

describe("write tools — request shape + gate", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("postiz_connect_integration POSTs provider and returns OAuth URL", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 200,
      body: { url: "https://oauth.example/x?code=abc" },
    });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createConnectIntegrationTool(() => client, config);
    const res = await tool.execute("t", { provider: "x" });
    expect(fake.calls[0].method).toBe("POST");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/integrations/connect`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({ provider: "x" });
    expect((res.details as { authorizationUrl: string }).authorizationUrl).toBe(
      "https://oauth.example/x?code=abc",
    );
  });

  it("postiz_create_post wraps integrationId into Postiz API shape", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { ok: true } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    await tool.execute("t", {
      type: "schedule",
      date: "2026-05-01T10:00:00.000Z",
      posts: [
        {
          integrationId: "int-1",
          value: [{ content: "hello" }],
          settings: { __type: "x", who_can_reply_post: "everyone" },
        },
      ],
    });
    expect(fake.calls[0].method).toBe("POST");
    const body = JSON.parse(fake.calls[0].body!);
    expect(body.posts[0].integration).toEqual({ id: "int-1" });
    expect(body.posts[0].settings.__type).toBe("x");
    expect(body.type).toBe("schedule");
  });

  it("postiz_update_post_status PATCHes /status", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUpdatePostStatusTool(() => client, config);
    await tool.execute("t", { postId: "p1", state: "QUEUE" });
    expect(fake.calls[0].method).toBe("PATCH");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/posts/p1/status`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({ state: "QUEUE" });
  });

  it("postiz_update_post_release_id PATCHes /release-id with optional URL", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUpdatePostReleaseIdTool(() => client, config);
    await tool.execute("t", {
      postId: "p1",
      releaseId: "tweet-99",
      releaseURL: "https://x.com/user/status/99",
    });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/posts/p1/release-id`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({
      releaseId: "tweet-99",
      releaseURL: "https://x.com/user/status/99",
    });
  });

  it("postiz_upload_file sends multipart with file and bytes", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { id: "img-1", path: "/u/img-1.png" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFileTool(() => client, config);
    const bytes = Buffer.from("PNG-FAKE-DATA");
    await tool.execute("t", {
      base64: bytes.toString("base64"),
      fileName: "shot.png",
      mimeType: "image/png",
    });
    expect(fake.calls[0].method).toBe("POST");
    expect(fake.calls[0].url).toBe(`${TEST_BASE_URL}/api/public/v1/upload`);
    expect(fake.calls[0].isFormData).toBe(true);
    expect(fake.calls[0].bodyFormSummary).toContain("file=");
    expect(fake.calls[0].bodyFormSummary).toContain("image/png");
    // multipart should NOT have manual Content-Type:application/json from us;
    // fetch sets the multipart boundary itself.
    expect(fake.calls[0].headers["content-type"]).not.toBe("application/json");
  });

  it("postiz_upload_from_url POSTs to /api/uploads/url", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { id: "img-9", path: "/u/img-9.jpg" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFromUrlTool(() => client, config);
    const res = await tool.execute("t", {
      url: "https://example.com/cover.jpg",
    });
    expect(fake.calls[0].method).toBe("POST");
    expect(JSON.parse(fake.calls[0].body!)).toEqual({
      url: "https://example.com/cover.jpg",
    });
    expect((res.details as { uploadRef: { id: string } }).uploadRef.id).toBe(
      "img-9",
    );
  });

  it("postiz_generate_video forwards arbitrary body", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { jobId: "v-1" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createGenerateVideoTool(() => client, config);
    await tool.execute("t", {
      body: { script: "hi there", voiceId: "alloy" },
    });
    expect(JSON.parse(fake.calls[0].body!)).toEqual({
      script: "hi there",
      voiceId: "alloy",
    });
  });
});
