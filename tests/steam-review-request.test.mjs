import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSteamReviewRequester,
  retryAfterMilliseconds,
  SteamReviewRateLimitError,
} from "../.test-output/steam-review-request.js";

function harness(statuses, headers = {}) {
  let clock = 0;
  const calls = [];
  const waits = [];
  const request = createSteamReviewRequester({
    now: () => clock,
    random: () => 0,
    sleep: async (ms) => { waits.push(ms); clock += ms; },
    fetch: async (url, init) => {
      calls.push({ url, at: clock, init });
      return new Response("{}", { status: statuses.shift() ?? 200, headers });
    },
  });
  return { request, calls, waits };
}

test("Retry-After accepts seconds and HTTP dates", () => {
  const now = Date.parse("2026-10-03T18:00:00Z");
  assert.equal(retryAfterMilliseconds("12", now), 12_000);
  assert.equal(retryAfterMilliseconds("Sat, 03 Oct 2026 18:00:20 GMT", now), 20_000);
  assert.equal(retryAfterMilliseconds("garbage", now), 0);
  assert.equal(retryAfterMilliseconds("-5", now), 0);
  assert.equal(retryAfterMilliseconds(null, now), 0);
});

test("successful and non-429 responses are not retried", async () => {
  const h = harness([200, 404]);
  assert.equal((await h.request("first")).status, 200);
  assert.equal((await h.request("second")).status, 404);
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.waits, [1000]);
  assert.equal(h.calls[0].init.cache, "no-store");
});

test("429 retries with increasing waits and reports progress", async () => {
  const h = harness([429, 429, 200]);
  const retries = [];
  assert.equal((await h.request("reviews", { onRetry: (r) => retries.push(r) })).status, 200);
  assert.deepEqual(h.waits, [5000, 10_000]);
  assert.deepEqual(retries, [{ attempt: 1, delayMs: 5000 }, { attempt: 2, delayMs: 10_000 }]);
});

test("Retry-After overrides shorter backoff", async () => {
  const h = harness([429, 200], { "Retry-After": "12" });
  await h.request("reviews");
  assert.deepEqual(h.waits, [12_000]);
});

test("long Retry-After stops without holding later requests open", async () => {
  const h = harness([429, 200], { "Retry-After": "120" });
  await assert.rejects(h.request("first"), (error) => error instanceof SteamReviewRateLimitError && error.retryAfterMs === 120_000);
  assert.equal(h.calls.length, 1);
  await assert.rejects(h.request("second"), SteamReviewRateLimitError);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.waits, []);
});

test("persistent 429 stops after three attempts and releases the queue", async () => {
  const h = harness([429, 429, 429, 200]);
  await assert.rejects(h.request("first"), SteamReviewRateLimitError);
  assert.equal(h.calls.length, 3);
  await h.request("second");
  assert.deepEqual(h.waits, [5000, 10_000, 20_000]);
});

test("concurrent callers share pacing and cooldown", async () => {
  const h = harness([429, 200, 200, 200]);
  await Promise.all([h.request("a"), h.request("b"), h.request("c")]);
  assert.deepEqual(h.calls.map(({ url }) => url), ["a", "a", "b", "c"]);
  assert.deepEqual(h.calls.map(({ at }) => at), [0, 5000, 6000, 7000]);
});

test("an aborted queued request does not skip the active request", async () => {
  let finishFirst;
  const calls = [];
  const request = createSteamReviewRequester({
    sleep: async () => {},
    fetch: async (url) => {
      calls.push(url);
      if (url === "first") await new Promise((resolve) => { finishFirst = resolve; });
      return new Response("{}");
    },
  });
  const first = request("first");
  await new Promise((resolve) => setImmediate(resolve));
  const controller = new AbortController();
  const second = request("second", { signal: controller.signal });
  controller.abort();
  await assert.rejects(second, { name: "AbortError" });
  const third = request("third");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["first"]);
  finishFirst();
  await Promise.all([first, third]);
  assert.deepEqual(calls, ["first", "third"]);
});

test("aborting backoff cancels further Steam requests", async () => {
  const controller = new AbortController();
  let count = 0;
  const request = createSteamReviewRequester({
    random: () => 0,
    fetch: async () => { count++; return new Response("{}", { status: 429 }); },
  });
  await assert.rejects(request("reviews", {
    signal: controller.signal,
    onRetry: () => controller.abort(),
  }), { name: "AbortError" });
  assert.equal(count, 1);
});
