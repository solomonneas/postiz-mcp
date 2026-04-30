import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({ description: "Post id to transition." }),
    status: Type.Union([Type.Literal("draft"), Type.Literal("schedule")], {
      description:
        "'draft' moves a queued post back to draft (it stops being scheduled). 'schedule' moves a draft into the schedule. Postiz returns the resulting state as uppercase 'DRAFT' or 'QUEUE' in the response.",
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
      "Transition a Postiz post between draft and schedule via PUT /api/public/v1/posts/{id}/status. Body shape is {status: 'draft'|'schedule'}; the server response carries state as 'DRAFT'|'QUEUE'. Moving draft -> schedule re-enters the schedule using the post's existing publishDate. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_update_post_status");
      const { postId, status } = raw as {
        postId: string;
        status: "draft" | "schedule";
      };
      const client = getClient();
      const res = await client.updatePostStatus(postId, { status });
      return jsonToolResult(
        withRate(client, {
          ok: true,
          postId,
          newStatus: status,
          response: res,
        }),
      );
    },
  };
}
