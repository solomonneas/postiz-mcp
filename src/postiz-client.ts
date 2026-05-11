export interface PostizClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  rateLimitPerHour?: number;
  cfAccessClientId?: string;
  cfAccessClientSecret?: string;
}

export interface RateLimitState {
  remaining: number;
  resetAt: number | null;
  limitPerHour: number;
}

export interface PostizListResponse<T> {
  data?: T[];
  posts?: T[];
  [key: string]: unknown;
}

export interface PostizIntegration {
  id: string;
  name?: string;
  identifier?: string;
  picture?: string;
  providerIdentifier?: string;
  type?: string;
  disabled?: boolean;
  profile?: string;
  customer?: { id: string; name: string } | null;
  [key: string]: unknown;
}

export interface PostizPost {
  id: string;
  group?: string;
  content?: string;
  publishDate?: string;
  releaseId?: string | null;
  releaseURL?: string | null;
  state?: "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT" | string;
  integration?: { id: string; providerIdentifier?: string; name?: string };
  [key: string]: unknown;
}

export interface PostizCreatePostInput {
  type: "draft" | "schedule" | "now";
  date: string;
  posts: Array<{
    integration: { id: string };
    value: Array<{
      content: string;
      id?: string;
      delay?: number;
      image?: Array<{ id?: string; path?: string }>;
    }>;
    settings?: Record<string, unknown>;
    group?: string;
  }>;
  shortLink?: boolean;
  tags?: Array<{ value: string; label: string }>;
}

export interface PostizUploadResponse {
  id: string;
  path: string;
  organizationId?: string;
  name?: string;
  [key: string]: unknown;
}

export interface PostizIntegrationSettings {
  rules: string;
  maxLength: number;
  settings: Record<string, unknown> | string;
  tools: unknown[];
}

export class PostizApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly code: string,
    message: string,
    public readonly retryAfterSec?: number,
  ) {
    super(`postiz ${status} ${code} on ${path}: ${message}`);
    this.name = "PostizApiError";
  }
}

export class PostizTimeoutError extends Error {
  constructor(path: string, timeoutMs: number) {
    super(`postiz request to ${path} timed out after ${timeoutMs}ms`);
    this.name = "PostizTimeoutError";
  }
}

export class PostizRateLimitGuardError extends Error {
  constructor(public readonly resetAt: number | null, public readonly limitPerHour: number) {
    const resetMsg = resetAt
      ? `resets at ${new Date(resetAt).toISOString()}`
      : "reset time unknown";
    super(
      `postiz local rate-limit guard: 0 of ${limitPerHour}/hr remaining (${resetMsg}). Waiting before sending avoids burning quota the API would have rejected anyway.`,
    );
    this.name = "PostizRateLimitGuardError";
  }
}

export class PostizCfAccessChallengeError extends Error {
  constructor(path: string) {
    super(
      `postiz request to ${path} hit a Cloudflare Access challenge. Set POSTIZ_CF_ACCESS_CLIENT_ID and POSTIZ_CF_ACCESS_CLIENT_SECRET to a valid service-token pair, or hit the LAN URL directly.`,
    );
    this.name = "PostizCfAccessChallengeError";
  }
}

interface RequestOpts {
  method?: string;
  body?: RequestInit["body"];
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** When true, bypass the local rate-limit guard. Used by tools that report
   *  status without spending a request - currently nothing does, but the
   *  hook exists so we never have to refactor a guard around a future probe. */
  skipRateLimitGuard?: boolean;
}

