export interface ReviewCheckpoint<T> {
  reviews: T[];
  cursor: string;
  fetched: number;
  total: number;
  complete: boolean;
}

type ReviewEvent<T> =
  | { type: "meta"; total: number }
  | { type: "review"; review: T; fetched: number; total: number }
  | { type: "progress"; fetched: number; total: number }
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done"; fetched: number; total: number; complete: boolean; nextCursor: string | null };

export async function downloadReviewChunks<T extends { recommendationid: string }>(options: {
  appId: string;
  language: string;
  checkpoint: ReviewCheckpoint<T>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  onProgress?: (fetched: number, total: number) => void;
  onStatus?: (message: string) => void;
}) {
  const checkpoint = options.checkpoint;
  const ids = new Set(checkpoint.reviews.map((review) => review.recommendationid));
  while (!checkpoint.complete) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({ appId: options.appId, language: options.language, chunked: "1",
      cursor: checkpoint.cursor, offset: String(checkpoint.fetched) });
    const timeout = AbortSignal.timeout(170_000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const response = await (options.fetch ?? fetch)(`/api/reviews/stream?${params}`, { signal });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      const wait = Number(response.headers.get("Retry-After"));
      const suffix = Number.isFinite(wait) && wait > 0 ? ` 再開目安: ${Math.ceil(wait / 60)}分後。` : "";
      throw new Error((payload.error || `レビュー取得に失敗しました: ${response.status}`) + suffix);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const batch: T[] = [];
    let bytes = 0;
    let doneEvent: Extract<ReviewEvent<T>, { type: "done" }> | undefined;
    const readEvent = (line: string) => {
      if (!line.trim()) return;
      if (doneEvent) throw new Error("レビュー取得の完了後に予期しないデータを受信しました。");
      const event = JSON.parse(line) as ReviewEvent<T>;
      if (event.type === "error") throw new Error(event.message);
      if (event.type === "retry") options.onStatus?.(event.message);
      if (event.type === "meta") checkpoint.total = event.total || checkpoint.total;
      if (event.type === "review") batch.push(event.review);
      if (event.type === "progress") options.onProgress?.(event.fetched, event.total || checkpoint.total);
      if (event.type === "done") doneEvent = event;
    };
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 20 * 1024 * 1024) throw new Error("1回のレビュー送信量が上限を超えました。時間を置いて再開してください。");
        buffer += decoder.decode(part.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) readEvent(line);
      }
      readEvent(buffer + decoder.decode());
      if (!doneEvent || (!doneEvent.complete && (!doneEvent.nextCursor || doneEvent.nextCursor === checkpoint.cursor))) {
        throw new Error("レビュー取得の通信が途中で切れました。取得済みの区間から再開できます。");
      }
      // Only commit a complete chunk. A truncated response must never become a full CSV/cache.
      for (const review of batch) {
        if (ids.has(review.recommendationid)) continue;
        checkpoint.reviews.push(review);
        ids.add(review.recommendationid);
      }
      checkpoint.fetched = doneEvent.fetched;
      checkpoint.total = doneEvent.total || checkpoint.total;
      checkpoint.complete = doneEvent.complete;
      if (doneEvent.nextCursor) checkpoint.cursor = doneEvent.nextCursor;
      options.onProgress?.(checkpoint.reviews.length, checkpoint.total);
      options.onStatus?.(checkpoint.complete ? "" : "続きのレビューを取得中...");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  return checkpoint.reviews;
}
