import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    provider: Type.String({
      description:
        "Provider identifier as Postiz expects it (e.g. 'x', 'linkedin', 'bluesky', 'mastodon'). Match the value used as `providerIdentifier` in postiz_list_integrations.",
    }),
    refresh: Type.Optional(
      Type.Boolean({
        description:
          "If true, ask Postiz to mint a refresh URL for an already-connected integration (re-auth). Default false (new connection).",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createConnectIntegrationTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_connect_integration",
    label: "postiz: connect integration",
    description:
      "Generate the OAuth authorization URL for connecting a new social channel. Returns a `url` the user must open in a browser to finish the flow — Postiz redirects back to its own callback. This tool does NOT run a callback server. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_connect_integration");
      const { provider, refresh } = raw as {
        provider: string;
        refresh?: boolean;
      };
      const client = getClient();
      const res = await client.connectIntegration({
        provider,
        ...(refresh !== undefined ? { refresh } : {}),
      });
      return jsonToolResult(
        withRate(client, {
          provider,
          authorizationUrl: res.url ?? null,
          response: res,
        }),
      );
    },
  };
}