export class PostizClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly cfAccessClientId?: string;
  private readonly cfAccessClientSecret?: string;
  private rate: RateLimitState;
  /** Sliding-window timestamps of the last successful sends, used as a
   *  client-side fallback when the server doesn't return rate-limit headers
   *  (older Postiz builds) so we still refuse to overshoot. */
  private readonly recentSends: number[] = [];
  /** Sticky once a response carries any X-RateLimit-* header. After that,
   *  the server-reported counter is authoritative - we don't decrement
   *  locally and we don't second-guess a 0. */
  private serverProvidesRateLimit = false;

  constructor(opts: PostizClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.cfAccessClientId = opts.cfAccessClientId;
    this.cfAccessClientSecret = opts.cfAccessClientSecret;
    this.rate = {
      remaining: opts.rateLimitPerHour ?? 30,
      resetAt: null,
      limitPerHour: opts.rateLimitPerHour ?? 30,
    };
  }

  getRateLimit(): RateLimitState {
    if (this.serverProvidesRateLimit) {
      return { ...this.rate };
    }
    this.pruneSlidingWindow();
    return {
      remaining: Math.max(0, this.rate.limitPerHour - this.recentSends.length),
      resetAt: null,
      limitPerHour: this.rate.limitPerHour,
    };
  }

  redact(text: string): string {
    let out = text;
    for (const secret of [
      this.apiKey,
      this.cfAccessClientSecret,
      this.cfAccessClientId,
    ]) {
      if (!secret) continue;
      // Skip absurdly short values to avoid mangling unrelated text.
      if (secret.length < 8) continue;
      out = out.split(secret).join("***REDACTED***");
    }
    return out;
  }

  /** GET /api/public/v1/integrations */
  async listIntegrations(): Promise<PostizIntegration[]> {
    return this.request<PostizIntegration[]>("/api/public/v1/integrations");
  }

  /** GET /api/public/v1/is-connected */
  async checkIntegration(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/is-connected");
  }

  /** GET /api/public/v1/find-slot/{id} */
  async findNextSlot(integrationId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(integrationId)) {
      throw new Error(`Invalid integration id: ${integrationId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/find-slot/${integrationId}`,
    );
  }

  /** GET /api/public/v1/social/{integration}?refresh={existingIntegrationId}
   *  Postiz public API: this is OAuth-URL minting for OAuth-based integrations
   *  (X, LinkedIn, etc). Mastodon and other URL-based providers are NOT
   *  supported here and return 400. The optional `refresh` value is the
   *  EXISTING integration id to re-auth, not a boolean. */
  async connectIntegration(body: {
    provider: string;
    refresh?: string;
  }): Promise<{ url: string }> {
    if (!isSafeProviderSlug(body.provider)) {
      throw new Error(`Invalid provider: ${body.provider}`);
    }
    const qs = new URLSearchParams();
    if (body.refresh) {
      if (!isSafeId(body.refresh)) {
        throw new Error(`Invalid refresh id: ${body.refresh}`);
      }
      qs.set("refresh", body.refresh);
    }
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<{ url: string }>(
      `/api/public/v1/social/${body.provider}${suffix}`,
    );
  }

  /** DELETE /api/public/v1/integrations/{id} */
  async deleteIntegration(integrationId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(integrationId)) {
      throw new Error(`Invalid integration id: ${integrationId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/integrations/${integrationId}`,
      { method: "DELETE" },
    );
  }

  /** GET /api/public/v1/integration-settings/{id}
   *  Returns the live runtime config for a connected integration: per-platform
   *  rules description, the maxLength (already adjusted upstream for the
   *  account's verified state), the DTO settings shape (or the literal string
   *  "No additional settings required" if the provider has none), and the
   *  list of platform-specific tools the account exposes.
   *
   *  We unwrap the upstream `{ output: {...} }` wrapper so callers see a flat
   *  object. Note: `verified` is computed internally upstream and baked into
   *  `maxLength`; it's not returned in the response. */
  async getIntegrationSettings(integrationId: string): Promise<PostizIntegrationSettings> {
    if (!isSafeId(integrationId)) {
      throw new Error(`Invalid integration id: ${integrationId}`);
    }
    const res = await this.request<{ output: PostizIntegrationSettings }>(
      `/api/public/v1/integration-settings/${integrationId}`,
    );
    return res.output;
  }

  /** POST /api/public/v1/integration-trigger/{id}
   *  Invoke a per-platform tool on a connected integration. The valid
   *  `methodName` values for an integration come from
   *  `getIntegrationSettings(id).tools`; each platform exposes a different
   *  set (Reddit subreddit search, YouTube playlist lookup, etc.).
   *
   *  The response shape is platform-specific and intentionally untyped here.
   *  Postiz forwards the platform's tool output verbatim.
   *
   *  Note: although some platform tools are pure-read (subreddit search,
   *  playlist lookup), the wire is POST and the body is opaque, so the
   *  tool layer treats this as a write for gating purposes. */
  async invokeIntegrationTool(
    integrationId: string,
    methodName: string,
    data: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (!isSafeId(integrationId)) {
      throw new Error(`Invalid integration id: ${integrationId}`);
    }
    return this.request<unknown>(
      `/api/public/v1/integration-trigger/${integrationId}`,
      {
        method: "POST",
        body: JSON.stringify({ methodName, data }),
      },
    );
  }

  /** POST /api/public/v1/posts */
  async createPost(body: PostizCreatePostInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** GET /api/public/v1/posts?startDate=&endDate=&customer=
   *  startDate + endDate are required by the Postiz public API (it returns
   *  400 otherwise) and must be ISO-8601. The MCP server fills sensible
   *  defaults when the agent omits them; the client itself stays a thin
   *  shell. */
  async listPosts(params: {
    startDate: string;
    endDate: string;
    customer?: string;
  }): Promise<unknown> {
    const qs = new URLSearchParams();
    qs.set("startDate", params.startDate);
    qs.set("endDate", params.endDate);
    if (params.customer) qs.set("customer", params.customer);
    return this.request<unknown>(`/api/public/v1/posts?${qs}`);
  }

  /** GET /api/public/v1/posts/{id}/missing */
  async getMissingContent(postId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/${postId}/missing`,
    );
  }

  /** PUT /api/public/v1/posts/{id}/release-id
   *  Spec body shape is {releaseId} only. releaseURL is not in the public
   *  API schema and is silently dropped. */
  async updateReleaseId(
    postId: string,
    body: { releaseId: string },
  ): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/${postId}/release-id`,
      { method: "PUT", body: JSON.stringify({ releaseId: body.releaseId }) },
    );
  }

  /** PUT /api/public/v1/posts/{id}/status
   *  Spec body shape is {status: "draft"|"schedule"} (lowercase, key is
   *  `status` not `state`). Server response still uses uppercase
   *  state: "DRAFT"|"QUEUE". */
  async updatePostStatus(
    postId: string,
    body: { status: "draft" | "schedule" },
  ): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/${postId}/status`,
      { method: "PUT", body: JSON.stringify(body) },
    );
  }

  /** DELETE /api/public/v1/posts/{id} */
  async deletePost(postId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(`/api/public/v1/posts/${postId}`, {
      method: "DELETE",
    });
  }

  /** DELETE /api/public/v1/posts/group/{group} (newer Postiz builds) */
  async deletePostGroup(group: string): Promise<Record<string, unknown>> {
    if (!isSafeId(group)) {
      throw new Error(`Invalid group id: ${group}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/group/${group}`,
      { method: "DELETE" },
    );
  }

  /** GET /api/public/v1/notifications?page= */
  async listNotifications(page = 1): Promise<unknown> {
    const qs = new URLSearchParams({ page: String(page) });
    return this.request<unknown>(`/api/public/v1/notifications?${qs}`);
  }

  /** POST /api/public/v1/upload (multipart) */
  async uploadFile(
    fileName: string,
    contents: Uint8Array | Buffer,
    mimeType: string,
  ): Promise<PostizUploadResponse> {
    const form = new FormData();
    const blob = new Blob([toUint8Array(contents)], { type: mimeType });
    form.append("file", blob, fileName);
    return this.request<PostizUploadResponse>("/api/public/v1/upload", {
      method: "POST",
      body: form,
    });
  }

  /** POST /api/public/v1/upload-from-url
   *  SSRF guard lives at the tool layer (src/tools/upload-from-url.ts);
   *  the client trusts whatever the tool passes through. */
  async uploadFromUrl(url: string): Promise<PostizUploadResponse> {
    return this.request<PostizUploadResponse>("/api/public/v1/upload-from-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  /** GET /api/public/v1/analytics/{integration}?date=
   *  Spec marks `date` as a required string (number-of-days lookback, e.g.
   *  "7", "30"). Numbers are silently coerced by URLSearchParams but pass
   *  the spec because the API treats it as string. */
  async getPlatformAnalytics(params: {
    integrationId: string;
    date: string | number;
  }): Promise<Record<string, unknown>> {
    if (!isSafeId(params.integrationId)) {
      throw new Error(`Invalid integration id: ${params.integrationId}`);
    }
    const qs = new URLSearchParams();
    qs.set("date", String(params.date));
    const suffix = `?${qs}`;
    return this.request<Record<string, unknown>>(
      `/api/public/v1/analytics/${params.integrationId}${suffix}`,
    );
  }

  /** GET /api/public/v1/analytics/post/{postId} (newer Postiz builds) */
  async getPostAnalytics(postId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/analytics/post/${postId}`,
    );
  }

  /** POST /api/public/v1/video/function
   *  Spec body shape: {functionName, identifier, params?}. functionName for
   *  voices is "loadVoices"; `identifier` is the video-type identifier
   *  (e.g. "image-text-slides"). Both required. */
  async videoFunction(body: {
    functionName: string;
    identifier: string;
    params?: Record<string, unknown>;
  }): Promise<unknown> {
    return this.request<unknown>("/api/public/v1/video/function", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** Convenience: load voices for a given video-type identifier. */
  async listVoices(identifier: string): Promise<unknown> {
    return this.videoFunction({ functionName: "loadVoices", identifier });
  }

  /** POST /api/public/v1/generate-video (top-level path, hyphenated). */
  async generateVideo(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/generate-video", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    let reservation: number | undefined;
    if (!opts.skipRateLimitGuard) {
      this.guardRateLimit();
      // Reserve the slot pre-flight so concurrent callers don't all see the
      // same `remaining` and overshoot. The reservation is released only if
      // the request never reached Postiz (local error, abort, network fail).
      reservation = this.reserveSlot();
    }
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const caller = opts.signal;
    let onCallerAbort: (() => void) | undefined;
    if (caller) {
      if (caller.aborted) controller.abort();
      else {
        onCallerAbort = () => controller.abort();
        caller.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    let timedOut = false;
    let reachedServer = false;
    const timeoutSignal = controller.signal;
    timeoutSignal.addEventListener(
      "abort",
      () => {
        if (!caller?.aborted) timedOut = true;
      },
      { once: true },
    );
    try {
      const isForm = opts.body instanceof FormData;
      const headers: Record<string, string> = {
        Authorization: this.apiKey,
        Accept: "application/json",
        ...(opts.body && !isForm ? { "Content-Type": "application/json" } : {}),
        ...(this.cfAccessClientId
          ? { "CF-Access-Client-Id": this.cfAccessClientId }
          : {}),
        ...(this.cfAccessClientSecret
          ? { "CF-Access-Client-Secret": this.cfAccessClientSecret }
          : {}),
        ...(opts.headers ?? {}),
      };
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body ?? null,
        headers,
        signal: controller.signal,
      });
      reachedServer = true;
      this.captureRateLimit(res.headers);
      const text = await res.text();
      if (!res.ok) {
        if (isCfAccessChallenge(res, text)) {
          throw new PostizCfAccessChallengeError(path);
        }
        if (res.status === 429) {
          const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"));
          // Wire 429 into the local guard so the next call doesn't immediately
          // hammer another 429 when the server didn't ship X-RateLimit-* headers.
          this.applyRetryAfter(retryAfterSec);
          throw new PostizApiError(
            429,
            path,
            "rate_limited",
            retryAfterSec
              ? `rate limited; retry after ${retryAfterSec}s`
              : "rate limited",
            retryAfterSec,
          );
        }
        const { code, message } = parseErrorBody(text, res.status);
        throw new PostizApiError(res.status, path, code, this.redact(message));
      }
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (err) {
      // The request never landed at Postiz; refund the slot. 5xx, 429, and
      // CF Access challenges all set reachedServer=true so they keep the
      // reservation (the call counted against API quota even if it errored).
      if (!reachedServer && reservation !== undefined) {
        this.releaseSlot(reservation);
        reservation = undefined;
      }
      if (err instanceof PostizApiError) throw err;
      if (err instanceof PostizCfAccessChallengeError) throw err;
      if (timedOut) throw new PostizTimeoutError(path, this.timeoutMs);
      if (isAbortError(err) && caller?.aborted) {
        const e = new Error(`postiz request to ${path} aborted`);
        e.name = "AbortError";
        throw e;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`postiz request to ${path} failed: ${this.redact(msg)}`);
    } finally {
      clearTimeout(timer);
      if (caller && onCallerAbort) {
        caller.removeEventListener("abort", onCallerAbort);
      }
    }
  }

  private guardRateLimit(): void {
    if (this.serverProvidesRateLimit) {
      // Refresh on window roll-over before the 0 check so a fresh hour opens
      // up immediately without a real call having to fail first.
      if (this.rate.resetAt && Date.now() >= this.rate.resetAt) {
        this.rate.remaining = this.rate.limitPerHour;
        this.rate.resetAt = null;
      }
      if (this.rate.remaining <= 0) {
        // If the server reported 0 remaining without a reset time, project a
        // 1h fallback rather than blocking forever - older Postiz builds emit
        // x-ratelimit-remaining without x-ratelimit-reset.
        const projectedReset =
          this.rate.resetAt ?? Date.now() + 60 * 60 * 1000;
        throw new PostizRateLimitGuardError(
          projectedReset,
          this.rate.limitPerHour,
        );
      }
      return;
    }
    this.pruneSlidingWindow();
    if (this.recentSends.length < this.rate.limitPerHour) return;
    const oldest = this.recentSends[0];
    const projectedReset = oldest + 60 * 60 * 1000;
    throw new PostizRateLimitGuardError(projectedReset, this.rate.limitPerHour);
  }

  /** Reserve a slot pre-flight. Returns the timestamp pushed into the
   *  sliding window so callers can release on local-only failure. */
  private reserveSlot(): number {
    const ts = Date.now();
    this.recentSends.push(ts);
    if (this.serverProvidesRateLimit) {
      this.rate.remaining = Math.max(0, this.rate.remaining - 1);
    }
    return ts;
  }

  /** Refund a reservation when the request never reached the server.
   *  Removes the matching timestamp; in server-mode also bumps `remaining`
   *  back. Idempotent if the timestamp was already pruned. */
  private releaseSlot(ts: number): void {
    const idx = this.recentSends.indexOf(ts);
    if (idx >= 0) this.recentSends.splice(idx, 1);
    if (this.serverProvidesRateLimit) {
      this.rate.remaining = Math.min(
        this.rate.limitPerHour,
        this.rate.remaining + 1,
      );
    }
  }

  /** Wire a 429 Retry-After value into the local guard so subsequent calls
   *  block until at least that timestamp instead of hammering 429s. */
  private applyRetryAfter(retryAfterSec: number | undefined): void {
    if (!retryAfterSec || retryAfterSec <= 0) return;
    this.serverProvidesRateLimit = true;
    this.rate.remaining = 0;
    const projected = Date.now() + retryAfterSec * 1000;
    this.rate.resetAt = Math.max(this.rate.resetAt ?? 0, projected);
  }

  private captureRateLimit(headers: Headers): void {
    const remaining = headers.get("x-ratelimit-remaining");
    const reset = headers.get("x-ratelimit-reset");
    const limit = headers.get("x-ratelimit-limit");
    let sawAny = false;
    if (limit) {
      const n = Number(limit);
      if (Number.isFinite(n) && n > 0) {
        this.rate.limitPerHour = n;
        sawAny = true;
      }
    }
    if (remaining !== null) {
      const n = Number(remaining);
      if (Number.isFinite(n)) {
        this.rate.remaining = Math.max(0, n);
        sawAny = true;
      }
    }
    if (reset) {
      const n = Number(reset);
      if (Number.isFinite(n)) {
        // Accept either Unix seconds or millis; values below 10^12 are seconds.
        this.rate.resetAt = n < 1e12 ? n * 1000 : n;
        sawAny = true;
      }
    }
    if (sawAny) this.serverProvidesRateLimit = true;
  }

  private pruneSlidingWindow(): void {
    const cutoff = Date.now() - 60 * 60 * 1000;
    while (this.recentSends.length && this.recentSends[0] < cutoff) {
      this.recentSends.shift();
    }
  }
}

function isSafeId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id) && id.length > 0 && id.length < 256;
}

function isSafeProviderSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug) && slug.length > 0 && slug.length < 64;
}

function toUint8Array(buf: Uint8Array | Buffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(buf.byteLength);
  bytes.set(buf);
  return bytes;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return n;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    const sec = Math.ceil((date - Date.now()) / 1000);
    return sec > 0 ? sec : 0;
  }
  return undefined;
}

function parseErrorBody(
  text: string,
  status: number,
): { code: string; message: string } {
  if (!text) return { code: defaultCode(status), message: `HTTP ${status}` };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const message =
      typeof parsed.message === "string"
        ? parsed.message
        : Array.isArray(parsed.message)
          ? parsed.message.join("; ")
          : typeof parsed.error === "string"
            ? parsed.error
            : text.slice(0, 400);
    const code =
      typeof parsed.error === "string" && parsed.error.length < 64
        ? slugify(parsed.error)
        : defaultCode(status);
    return { code, message };
  } catch {
    return { code: defaultCode(status), message: text.slice(0, 400) };
  }
}

function defaultCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 422) return "unprocessable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  return "http_error";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/(^_+|_+$)/g, "");
}

function isCfAccessChallenge(res: Response, body: string): boolean {
  if (res.headers.get("cf-mitigated")?.toLowerCase() === "challenge") return true;
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html")) return false;
  return /cloudflare\s+access|<title>[^<]*access[^<]*<\/title>/i.test(body);
}
