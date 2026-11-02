import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadCommon, read, plain } from "./helpers.mjs";

// sidebar.js with common.js, as the sidebar (IN_SIDEBAR) or the popup.
function loadSidebar(inSidebar = true) {
  const ctx = loadCommon();
  vm.runInContext(`const IN_SIDEBAR = ${inSidebar};`, ctx);
  vm.runInContext(read("popup/sidebar.js"), ctx);
  const get = (expr) => vm.runInContext(expr, ctx);
  return { ctx, get, setUi: (u) => vm.runInContext(`ui = sanitizeUi(${JSON.stringify(u)})`, ctx) };
}

const speed = { key: "speed", min: 0.25, max: 4, step: 0.05 };
const volume = { key: "volume", min: 0, max: 400, step: 1 };
const range = (spec) => [spec.rangeMin, spec.rangeMax];

test("sliderSpec: the popup keeps the slider's own range and step", () => {
  const { get, setUi } = loadSidebar(false);
  setUi({ extended: true, steps: { speed: 0.5 } });
  assert.deepEqual(plain(get("sliderSpec")(speed)), { min: 0.25, max: 4, step: 0.05, anchor: 1, rangeMin: 0.25, rangeMax: 4 });
});

test("sliderSpec: the sidebar reaches LIMITS and uses custom steps", () => {
  const { get, setUi } = loadSidebar();
  setUi({});
  assert.deepEqual(plain(get("sliderSpec")(volume)), { min: 0, max: 800, step: 1, anchor: 100, rangeMin: 0, rangeMax: 800 });
  setUi({ extended: false, steps: { volume: 5 } });
  assert.deepEqual(plain(get("sliderSpec")(volume)), { min: 0, max: 400, step: 5, anchor: 100, rangeMin: 0, rangeMax: 400 });
});

test("sliderSpec: the step grid goes through the default, so 1× stays reachable with any step", () => {
  const { get, setUi } = loadSidebar();
  for (const [step, expected] of [
    [0.25, [0.25, 16]],
    [0.3, [0.1, 16]],
    [7.95, [1, 8.95]],
    [0.05, [0.1, 16]],
  ]) {
    setUi({ steps: { speed: step } });
    const spec = plain(get("sliderSpec")(speed));
    assert.deepEqual(range(spec), expected, `step ${step}`);
    const k = (1 - spec.rangeMin) / step;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-9, `1× on the range input's grid with step ${step}`);
  }
  setUi({ steps: { volume: 7 } });
  assert.deepEqual(range(plain(get("sliderSpec")(volume))), [2, 800]);
});

test("nudge: moves along the grid through the default, without float drift", () => {
  const { get } = loadSidebar();
  const nudge = get("nudge");
  const spec = { min: 0.1, max: 16, step: 0.05, anchor: 1 };
  assert.equal(nudge(1, 1, spec), 1.05);
  assert.equal(nudge(1, -1, spec), 0.95);
  assert.equal(nudge(1.03, 1, spec), 1.05, "off-grid values snap up");
  assert.equal(nudge(1.03, -1, spec), 1, "off-grid values snap down, not past the grid point");
  assert.equal(nudge(16, 1, spec), 16);
  assert.equal(nudge(0.1, -1, spec), 0.1);
  let v = 0.1;
  for (let i = 0; i < 18; i++) v = nudge(v, 1, spec);
  assert.equal(v, 1);
  assert.equal(nudge(-1, 1, { min: -24, max: 24, step: 0.5, anchor: 0 }), -0.5);
  const odd = { min: 0.1, max: 16, step: 0.3, anchor: 1 };
  assert.deepEqual([nudge(1, -1, odd), nudge(0.7, 1, odd), nudge(1, 1, odd)], [0.7, 1, 1.3]);
});

test("nudge: never moves against the button (value beyond the bounds stays)", () => {
  const { get } = loadSidebar();
  const nudge = get("nudge");
  const spec = { min: 0, max: 400, step: 1, anchor: 100 }; // extended limits switched off
  assert.equal(nudge(600, 1, spec), 600, "+ doesn't lower 600 % to 400 %");
  assert.equal(nudge(600, -1, spec), 400, "− brings it back into range");
  assert.equal(nudge(-5, -1, { min: 0, max: 10, step: 1, anchor: 0 }), -5);
});

test("navigationWatcher: real page loads and site changes restart, same-document URL changes don't", () => {
  const { get } = loadSidebar();
  let host = "example.com";
  const watch = get("navigationWatcher")(() => host);
  // Firefox: pushState / replaceState / hash change all report status "complete"
  assert.equal(watch({ status: "complete", url: "https://example.com/b" }), false, "pushState");
  assert.equal(watch({ status: "complete", url: "https://example.com/b#t=10" }), false, "hash");
  assert.equal(watch({ title: "x" }), false);
  // a reload or navigation: "loading", then "complete"
  assert.equal(watch({ status: "loading", url: "https://example.com/c" }), false);
  assert.equal(watch({ status: "complete" }), true);
  // another site
  assert.equal(watch({ url: "https://other.org/" }), true);
  host = "other.org";
  assert.equal(watch({ url: "https://other.org/x" }), false);
  // opened while the tab was loading: its "complete" restarts
  assert.equal(get("navigationWatcher")(() => host, true)({ status: "complete" }), true);
});

test("sanitizeUi: bad stored values fall back to the defaults", () => {
  const { get } = loadSidebar();
  const sanitizeUi = get("sanitizeUi");
  assert.deepEqual(plain(sanitizeUi(null)), { extended: true, steps: {}, jumpShort: 5, jumpLong: 30 });
  const s = plain(
    sanitizeUi({
      extended: "yes",
      jumpShort: -3,
      jumpLong: 1e9,
      steps: { volume: 5, speed: 0, bass: "1", evil: 1, __proto__: 2, gamma: Infinity, zoom: 0.0001 },
    })
  );
  assert.deepEqual(s, { extended: true, steps: { volume: 5 }, jumpShort: 0.1, jumpLong: 3600 });
});
