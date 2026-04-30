import { resolve } from "node:path";
import { isIPv4, isIPv6 } from "node:net";

const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

/** Hosts and address ranges we refuse to forward to a server-side fetcher.
 *  This is layered on top of whatever Postiz itself does; the goal is to
 *  prevent a confused-deputy attack where the MCP becomes the SSRF vector. */
function isPrivateHostname(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (lower === "::1" || lower === "[::1]") return true;
  return false;
}

function isPrivateIPv4(addr: string): boolean {
  const m = addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIPv6(addr: string): boolean {
  const lower = addr.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fe80::")) return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("ff")) return true;
  return false;
}

export class SsrfBlockedError extends Error {
  constructor(reason: string, url: string) {
    super(`postiz-mcp: refusing to forward URL (${reason}): ${url}`);
    this.name = "SsrfBlockedError";
  }
}

export function assertSafeUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError("not a valid URL", rawUrl);
  }
  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfBlockedError(`scheme ${parsed.protocol} not allowed`, rawUrl);
  }
  const host = parsed.hostname;
  if (!host) throw new SsrfBlockedError("missing host", rawUrl);
  if (isPrivateHostname(host)) {
    throw new SsrfBlockedError("private hostname", rawUrl);
  }
  if (isIPv4(host)) {
    if (isPrivateIPv4(host)) throw new SsrfBlockedError("private IPv4", rawUrl);
  } else if (isIPv6(host)) {
    if (isPrivateIPv6(host)) throw new SsrfBlockedError("private IPv6", rawUrl);
  }
  return parsed;
}

export class UploadPathError extends Error {
  constructor(reason: string, attempted: string) {
    super(`postiz-mcp: refusing upload path (${reason}): ${attempted}`);
    this.name = "UploadPathError";
  }
}

/** Resolve uploadRoots from config + env. POSTIZ_UPLOAD_ROOTS overrides the
 *  config-supplied list (matches how api-key precedence works elsewhere).
 *  Returns absolute, trailing-separator-stripped paths. */
export function resolveUploadRoots(
  configRoots: string[] | undefined,
  envName = "POSTIZ_UPLOAD_ROOTS",
): string[] {
  const env = (process.env[envName] ?? "").trim();
  const raw = env
    ? env
        .split(/[,:]/)
        .map((s) => s.trim())
        .filter(Boolean)
    : (configRoots ?? []);
  return raw.map((r) => resolve(r));
}

/** Throws unless `filePath` resolves to a path under at least one root.
 *  An empty `roots` list rejects every filePath: callers fall back to the
 *  base64 lane in that case. */
export function assertPathUnderRoots(filePath: string, roots: string[]): string {
  if (!filePath) throw new UploadPathError("empty path", filePath);
  if (roots.length === 0) {
    throw new UploadPathError(
      "filePath uploads disabled (no POSTIZ_UPLOAD_ROOTS configured); use base64",
      filePath,
    );
  }
  const absolute = resolve(filePath);
  for (const root of roots) {
    if (absolute === root || absolute.startsWith(root + "/")) {
      return absolute;
    }
  }
  throw new UploadPathError("not under any allowlisted upload root", filePath);
}
