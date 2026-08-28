import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const serverBundle = new URL("../dist/server/index.js", import.meta.url);

test("builds the server bundle", async () => {
  await access(serverBundle);
  const { default: worker } = await import(serverBundle.href);
  assert.ok(typeof worker === "function");
});
