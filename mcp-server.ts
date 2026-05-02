#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { PostizClient } from "./src/postiz-client.ts";
import { makeClient, type PostizPluginConfig } from "./src/config.ts";

import { createListIntegrationsTool } from "./src/tools/list-integrations.ts";
import { createCheckIntegrationTool } from "./src/tools/check-integration.ts";
import { createFindNextSlotTool } from "./src/tools/find-next-slot.ts";
import { createConnectIntegrationTool } from "./src/tools/connect-integration.ts";
import { createDeleteIntegrationTool } from "./src/tools/delete-integration.ts";
import { createInvokeIntegrationToolTool } from "./src/tools/invoke-integration-tool.ts";
import { createCreatePostTool } from "./src/tools/create-post.ts";
import { createListPostsTool } from "./src/tools/list-posts.ts";
import { createGetMissingContentTool } from "./src/tools/get-missing-content.ts";
import { createGetIntegrationSettingsTool } from "./src/tools/get-integration-settings.ts";
import { createUpdatePostReleaseIdTool } from "./src/tools/update-post-release-id.ts";
import { createUpdatePostStatusTool } from "./src/tools/update-post-status.ts";
import { createDeletePostTool } from "./src/tools/delete-post.ts";
import { createDeletePostGroupTool } from "./src/tools/delete-post-group.ts";
import { createListNotificationsTool } from "./src/tools/list-notifications.ts";
import { createUploadFileTool } from "./src/tools/upload-file.ts";
import { createUploadFromUrlTool } from "./src/tools/upload-from-url.ts";
import { createGetPlatformAnalyticsTool } from "./src/tools/get-platform-analytics.ts";
import { createGetPostAnalyticsTool } from "./src/tools/get-post-analytics.ts";
import { createListVoicesTool } from "./src/tools/list-voices.ts";
import { createGenerateVideoTool } from "./src/tools/generate-video.ts";
import { createGetProviderSettingsSchemaTool } from "./src/tools/get-provider-settings-schema.ts";

const VERSION = "0.2.0";

function readConfigFromEnv(): PostizPluginConfig {
  const baseUrl = (process.env.POSTIZ_URL ?? "").trim();
  if (!baseUrl) {
    throw new Error(
      "POSTIZ_URL is required (e.g. http://localhost:5000 or https://postiz.example.com). Set it in your MCP client env config.",
    );
  }
  const apiKeyEnv = (process.env.POSTIZ_API_KEY_ENV ?? "POSTIZ_API_KEY").trim() || "POSTIZ_API_KEY";
  const apiKey = (process.env[apiKeyEnv] ?? "").trim();
  if (!apiKey) {
    throw new Error(
      `${apiKeyEnv} is required. Generate an API key in Postiz under Settings -> Public API.`,
    );
  }
  const cfId = (process.env.POSTIZ_CF_ACCESS_CLIENT_ID ?? "").trim();
  const cfSecret = (process.env.POSTIZ_CF_ACCESS_CLIENT_SECRET ?? "").trim();
  const uploadRoots = (process.env.POSTIZ_UPLOAD_ROOTS ?? "")
    .split(/[,:]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    baseUrl,
    apiKeyInline: apiKey,
    apiKeyEnv,
    enableWrite: parseBool(process.env.POSTIZ_ENABLE_WRITE) ?? false,
    enableDelete: parseBool(process.env.POSTIZ_ENABLE_DELETE) ?? false,
    requestTimeoutMs: parsePosInt("POSTIZ_REQUEST_TIMEOUT_MS", 30_000, 1000),
    rateLimitPerHour: parsePosInt("POSTIZ_RATE_LIMIT_PER_HOUR", 30, 1),
    uploadRoots,
    maxUploadBytes: parsePosInt(
      "POSTIZ_MAX_UPLOAD_BYTES",
      100 * 1024 * 1024,
      1,
    ),
    cfAccessClientIdInline: cfId || undefined,
    cfAccessClientSecretInline: cfSecret || undefined,
    cfAccessClientIdEnv: "POSTIZ_CF_ACCESS_CLIENT_ID",
    cfAccessClientSecretEnv: "POSTIZ_CF_ACCESS_CLIENT_SECRET",
  };
}

function parseBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  const v = raw.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return undefined;
}

function parsePosInt(envName: string, fallback: number, min: number): number {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new Error(
      `${envName} must be an integer >= ${min} (got ${JSON.stringify(raw)}).`,
    );
  }
  return n;
}

function lazyClient(config: PostizPluginConfig): () => PostizClient {
  let cached: PostizClient | undefined;
  return () => {
    if (!cached) cached = makeClient(config);
    return cached;
  };
}

interface ToolFactoryResult {
  name: string;
  description: string;
  execute: (
    toolCallId: string,
    rawParams: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: unknown;
  }>;
}

function bind<Shape extends z.ZodRawShape>(
  server: McpServer,
  tool: ToolFactoryResult,
  shape: Shape,
): void {
  const handler = async (args: unknown): Promise<CallToolResult> => {
    const res = await tool.execute("mcp", args as Record<string, unknown>);
    return { content: res.content };
  };
  server.tool(tool.name, tool.description, shape, handler as never);
}

