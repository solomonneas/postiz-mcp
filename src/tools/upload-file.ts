import { Type } from "@sinclair/typebox";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    filePath: Type.Optional(
      Type.String({
        description:
          "Absolute path to a file on the host running this MCP server. Use this when the file is local to the agent. Either filePath or base64+fileName is required.",
      }),
    ),
    base64: Type.Optional(
      Type.String({
        description:
          "Base64-encoded file contents. Useful when the agent has the bytes in memory but no on-disk path.",
      }),
    ),
    fileName: Type.Optional(
      Type.String({
        description:
          "Name to advertise in the multipart upload. Required when using base64; auto-derived from filePath when omitted.",
      }),
    ),
    mimeType: Type.Optional(
      Type.String({
        description:
          "Content-Type for the upload (e.g. 'image/png'). Default 'application/octet-stream'.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createUploadFileTool(
  getClient: () => PostizClient,
  config: PostizPluginConfig,
) {
  return {
    name: "postiz_upload_file",
    label: "postiz: upload file",
    description:
      "Upload a media file (image, video) to Postiz storage via POST /api/uploads/file. Returns { id, path } that you can pass into postiz_create_post `value[].image[]`. Requires enableWrite.",
    parameters: Schema,
    execute: async (_id: string, raw: Record<string, unknown>) => {
      requireWriteGate(config, "postiz_upload_file");
      const { filePath, base64, fileName, mimeType } = raw as {
        filePath?: string;
        base64?: string;
        fileName?: string;
        mimeType?: string;
      };
      if (!filePath && !base64) {
        throw new Error(
          "postiz_upload_file requires either filePath or base64.",
        );
      }
      let bytes: Uint8Array;
      let resolvedName: string;
      if (filePath) {
        const buf = await readFile(filePath);
        bytes = new Uint8Array(buf);
        resolvedName = fileName ?? basename(filePath);
      } else {
        if (!fileName) {
          throw new Error("postiz_upload_file requires fileName when using base64.");
        }
        bytes = Uint8Array.from(Buffer.from(base64 as string, "base64"));
        resolvedName = fileName;
      }
      const client = getClient();
      const res = await client.uploadFile(
        resolvedName,
        bytes,
        mimeType ?? "application/octet-stream",
      );
      return jsonToolResult(
        withRate(client, {
          ok: true,
          fileName: resolvedName,
          bytes: bytes.byteLength,
          response: res,
          uploadRef: { id: res.id, path: res.path },
        }),
      );
    },
  };
}
