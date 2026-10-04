import { apiSignal, checkApiActive } from "./api-protection";

export interface ReviewRetry {
  attempt: number;
  delayMs: number;
}

export interface ReviewRequestOptions {
  signal?: AbortSignal;
  onRetry?: (retry: ReviewRetry) => void;
}

export class SteamReviewRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super(`Steam側でレビュー取得が一時的に制限されています（429）。${Math.ceil(retryAfterMs / 1000)}秒以上時間を置いて、もう一度試してください。`);
    this.name = "SteamReviewRateLimitError";
  }
}

export function retryAfterMilliseconds(value: string | null, now: number): number {
  if (!value?.trim()) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds * 1000));
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(finish, ms);
    function finish() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function waitForTurn(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (!signal) return turn;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export function createSteamReviewRequester(dependencies: {
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
} = {}) {
  const fetchResponse = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? wait;
  const random = dependencies.random ?? Math.random;
  let nextRequestAt = 0;
  let cooldownUntil = 0;
  let queue = Promise.resolve();

  return async (url: string, options: ReviewRequestOptions = {}): Promise<Response> => {
    checkApiActive();
    options = { ...options, signal: apiSignal(options.signal) };
    const turn = queue;
    let release!: () => void;
    const completion = new Promise<void>((resolve) => { release = resolve; });
    // Share pacing and cooldown across all review callers in this server process.
    queue = turn.then(() => completion);

    try {
      await waitForTurn(turn, options.signal);
      for (let attempt = 1; attempt <= 3; attempt++) {
        options.signal?.throwIfAborted();
        const delay = Math.max(nextRequestAt, cooldownUntil) - now();
        if (delay > 30_000) throw new SteamReviewRateLimitError(delay);
        if (delay > 0) await sleep(delay, options.signal);
        options.signal?.throwIfAborted();
        nextRequestAt = now() + 1000;

        const controller = new AbortController();
        const abort = () => controller.abort(options.signal?.reason);
        options.signal?.addEventListener("abort", abort, { once: true });
        const timeout = setTimeout(() => controller.abort(), 15_000);
        let response: Response;
        try {
          response = await fetchResponse(url, { signal: controller.signal, cache: "no-store" });
        } finally {
          clearTimeout(timeout);
          options.signal?.removeEventListener("abort", abort);
        }
        if (response.status !== 429) return response;

        const retryDelay = Math.max(
          retryAfterMilliseconds(response.headers.get("Retry-After"), now()),
          5000 * 2 ** (attempt - 1) + Math.floor(random() * 1000),
        );
        cooldownUntil = Math.max(cooldownUntil, now() + retryDelay);
        await response.body?.cancel();
        // Do not retry early when Steam requests a longer wait.
        if (attempt === 3 || retryDelay > 30_000) {
          throw new SteamReviewRateLimitError(retryDelay);
        }
        options.onRetry?.({ attempt, delayMs: retryDelay });
      }
      throw new Error("レビュー取得に失敗しました");
    } finally {
      release();
    }
  };
}

const shared = globalThis as typeof globalThis & {
  steamReviewRequester?: ReturnType<typeof createSteamReviewRequester>;
};

export const fetchSteamReviewResponse = shared.steamReviewRequester ??= createSteamReviewRequester();
