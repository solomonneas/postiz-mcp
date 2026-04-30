import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    identifier: Type.String({
      description:
        "Video-type identifier whose voice catalog you want (e.g. 'image-text-slides'). Postiz routes this to the matching video integration internally.",
    }),
  },
  { additionalProperties: false },
);

export function createListVoicesTool(getClient: () => PostizClient) {
  return {
    name: "postiz_list_voices",
    label: "postiz: list video voices",
    description:
      "List available AI voices for a video-type identifier via POST /api/public/v1/video/function with body {functionName: 'loadVoices', identifier}. Required input for postiz_generate_video: pick a voice id from the returned catalog before constructing the generate-video payload.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { identifier } = raw as { identifier: string };
      const client = getClient();
      const res = await client.listVoices(identifier);
      return jsonToolResult(
        withRate(client, {
          identifier,
          voices: res,
        }),
      );
    },
  };
}
