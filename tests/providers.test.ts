import { afterEach, describe, expect, it } from "vitest";
import {
  PROVIDER_SCHEMAS,
  PROVIDER_SCHEMA_BY_SLUG,
  PROVIDER_SLUGS,
  findProviderSchema,
} from "../src/providers/index.ts";
import { createGetProviderSettingsSchemaTool } from "../src/tools/get-provider-settings-schema.ts";
import { makeTestClient } from "./helpers.ts";
import { makeFakeFetch } from "./helpers-fetch.ts";

describe("bundled provider schemas", () => {
  it("includes the canonical 24 providers", () => {
    expect(PROVIDER_SLUGS).toEqual(
      [...PROVIDER_SLUGS].sort((a, b) => a.localeCompare(b)),
    );
    expect(PROVIDER_SLUGS.length).toBeGreaterThanOrEqual(24);
    for (const slug of [
      "x",
      "linkedin",
      "reddit",
      "hashnode",
      "devto",
      "wordpress",
      "lemmy",
    ]) {
      expect(PROVIDER_SLUGS).toContain(slug);
    }
  });

  it("each provider has source URL + ISO fetchedAt + non-empty markdown", () => {
    for (const p of PROVIDER_SCHEMAS) {
      expect(p.sourceUrl).toMatch(
        /^https:\/\/docs\.postiz\.com\/public-api\/providers\/.+\.md$/,
      );
      expect(() => new Date(p.fetchedAt).toISOString()).not.toThrow();
      expect(p.markdown.length).toBeGreaterThan(0);
    }
  });

  it("X provider exposes the who_can_reply_post field in defaultSettings", () => {
    const x = PROVIDER_SCHEMA_BY_SLUG["x"];
    expect(x).toBeDefined();
    expect(x.defaultSettings).toMatchObject({
      __type: "x",
      who_can_reply_post: expect.any(String),
    });
  });

  it("findProviderSchema resolves by slug, by type, and by alias", () => {
    expect(findProviderSchema("x")).toBeTruthy();
    expect(findProviderSchema("X")).toBeTruthy();
    expect(findProviderSchema("twitter")).toMatchObject({ slug: "x" });
    expect(findProviderSchema("google_my_business")).toMatchObject({ slug: "gmb" });
    expect(findProviderSchema("unknown-provider")).toBeNull();
  });
});

describe("postiz_get_provider_settings_schema tool", () => {
  let fake: ReturnType<typeof makeFakeFetch>;
  afterEach(() => fake?.restore());

  it("returns markdown by default", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const tool = createGetProviderSettingsSchemaTool(() => client);
    const res = await tool.execute("t", { provider: "x" });
    const d = res.details as {
      ok: boolean;
      type: string;
      defaultSettings: Record<string, unknown> | null;
      markdown?: string;
    };
    expect(d.ok).toBe(true);
    expect(d.type).toBe("x");
    expect(d.defaultSettings?.__type).toBe("x");
    expect(d.markdown).toBeDefined();
    expect(d.markdown!.length).toBeGreaterThan(0);
    // No outbound HTTP — the schema bundle is local.
    expect(fake.calls).toHaveLength(0);
  });

  it("includeMarkdown=false returns a compact response", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const tool = createGetProviderSettingsSchemaTool(() => client);
    const res = await tool.execute("t", {
      provider: "linkedin",
      includeMarkdown: false,
    });
    const d = res.details as { markdown?: string; defaultSettings: unknown };
    expect(d.markdown).toBeUndefined();
    expect(d.defaultSettings).toBeDefined();
  });

  it("returns ok:false / unknown_provider for misses", async () => {
    fake = makeFakeFetch();
    const client = makeTestClient();
    const tool = createGetProviderSettingsSchemaTool(() => client);
    const res = await tool.execute("t", { provider: "myspace" });
    const d = res.details as {
      ok: boolean;
      reason: string;
      knownSlugs: string[];
    };
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("unknown_provider");
    expect(d.knownSlugs.length).toBeGreaterThan(0);
  });
});
