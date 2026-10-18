import { randomUUID } from "node:crypto";
import { request, createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHttpServer, type HttpServerHandle } from "../src/http.ts";

const TOKEN = randomUUID();
let http: HttpServerHandle | undefined;
const clients: Client[] = [];
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  await http?.close();
  http = undefined;
  for (const fn of cleanup.splice(0)) await fn();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function configure(extra: Record<string, string | undefined> = {}) {
  for (const [key, value] of Object.entries({
    POSTIZ_URL: "https://postiz.example.com", POSTIZ_API_KEY: "test-upstream-key",
    POSTIZ_MCP_HTTP_TOKEN: TOKEN, POSTIZ_MCP_HTTP_HOST: undefined, POSTIZ_MCP_HTTP_PORT: "0",
    POSTIZ_API_KEY_ENV: undefined, POSTIZ_CF_ACCESS_CLIENT_ID: undefined,
    POSTIZ_CF_ACCESS_CLIENT_SECRET: undefined, POSTIZ_ENABLE_WRITE: "true", POSTIZ_ENABLE_DELETE: "true",
    POSTIZ_MCP_HTTP_LOCAL_FILES: undefined, POSTIZ_UPLOAD_ROOTS: undefined,
    POSTIZ_RATE_LIMIT_PER_HOUR: "30", ...extra,
  })) vi.stubEnv(key, value);
}
async function start(extra = {}) {
  configure(extra);
  http = await createHttpServer();
  return `http://localhost:${http.port}`;
}
async function connect(url: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: "http-test", version: "1" });
  clients.push(client);
  await client.connect(transport);
  return { client, transport };
}
it.each([undefined, "Bearer wrong"])("rejects missing/wrong auth %s", async (authorization) => {
  const res = await fetch(`${await start()}/mcp`, { method: "POST", headers: authorization ? { authorization } : {} });
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toBe("Bearer");
});
it("returns only liveness without authentication", async () => {
  const res = await fetch(`${await start()}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('{"status":"ok"}');
});
it("lists tools and removes terminated sessions", async () => {
  const url = await start();
  const { client, transport } = await connect(url);
  expect((await client.listTools()).tools.some(t => t.name === "postiz_create_post")).toBe(true);
  const id = transport.sessionId!;
  await transport.terminateSession();
  expect((await fetch(`${url}/mcp`, { headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": id, accept: "text/event-stream" } })).status).toBe(404);
});
it.each([{ origin: "https://evil.example.com" }, { origin: "null" }, { host: "evil.example.com" }])("rejects rebinding before auth %j", async headers => {
  const url = await start();
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = request(`${url}/mcp`, { method: "POST", headers }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject); req.end();
  });
  expect(status).toBe(403);
});
it.each([undefined, "", "  ", "test-upstream-key", "cf-secret", "cf-id", "url-password"])("refuses missing/blank/reused token %s", async token => {
  configure({ POSTIZ_MCP_HTTP_TOKEN: token, POSTIZ_CF_ACCESS_CLIENT_SECRET: "cf-secret", POSTIZ_CF_ACCESS_CLIENT_ID: "cf-id", POSTIZ_URL: "https://user:url-password@postiz.example.com" });
  await expect(createHttpServer()).rejects.toThrow(/POSTIZ_MCP_HTTP_TOKEN/);
});
it("rejects a token matching an indirect API credential", async () => {
  configure({ POSTIZ_API_KEY_ENV: "TEST_POSTIZ_KEY", TEST_POSTIZ_KEY: TOKEN });
  await expect(createHttpServer()).rejects.toThrow(/POSTIZ_MCP_HTTP_TOKEN/);
});
it.each([false, true])("bounds content-length and chunked bodies (chunked=%s)", async chunked => {
  const url = await start();
  const status = await new Promise((resolve, reject) => {
    const req = request(`${url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${TOKEN}`, ...(chunked ? {} : { "content-length": "1200000" }) } }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write("x".repeat(600_000)); req.end("x".repeat(600_000));
  });
  expect(status).toBe(413);
});
it("expires idle sessions and closes idempotently", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const url = await start();
  const { transport } = await connect(url);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 31 * 60_000);
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await fetch(`${url}/mcp`, { headers: { authorization: `Bearer ${TOKEN}`, "mcp-session-id": transport.sessionId!, accept: "text/event-stream" } })).status).toBe(404);
  await Promise.all([http!.close(), http!.close()]);
  await expect(fetch(`${url}/healthz`)).rejects.toThrow();
});
it("isolates per-call confirmations while sharing the upstream rate budget", async () => {
  const calls: string[] = [];
  const upstream = createServer((req, res) => { calls.push(req.method!); res.writeHead(200, { "content-type": "application/json" }).end("{}"); });
  await new Promise<void>(resolve => upstream.listen(0, "localhost", resolve));
  cleanup.push(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const addr = upstream.address() as { port: number };
  const url = await start({ POSTIZ_URL: `http://localhost:${addr.port}`, POSTIZ_RATE_LIMIT_PER_HOUR: "1" });
  const [a, b] = await Promise.all([connect(url), connect(url)]);
  expect(a.transport.sessionId).not.toBe(b.transport.sessionId);
  const confirmed = await a.client.callTool({ name: "postiz_delete_post", arguments: { postId: "test", confirm: true } });
  expect(confirmed.isError).not.toBe(true);
  for (const client of [b.client, a.client]) {
    const result = await client.callTool({ name: "postiz_delete_post", arguments: { postId: "test", confirm: false } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("confirm=true");
  }
  const rate = await b.client.callTool({ name: "postiz_list_integrations", arguments: {} });
  expect(rate.isError).toBe(true);
  expect(JSON.stringify(rate.content)).toContain("rate-limit guard");
  expect(calls).toEqual(["DELETE"]);
});
it("disables HTTP local paths by default even with upload roots configured", async () => {
  const { client } = await connect(await start({ POSTIZ_UPLOAD_ROOTS: tmpdir() }));
  const res = await client.callTool({ name: "postiz_upload_file", arguments: { filePath: join(tmpdir(), "absent") } });
  expect(res.isError).toBe(true);
  expect(JSON.stringify(res.content)).toContain("POSTIZ_MCP_HTTP_LOCAL_FILES");
});
