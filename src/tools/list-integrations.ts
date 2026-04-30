import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

export function createListIntegrationsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_list_integrations",
    label: "postiz: list integrations",
    description:
      "List every connected social-media channel for the org behind the configured Postiz API key. Returns id, name, providerIdentifier (the value used as `__type` in post settings), profile, and disabled state. Use this BEFORE postiz_create_post to get the integration id you need to target.",
    parameters: Schema,
    execute: async (
      _toolCallId: string,
      _rawParams: Record<string, unknown>,
    ) => {
      const client = getClient();
      const list = await client.listIntegrations();
      return jsonToolResult(
        withRate(client, {
          count: Array.isArray(list) ? list.length : 0,
          integrations: list,
        }),
      );
    },
  };
}
