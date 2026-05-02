import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description:
        "Integration id (from postiz_list_integrations) on which to invoke the tool.",
    }),
    methodName: Type.String({
      description:
        "Platform-specific tool method name. Discover valid names via postiz_get_integration_settings(integrationId).tools - each platform exposes a different set (e.g. Reddit: searchSubreddit; YouTube: listPlaylists).",
    }),
    data: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          "Method-specific arguments. Shape varies by platform/methodName; consult the integration's tools metadata. Defaults to {} if omitted.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createInvokeIntegrationToolTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_invoke_integration_tool",
    label: "postiz: invoke integration tool",
    description:
      "Invoke a per-platform tool method on a connected integration via POST /api/public/v1/integration-trigger/{id}. Each provider exposes its own set of tool methods (Reddit subreddit search, YouTube playlist lookup, etc.) for fetching the IDs/data you need before constructing a post. Discovery flow: (1) postiz_list_integrations -> id; (2) postiz_get_integration_settings(id) -> .tools shows valid methodName values; (3) call this tool with the method + data. Response shape is platform-specific (Postiz forwards the platform tool's output verbatim). Requires enableWrite=true: although some platform tools are pure-read, the wire is POST with an opaque body, so the gate treats every invocation as a potential write.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_invoke_integration_tool");
      const { integrationId, methodName, data } = raw as {
        integrationId: string;
        methodName: string;
        data?: Record<string, unknown>;
      };
      const client = getClient();
      const response = await client.invokeIntegrationTool(
        integrationId,
        methodName,
        data,
      );
      return jsonToolResult(
        withRate(client, {
          integrationId,
          methodName,
          response,
        }),
      );
    },
  };
}
