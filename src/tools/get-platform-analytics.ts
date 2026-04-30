import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description: "Integration id (from postiz_list_integrations).",
    }),
    date: Type.String({
      description:
        "Lookback window in days as a string (e.g. '7', '30', '90'). Postiz public API requires this; numbers are coerced to strings.",
      pattern: "^[0-9]+$",
    }),
  },
  { additionalProperties: false },
);

export function createGetPlatformAnalyticsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_get_platform_analytics",
    label: "postiz: platform analytics",
    description:
      "Get follower / impression / engagement analytics for a connected channel via GET /api/public/v1/analytics/{integration}?date=N. `date` is a required lookback in days (e.g. '7', '30'); available metrics depend on what the platform exposes to Postiz.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { integrationId, date } = raw as {
        integrationId: string;
        date: string;
      };
      const client = getClient();
      const res = await client.getPlatformAnalytics({ integrationId, date });
      return jsonToolResult(
        withRate(client, {
          integrationId,
          windowDays: date,
          analytics: res,
        }),
      );
    },
  };
}
