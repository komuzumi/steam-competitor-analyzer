import { AsyncLocalStorage } from "node:async_hooks";

export type ApiKind = "analyze" | "audience" | "ai" | "reviews" | "discovery";
const MiB = 1024 * 1024;
const POLICIES = {
  analyze: { requests: 12, concurrent: 2, timeoutMs: 240_000, responseBytes: 5 * MiB },
  audience: { requests: 4, concurrent: 1, timeoutMs: 240_000, responseBytes: 2 * MiB },
  ai: { requests: 12, concurrent: 2, timeoutMs: 170_000, responseBytes: 2 * MiB },
  reviews: { requests: 60, concurrent: 1, timeoutMs: 150_000, responseBytes: 20 * MiB },
  discovery: { requests: 120, concurrent: 2, timeoutMs: 45_000, responseBytes: MiB },
} as const;

export class ApiLimitError extends Error {
  constructor(message: string, public status = 429, public retryAfterSeconds = 60) {
    super(message);
    this.name = "ApiLimitError";
  }
}

// Process-wide bounds do not depend on spoofable client/IP headers or cookies.
export function createApiGovernor(options: { now?: () => number; dailyBytes?: number } = {}) {
  const now = options.now ?? Date.now;
  const dailyBytes = options.dailyBytes ?? 256 * MiB;
  const windows = new Map<ApiKind, { start: number; count: number; active: number }>();
  let active = 0;
  let bytes = 0;
  let byteWindowStart = now();

  function refreshBytes() {
    if (now() - byteWindowStart >= 86_400_000) {
      byteWindowStart = now();
      bytes = 0;
    }
  }

  return {
    acquire(kind: ApiKind) {
      refreshBytes();
      if (bytes >= dailyBytes) {
        throw new ApiLimitError("サーバーの送信量上限に達しました。取得済みデータは保持されています。時間を置いて再開してください。", 429,
          Math.max(1, Math.ceil((byteWindowStart + 86_400_000 - now()) / 1000)));
      }
      const policy = POLICIES[kind];
      const window = windows.get(kind) ?? { start: now(), count: 0, active: 0 };
      windows.set(kind, window);
      if (now() - window.start >= 600_000) {
        window.start = now();
        window.count = 0;
      }
      if (window.count >= policy.requests) {
        throw new ApiLimitError("短時間の実行回数が上限に達しました。時間を置いて再開してください。", 429,
          Math.max(1, Math.ceil((window.start + 600_000 - now()) / 1000)));
      }
      if (active >= 4 || window.active >= policy.concurrent) {
        throw new ApiLimitError("サーバーが混雑しています。約30秒後に再開してください。", 429, 30);
      }
      window.count++;
      window.active++;
      active++;
      let released = false;
      let sent = 0;
      return {
        consume(size: number) {
          refreshBytes();
          if (sent + size > policy.responseBytes || bytes + size > dailyBytes) {
            throw new ApiLimitError("送信量上限に達しました。取得済みデータは保持されています。時間を置いて再開してください。");
          }
          sent += size;
          bytes += size;
        },
        release() {
          if (released) return;
          released = true;
          window.active--;
          active--;
        },
      };
    },
  };
}

const shared = globalThis as typeof globalThis & { apiGovernor?: ReturnType<typeof createApiGovernor> };
const governor = shared.apiGovernor ??= createApiGovernor();
const context = new AsyncLocalStorage<AbortSignal>();

export function apiSignal(extra?: AbortSignal): AbortSignal | undefined {
  const signal = context.getStore();
  if (signal && extra) return AbortSignal.any([signal, extra]);
  return signal ?? extra;
}

export function checkApiActive() {
  context.getStore()?.throwIfAborted();
}

export function apiErrorResponse(error: unknown): Response {
  const limit = error instanceof ApiLimitError ? error : null;
  return Response.json({ error: limit?.message ?? "処理を完了できませんでした。時間を置いて再度お試しください。" }, {
    status: limit?.status ?? 500,
    headers: { "Cache-Control": "no-store", ...(limit ? { "Retry-After": String(limit.retryAfterSeconds) } : {}) },
  });
}

export async function readLimitedJson<T>(req: Request, maxBytes: number): Promise<T> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new ApiLimitError("送信データが大きすぎます。", 413);
  if (!req.body) throw new ApiLimitError("リクエスト本文を指定してください。", 400);
  const reader = req.body.getReader();
  const signal = apiSignal(req.signal);
  const cancel = () => { void reader.cancel(); };
  signal?.addEventListener("abort", cancel, { once: true });
  let text = "";
  let size = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      signal?.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new ApiLimitError("送信データが大きすぎます。", 413);
      text += decoder.decode(part.value, { stream: true });
    }
    signal?.throwIfAborted();
    text += decoder.decode();
    try { return JSON.parse(text) as T; }
    catch { throw new ApiLimitError("JSON形式のリクエストを指定してください。", 400); }
  } finally {
    signal?.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function protectApi(req: Request, kind: ApiKind, handler: () => Promise<Response>): Promise<Response> {
  let lease: ReturnType<typeof governor.acquire>;
  try { lease = governor.acquire(kind); }
  catch (error) { return apiErrorResponse(error); }
  const controller = new AbortController();
  const abort = () => controller.abort(new ApiLimitError("処理が中断されました。", 499));
  req.signal.addEventListener("abort", abort, { once: true });
  if (req.signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new ApiLimitError("処理時間の上限に達しました。時間を置いて再開してください。", 504)), POLICIES[kind].timeoutMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timeout);
    req.signal.removeEventListener("abort", abort);
    lease.release();
  };
  try {
    controller.signal.throwIfAborted();
    const response = await context.run(controller.signal, handler);
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      cleanup();
      return apiErrorResponse(controller.signal.reason);
    }
    if (!response.body) { cleanup(); return response; }
    reader = response.body.getReader();
    const cancel = () => { void reader?.cancel().catch(() => undefined); cleanup(); };
    controller.signal.addEventListener("abort", cancel, { once: true });
    const body = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          controller.signal.throwIfAborted();
          const part = await reader!.read();
          if (part.done) {
            destination.close();
            cleanup();
            controller.signal.removeEventListener("abort", cancel);
          } else {
            lease.consume(part.value.byteLength);
            destination.enqueue(part.value);
          }
        } catch (error) {
          destination.error(error);
          controller.abort(error);
          void reader!.cancel().catch(() => undefined);
          cleanup();
        }
      },
      cancel() { controller.abort(); cancel(); },
    });
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return new Response(body, { status: response.status, headers });
  } catch (error) {
    controller.abort(error);
    cleanup();
    return apiErrorResponse(error);
  }
}
