import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({ description: "Post id (from postiz_list_posts)." }),
  },
  { additionalProperties: false },
);

export function createGetPostAnalyticsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_get_post_analytics",
    label: "postiz: post analytics",
    description:
      "Get per-post engagement metrics (likes, comments, shares) via GET /api/analytics/post. Returns whatever the source platform exposes — different shape per provider.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { postId } = raw as { postId: string };
      const client = getClient();
      const res = await client.getPostAnalytics(postId);
      return jsonToolResult(withRate(client, { postId, analytics: res }));
    },
  };
}
