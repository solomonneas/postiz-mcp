import type { PostizPluginConfig } from "./config.ts";

export class PostizGateError extends Error {
  constructor(
    public readonly gate: "write" | "delete" | "confirm",
    public readonly tool: string,
    message: string,
  ) {
    super(message);
    this.name = "PostizGateError";
  }
}

export function requireWriteGate(config: PostizPluginConfig, tool: string): void {
  if (!config.enableWrite) {
    throw new PostizGateError(
      "write",
      tool,
      `${tool} requires enableWrite=true (POSTIZ_ENABLE_WRITE=true). This tool publishes externally-visible side effects to social platforms; it is gated off by default. Flip the flag in your env or plugin config to enable.`,
    );
  }
}

export function requireDeleteGate(config: PostizPluginConfig, tool: string): void {
  requireWriteGate(config, tool);
  if (!config.enableDelete) {
    throw new PostizGateError(
      "delete",
      tool,
      `${tool} requires enableDelete=true (POSTIZ_ENABLE_DELETE=true) in addition to enableWrite. Postiz delete operations are irreversible: deleting an integration removes scheduled posts, deleting a post removes the whole group.`,
    );
  }
}

export function requireConfirm(tool: string, confirm: unknown): void {
  if (confirm !== true) {
    throw new PostizGateError(
      "confirm",
      tool,
      `${tool} requires confirm=true. Pass {"confirm": true} only when you have verified the target id and accept that the operation is irreversible.`,
    );
  }
}
