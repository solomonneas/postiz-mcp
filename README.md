<p align="center">
  <img src="docs/assets/postiz-mcp-banner.jpg" alt="postiz-mcp banner">
</p>

<h1 align="center">postiz-mcp</h1>

<p align="center">
  <strong>Canonical Postiz client for any MCP-compatible client.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript 5">
  <img src="https://img.shields.io/badge/MCP-server-7A3EFF?style=for-the-badge" alt="MCP server">
  <img src="https://img.shields.io/badge/OpenClaw-native_plugin-6C3BFF?style=for-the-badge" alt="OpenClaw native plugin">
  <img src="https://img.shields.io/badge/license-MIT-2EA043?style=for-the-badge" alt="MIT license">
</p>

Canonical [Postiz](https://github.com/gitroomhq/postiz-app) client for any MCP-compatible client. Full coverage of the Postiz public API (integrations, posts, uploads, analytics, video) with env-gated writes, confirm-required deletes, and a built-in rate-limit guard.

Ships as a stdio MCP server **and** a first-class OpenClaw native plugin from the same package.

## Why

If you self-host Postiz and want Claude / Codex / OpenClaw / Hermes / any MCP client to interact with it, this gives you a typed, tested, single-purpose tool surface instead of hand-rolled HTTP calls in every workflow.

## See also

[`gitroomhq/postiz-agent`](https://github.com/gitroomhq/postiz-agent) is the official Postiz CLI from Nevo David. It's the right pick if you're a **Postiz Cloud subscriber** wanting OAuth-flow auth, or if you only need a Bash-callable surface in Claude Code.

This package (`postiz-mcp`) is the right pick if you:
- Self-host Postiz and want to skip running an OAuth broker
- Use an MCP-native client (Claude Desktop, OpenClaw, Hermes, Codex CLI) and want **typed tool schemas** instead of bash-shelling
- Want **defense-in-depth gating** (writes off by default, deletes require `enableDelete` + `confirm: true`)
- Want a **local rate-limit guard** that refuses to send when your hourly budget is exhausted
- Need **Cloudflare Access** service-token support

## Warnings before you wire this up

- **Postiz writes are public side effects.** A successful `postiz_create_post` with `type: "now"` (or a near-term schedule) lands on real social accounts. Once published, posts can be deleted from Postiz but **the platform-side post stays live** - Postiz cannot recall it.
- **The Postiz public API is rate-limited at 30 requests/hour by default.** This server tracks the limit locally and refuses to send when the budget is exhausted. Override with `POSTIZ_RATE_LIMIT_PER_HOUR` if your Postiz instance is configured higher.
- **Writes and deletes are gated off by default.** Reads always work. To enable writes you must explicitly set `POSTIZ_ENABLE_WRITE=true`. To enable deletes you must additionally set `POSTIZ_ENABLE_DELETE=true` AND pass `confirm: true` in the tool call.

## Tools

### Reads (always on)
- `postiz_list_integrations` - list connected channels
- `postiz_check_integration` - verify API key
- `postiz_find_next_slot` - next free posting slot for a channel
- `postiz_list_posts` - posts in a date window
- `postiz_get_missing_content` - recover platform content for a Postiz post with a missing `releaseId`
- `postiz_get_integration_settings` - live runtime config for ONE connected integration: rules, maxLength (verified-aware), settings DTO, available platform-specific tools. Use before postiz_create_post when content length matters.
- `postiz_list_notifications` - Postiz UI notifications
- `postiz_get_platform_analytics` - followers / impressions / engagement
- `postiz_get_post_analytics` - likes / comments / shares
- `postiz_list_voices` - AI video voice catalog
- `postiz_get_provider_settings_schema` - per-provider `settings` schema (X, LinkedIn, Reddit, etc.) bundled at build time

### Writes (require `POSTIZ_ENABLE_WRITE=true`)
- `postiz_create_post` - schedule / publish-now / draft
- `postiz_connect_integration` - generate OAuth URL for a new channel
- `postiz_invoke_integration_tool` - call a per-platform tool method on an integration (e.g. Reddit subreddit search, YouTube playlist lookup) via POST /api/public/v1/integration-trigger/{id}. Discover valid `methodName` values via `postiz_get_integration_settings(id).tools` first.
- `postiz_update_post_status` - toggle DRAFT ↔ QUEUE
- `postiz_update_post_release_id` - reattach a Postiz post to its platform-side release
- `postiz_upload_file` - multipart upload from local file or base64
- `postiz_upload_from_url` - server-side fetch
- `postiz_generate_video` - AI video generation

### Deletes (require `POSTIZ_ENABLE_WRITE=true` + `POSTIZ_ENABLE_DELETE=true` + `confirm: true`)
- `postiz_delete_post` - cascades to whole group
- `postiz_delete_post_group` - delete every post in a cross-post group
- `postiz_delete_integration` - disconnect channel + all its scheduled posts

## Install

```bash
npm install -g postiz-mcp
```

Or from source:

```bash
git clone https://github.com/solomonneas/postiz-mcp.git
cd postiz-mcp
npm install
npm run build
```

## Configuration

Set these environment variables in your MCP client config:

| Variable | Required | Default | Description |
|---|---|---|---|
| `POSTIZ_URL` | yes | - | Base URL, e.g. `http://localhost:5000` or `https://postiz.example.com` |
| `POSTIZ_API_KEY` | yes | - | API key from Postiz Settings → Public API |
| `POSTIZ_ENABLE_WRITE` | no | `false` | Set `true` to expose create / update / upload / connect / generate-video tools |
| `POSTIZ_ENABLE_DELETE` | no | `false` | Set `true` (in addition to write) to expose delete tools |
| `POSTIZ_REQUEST_TIMEOUT_MS` | no | `30000` | HTTP timeout (ms) |
| `POSTIZ_RATE_LIMIT_PER_HOUR` | no | `30` | Local guard ceiling. The server still trusts response headers when present. |
| `POSTIZ_CF_ACCESS_CLIENT_ID` | no | - | Cloudflare Access service token client id (only needed if Postiz is behind CF Access) |
| `POSTIZ_CF_ACCESS_CLIENT_SECRET` | no | - | Cloudflare Access service token secret |

### Getting an API key

1. Log into Postiz as an admin
2. Settings → Public API → Generate API Key
3. Copy the value (starts with `pos_` or is a raw UUID depending on your Postiz version)

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "postiz": {
      "command": "postiz-mcp",
      "env": {
        "POSTIZ_URL": "http://localhost:5000",
        "POSTIZ_API_KEY": "your-api-key-here",
        "POSTIZ_ENABLE_WRITE": "true",
        "POSTIZ_ENABLE_DELETE": "false"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add postiz \
  --env POSTIZ_URL=http://localhost:5000 \
  --env POSTIZ_API_KEY=your-api-key-here \
  --env POSTIZ_ENABLE_WRITE=true \
  -- postiz-mcp
```

Add `--scope user` to make it available from any directory instead of only the current project.

### OpenClaw

postiz-mcp is also an OpenClaw native plugin. From a source checkout:

```bash
openclaw plugin add /absolute/path/to/postiz-mcp \
  --config '{
    "baseUrl": "http://localhost:5000",
    "apiKeyEnv": "POSTIZ_API_KEY",
    "enableWrite": true,
    "enableDelete": false
  }'
```

Then export the API key and restart the gateway:

```bash
export POSTIZ_API_KEY=your-api-key-here
systemctl --user restart openclaw-gateway
openclaw plugin list   # confirm "postiz" is enabled
```

You can also run it as a regular MCP server under OpenClaw:

```bash
openclaw mcp set postiz '{
  "command": "postiz-mcp",
  "env": {
    "POSTIZ_URL": "http://localhost:5000",
    "POSTIZ_API_KEY": "your-api-key-here",
    "POSTIZ_ENABLE_WRITE": "true"
  }
}'
```

### Hermes Agent

[Hermes Agent](https://github.com/NousResearch/hermes-agent) reads MCP config from `~/.hermes/config.yaml` under `mcp_servers`. Add an entry:

```yaml
mcp_servers:
  postiz:
    command: "postiz-mcp"
    env:
      POSTIZ_URL: "http://localhost:5000"
      POSTIZ_API_KEY: "your-api-key-here"
      POSTIZ_ENABLE_WRITE: "true"
```

Or from a source checkout:

```yaml
mcp_servers:
  postiz:
    command: "node"
    args: ["/absolute/path/to/postiz-mcp/dist/mcp-server.js"]
    env:
      POSTIZ_URL: "http://localhost:5000"
      POSTIZ_API_KEY: "your-api-key-here"
      POSTIZ_ENABLE_WRITE: "true"
```

Then reload MCP from inside a Hermes session:

```
/reload-mcp
```

### Codex CLI

[Codex CLI](https://github.com/openai/codex) registers MCP servers via `codex mcp add`:

```bash
codex mcp add postiz \
  --env POSTIZ_URL=http://localhost:5000 \
  --env POSTIZ_API_KEY=your-api-key-here \
  --env POSTIZ_ENABLE_WRITE=true \
  -- postiz-mcp
```

Or from a source checkout:

```bash
codex mcp add postiz \
  --env POSTIZ_URL=http://localhost:5000 \
  --env POSTIZ_API_KEY=your-api-key-here \
  --env POSTIZ_ENABLE_WRITE=true \
  -- node /absolute/path/to/postiz-mcp/dist/mcp-server.js
```

Codex writes the entry to `~/.codex/config.toml` under `[mcp_servers.postiz]`. Verify with:

```bash
codex mcp list
```

### Postiz behind Cloudflare Access

If your Postiz is exposed via Cloudflare Tunnel + Access (e.g. `https://postiz.example.com`), generate a service token in the Cloudflare Zero Trust dashboard and add the env vars:

```bash
export POSTIZ_CF_ACCESS_CLIENT_ID=your-cf-id.access
export POSTIZ_CF_ACCESS_CLIENT_SECRET=your-cf-secret
```

The MCP server forwards them as `CF-Access-Client-Id` / `CF-Access-Client-Secret` on every request. If you forget them, you'll get a clear `PostizCfAccessChallengeError` instead of a confusing HTML response.

## Example prompts

- *"List the integrations on my Postiz."*
- *"Schedule a Bluesky post for tomorrow 9am: 'Just shipped postiz-mcp.'"*
- *"What's the next available LinkedIn slot? Schedule this 4-tweet thread for that time on X with replies set to verified-only."*
- *"What posted last week and how did the X post on Tuesday do?"*
- *"Show me the X provider settings schema so I can construct a thread payload."*

### Thread mode (multi-post threads with per-post media + delay)

`postiz_create_post`'s `posts[].value[]` array is a sequence - every entry posts to the same integration in order, with optional per-entry `image[]` and `delay` (minutes between posts). Use this for X threads, LinkedIn carousel-style follow-ups, etc.

```json
{
  "type": "schedule",
  "date": "2026-05-15T09:00:00.000Z",
  "posts": [
    {
      "integrationId": "integration-uuid-here",
      "value": [
        {
          "content": "Launching our new feature today.",
          "image": [{ "id": "abc", "path": "<path returned by postiz_upload_file>" }]
        },
        {
          "content": "Here's what's new under the hood:",
          "delay": 5
        },
        {
          "content": "Try it and let us know what breaks.",
          "delay": 5
        }
      ]
    }
  ]
}
```

Each `value[]` after the first uses `delay` (minutes) to space posts out. `image[]` is optional per entry and uses paths returned by `postiz_upload_file` / `postiz_upload_from_url` - raw filesystem paths and external URLs are rejected.

## Provider settings schemas

`postiz_get_provider_settings_schema` returns the bundled per-provider `settings` reference (parsed from `docs.postiz.com/public-api/providers/{slug}.md`). Use it before `postiz_create_post` when you need provider-specific fields like X's `who_can_reply_post` or LinkedIn's `audience`.

The schemas are refreshed monthly by a GitHub Actions workflow that opens a PR if Postiz updated any provider doc. To refresh manually:

```bash
npm run refresh-schemas
```

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

## License

MIT
