import { Type } from "@sinclair/typebox";
import type { PostizClient, PostizCreatePostInput } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    type: Type.Union(
      [Type.Literal("draft"), Type.Literal("schedule"), Type.Literal("now")],
      {
        description:
          "'draft' saves without scheduling. 'schedule' queues for the supplied date. 'now' publishes immediately on the platform side.",
      },
    ),
    date: Type.String({
      description:
        "ISO-8601 timestamp (e.g. '2026-05-01T14:00:00.000Z'). Required even for 'now' — Postiz expects the field. Use postiz_find_next_slot for a schedule-respecting default.",
    }),
    posts: Type.Array(
      Type.Object(
        {
          integrationId: Type.String({
            description:
              "Integration id (from postiz_list_integrations) to post on.",
          }),
          value: Type.Array(
            Type.Object(
              {
                content: Type.String({
                  description:
                    "Post body. For threads (X, Bluesky), append more value entries — each entry is one post in the thread.",
                }),
                image: Type.Optional(
                  Type.Array(
                    Type.Object(
                      {
                        id: Type.Optional(Type.String()),
                        path: Type.Optional(Type.String()),
                      },
                      { additionalProperties: true },
                    ),
                    {
                      description:
                        "Attached media. Use postiz_upload_file or postiz_upload_from_url first to obtain { id, path }.",
                    },
                  ),
                ),
              },
              { additionalProperties: true },
            ),
            { minItems: 1 },
          ),
          settings: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description:
                "Provider-specific settings block (must include `__type`). Use postiz_get_provider_settings_schema to discover fields and required values for the target provider.",
            }),
          ),
          group: Type.Optional(
            Type.String({
              description:
                "Optional group id to associate this post with an existing group (e.g. cross-posting the same thread to multiple integrations).",
            }),
          ),
        },
        { additionalProperties: false },
      ),
      {
        minItems: 1,
        description:
          "One entry per integration to post on. Each entry's `value` array is the post (or thread, for value.length > 1).",
      },
    ),
    shortLink: Type.Optional(
      Type.Boolean({
        description:
          "If true, Postiz shortens links in the post via its short-link service. Default false.",
      }),
    ),
    tags: Type.Optional(
      Type.Array(
        Type.Object(
          {
            value: Type.String(),
            label: Type.String(),
          },
          { additionalProperties: false },
        ),
        {
          description:
            "Optional grouping tags Postiz uses for filtering in its UI. NOT the same as platform-specific hashtags.",
        },
      ),
    ),
  },
  { additionalProperties: false },
);

export function createCreatePostTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_create_post",
    label: "postiz: create post",
    description:
      "Create, schedule, or immediately publish one or more posts via POST /api/posts. PUBLIC SIDE EFFECT: with type='now' or a near-term schedule, this lands on real social accounts. Use postiz_get_provider_settings_schema first to construct valid `settings` blocks. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_create_post");
      const params = raw as {
        type: "draft" | "schedule" | "now";
        date: string;
        posts: Array<{
          integrationId: string;
          value: Array<{ content: string; image?: Array<{ id?: string; path?: string }> }>;
          settings?: Record<string, unknown>;
          group?: string;
        }>;
        shortLink?: boolean;
        tags?: Array<{ value: string; label: string }>;
      };
      const body: PostizCreatePostInput = {
        type: params.type,
        date: params.date,
        posts: params.posts.map((p) => ({
          integration: { id: p.integrationId },
          value: p.value,
          ...(p.settings ? { settings: p.settings } : {}),
          ...(p.group ? { group: p.group } : {}),
        })),
        ...(params.shortLink !== undefined ? { shortLink: params.shortLink } : {}),
        ...(params.tags ? { tags: params.tags } : {}),
      };
      const client = getClient();
      const res = await client.createPost(body);
      return jsonToolResult(
        withRate(client, {
          ok: true,
          action: "create_post",
          type: params.type,
          date: params.date,
          integrationCount: params.posts.length,
          response: res,
        }),
      );
    },
  };
}
