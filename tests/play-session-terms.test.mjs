import test from "node:test";
import assert from "node:assert/strict";
import { sessionTermLabels } from "../app/play/session-terms.ts";
const t = (key) => key;

test("unrestricted smoking, fees and preferences are not advertised as session requirements", () => {
  assert.deepEqual(sessionTermLabels({
    smoking: { want: "any", strictness: "prefer" },
    fee: { want: "any", strictness: "must" },
    vibe: { want: "competitive", strictness: "any" },
    level: { want: "similar", strictness: "any" },
  }, t), []);
});

test("public session terms retain playing style, level and practical conditions", () => {
  assert.deepEqual(sessionTermLabels({
    level: { want: "similar", strictness: "prefer", handicapOk: true },
    vibe: { want: "practice", strictness: "prefer" },
    smoking: { want: "no", strictness: "must" },
    fee: { want: "split", strictness: "prefer" }, teaching: true,
  }, t), ["水平相近", "接受讓分", "練習", "必須無煙", "希望 AA 制", "樂意陪伴新手"]);
});

test("mandatory and preferred practical terms stay distinct", () => {
  assert.deepEqual(sessionTermLabels({ smoking: { want: "no", strictness: "prefer" }, fee: { want: "split", strictness: "must" } }, t), ["希望無煙", "必須 AA 制"]);
});
