import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({
      description:
        "Post id whose `releaseId` is marked missing. Postiz fetches the most recent platform content to help reconcile.",
    }),
  },
  { additionalProperties: false },
);

export function createGetMissingContentTool(getClient: () => PostizClient) {
  return {
    name: "postiz_get_missing_content",
    label: "postiz: get missing content",
    description:
      "Fetch recent platform-side content for a post whose Postiz releaseId is marked missing. Pair with postiz_update_post_release_id to reattach.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { postId } = raw as { postId: string };
      const client = getClient();
      const res = await client.getMissingContent(postId);
      return jsonToolResult(withRate(client, { postId, response: res }));
    },
  };
}
