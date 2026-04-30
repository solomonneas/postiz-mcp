import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description:
        "Integration id (from postiz_list_integrations) to find the next free posting slot for. Postiz computes the slot from the integration's posting schedule.",
    }),
  },
  { additionalProperties: false },
);

export function createFindNextSlotTool(getClient: () => PostizClient) {
  return {
    name: "postiz_find_next_slot",
    label: "postiz: find next slot",
    description:
      "Return the next available posting time for a given integration. The slot respects the org's configured posting schedule, so this is the right answer to use as `date` in postiz_create_post when you don't have a specific time in mind.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { integrationId } = raw as { integrationId: string };
      const client = getClient();
      const res = await client.findNextSlot(integrationId);
      return jsonToolResult(withRate(client, { integrationId, slot: res }));
    },
  };
}
