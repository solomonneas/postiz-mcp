import type { PostizClient, RateLimitState } from "../postiz-client.ts";

export function jsonToolResult<T>(details: T): {
  content: Array<{ type: "text"; text: string }>;
  details: T;
} {
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    details,
  };
}

export interface WithRateLimit {
  rateLimit: RateLimitState;
}

/** Attach the client's current rate-limit state to a tool's result payload.
 *  Every tool surfaces this so callers can self-throttle. The state is read
 *  AFTER the underlying request, so it reflects the just-completed call. */
export function withRate<T extends Record<string, unknown>>(
  client: PostizClient,
  details: T,
): T & WithRateLimit {
  return {
    ...details,
    rateLimit: client.getRateLimit(),
  };
}
