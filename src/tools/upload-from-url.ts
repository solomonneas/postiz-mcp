import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    url: Type.String({
      description:
        "Public URL of the media file. Postiz fetches it server-side and stores a copy.",
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
      "Upload a media file from a public URL via POST /api/uploads/url. Postiz fetches the URL server-side, so this works for sources the MCP host can't reach. Returns { id, path } usable in postiz_create_post `value[].image[]`. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_upload_from_url");
      const { url } = raw as { url: string };
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
