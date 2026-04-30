import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    startDate: Type.Optional(
      Type.String({
        description:
          "ISO-8601 start of the window (inclusive). Default is 7 days before now.",
      }),
    ),
    endDate: Type.Optional(
      Type.String({
        description: "ISO-8601 end of the window (exclusive). Default is now.",
      }),
    ),
    window: Type.Optional(
      Type.Union(
        [Type.Literal("day"), Type.Literal("week"), Type.Literal("month")],
        {
          description:
            "Convenience preset matching Postiz's UI. Used to compute defaults when startDate/endDate are omitted. Default 'week'.",
        },
      ),
    ),
    customer: Type.Optional(
      Type.String({
        description:
          "Optional customer id (multi-tenant Postiz). Omit unless you have customers configured.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createListPostsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_list_posts",
    label: "postiz: list posts",
    description:
      "List posts in a date window via GET /api/public/v1/posts?startDate=&endDate=. Both startDate and endDate are required by Postiz; this tool fills sensible defaults from the optional `window` preset when the agent omits them. Returns scheduled, queued, and published posts with their integration, content, state, and any platform release URL.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const params = raw as {
        startDate?: string;
        endDate?: string;
        window?: "day" | "week" | "month";
        customer?: string;
      };
      const window = params.window ?? "week";
      const now = new Date();
      const defaultEnd = new Date(now);
      const defaultStart = new Date(now);
      if (window === "day") defaultStart.setUTCDate(defaultStart.getUTCDate() - 1);
      else if (window === "month") defaultStart.setUTCMonth(defaultStart.getUTCMonth() - 1);
      else defaultStart.setUTCDate(defaultStart.getUTCDate() - 7);
      const startDate = params.startDate ?? defaultStart.toISOString();
      const endDate = params.endDate ?? defaultEnd.toISOString();
      const client = getClient();
      const res = await client.listPosts({
        startDate,
        endDate,
        ...(params.customer ? { customer: params.customer } : {}),
      });
      return jsonToolResult(
        withRate(client, { window: { startDate, endDate, preset: window }, posts: res }),
      );
    },
  };
}
