import {
  PROVIDER_SCHEMAS,
  PROVIDER_SCHEMA_BY_SLUG,
  PROVIDER_SCHEMA_BY_TYPE,
  PROVIDER_SLUGS,
  type ProviderSchema,
} from "./schemas.ts";

export type { ProviderSchema };
export {
  PROVIDER_SCHEMAS,
  PROVIDER_SCHEMA_BY_SLUG,
  PROVIDER_SCHEMA_BY_TYPE,
  PROVIDER_SLUGS,
};

export function findProviderSchema(query: string): ProviderSchema | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  if (PROVIDER_SCHEMA_BY_SLUG[q]) return PROVIDER_SCHEMA_BY_SLUG[q];
  if (PROVIDER_SCHEMA_BY_TYPE[q]) return PROVIDER_SCHEMA_BY_TYPE[q];
  // Common aliases the docs site doesn't index 1:1.
  const aliases: Record<string, string> = {
    twitter: "x",
    google_my_business: "gmb",
    "google-my-business": "gmb",
    googlemybusiness: "gmb",
    "x-twitter": "x",
  };
  const aliased = aliases[q];
  if (aliased && PROVIDER_SCHEMA_BY_SLUG[aliased]) {
    return PROVIDER_SCHEMA_BY_SLUG[aliased];
  }
  return null;
}
