import assert from "node:assert/strict";
import { test } from "node:test";
import { collectReviewChunk } from "../.test-output/review-chunks.js";
import { downloadReviewChunks } from "../.test-output/review-download.js";

test("25,050 reviews are retrieved across bounded chunks without a 10k total cap", async () => {
  const collected = [];
  let cursor = "0";
  let requests = 0;
  let complete = false;
  while (!complete) {
    const result = await collectReviewChunk({
      cursor,
      fetchPage: async (position) => {
        const start = Number(position);
        return { reviews: Array.from({ length: Math.min(100, 25_050 - start) }, (_, i) => start + i), cursor: String(start + 100), total_reviews: 25_050 };
      },
      pageBytes: (page) => page.reviews.length,
      sendPage: (page) => collected.push(...page.reviews),
    });
    complete = result.complete; cursor = result.cursor; requests++;
  }
  assert.equal(requests, 3);
  assert.equal(collected.length, 25_050);
  assert.equal(new Set(collected).size, 25_050);
  assert.equal(collected.at(-1), 25_049);
});

test("byte bound pauses at a page boundary and returns the unconsumed cursor", async () => {
  const collected = [];
  const result = await collectReviewChunk({ cursor: "0", maxBytes: 150,
    fetchPage: async (position) => ({ reviews: Array.from({ length: 100 }, (_, i) => Number(position) + i), cursor: String(Number(position) + 100), total_reviews: 1000 }),
    pageBytes: (page) => page.reviews.length, sendPage: (page) => collected.push(...page.reviews),
  });
  assert.equal(result.complete, false); assert.equal(result.cursor, "100"); assert.equal(collected.length, 100);
});

test("time bound is independent of title review count", async () => {
  let now = 0;
  const result = await collectReviewChunk({ cursor: "a", timeoutMs: 10, now: () => now,
    fetchPage: async () => ({ reviews: [1], cursor: "b", total_reviews: 1_000_000 }),
    pageBytes: () => 1, sendPage: () => { now = 10; },
  });
  assert.equal(result.complete, false); assert.equal(result.cursor, "b");
});

test("cancelled work does not fetch another page", async () => {
  const abort = new AbortController(); abort.abort();
  let calls = 0;
  await assert.rejects(collectReviewChunk({ cursor: "a", signal: abort.signal,
    fetchPage: async () => { calls++; return { reviews: [], cursor: "", total_reviews: 0 }; },
    pageBytes: () => 0, sendPage: () => {},
  }), { name: "AbortError" });
  assert.equal(calls, 0);
});

function response(events) {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}
function checkpoint() { return { reviews: [], cursor: "*", fetched: 0, total: 12_000, complete: false }; }

test("client resumes a committed chunk after a 429 and never exposes a partial full cache", async () => {
  const state = checkpoint();
  let calls = 0;
  await assert.rejects(downloadReviewChunks({ appId: "620", language: "all", checkpoint: state,
    fetch: async () => ++calls === 1 ? response([
      { type: "review", review: { recommendationid: "1" } },
      { type: "done", complete: false, nextCursor: "page2", fetched: 1, total: 12_000 },
    ]) : Response.json({ error: "利用回数の上限" }, { status: 429, headers: { "Retry-After": "30" } }),
  }), /利用回数/);
  assert.equal(state.complete, false); assert.equal(state.cursor, "page2"); assert.equal(state.reviews.length, 1);
  await downloadReviewChunks({ appId: "620", language: "all", checkpoint: state,
    fetch: async (url) => {
      assert.equal(new URL(url, "http://localhost").searchParams.get("cursor"), "page2");
      return response([
        { type: "review", review: { recommendationid: "1" } },
        { type: "review", review: { recommendationid: "2" } },
        { type: "done", complete: true, nextCursor: null, fetched: 3, total: 12_000 },
      ]);
    },
  });
  assert.equal(state.complete, true); assert.equal(state.reviews.length, 2);
});

test("interrupted response discards only the uncommitted chunk", async () => {
  const state = checkpoint();
  await assert.rejects(downloadReviewChunks({ appId: "620", language: "all", checkpoint: state,
    fetch: async () => response([{ type: "review", review: { recommendationid: "1" } }]),
  }), /途中で/);
  assert.equal(state.reviews.length, 0); assert.equal(state.complete, false); assert.equal(state.cursor, "*");
});

test("completed cache is reused without a network request", async () => {
  const state = checkpoint(); state.complete = true; state.reviews = [{ recommendationid: "1" }];
  const reviews = await downloadReviewChunks({ appId: "620", language: "all", checkpoint: state,
    fetch: async () => { throw new Error("unexpected network access"); },
  });
  assert.equal(reviews.length, 1);
});
