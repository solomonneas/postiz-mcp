import { PostizClient } from "./postiz-client.ts";

export interface PostizPluginConfig {
  baseUrl: string;
  apiKeyInline: string;
  apiKeyEnv: string;
  /** Gate for create/update tools (create_post, update_*, connect_integration,
   *  upload_file, upload_from_url, generate_video). Off by default — every
   *  tool that lands on a real social account or burns API credits is gated. */
  enableWrite: boolean;
  /** Second gate for delete tools (delete_post, delete_post_group,
   *  delete_integration). Off by default. Each delete tool also requires
   *  `confirm: true` in args; both must align before the request fires. */
  enableDelete: boolean;
  requestTimeoutMs: number;
  rateLimitPerHour: number;
  cfAccessClientIdInline?: string;
  cfAccessClientSecretInline?: string;
  cfAccessClientIdEnv: string;
  cfAccessClientSecretEnv: string;
}

export function resolveConfig(raw: unknown): PostizPluginConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("postiz-mcp: plugin config missing");
  }
  const c = raw as Record<string, unknown>;
  const baseUrl = typeof c.baseUrl === "string" ? c.baseUrl.trim() : "";
  if (!baseUrl) throw new Error("postiz-mcp: baseUrl is required");
  const apiKeyEnv =
    typeof c.apiKeyEnv === "string" && c.apiKeyEnv.trim()
      ? c.apiKeyEnv.trim()
      : "POSTIZ_API_KEY";
  const apiKeyInline = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  return {
    baseUrl,
    apiKeyInline,
    apiKeyEnv,
    enableWrite: c.enableWrite === true,
    enableDelete: c.enableDelete === true,
    requestTimeoutMs:
      typeof c.requestTimeoutMs === "number" ? c.requestTimeoutMs : 30_000,
    rateLimitPerHour:
      typeof c.rateLimitPerHour === "number" ? c.rateLimitPerHour : 30,
    cfAccessClientIdInline:
      typeof c.cfAccessClientId === "string" && c.cfAccessClientId.trim()
        ? c.cfAccessClientId.trim()
        : undefined,
    cfAccessClientSecretInline:
      typeof c.cfAccessClientSecret === "string" && c.cfAccessClientSecret.trim()
        ? c.cfAccessClientSecret.trim()
        : undefined,
    cfAccessClientIdEnv:
      typeof c.cfAccessClientIdEnv === "string" && c.cfAccessClientIdEnv.trim()
        ? c.cfAccessClientIdEnv.trim()
        : "POSTIZ_CF_ACCESS_CLIENT_ID",
    cfAccessClientSecretEnv:
      typeof c.cfAccessClientSecretEnv === "string" &&
      c.cfAccessClientSecretEnv.trim()
        ? c.cfAccessClientSecretEnv.trim()
        : "POSTIZ_CF_ACCESS_CLIENT_SECRET",
  };
}

export function resolveApiKey(config: PostizPluginConfig): string {
  if (config.apiKeyInline) return config.apiKeyInline;
  const fromEnv = (process.env[config.apiKeyEnv] ?? "").trim();
  if (!fromEnv) {
    throw new Error(
      `postiz-mcp: apiKey is empty and env var ${config.apiKeyEnv} is not set`,
    );
  }
  return fromEnv;
}

export function makeClient(config: PostizPluginConfig): PostizClient {
  const cfId =
    config.cfAccessClientIdInline ??
    ((process.env[config.cfAccessClientIdEnv] ?? "").trim() || undefined);
  const cfSecret =
    config.cfAccessClientSecretInline ??
    ((process.env[config.cfAccessClientSecretEnv] ?? "").trim() || undefined);
  return new PostizClient({
    baseUrl: config.baseUrl,
    apiKey: resolveApiKey(config),
    timeoutMs: config.requestTimeoutMs,
    rateLimitPerHour: config.rateLimitPerHour,
    cfAccessClientId: cfId,
    cfAccessClientSecret: cfSecret,
  });
}
