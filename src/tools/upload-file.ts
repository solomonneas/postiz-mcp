import { Type } from "@sinclair/typebox";
import { stat } from "node:fs/promises";
import { open } from "node:fs/promises";
import { basename } from "node:path";
import type { PostizClient } from "../postiz-client.ts";
import type { PostizPluginConfig } from "../config.ts";
import { requireWriteGate } from "../gates.ts";
import { assertPathUnderRoots, resolveUploadRoots } from "../security.ts";
import { jsonToolResult, withRate } from "./_util.ts";

const Schema = Type.Object(
  {
    filePath: Type.Optional(
      Type.String({
        description:
          "Absolute path to a file under one of the configured POSTIZ_UPLOAD_ROOTS. With no allowlist set, filePath uploads are disabled and base64 is required.",
      }),
    ),
    base64: Type.Optional(
      Type.String({
        description:
          "Base64-encoded file contents. Useful when the agent has the bytes in memory but no on-disk path. Either filePath or base64+fileName is required.",
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
      "Upload a media file (image, video) to Postiz storage via POST /api/public/v1/upload (multipart form). Returns { id, path } that you can pass into postiz_create_post `value[].image[]`. `filePath` is restricted to a configured allowlist of upload roots (POSTIZ_UPLOAD_ROOTS, comma- or colon-separated); with no allowlist set, only base64 input is accepted. Per-upload size cap is the configured maxUploadBytes (default 100 MiB). Requires enableWrite.",
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
      if (filePath && base64) {
        throw new Error(
          "postiz_upload_file requires exactly one of filePath or base64, not both.",
        );
      }
      const maxBytes = config.maxUploadBytes;
      let bytes: Uint8Array;
      let resolvedName: string;
      if (filePath) {
        const roots = resolveUploadRoots(config.uploadRoots);
        const absolute = assertPathUnderRoots(filePath, roots);
        const info = await stat(absolute);
        if (!info.isFile()) {
          throw new Error(
            `postiz_upload_file: ${filePath} is not a regular file`,
          );
        }
        if (info.size > maxBytes) {
          throw new Error(
            `postiz_upload_file: file size ${info.size} exceeds maxUploadBytes ${maxBytes}`,
          );
        }
        const fh = await open(absolute, "r");
        try {
          const buf = Buffer.allocUnsafe(info.size);
          let read = 0;
          while (read < info.size) {
            const { bytesRead } = await fh.read(buf, read, info.size - read, read);
            if (bytesRead === 0) break;
            read += bytesRead;
          }
          bytes = new Uint8Array(buf.buffer, buf.byteOffset, read);
        } finally {
          await fh.close();
        }
        resolvedName = sanitizeFileName(fileName ?? basename(absolute));
      } else {
        if (!fileName) {
          throw new Error("postiz_upload_file requires fileName when using base64.");
        }
        const decoded = Buffer.from(base64 as string, "base64");
        if (decoded.byteLength > maxBytes) {
          throw new Error(
            `postiz_upload_file: decoded size ${decoded.byteLength} exceeds maxUploadBytes ${maxBytes}`,
          );
        }
        bytes = Uint8Array.from(decoded);
        resolvedName = sanitizeFileName(fileName);
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

function sanitizeFileName(name: string): string {
  // Strip any directory components, control chars, and anything that would
  // confuse multipart-form filename quoting. Keep dots and dashes for
  // extensions.
  return basename(name).replace(/[^A-Za-z0-9._-]/g, "_") || "upload.bin";
}
