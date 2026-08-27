import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// getCurrentMember() is the hottest path in the app: every page load and every
// authed API call awaits it. It used to await an unconditional
// `ALTER TABLE members ADD COLUMN IF NOT EXISTS password_set …` on each cold
// start. ALTER TABLE needs ACCESS EXCLUSIVE, so it queued behind any in-flight
// transaction touching members and then blocked every *later* reader of members
// behind it. With the pool capped at four connections that starves the whole
// instance — members can't open the app, and saves (which call requireMember
// first) hang, which is how it was reported.
//
// The column is owned by supabase/migrations/20260826000001_member_password_set.sql.
// The runtime self-heal stays, for a deploy that lands before the migration is
// applied, but it must probe the catalog first and only ever reach DDL when the
// column is genuinely absent.
const source = readFileSync(new URL("../db/auth.pg.ts", import.meta.url), "utf8");

function body(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found`);
  let depth = 0, i = source.indexOf("{", start);
  for (let j = i; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}" && --depth === 0) return source.slice(i, j + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test("the password_set self-heal probes the catalog before any DDL", () => {
  const fn = body("ensurePasswordSetSchema");
  const probe = fn.indexOf("information_schema.columns");
  const alter = fn.indexOf("ALTER TABLE");
  assert.notEqual(probe, -1, "must look the column up in the catalog");
  assert.notEqual(alter, -1, "must still be able to self-heal");
  assert.ok(probe < alter, "the catalog probe must come before the ALTER");
  assert.match(fn, /if \(probe\?\.present\) return;/, "a present column must short-circuit before the ALTER");
});

test("the self-heal's DDL cannot park an exclusive lock in front of readers", () => {
  const fn = body("ensurePasswordSetSchema");
  assert.match(fn, /SET LOCAL lock_timeout = '\d+s'/, "DDL must run under a short lock_timeout");
});

test("a failed self-heal never takes down the request that triggered it", () => {
  const fn = body("ensurePasswordSetSchema");
  // The cached promise must settle, not reject: getCurrentMember awaits it, so
  // a rethrow here is a 500 on every page load.
  assert.ok(!/\.catch\([^)]*=>\s*\{[^}]*throw /s.test(fn), "must not rethrow out of the hot path");
  assert.match(fn, /passwordSetSchemaReady = null/, "must clear the cache so the next request re-probes");
});

test("a signed-out visitor reaches no schema check and no database round trip", () => {
  const fn = body("getCurrentMember");
  const cookie = fn.indexOf("parseCookie");
  const noToken = fn.indexOf("if (!token) return null;");
  const ensure = fn.indexOf("ensurePasswordSetSchema");
  assert.ok(cookie < noToken && noToken < ensure, "the cookie check must precede any database work");
});

test("no other schema bootstrap issues DDL unconditionally on a hot path", () => {
  // ensureAuthSchema / ensurePreliminaryRatingSchema are migration-owned and
  // short-circuit before their historical bootstraps; keep it that way.
  for (const name of ["ensureAuthSchema", "ensurePreliminaryRatingSchema"]) {
    const fn = body(name);
    const early = fn.indexOf("return Promise.resolve();");
    assert.notEqual(early, -1, `${name} must stay short-circuited`);
    assert.ok(early < fn.indexOf("ALTER TABLE"), `${name} must not reach DDL`);
  }
});
