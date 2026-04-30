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

describe("write tools - request shape + gate", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("postiz_connect_integration GETs /social/{provider} and returns OAuth URL", async () => {
    fake = makeFakeFetch();
    fake.queue({
      status: 200,
      body: { url: "https://oauth.example/x?code=abc" },
    });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createConnectIntegrationTool(() => client, config);
    const res = await tool.execute("t", { provider: "x" });
    expect(fake.calls[0].method).toBe("GET");
    expect(fake.calls[0].url).toBe(`${TEST_BASE_URL}/api/public/v1/social/x`);
    expect((res.details as { authorizationUrl: string }).authorizationUrl).toBe(
      "https://oauth.example/x?code=abc",
    );
  });

  it("postiz_connect_integration with refresh adds the refresh query param", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { url: "https://oauth.example/x" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createConnectIntegrationTool(() => client, config);
    await tool.execute("t", { provider: "x", refresh: "int-77" });
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/social/x?refresh=int-77`,
    );
  });

  it("postiz_create_post wraps integrationId into Postiz API shape", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { ok: true } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    const futureIso = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await tool.execute("t", {
      type: "schedule",
      date: futureIso,
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

  it("postiz_create_post rejects empty content with no image attachments", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    await expect(
      tool.execute("t", {
        type: "now",
        date: new Date().toISOString(),
        posts: [{ integrationId: "int-1", value: [{ content: "   " }] }],
      }),
    ).rejects.toThrow(/content is empty/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_create_post rejects type=schedule with a past date", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await expect(
      tool.execute("t", {
        type: "schedule",
        date: pastIso,
        posts: [{ integrationId: "int-1", value: [{ content: "hi" }] }],
      }),
    ).rejects.toThrow(/future date/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_create_post rejects empty posts[]", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    await expect(
      tool.execute("t", {
        type: "draft",
        date: new Date().toISOString(),
        posts: [],
      }),
    ).rejects.toThrow(/at least one entry/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_create_post allows empty content when an image is attached (image-only post)", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { ok: true } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createCreatePostTool(() => client, config);
    await tool.execute("t", {
      type: "now",
      date: new Date().toISOString(),
      posts: [
        {
          integrationId: "int-1",
          value: [{ content: "", image: [{ id: "img-1", path: "/u/1.jpg" }] }],
        },
      ],
    });
    expect(fake.calls).toHaveLength(1);
  });

  it("postiz_update_post_status PUTs /status with lowercase status enum", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUpdatePostStatusTool(() => client, config);
    await tool.execute("t", { postId: "p1", status: "schedule" });
    expect(fake.calls[0].method).toBe("PUT");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/posts/p1/status`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({ status: "schedule" });
  });

  it("postiz_update_post_release_id PUTs /release-id with releaseId only", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: {} });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUpdatePostReleaseIdTool(() => client, config);
    await tool.execute("t", { postId: "p1", releaseId: "tweet-99" });
    expect(fake.calls[0].method).toBe("PUT");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/posts/p1/release-id`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({ releaseId: "tweet-99" });
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

  it("postiz_upload_from_url POSTs to /upload-from-url", async () => {
    fake = makeFakeFetch();
    fake.queue({ status: 200, body: { id: "img-9", path: "/u/img-9.jpg" } });
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFromUrlTool(() => client, config);
    const res = await tool.execute("t", {
      url: "https://example.com/cover.jpg",
    });
    expect(fake.calls[0].method).toBe("POST");
    expect(fake.calls[0].url).toBe(
      `${TEST_BASE_URL}/api/public/v1/upload-from-url`,
    );
    expect(JSON.parse(fake.calls[0].body!)).toEqual({
      url: "https://example.com/cover.jpg",
    });
    expect((res.details as { uploadRef: { id: string } }).uploadRef.id).toBe(
      "img-9",
    );
  });

  it("postiz_upload_from_url rejects file:// URLs (SSRF guard)", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFromUrlTool(() => client, config);
    await expect(
      tool.execute("t", { url: "file:///etc/passwd" }),
    ).rejects.toThrow(/scheme|refusing/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_upload_from_url rejects loopback / private-network URLs (SSRF guard)", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFromUrlTool(() => client, config);
    for (const url of [
      "http://127.0.0.1/admin",
      "http://localhost:5432/",
      "http://169.254.169.254/latest/meta-data",
      "http://10.0.0.1/",
      "http://192.168.1.5/",
    ]) {
      await expect(tool.execute("t", { url })).rejects.toThrow(/refusing/i);
    }
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_upload_file rejects filePath when no upload roots are configured", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true });
    const tool = createUploadFileTool(() => client, config);
    await expect(
      tool.execute("t", { filePath: "/etc/passwd" }),
    ).rejects.toThrow(/uploads disabled|allowlisted/i);
    expect(fake.calls).toHaveLength(0);
  });

  it("postiz_upload_file rejects base64 payloads above maxUploadBytes", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const config = makeTestConfig({ enableWrite: true, maxUploadBytes: 16 });
    const tool = createUploadFileTool(() => client, config);
    const oversized = Buffer.alloc(64, 1).toString("base64");
    await expect(
      tool.execute("t", {
        base64: oversized,
        fileName: "big.bin",
        mimeType: "application/octet-stream",
      }),
    ).rejects.toThrow(/exceeds maxUploadBytes/);
    expect(fake.calls).toHaveLength(0);
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
