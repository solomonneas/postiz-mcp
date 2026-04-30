import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    postId: Type.String({ description: "Post id whose releaseId should be updated." }),
    releaseId: Type.String({
      description:
        "Platform-side release id (e.g. tweet id, LinkedIn share id) to attach to the Postiz post.",
    }),
  },
  { additionalProperties: false },
);

export function createUpdatePostReleaseIdTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_update_post_release_id",
    label: "postiz: update post release id",
    description:
      "Update the `releaseId` of a Postiz post via PUT /api/public/v1/posts/{id}/release-id. Use to reconcile a Postiz post with the actual platform-side release after a missing-content event (typically after calling postiz_get_missing_content). Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_update_post_release_id");
      const { postId, releaseId } = raw as {
        postId: string;
        releaseId: string;
      };
      const client = getClient();
      const res = await client.updateReleaseId(postId, { releaseId });
      return jsonToolResult(
        withRate(client, {
          ok: true,
          postId,
          releaseId,
          response: res,
        }),
      );
    },
  };
}
