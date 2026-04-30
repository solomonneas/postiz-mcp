import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

export function createCheckIntegrationTool(getClient: () => PostizClient) {
  return {
    name: "postiz_check_integration",
    label: "postiz: check API key",
    description:
      "Verify the configured Postiz API key is valid and reaches the configured baseUrl. Useful as a first call before any other tool — if this returns ok, every other tool can authenticate against the same instance.",
    parameters: Schema,
    execute: async (
      _toolCallId: string,
      _rawParams: Record<string, unknown>,
    ) => {
      const client = getClient();
      const res = await client.checkIntegration();
      return jsonToolResult(withRate(client, { ok: true, response: res }));
    },
  };
}
