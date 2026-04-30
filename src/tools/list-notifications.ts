import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    page: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 100,
        description: "Page number, 100 notifications per page. Default 1.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createListNotificationsTool(getClient: () => PostizClient) {
  return {
    name: "postiz_list_notifications",
    label: "postiz: list notifications",
    description:
      "List notifications, sorted most-recent first. Useful for surfacing posting failures, OAuth re-auth prompts, and new-feature notices Postiz shows in its UI.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { page } = raw as { page?: number };
      const client = getClient();
      const res = await client.listNotifications(page ?? 1);
      return jsonToolResult(withRate(client, { page: page ?? 1, notifications: res }));
    },
  };
}
