import test from "node:test";
import assert from "node:assert/strict";
import {createBoardCache} from "../lib/board-cache.ts";

test("returning to the board reuses a snapshot, then revalidates after its TTL",async()=>{
  let now=0,requests=0;
  const cache=createBoardCache(30,()=>now),fetcher=async()=>++requests;
  assert.equal(await cache.read("member:today",fetcher),1);
  now=29;
  assert.equal(await cache.read("member:today",fetcher),1);
  now=31;
  assert.equal(cache.peek("member:today"),1,"old data stays visible during refresh");
  assert.equal(await cache.read("member:today",fetcher),2);
});

test("concurrent mounts share one in-flight request",async()=>{
  const cache=createBoardCache();let complete,requests=0;
  const fetcher=()=>{requests++;return new Promise(resolve=>{complete=resolve})};
  const first=cache.read("member",fetcher),second=cache.read("member",fetcher);
  assert.equal(requests,1);complete("board");
  assert.deepEqual(await Promise.all([first,second]),["board","board"]);
});

test("an old response cannot replace the post-mutation snapshot",async()=>{
  const cache=createBoardCache();let complete;
  const old=cache.read("member",()=>new Promise(resolve=>{complete=resolve}));
  cache.invalidate("member");
  await cache.read("member",async()=>"updated");complete("old");await old;
  assert.equal(cache.peek("member"),"updated");
});

test("switching member or playing day discards the previous snapshot",async()=>{
  const cache=createBoardCache();
  await cache.read("alice:today",async()=>"Alice's participation");
  assert.equal(cache.peek("bob:today"),null);
  await cache.read("bob:today",async()=>"Bob's participation");
  assert.equal(cache.peek("bob:tomorrow"),null);
});

test("failed requests are retryable and do not erase an existing snapshot",async()=>{
  let now=0;const cache=createBoardCache(10,()=>now);
  await cache.read("member",async()=>"known");now=11;
  await assert.rejects(cache.read("member",async()=>{throw Error("network")}),/network/);
  assert.equal(cache.peek("member"),"known");
  assert.equal(await cache.read("member",async()=>"recovered"),"recovered");
});
