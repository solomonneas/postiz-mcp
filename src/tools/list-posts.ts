import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    startDate: Type.Optional(
      Type.String({
        description:
          "ISO-8601 start of the window (inclusive). Default is the start of the current Postiz `display` period.",
      }),
    ),
    endDate: Type.Optional(
      Type.String({
        description: "ISO-8601 end of the window (exclusive).",
      }),
    ),
    display: Type.Optional(
      Type.Union(
        [Type.Literal("day"), Type.Literal("week"), Type.Literal("month")],
        {
          description:
            "Convenience window matching Postiz's UI. Used when startDate/endDate are omitted. Default 'week'.",
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
      "List posts in a date range via GET /api/posts. Returns scheduled, queued, and published posts with their integration, content, state, and any platform release URL.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const params = raw as {
        startDate?: string;
        endDate?: string;
        display?: "day" | "week" | "month";
        customer?: string;
      };
      // Postiz validates startDate + endDate as ISO-8601 and 400s when
      // either is missing. Fill a sensible default window when the agent
      // omits them so simple "what's queued?" prompts just work.
      const display = params.display ?? "week";
      const now = new Date();
      const defaultEnd = new Date(now);
      const defaultStart = new Date(now);
      if (display === "day") defaultStart.setUTCDate(defaultStart.getUTCDate() - 1);
      else if (display === "month") defaultStart.setUTCMonth(defaultStart.getUTCMonth() - 1);
      else defaultStart.setUTCDate(defaultStart.getUTCDate() - 7);
      const startDate = params.startDate ?? defaultStart.toISOString();
      const endDate = params.endDate ?? defaultEnd.toISOString();
      const client = getClient();
      const res = await client.listPosts({
        startDate,
        endDate,
        display,
        ...(params.customer ? { customer: params.customer } : {}),
      });
      return jsonToolResult(
        withRate(client, { window: { startDate, endDate, display }, posts: res }),
      );
    },
  };
}
