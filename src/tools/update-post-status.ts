import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({ description: "Post id to transition." }),
    state: Type.Union([Type.Literal("DRAFT"), Type.Literal("QUEUE")], {
      description:
        "'DRAFT' moves a queued post back to draft (it stops being scheduled). 'QUEUE' moves a draft into the schedule.",
    }),
  },
  { additionalProperties: false },
);

export function createUpdatePostStatusTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_update_post_status",
    label: "postiz: update post status",
    description:
      "Transition a Postiz post between DRAFT and QUEUE via PATCH /api/posts/{id}/status. Moving DRAFT→QUEUE re-enters the schedule using the post's existing publishDate. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_update_post_status");
      const { postId, state } = raw as {
        postId: string;
        state: "DRAFT" | "QUEUE";
      };
      const client = getClient();
      const res = await client.updatePostStatus(postId, { state });
      return jsonToolResult(
        withRate(client, {
          ok: true,
          postId,
          newState: state,
          response: res,
        }),
      );
    },
  };
}