async function main(): Promise<void> {
  const config = readConfigFromEnv();
  const getClient = lazyClient(config);

  const server = new McpServer({
    name: "postiz-mcp",
    version: VERSION,
    description:
      "Postiz tools: full coverage of the Postiz public API with env-gated writes, confirm-required deletes, and a built-in 30/hr rate-limit guard.",
  });

  // Reads
  bind(server, createListIntegrationsTool(getClient), {});
  bind(server, createCheckIntegrationTool(getClient), {});
  bind(server, createFindNextSlotTool(getClient), {
    integrationId: z.string().describe("Integration id from postiz_list_integrations."),
  });
  bind(server, createListPostsTool(getClient), {
    startDate: z.string().optional().describe("ISO-8601 start of window."),
    endDate: z.string().optional().describe("ISO-8601 end of window."),
    window: z.enum(["day", "week", "month"]).optional().describe(
      "Convenience preset when start/end omitted. Default 'week'.",
    ),
    customer: z.string().optional().describe("Optional customer id (multi-tenant)."),
  });
  bind(server, createGetMissingContentTool(getClient), {
    postId: z.string().describe("Post id whose releaseId is marked missing."),
  });
  bind(server, createGetIntegrationSettingsTool(getClient), {
    integrationId: z
      .string()
      .describe("Integration id from postiz_list_integrations."),
  });
  bind(server, createListNotificationsTool(getClient), {
    page: z.number().int().min(1).max(100).optional().describe("Page (default 1)."),
  });
  bind(server, createGetPlatformAnalyticsTool(getClient), {
    integrationId: z.string().describe("Integration id."),
    date: z
      .string()
      .regex(/^[0-9]+$/)
      .describe("Lookback in days as a string (e.g. '7', '30'). Required."),
  });
  bind(server, createGetPostAnalyticsTool(getClient), {
    postId: z.string().describe("Post id."),
  });
  bind(server, createListVoicesTool(getClient), {
    identifier: z.string().describe("Video-type identifier (e.g. 'image-text-slides')."),
  });
  bind(server, createGetProviderSettingsSchemaTool(getClient), {
    provider: z.string().describe("Provider slug or __type (e.g. 'x', 'linkedin')."),
    includeMarkdown: z.boolean().optional().describe(
      "Include full markdown reference. Default true.",
    ),
  });

  // Writes (gated by enableWrite)
  bind(server, createConnectIntegrationTool(getClient, config), {
    provider: z.string().describe("Provider slug (e.g. 'x', 'linkedin')."),
    refresh: z
      .string()
      .optional()
      .describe("Existing integration id to re-auth. Omit for a brand-new connection."),
  });
  bind(server, createInvokeIntegrationToolTool(getClient, config), {
    integrationId: z
      .string()
      .describe("Integration id from postiz_list_integrations."),
    methodName: z
      .string()
      .describe(
        "Platform-specific tool method name. Discover via postiz_get_integration_settings(integrationId).tools.",
      ),
    data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Method-specific arguments. Shape varies by platform/methodName. Defaults to empty.",
      ),
  });
  bind(server, createCreatePostTool(getClient, config), {
    type: z.enum(["draft", "schedule", "now"]).describe(
      "draft / schedule / now. PUBLIC SIDE EFFECT for schedule + now.",
    ),
    date: z.string().describe("ISO-8601 timestamp."),
    posts: z.array(
      z.object({
        integrationId: z.string(),
        value: z.array(
          z.object({
            content: z.string(),
            delay: z.number().int().min(0).optional().describe(
              "Minutes to wait after the previous post in the value[] sequence before publishing this one.",
            ),
            image: z
              .array(
                z.object({
                  id: z.string().optional(),
                  path: z.string().optional(),
                }),
              )
              .optional(),
          }),
        ).min(1),
        settings: z.record(z.string(), z.unknown()).optional(),
        group: z.string().optional(),
      }),
    ).min(1).describe("One entry per integration to post on."),
    shortLink: z.boolean().optional(),
    tags: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  });
  bind(server, createUpdatePostReleaseIdTool(getClient, config), {
    postId: z.string(),
    releaseId: z.string(),
  });
  bind(server, createUpdatePostStatusTool(getClient, config), {
    postId: z.string(),
    status: z.enum(["draft", "schedule"]),
  });
  bind(server, createUploadFileTool(getClient, config), {
    filePath: z.string().optional().describe("Absolute path to a local file."),
    base64: z.string().optional().describe("Base64-encoded contents."),
    fileName: z.string().optional().describe("File name for multipart upload."),
    mimeType: z.string().optional().describe("Content-Type."),
  });
  bind(server, createUploadFromUrlTool(getClient, config), {
    url: z.string().describe("Public URL Postiz should fetch."),
  });
  bind(server, createGenerateVideoTool(getClient, config), {
    body: z.record(z.string(), z.unknown()).describe(
      "Free-form payload as expected by Postiz video integrations.",
    ),
  });

  // Deletes (gated by enableWrite + enableDelete + confirm=true)
  bind(server, createDeleteIntegrationTool(getClient, config), {
    integrationId: z.string(),
    confirm: z.boolean().describe("Must be true. Cascades - scheduled posts removed."),
  });
  bind(server, createDeletePostTool(getClient, config), {
    postId: z.string(),
    confirm: z.boolean().describe("Must be true. Cascades to whole group."),
  });
  bind(server, createDeletePostGroupTool(getClient, config), {
    group: z.string(),
    confirm: z.boolean().describe("Must be true. Removes every post in the group."),
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`postiz-mcp fatal: ${msg}`);
  process.exit(1);
});
