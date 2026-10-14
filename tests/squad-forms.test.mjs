import test from "node:test";
import assert from "node:assert/strict";
import { squadForms } from "../lib/squad-rivalry.ts";

const m = (a, b, scoreA, scoreB, playedOn, extra = {}) => ({ a, b, scoreA, scoreB, playedOn, status: "confirmed", createdAt: `${playedOn}T00:00:00Z`, ...extra });

test("form only counts confirmed singles between squad members, newest first", () => {
  const forms = squadForms([
    m("x", "y", 3, 1, "2026-09-01"), // x W
    m("x", "z", 3, 0, "2026-09-02"), // z is outside the squad: ignored
    m("x", "y", 0, 3, "2026-09-03"), // x L
    m("x", "y", 2, 2, "2026-09-04", { status: "pending" }),
    m("x", "y", 3, 2, "2026-09-05", { mode: "2v2" }),
    m("x", "y", 1, 1, "2026-09-06"), // x D
  ], ["x", "y"]);
  assert.deepEqual(forms.get("x"), ["D", "L", "W"]);
  assert.deepEqual(forms.get("y"), ["D", "W", "L"]);
  assert.equal(forms.has("z"), false);
});

test("form keeps only the five most recent results", () => {
  const list = ["01", "02", "03", "04", "05", "06", "07"].map((day, i) => m("x", "y", i % 2 ? 0 : 3, 1, `2026-09-${day}`));
  assert.deepEqual(squadForms(list, ["x", "y"]).get("x"), ["W", "L", "W", "L", "W"]);
});
