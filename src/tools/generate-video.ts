import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    body: Type.Record(Type.String(), Type.Unknown(), {
      description:
        "Free-form video generation payload as expected by Postiz's /api/public/v1/generate-video endpoint. Shape varies by enabled video integration; check Postiz video docs for the integration in use.",
    }),
  },
  { additionalProperties: false },
);

export function createGenerateVideoTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_generate_video",
    label: "postiz: generate video",
    description:
      "Generate an AI video via POST /api/public/v1/generate-video. COST IMPLICATION: video generation may bill against the configured Postiz video integration's credit pool. Requires enableWrite. Body shape is provider-specific; see Postiz video docs for the integration in use.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_generate_video");
      const { body } = raw as { body: Record<string, unknown> };
      const client = getClient();
      const res = await client.generateVideo(body);
      return jsonToolResult(withRate(client, { ok: true, response: res }));
    },
  };
}
