import { Type } from "@sinclair/typebox";
import { PostizApiError, type PostizClient } from "../postiz-client.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object({}, { additionalProperties: false });

export function createCheckIntegrationTool(getClient: () => PostizClient) {
  return {
    name: "postiz_check_integration",
    label: "postiz: check API key",
    description:
      "Verify the configured Postiz API key is valid and reaches the configured baseUrl via GET /api/public/v1/is-connected. Useful as a first call before any other tool: if this returns ok=true, every other tool can authenticate against the same instance. ok=false means Postiz reachable but the key is rejected; ok=false with reason='unreachable' means the request never landed.",
    parameters: Schema,
    execute: async (
      _toolCallId: string,
      _rawParams: Record<string, unknown>,
    ) => {
      const client = getClient();
      try {
        const res = await client.checkIntegration();
        return jsonToolResult(
          withRate(client, {
            ok: interpretIsConnected(res),
            response: res,
          }),
        );
      } catch (err) {
        if (err instanceof PostizApiError) {
          if (err.status === 401 || err.status === 403) {
            return jsonToolResult(
              withRate(client, {
                ok: false,
                reason: "unauthorized",
                status: err.status,
                message: err.message,
              }),
            );
          }
          return jsonToolResult(
            withRate(client, {
              ok: false,
              reason: "http_error",
              status: err.status,
              message: err.message,
            }),
          );
        }
        const msg = err instanceof Error ? err.message : String(err);
        return jsonToolResult(
          withRate(client, {
            ok: false,
            reason: "unreachable",
            message: msg,
          }),
        );
      }
    },
  };
}

/** Postiz's /is-connected typically returns either `true`, `{connected:true}`,
 *  `{authenticated:true}`, or simply `{}` on success. We treat any explicit
 *  false-ish indicator as a fail; everything else (including empty body) as
 *  success because reaching a 200 already proves auth + reachability. */
function interpretIsConnected(res: unknown): boolean {
  if (res === false) return false;
  if (res === true) return true;
  if (res && typeof res === "object" && !Array.isArray(res)) {
    const obj = res as Record<string, unknown>;
    if (obj.connected === false) return false;
    if (obj.authenticated === false) return false;
    if (obj.ok === false) return false;
  }
  return true;
}
