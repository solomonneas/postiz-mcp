import { Type } from "@sinclair/typebox";
import type { PostizClient, PostizCreatePostInput } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

/** Slack between "schedule" date and now to forgive small clock skew without
 *  letting the agent paper over an obvious past-time mistake. */
const SCHEDULE_PAST_SLACK_MS = 5 * 60 * 1000;

export function validateCreatePostInput(params: {
  type: "draft" | "schedule" | "now";
  date: string;
  posts: Array<{
    integrationId: string;
    value: Array<{ content: string; image?: Array<{ id?: string; path?: string }> }>;
  }>;
}): void {
  if (!Array.isArray(params.posts) || params.posts.length === 0) {
    throw new Error("postiz_create_post: posts[] must contain at least one entry.");
  }
  const parsedDate = Date.parse(params.date);
  if (Number.isNaN(parsedDate)) {
    throw new Error(
      `postiz_create_post: date is not a valid ISO-8601 timestamp: ${params.date}`,
    );
  }
  if (params.type === "schedule") {
    if (parsedDate < Date.now() - SCHEDULE_PAST_SLACK_MS) {
      throw new Error(
        `postiz_create_post: type='schedule' requires a future date; got ${params.date}.`,
      );
    }
  }
  for (let i = 0; i < params.posts.length; i++) {
    const p = params.posts[i];
    if (!p || typeof p !== "object") {
      throw new Error(`postiz_create_post: posts[${i}] is not an object.`);
    }
    if (!p.integrationId || typeof p.integrationId !== "string") {
      throw new Error(`postiz_create_post: posts[${i}].integrationId is required.`);
    }
    if (!Array.isArray(p.value) || p.value.length === 0) {
      throw new Error(
        `postiz_create_post: posts[${i}].value must contain at least one entry.`,
      );
    }
    for (let j = 0; j < p.value.length; j++) {
      const v = p.value[j];
      const content = typeof v?.content === "string" ? v.content : "";
      const hasImage = Array.isArray(v?.image) && v.image.length > 0;
      if (content.trim().length === 0 && !hasImage) {
        throw new Error(
          `postiz_create_post: posts[${i}].value[${j}].content is empty and no image is attached.`,
        );
      }
    }
  }
}

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
        "ISO-8601 timestamp (e.g. '2026-05-01T14:00:00.000Z'). Required even for 'now' - Postiz expects the field. Use postiz_find_next_slot for a schedule-respecting default.",
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
                    "Post body. For threads (X, Bluesky), append more value entries - each entry is one post in the thread.",
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
      "Create, schedule, or immediately publish one or more posts via POST /api/public/v1/posts. PUBLIC SIDE EFFECT: with type='now' or a near-term schedule, this lands on real social accounts. Use postiz_get_provider_settings_schema first to construct valid `settings` blocks. Empty content and past schedule dates (more than 5 minutes old) are rejected before the request fires. Requires enableWrite.",
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
      validateCreatePostInput(params);
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
