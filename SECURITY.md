# Security Policy

## Supported versions

postiz-mcp is pre-1.0 and moves fast. Security fixes land on the latest published
version (`npm install -g postiz-mcp`); please upgrade before reporting.

## Reporting a vulnerability

Please report security issues privately, not in a public issue:

- GitHub: **Security → Report a vulnerability** (private advisory) on this repo, or
- contact the maintainer privately via [@solomonneas](https://github.com/solomonneas)

Include the version, your MCP client, and a minimal reproduction. You'll get an
acknowledgement, and a fix or mitigation plan once the report is confirmed.

## Scope

In scope:

- The MCP server and OpenClaw plugin code in this repo
- The write/delete gating logic (`POSTIZ_ENABLE_WRITE`, `POSTIZ_ENABLE_DELETE`, `confirm`)
- Credential handling (how `POSTIZ_API_KEY` and Cloudflare Access tokens are read and forwarded)
- The local rate-limit guard

Out of scope:

- [Postiz](https://github.com/gitroomhq/postiz-app) itself and the social platforms it posts to
- Your MCP client's secret storage

## Handling credentials

postiz-mcp reads `POSTIZ_API_KEY` (and optional Cloudflare Access tokens) from the
environment and forwards them only to the configured `POSTIZ_URL`. It never logs
them. Never commit an API key or paste one into an issue: scrub the value first.
