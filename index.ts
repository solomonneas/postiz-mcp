import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { PostizClient } from "./src/postiz-client.ts";
import { makeClient, resolveConfig, type PostizPluginConfig } from "./src/config.ts";

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

export default definePluginEntry({
  id: "postiz",
  name: "Postiz",
  description:
    "Full-coverage Postiz client for OpenClaw agents: integrations, posts (create / list / update / delete), uploads, analytics, and video. Env-gated writes, confirm-required deletes, built-in 30/hr rate-limit guard, bundled per-provider settings schemas.",
  register(api) {
    if (api.registrationMode !== "full") return;

    const config = resolveConfig(api.pluginConfig);
    const getClient = lazyClient(config);

    // Reads - always available.
    api.registerTool(createListIntegrationsTool(getClient) as AnyAgentTool);
    api.registerTool(createCheckIntegrationTool(getClient) as AnyAgentTool);
    api.registerTool(createFindNextSlotTool(getClient) as AnyAgentTool);
    api.registerTool(createListPostsTool(getClient) as AnyAgentTool);
    api.registerTool(createGetMissingContentTool(getClient) as AnyAgentTool);
    api.registerTool(
      createGetIntegrationSettingsTool(getClient) as AnyAgentTool,
    );
    api.registerTool(createListNotificationsTool(getClient) as AnyAgentTool);
    api.registerTool(createGetPlatformAnalyticsTool(getClient) as AnyAgentTool);
    api.registerTool(createGetPostAnalyticsTool(getClient) as AnyAgentTool);
    api.registerTool(createListVoicesTool(getClient) as AnyAgentTool);
    api.registerTool(
      createGetProviderSettingsSchemaTool(getClient) as AnyAgentTool,
    );

    // Writes - register only when enabled. Gates re-check at execute time
    // so the registration pattern matches behavior even if config flips
    // between a registration sync and a tool call.
    if (config.enableWrite) {
      api.registerTool(
        createConnectIntegrationTool(getClient, config) as AnyAgentTool,
      );
      api.registerTool(
        createInvokeIntegrationToolTool(getClient, config) as AnyAgentTool,
      );
      api.registerTool(createCreatePostTool(getClient, config) as AnyAgentTool);
      api.registerTool(
        createUpdatePostReleaseIdTool(getClient, config) as AnyAgentTool,
      );
      api.registerTool(
        createUpdatePostStatusTool(getClient, config) as AnyAgentTool,
      );
      api.registerTool(createUploadFileTool(getClient, config) as AnyAgentTool);
      api.registerTool(
        createUploadFromUrlTool(getClient, config) as AnyAgentTool,
      );
      api.registerTool(
        createGenerateVideoTool(getClient, config) as AnyAgentTool,
      );

      if (config.enableDelete) {
        api.registerTool(
          createDeleteIntegrationTool(getClient, config) as AnyAgentTool,
        );
        api.registerTool(
          createDeletePostTool(getClient, config) as AnyAgentTool,
        );
        api.registerTool(
          createDeletePostGroupTool(getClient, config) as AnyAgentTool,
        );
      }
    }
  },
});

function lazyClient(config: PostizPluginConfig): () => PostizClient {
  let cached: PostizClient | undefined;
  return () => {
    if (!cached) cached = makeClient(config);
    return cached;
  };
}
