import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiLimitError, createApiGovernor, protectApi, apiSignal, readLimitedJson } from "../.test-output/api-protection.js";

test("concurrent review downloads are refused; release is idempotent", () => {
  const governor = createApiGovernor();
  const first = governor.acquire("reviews");
  assert.throws(() => governor.acquire("reviews"), ApiLimitError);
  first.release(); first.release();
  governor.acquire("reviews").release();
});

test("request frequency is limited across clients and recovers after the window", () => {
  let now = 0;
  const governor = createApiGovernor({ now: () => now });
  for (let i = 0; i < 4; i++) governor.acquire("audience").release();
  assert.throws(() => governor.acquire("audience"), (e) => e.status === 429 && e.retryAfterSeconds === 600);
  now = 600_000;
  governor.acquire("audience").release();
});

test("all endpoints share the active request ceiling", () => {
  const governor = createApiGovernor();
  const active = [governor.acquire("analyze"), governor.acquire("analyze"), governor.acquire("ai"), governor.acquire("ai")];
  assert.throws(() => governor.acquire("discovery"), ApiLimitError);
  active.forEach((lease) => lease.release());
  governor.acquire("discovery").release();
});

test("byte budget is shared across routes and resets after 24 hours", () => {
  let now = 0;
  const governor = createApiGovernor({ now: () => now, dailyBytes: 100 });
  const lease = governor.acquire("reviews");
  lease.consume(60);
  assert.throws(() => lease.consume(41), ApiLimitError);
  lease.consume(40); lease.release();
  assert.throws(() => governor.acquire("ai"), ApiLimitError);
  now += 86_400_000;
  governor.acquire("reviews").release();
});

test("declared and chunked JSON bodies cannot bypass the input byte limit", async () => {
  await assert.rejects(readLimitedJson(new Request("http://localhost", {
    method: "POST", headers: { "content-length": "9999" }, body: "{}",
  }), 10), (e) => e.status === 413);
  await assert.rejects(readLimitedJson(new Request("http://localhost", {
    method: "POST", body: JSON.stringify({ text: "x".repeat(30) }),
  }), 10), (e) => e.status === 413);
  assert.deepEqual(await readLimitedJson(new Request("http://localhost", { method: "POST", body: "{}" }), 10), {});
  await assert.rejects(readLimitedJson(new Request("http://localhost", { method: "POST", body: "invalid" }), 10), (e) => e.status === 400);
});

test("a streaming lease lasts until completion or client cancellation", async () => {
  let upstreamCancelled = false;
  let signal;
  const response = await protectApi(new Request("http://localhost"), "reviews", async () => {
    signal = apiSignal();
    return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1])); },
      cancel() { upstreamCancelled = true; },
    }));
  });
  const denied = await protectApi(new Request("http://localhost"), "reviews", async () => Response.json({}));
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("Retry-After"), "30");
  const reader = response.body.getReader();
  await reader.read(); await reader.cancel();
  assert.equal(signal.aborted, true);
  assert.equal(upstreamCancelled, true);
  const allowed = await protectApi(new Request("http://localhost"), "reviews", async () => Response.json({ ok: true }));
  assert.deepEqual(await allowed.json(), { ok: true });
});

test("oversized output is cut off and releases the worker", async () => {
  const response = await protectApi(new Request("http://localhost"), "discovery", async () => new Response(new Uint8Array(2 * 1024 * 1024)));
  await assert.rejects(response.arrayBuffer(), ApiLimitError);
  const next = await protectApi(new Request("http://localhost"), "discovery", async () => Response.json({ ok: true }));
  assert.equal(next.status, 200); await next.arrayBuffer();
});

test("already disconnected clients do not start an expensive handler", async () => {
  const abort = new AbortController(); abort.abort();
  let called = false;
  const response = await protectApi(new Request("http://localhost", { signal: abort.signal }), "analyze", async () => {
    called = true; return Response.json({});
  });
  assert.equal(called, false); assert.equal(response.status, 499);
  assert.match((await response.json()).error, /中断/);
});
