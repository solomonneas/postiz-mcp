import { vi } from "vitest";

export interface CapturedCall {
  url: string;
  method: string;
  /** Header names lowercased so assertions survive case-insensitive
   *  refactors (e.g. swapping to `new Headers(...)`). */
  headers: Record<string, string>;
  body: string | null;
  /** True when the body was a FormData instance. The serialized body lands
   *  in `bodyText` for assertions on filename / mime, but we don't try to
   *  reproduce the exact multipart layout the runtime would have emitted. */
  isFormData: boolean;
  /** Crude FormData serialization (entries joined as "name=value\\n") used
   *  only for "did the right field name show up?" assertions. */
  bodyFormSummary?: string;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
  rejectWith?: unknown;
  hangUntilAbort?: boolean;
}

export interface FakeFetch {
  calls: CapturedCall[];
  queue(...responses: FakeResponse[]): void;
  restore(): void;
}

export function makeFakeFetch(): FakeFetch {
  const calls: CapturedCall[] = [];
  const responses: FakeResponse[] = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = vi.fn(
    async (input: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;

      const headers = flattenHeaders(init.headers);
      const isFormData = init.body instanceof FormData;
      let body: string | null = null;
      let bodyFormSummary: string | undefined;
      if (init.body === undefined || init.body === null) {
        body = null;
      } else if (typeof init.body === "string") {
        body = init.body;
      } else if (isFormData) {
        const fd = init.body as FormData;
        const summary: string[] = [];
        fd.forEach((v, k) => {
          if (v instanceof Blob) {
            summary.push(`${k}=<blob ${v.type || "?"} ${v.size}b>`);
          } else {
            summary.push(`${k}=${String(v)}`);
          }
        });
        bodyFormSummary = summary.join("\n");
      } else {
        body = String(init.body);
      }

      calls.push({
        url,
        method: (init.method ?? "GET").toUpperCase(),
        headers,
        body,
        isFormData,
        bodyFormSummary,
      });

      const next = responses.shift() ?? { status: 200, text: "" };

      if (next.hangUntilAbort) {
        const signal = init.signal as AbortSignal | undefined;
        if (!signal) {
          throw new Error("hangUntilAbort used without an AbortSignal");
        }
        return new Promise<Response>((_, reject) => {
          if (signal.aborted) {
            reject(abortError());
            return;
          }
          signal.addEventListener("abort", () => reject(abortError()), {
            once: true,
          });
        });
      }

      if (next.rejectWith !== undefined) throw next.rejectWith;

      const text =
        next.text !== undefined
          ? next.text
          : next.body === undefined
            ? ""
            : JSON.stringify(next.body);
      return new Response(text, {
        status: next.status ?? 200,
        headers: next.headers,
      });
    },
  ) as unknown as typeof fetch;

  return {
    calls,
    queue(...r) {
      responses.push(...r);
    },
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function flattenHeaders(h: RequestInit["headers"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = String(v);
  return out;
}

function abortError(): Error {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  return err;
}
