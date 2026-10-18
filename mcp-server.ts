#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./src/server.ts";
import { startHttpServer } from "./src/http.ts";

async function main(): Promise<void> {
  if (process.argv.includes("--http")) {
    await startHttpServer();
    return;
  }
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`postiz-mcp fatal: ${msg}`);
  process.exit(1);
});
