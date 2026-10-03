import assert from "node:assert/strict";
import test from "node:test";
import { LEGACY_SESSION_COOKIE, SESSION_COOKIE, readSessionToken } from "../lib/session-cookie.ts";

test("a session started before the rename still reads", () => {
  assert.equal(readSessionToken(`theme=x; ${LEGACY_SESSION_COOKIE}=old-token`), "old-token");
});
test("the new cookie wins when both are present", () => {
  assert.equal(readSessionToken(`${LEGACY_SESSION_COOKIE}=old; ${SESSION_COOKIE}=new`), "new");
});
test("no cookie reads as signed out", () => {
  assert.equal(readSessionToken(null), null);
  assert.equal(readSessionToken("a=b"), null);
});
