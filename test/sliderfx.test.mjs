import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadCommon, read } from "./helpers.mjs";

// sliderfx.js needs sidebar.js (onGrid, decimalsOf) and a document for its scroll listener.
function load() {
  const ctx = loadCommon();
  vm.runInContext(`const IN_SIDEBAR = false; var document = { addEventListener() {} }; var performance = { now: () => 0 };`, ctx);
  vm.runInContext(read("popup/sidebar.js"), ctx);
  vm.runInContext(read("popup/sliderfx.js"), ctx);
  return (expr) => vm.runInContext(expr, ctx);
}

test("angle differences wrap around", () => {
  const delta = load()("angleDelta");
  assert.equal(delta(350, 10), 20);
  assert.equal(delta(10, 350), -20);
  assert.equal(delta(0, 180), 180);
  assert.equal(delta(90, 45), -45);
});

test("thumb rings: inner, middle, outer – also beyond the thumb", () => {
  const ring = load()("ringAt");
  assert.deepEqual([0, 0.3, 0.5, 0.8, 1.05].map(ring), ["inner", "inner", "middle", "outer", "outer"]);
});

test("thumb rings: steps per notch – inner 1, middle 5, outer 10", () => {
  assert.deepEqual({ ...load()("RING_STEPS") }, { inner: 1, middle: 5, outer: 10 });
});

test("press mode (drag mode): leaving the track's line turns, going along it drags", () => {
  const mode = load()("pressMode");
  assert.equal(mode(10, 2), null, "not decided yet");
  assert.equal(mode(16, 3), "drag");
  assert.equal(mode(-16, -5), "drag");
  assert.equal(mode(2, -7), "turn");
  // circling right on the outer ring (radius 13 px) from its top: turns before 15 px sideways
  const at = (deg) => [13 * Math.sin((deg * Math.PI) / 180), 13 - 13 * Math.cos((deg * Math.PI) / 180)];
  let decided = null;
  for (let d = 0; d <= 90 && !decided; d += 4) decided = mode(...at(d));
  assert.equal(decided, "turn");
});

test("snapTo: dragging by the middle or outer ring moves on a 5 or 10 times coarser grid", () => {
  const snap = load()("snapTo");
  const volume = { min: 0, max: 400, step: 1, anchor: 100 };
  assert.equal(snap(137, 10, volume), 140);
  assert.equal(snap(133, 5, volume), 135);
  assert.equal(snap(133, 1, volume), 133);
  assert.equal(snap(398, 10, volume), 400);
  const speed = { min: 0.25, max: 4, step: 0.05, anchor: 1 };
  assert.equal(snap(1.37, 10, speed), 1.5, "speed by the outer ring: 0.5× steps through 1×");
});

test("stepBy: on the grid through the default, within the bounds", () => {
  const stepBy = load()("stepBy");
  const speed = { min: 0.25, max: 4, step: 0.05, anchor: 1 };
  assert.equal(stepBy(1, 3, speed), 1.15);
  assert.equal(stepBy(1.15, -3, speed), 1);
  assert.equal(stepBy(3.9, 10, speed), 4);
  assert.equal(stepBy(0.3, -10, speed), 0.25);
  assert.equal(stepBy(1.02, 1, speed), 1.05, "snaps back onto the grid");
});

test("formatValue: signed for sliders below zero, with the unit (German UI in the tests)", () => {
  const get = load();
  const fmt = (v, c) => get("formatValue")(v, c, { step: c.step });
  assert.equal(fmt(3.5, { min: -15, step: 0.5, unit: "dB" }), "+3,5 dB");
  assert.equal(fmt(-2, { min: -15, step: 0.5, unit: "dB" }), "-2 dB");
  assert.equal(fmt(120, { min: 0, step: 1, unit: "%" }), "120 %");
  assert.equal(fmt(1.25, { min: 0.25, step: 0.05, unit: "×" }), "1,25×");
});
