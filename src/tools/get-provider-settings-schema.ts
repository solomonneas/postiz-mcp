import { Type } from "@sinclair/typebox";
import type { PostizClient } from "../postiz-client.ts";
import {
  PROVIDER_SLUGS,
  findProviderSchema,
} from "../providers/index.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    provider: Type.String({
      description: `Provider slug or __type value (case-insensitive). Known: ${PROVIDER_SLUGS.join(", ")}. Aliases: 'twitter' → 'x', 'google_my_business' → 'gmb'.`,
    }),
    includeMarkdown: Type.Optional(
      Type.Boolean({
        description:
          "If true, include the full provider documentation markdown. Default true. Set false for a compact response that only carries the JSON template.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createGetProviderSettingsSchemaTool(
  getClient: () => PostizClient,
) {
  return {
    name: "postiz_get_provider_settings_schema",
    label: "postiz: get provider settings schema",
    description:
      "Look up the `settings` block schema for a Postiz provider (X, LinkedIn, Reddit, etc.) — bundled at build time from docs.postiz.com. Returns a default-settings template, the provider's `__type` value, and (by default) the full markdown reference. Call this before postiz_create_post when you need provider-specific fields.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      const { provider, includeMarkdown } = raw as {
        provider: string;
        includeMarkdown?: boolean;
      };
      const schema = findProviderSchema(provider);
      const client = getClient();
      if (!schema) {
        return jsonToolResult(
          withRate(client, {
            ok: false,
            query: provider,
            reason: "unknown_provider",
            knownSlugs: PROVIDER_SLUGS,
            hint: "Run `npm run refresh-schemas` (or wait for the monthly CI job) if Postiz added a new provider since this build.",
          }),
        );
      }
      const showMd = includeMarkdown !== false;
      return jsonToolResult(
        withRate(client, {
          ok: true,
          slug: schema.slug,
          type: schema.type,
          sourceUrl: schema.sourceUrl,
          fetchedAt: schema.fetchedAt,
          defaultSettings: schema.defaultSettings,
          markdown: showMd ? schema.markdown : undefined,
        }),
      );
    },
  };
}
