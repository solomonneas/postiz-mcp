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
   *  status without spending a request — currently nothing does, but the
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
   *  the server-reported counter is authoritative — we don't decrement
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
    if (!this.apiKey) return text;
    return text.split(this.apiKey).join("***REDACTED***");
  }

  /** GET /api/public/v1/integrations */
  async listIntegrations(): Promise<PostizIntegration[]> {
    return this.request<PostizIntegration[]>("/api/public/v1/integrations");
  }

  /** GET /api/public/v1/integrations/check (newer Postiz builds) */
  async checkIntegration(): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/integrations/check");
  }

  /** GET /api/public/v1/integrations/find-slot?id=... (newer Postiz builds) */
  async findNextSlot(integrationId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(integrationId)) {
      throw new Error(`Invalid integration id: ${integrationId}`);
    }
    const qs = new URLSearchParams({ id: integrationId });
    return this.request<Record<string, unknown>>(
      `/api/public/v1/integrations/find-slot?${qs}`,
    );
  }

  /** POST /api/public/v1/integrations/connect (newer Postiz builds) */
  async connectIntegration(body: {
    provider: string;
    refresh?: boolean;
  }): Promise<{ url: string }> {
    return this.request<{ url: string }>("/api/public/v1/integrations/connect", {
      method: "POST",
      body: JSON.stringify(body),
    });
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

  /** POST /api/public/v1/posts */
  async createPost(body: PostizCreatePostInput): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/posts", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /** GET /api/public/v1/posts?startDate=&endDate=&display=
   *  startDate + endDate are required by Postiz (it returns 400 otherwise) and
   *  must be ISO-8601. The MCP server fills sensible defaults if the agent
   *  omits them; the client itself stays a thin shell. */
  async listPosts(params: {
    startDate?: string;
    endDate?: string;
    display?: "day" | "week" | "month";
    customer?: string;
  } = {}): Promise<unknown> {
    const qs = new URLSearchParams();
    if (params.startDate) qs.set("startDate", params.startDate);
    if (params.endDate) qs.set("endDate", params.endDate);
    if (params.display) qs.set("display", params.display);
    if (params.customer) qs.set("customer", params.customer);
    const suffix = qs.toString() ? `?${qs}` : "";
    return this.request<unknown>(`/api/public/v1/posts${suffix}`);
  }

  /** GET /api/public/v1/posts/missing-content?postId=... (newer Postiz builds) */
  async getMissingContent(postId: string): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    const qs = new URLSearchParams({ postId });
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/missing-content?${qs}`,
    );
  }

  /** PATCH /api/public/v1/posts/{id}/release-id (newer Postiz builds) */
  async updateReleaseId(
    postId: string,
    body: { releaseId: string; releaseURL?: string },
  ): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/${postId}/release-id`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  }

  /** PATCH /api/public/v1/posts/{id}/status (newer Postiz builds) */
  async updatePostStatus(
    postId: string,
    body: { state: "DRAFT" | "QUEUE" },
  ): Promise<Record<string, unknown>> {
    if (!isSafeId(postId)) {
      throw new Error(`Invalid post id: ${postId}`);
    }
    return this.request<Record<string, unknown>>(
      `/api/public/v1/posts/${postId}/status`,
      { method: "PATCH", body: JSON.stringify(body) },
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

  /** POST /api/public/v1/upload/url (newer Postiz builds) */
  async uploadFromUrl(url: string): Promise<PostizUploadResponse> {
    return this.request<PostizUploadResponse>("/api/public/v1/upload/url", {
      method: "POST",
      body: JSON.stringify({ url }),
    });
  }

  /** GET /api/public/v1/analytics/{integrationId}?date= */
  async getPlatformAnalytics(params: {
    integrationId: string;
    date?: number;
  }): Promise<Record<string, unknown>> {
    if (!isSafeId(params.integrationId)) {
      throw new Error(`Invalid integration id: ${params.integrationId}`);
    }
    const qs = new URLSearchParams();
    if (params.date !== undefined) qs.set("date", String(params.date));
    const suffix = qs.toString() ? `?${qs}` : "";
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

  /** GET /api/public/v1/video/function (newer Postiz builds) */
  async listVoices(integrationId?: string): Promise<unknown> {
    const qs = new URLSearchParams();
    qs.set("functionName", "voices");
    if (integrationId) qs.set("integrationId", integrationId);
    return this.request<unknown>(`/api/public/v1/video/function?${qs}`);
  }

  /** POST /api/public/v1/video/generate (newer Postiz builds) */
  async generateVideo(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request<Record<string, unknown>>("/api/public/v1/video/generate", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  private async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    if (!opts.skipRateLimitGuard) this.guardRateLimit();
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
      this.captureRateLimit(res.headers);
      const text = await res.text();
      if (!res.ok) {
        if (isCfAccessChallenge(res, text)) {
          throw new PostizCfAccessChallengeError(path);
        }
        if (res.status === 429) {
          const retryAfterSec = parseRetryAfter(res.headers.get("retry-after"));
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
      this.recordSlidingSend();
      if (!text) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (err) {
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
        throw new PostizRateLimitGuardError(
          this.rate.resetAt,
          this.rate.limitPerHour,
        );
      }
      return;
    }
    this.pruneSlidingWindow();
    if (this.recentSends.length < this.rate.limitPerHour) return;
    throw new PostizRateLimitGuardError(null, this.rate.limitPerHour);
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

  private recordSlidingSend(): void {
    // Always track timestamps so the sliding-window fallback has data, even
    // if the server starts/stops sending headers mid-session.
    this.recentSends.push(Date.now());
    if (this.serverProvidesRateLimit) return;
    this.rate.remaining = Math.max(
      0,
      this.rate.limitPerHour - this.recentSends.length,
    );
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

function toUint8Array(buf: Uint8Array | Buffer): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  return new Uint8Array(buf);
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
