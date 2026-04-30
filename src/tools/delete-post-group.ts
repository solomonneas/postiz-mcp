import { Type } from "@sinclair/typebox";
import { PostizApiError, type PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireConfirm, requireDeleteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    group: Type.String({ description: "Group id (cross-post unit) to delete." }),
    confirm: Type.Boolean({
      description:
        "Must be true. Deletes EVERY post in the group across every integration. Already-published platform posts remain live; only Postiz records are removed.",
    }),
  },
  { additionalProperties: false },
);

export function createDeletePostGroupTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_delete_post_group",
    label: "postiz: delete post group",
    description:
      "Delete every post in a group (cross-post unit) via DELETE /api/posts/group/{group}. Use when you want to retract a whole cross-post in one call. Requires enableWrite + enableDelete + confirm=true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireDeleteGate(config, "postiz_delete_post_group");
      const { group, confirm } = raw as { group: string; confirm: boolean };
      requireConfirm("postiz_delete_post_group", confirm);
      const client = getClient();
      try {
        const res = await client.deletePostGroup(group);
        return jsonToolResult(
          withRate(client, {
            ok: true,
            action: "delete_post_group",
            group,
            response: res,
          }),
        );
      } catch (err) {
        if (err instanceof PostizApiError && err.status === 404) {
          return jsonToolResult(
            withRate(client, {
              ok: false,
              action: "delete_post_group",
              group,
              reason: "not_found",
              message: "Group not found. May have already been deleted.",
            }),
          );
        }
        throw err;
      }
    },
  };
}
