import { Type } from "@sinclair/typebox";
import { PostizApiError, type PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireConfirm, requireDeleteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({ description: "Post id to delete." }),
    confirm: Type.Boolean({
      description:
        "Must be true. Deletion cascades to every post in the same `group` (Postiz cross-post unit). Posts already published on the platform are NOT recalled — they remain live; only the Postiz record is removed.",
    }),
  },
  { additionalProperties: false },
);

export function createDeletePostTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_delete_post",
    label: "postiz: delete post",
    description:
      "Delete a Postiz post by id. CASCADES — every post in the same group is removed. Already-published platform posts remain live. Requires enableWrite + enableDelete + confirm=true.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireDeleteGate(config, "postiz_delete_post");
      const { postId, confirm } = raw as { postId: string; confirm: boolean };
      requireConfirm("postiz_delete_post", confirm);
      const client = getClient();
      try {
        const res = await client.deletePost(postId);
        return jsonToolResult(
          withRate(client, {
            ok: true,
            action: "delete_post",
            postId,
            response: res,
          }),
        );
      } catch (err) {
        if (err instanceof PostizApiError && err.status === 404) {
          return jsonToolResult(
            withRate(client, {
              ok: false,
              action: "delete_post",
              postId,
              reason: "not_found",
              message: "Post not found. May have already been deleted.",
            }),
          );
        }
        throw err;
      }
    },
  };
}
