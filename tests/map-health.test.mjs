import test from "node:test";
import assert from "node:assert/strict";
import { watchMapHealth } from "../app/play/map-health.ts";

function fakeMap() {
  const listeners = new Map();
  return {
    loaded: () => false,
    on(name, listener) { listeners.set(name, listener); },
    off(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    emit(name, event) { listeners.get(name)?.(event); },
    listeners,
  };
}

test("silent map load failures become visible, then recover when loading completes", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(console, "error", () => {});
  const map = fakeMap();
  const states = [];
  const stop = watchMapHealth(map, value => states.push(value));
  t.mock.timers.tick(20_000);
  assert.deepEqual(states, [false, true]);
  map.emit("load");
  assert.equal(states.at(-1), false);
  map.emit("error", { error: new Error("Tile request failed") });
  assert.equal(states.at(-1), true);
  map.emit("idle");
  assert.equal(states.at(-1), false);
  stop();
  assert.equal(map.listeners.size, 0);
});

test("unmount removes listeners and cancels the failure timeout", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const map = fakeMap();
  const states = [];
  watchMapHealth(map, value => states.push(value))();
  t.mock.timers.tick(20_000);
  assert.deepEqual(states, []);
  assert.equal(map.listeners.size, 0);
});
