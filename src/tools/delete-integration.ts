import { Type } from "@sinclair/typebox";
import { PostizApiError, type PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireConfirm, requireDeleteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description:
        "Integration id to disconnect (from postiz_list_integrations).",
    }),
    confirm: Type.Boolean({
      description:
        "Must be true to actually disconnect. Postiz also removes every scheduled post tied to this integration. Irreversible — re-connecting requires a fresh OAuth flow.",
    }),
  },
  { additionalProperties: false },
);

export function createDeleteIntegrationTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_delete_integration",
    label: "postiz: delete integration",
    description:
      "Disconnect a connected social channel. Cascades — Postiz also deletes every scheduled post for that integration. Requires enableWrite + enableDelete + confirm=true. Returns ok:false / not_found on 404 (already disconnected).",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireDeleteGate(config, "postiz_delete_integration");
      const { integrationId, confirm } = raw as {
        integrationId: string;
        confirm: boolean;
      };
      requireConfirm("postiz_delete_integration", confirm);
      const client = getClient();
      try {
        const res = await client.deleteIntegration(integrationId);
        return jsonToolResult(
          withRate(client, {
            ok: true,
            action: "delete_integration",
            integrationId,
            response: res,
          }),
        );
      } catch (err) {
        if (err instanceof PostizApiError && err.status === 404) {
          return jsonToolResult(
            withRate(client, {
              ok: false,
              action: "delete_integration",
              integrationId,
              reason: "not_found",
              message: "Integration not found. May have already been disconnected.",
            }),
          );
        }
        throw err;
      }
    },
  };
}
