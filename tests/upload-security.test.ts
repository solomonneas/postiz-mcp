import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createUploadFileTool } from "../src/tools/upload-file.ts";
import { assertSafeUrl } from "../src/security.ts";
import { makeTestConfig } from "./helpers.ts";
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
it("keeps valid roots usable and confines reads through the opened file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "postiz-upload-"));
  cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, "allowed"); await mkdir(root);
  await writeFile(join(dir, "outside"), "private");
  await symlink(join(dir, "outside"), join(root, "escape"));
  await writeFile(join(root, "inside"), "media");
  const uploadFile = vi.fn().mockResolvedValue({ id: "media", path: "/uploads/media" });
  const tool = createUploadFileTool(() => ({ uploadFile, getRateLimit: () => ({}) }) as never, makeTestConfig({ enableWrite: true, uploadRoots: [join(dir, "missing-root"), root] }));
  await tool.execute("t", { filePath: join(root, "inside") });
  await expect(tool.execute("t", { filePath: join(root, "escape") })).rejects.toThrow(/allowlisted|root/);
  expect(Buffer.from(uploadFile.mock.calls[0][1]).toString()).toBe("media");
  expect(uploadFile).toHaveBeenCalledTimes(1);
});
it.each(["http://[::1]/media", "http://[fd00::1]/media", "http://[::ffff:127.0.0.1]/media", "http://[fe90::1]/media"])("blocks private IPv6 URL %s", url => {
  expect(() => assertSafeUrl(url)).toThrow(/private/);
});
