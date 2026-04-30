import { PostizClient } from "../src/postiz-client.ts";
import type { PostizPluginConfig } from "../src/config.ts";

export const TEST_BASE_URL = "https://postiz.test.local";
export const TEST_API_KEY = "test-api-key-12345";

export function makeTestClient(
  overrides: Partial<{
    rateLimitPerHour: number;
    timeoutMs: number;
    cfAccessClientId: string;
    cfAccessClientSecret: string;
  }> = {},
): PostizClient {
  return new PostizClient({
    baseUrl: TEST_BASE_URL,
    apiKey: TEST_API_KEY,
    timeoutMs: overrides.timeoutMs ?? 5_000,
    rateLimitPerHour: overrides.rateLimitPerHour ?? 30,
    cfAccessClientId: overrides.cfAccessClientId,
    cfAccessClientSecret: overrides.cfAccessClientSecret,
  });
}

export function makeTestConfig(
  overrides: Partial<PostizPluginConfig> = {},
): PostizPluginConfig {
  return {
    baseUrl: TEST_BASE_URL,
    apiKeyInline: TEST_API_KEY,
    apiKeyEnv: "POSTIZ_API_KEY",
    enableWrite: false,
    enableDelete: false,
    requestTimeoutMs: 5_000,
    rateLimitPerHour: 30,
    cfAccessClientIdEnv: "POSTIZ_CF_ACCESS_CLIENT_ID",
    cfAccessClientSecretEnv: "POSTIZ_CF_ACCESS_CLIENT_SECRET",
    ...overrides,
  };
}
