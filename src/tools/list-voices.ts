import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.Optional(
      Type.String({
        description:
          "Optional integration id to scope the voice list to a specific provider's voice catalog.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createListVoicesTool(getClient: () => PostizClient) {
  return {
    name: "postiz_list_voices",
    label: "postiz: list video voices",
    description:
      "List available AI voices for video generation via GET /api/video/function?functionName=voices. Required input for postiz_generate_video — pick a voice id from the returned catalog.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { integrationId } = raw as { integrationId?: string };
      const client = getClient();
      const res = await client.listVoices(integrationId);
      return jsonToolResult(
        withRate(client, {
          integrationId: integrationId ?? null,
          voices: res,
        }),
      );
    },
  };
}
