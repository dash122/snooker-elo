import test from "node:test";
import assert from "node:assert/strict";
import { createBoardCache } from "../app/play/board-cache.ts";

test("badge and first tab load share one request and reuse its response", async () => {
  const cache = createBoardCache();
  let calls = 0;
  const board = { ready: true };
  const load = async () => { calls++; return board; };
  const [badge, tab] = await Promise.all([cache.load("member:zh", load), cache.load("member:zh", load)]);
  assert.equal(calls, 1);
  assert.equal(badge, tab);
  assert.equal(cache.peek("member:zh"), board);
  await cache.load("member:zh", load);
  assert.equal(calls, 1);
  await cache.load("member:zh", load, true);
  assert.equal(calls, 2);
});

test("cached boards stay separate by viewer and filter", async () => {
  const cache = createBoardCache();
  await cache.load("alice:hk", async () => ({ viewerId: "alice" }));
  assert.equal(cache.peek("bob:hk"), null);
  assert.equal(cache.peek("alice:london"), null);
});

test("failed requests can retry and expired responses refresh", async () => {
  const cache = createBoardCache(0);
  await assert.rejects(cache.load("board", async () => { throw new Error("offline"); }));
  await cache.load("board", async () => ({ revision: 1 }));
  assert.deepEqual(await cache.load("board", async () => ({ revision: 2 })), { revision: 2 });
});

test("a write invalidates both cached boards and older in-flight reads", async () => {
  const cache = createBoardCache();
  let complete;
  const old = cache.load("board", () => new Promise((resolve) => { complete = resolve; }));
  await Promise.resolve();
  cache.clear();
  await cache.load("board", async () => ({ revision: 2 }));
  complete({ revision: 1 });
  await old;
  assert.deepEqual(cache.peek("board"), { revision: 2 });
});
