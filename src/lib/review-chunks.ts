export const REVIEW_CHUNK_MAX_PAGES = 100;
export const REVIEW_CHUNK_MAX_BYTES = 16 * 1024 * 1024;
export const REVIEW_CHUNK_TIME_MS = 100_000;

export interface ReviewPage<T> {
  reviews: T[];
  cursor: string;
  total_reviews: number;
}

// Stop only between complete Steam pages, so continuation never skips reviews.
export async function collectReviewChunk<T>(options: {
  cursor: string;
  fetchPage: (cursor: string) => Promise<ReviewPage<T>>;
  sendPage: (page: ReviewPage<T>) => void;
  pageBytes: (page: ReviewPage<T>) => number;
  signal?: AbortSignal;
  now?: () => number;
  maxPages?: number;
  maxBytes?: number;
  timeoutMs?: number;
}) {
  const now = options.now ?? Date.now;
  const started = now();
  const maxPages = options.maxPages ?? REVIEW_CHUNK_MAX_PAGES;
  const maxBytes = options.maxBytes ?? REVIEW_CHUNK_MAX_BYTES;
  const timeout = options.timeoutMs ?? REVIEW_CHUNK_TIME_MS;
  let cursor = options.cursor;
  let bytes = 0;
  let pages = 0;
  let fetched = 0;
  const seen = new Set<string>([cursor]);
  while (pages < maxPages && (pages === 0 || now() - started < timeout)) {
    options.signal?.throwIfAborted();
    const page = await options.fetchPage(cursor);
    options.signal?.throwIfAborted();
    if (page.reviews.length === 0) return { complete: true, cursor: null, fetched };
    const size = options.pageBytes(page);
    if (size > maxBytes) throw new Error("1ページのレビューが送信量上限を超えています。言語を絞って再取得してください。");
    if (bytes + size > maxBytes) break;
    if (!page.cursor || page.cursor === "*" || seen.has(page.cursor)) {
      throw new Error("Steamから続きの取得位置を受け取れませんでした。時間を置いて再開してください。");
    }
    options.sendPage(page);
    bytes += size;
    fetched += page.reviews.length;
    pages++;
    cursor = page.cursor;
    seen.add(cursor);
  }
  return { complete: false, cursor, fetched };
}
