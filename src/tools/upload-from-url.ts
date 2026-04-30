import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { assertSafeUrl } from "../security.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    url: Type.String({
      description:
        "Public http or https URL of the media file. file://, private-network and link-local addresses are rejected. Postiz fetches it server-side and stores a copy.",
    }),
  },
  { additionalProperties: false },
);

export function createUploadFromUrlTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_upload_from_url",
    label: "postiz: upload from URL",
    description:
      "Upload a media file from a public URL via POST /api/public/v1/upload-from-url. Postiz fetches the URL server-side, so this works for sources the MCP host can't reach. Returns { id, path } usable in postiz_create_post `value[].image[]`. The URL must use http or https; private-network and link-local addresses are rejected to limit SSRF surface against the Postiz host. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_upload_from_url");
      const { url } = raw as { url: string };
      assertSafeUrl(url);
      const client = getClient();
      const res = await client.uploadFromUrl(url);
      return jsonToolResult(
        withRate(client, {
          ok: true,
          sourceUrl: url,
          response: res,
          uploadRef: { id: res.id, path: res.path },
        }),
      );
    },
  };
}
