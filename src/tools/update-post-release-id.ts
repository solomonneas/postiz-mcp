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
    releaseURL: Type.Optional(
      Type.String({
        description:
          "Optional canonical URL of the published post on the platform.",
      }),
    ),
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
      "Update the `releaseId` (and optionally `releaseURL`) of a Postiz post via PATCH /api/posts/{id}/release-id. Use to reconcile a Postiz post with the actual platform-side release after a missing-content event. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_update_post_release_id");
      const { postId, releaseId, releaseURL } = raw as {
        postId: string;
        releaseId: string;
        releaseURL?: string;
      };
      const client = getClient();
      const res = await client.updateReleaseId(postId, {
        releaseId,
        ...(releaseURL ? { releaseURL } : {}),
      });
      return jsonToolResult(
        withRate(client, {
          ok: true,
          postId,
          releaseId,
          releaseURL: releaseURL ?? null,
          response: res,
        }),
      );
    },
  };
}
