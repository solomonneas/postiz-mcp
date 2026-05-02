import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    integrationId: Type.String({
      description:
        "Integration id (from postiz_list_integrations) whose runtime settings you want.",
    }),
  },
  { additionalProperties: false },
);

export function createGetIntegrationSettingsTool(
  getClient: () => PostizClient,
) {
  return {
    name: "postiz_get_integration_settings",
    label: "postiz: get integration settings",
    description:
      "Fetch live, account-level config for one connected integration via GET /api/public/v1/integration-settings/{id}. Returns rules, maxLength (already adjusted for verified-account state upstream), the DTO settings shape (or the string 'No additional settings required'), and platform-specific tools available to this account. Distinct from postiz_get_provider_settings_schema, which returns the static bundled schema by provider type. Use this BEFORE postiz_create_post when content length matters or when you need to discover platform-specific tools.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { integrationId } = raw as { integrationId: string };
      const client = getClient();
      const data = await client.getIntegrationSettings(integrationId);
      return jsonToolResult(
        withRate(client, {
          integrationId,
          ...data,
        }),
      );
    },
  };
}
