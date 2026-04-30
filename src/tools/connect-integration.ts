import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    provider: Type.String({
      description:
        "Provider identifier as Postiz expects it (e.g. 'x', 'linkedin', 'bluesky'). Match the value used as `providerIdentifier` in postiz_list_integrations. Only OAuth-based providers are supported by Postiz's public API; URL-based providers like Mastodon return 400.",
    }),
    refresh: Type.Optional(
      Type.String({
        description:
          "Existing integration id to re-authorize (mints a refresh URL for that integration). Omit when connecting a brand-new channel.",
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
      "Generate the OAuth authorization URL for connecting a new social channel via GET /api/public/v1/social/{integration}. Returns a `url` the user must open in a browser to finish the flow; Postiz redirects back to its own callback. This tool does NOT run a callback server. Pass `refresh` set to an existing integration id to re-auth an already-connected channel. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_connect_integration");
      const { provider, refresh } = raw as {
        provider: string;
        refresh?: string;
      };
      const client = getClient();
      const res = await client.connectIntegration({
        provider,
        ...(refresh ? { refresh } : {}),
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
