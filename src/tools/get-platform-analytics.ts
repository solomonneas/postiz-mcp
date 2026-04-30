import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description: "Integration id (from postiz_list_integrations).",
    }),
    date: Type.Optional(
      Type.Number({
        description:
          "Lookback window in days (e.g. 7, 30). Postiz default applies when omitted.",
        minimum: 1,
        maximum: 365,
      }),
    ),
  },
  { additionalProperties: false },
);

export function createGetPlatformAnalyticsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_get_platform_analytics",
    label: "postiz: platform analytics",
    description:
      "Get follower / impression / engagement analytics for a connected channel via GET /api/analytics/platform. Available metrics depend on what the platform exposes to Postiz.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { integrationId, date } = raw as {
        integrationId: string;
        date?: number;
      };
      const client = getClient();
      const res = await client.getPlatformAnalytics({
        integrationId,
        ...(date !== undefined ? { date } : {}),
      });
      return jsonToolResult(
        withRate(client, {
          integrationId,
          windowDays: date ?? null,
          analytics: res,
        }),
      );
    },
  };
}
