import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { loadCommon, read, plain } from "./helpers.mjs";

// modules.js and layout.js on top of common.js, as the popup or the sidebar. Their DOM
// parts only run when called, so the data side can be tested without a page.
function loadLayout(inSidebar = false) {
  const ctx = loadCommon();
  vm.runInContext(`const IN_SIDEBAR = ${inSidebar}; const t = AVFX.t;`, ctx);
  vm.runInContext(read("popup/modules.js"), ctx);
  vm.runInContext(read("popup/layout.js"), ctx);
  return (expr) => plain(vm.runInContext(expr, ctx));
}

const allModules = (l) => [...l.pages.flatMap((p) => p.modules)];

test("layout: the defaults place every module once, sidebar-only ones only in the sidebar", () => {
  for (const [sidebar, surface] of [[false, "popup"], [true, "sidebar"]]) {
    const get = loadLayout(sidebar);
    const l = get(`defaultLayout("${surface}")`);
    const placed = allModules(l);
    assert.equal(new Set(placed).size, placed.length, `${surface}: a module on two pages`);
    const available = get(`modulesFor("${surface}").map((m) => m.id)`);
    for (const id of placed) assert.ok(available.includes(id), `${surface}: ${id} isn't available`);
    for (const id of l.start) assert.ok(available.includes(id), `${surface}: pinned ${id} isn't available`);
    assert.equal(placed.includes("mixer"), sidebar);
    // the sidebar's timeline has the transport buttons
    assert.equal(placed.includes("transport"), !sidebar);
    assert.deepEqual(get(`sanitizeLayout(defaultLayout("${surface}"), "${surface}")`), l, `${surface}: defaults are stable`);
  }
});

test("layout: every module item has a unique id and a label, every slider a key", () => {
  const get = loadLayout(true);
  for (const m of get("MODULES.map((m) => ({ id: m.id, title: m.title, items: m.items.map((i) => ({ id: i.id, label: i.label, kind: i.kind })) }))")) {
    assert.ok(m.title, `${m.id} has no title`);
    const ids = m.items.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, `${m.id}: duplicate item ids`);
    for (const i of m.items) {
      assert.ok(i.label, `${m.id}/${i.id} has no label`);
      assert.ok(["block", "inline"].includes(i.kind));
    }
  }
  const controls = get("CONTROLS.map((c) => c.key)");
  assert.equal(new Set(controls).size, controls.length, "a slider in two modules");
  for (const key of controls) assert.ok(get(`Object.hasOwn(AVFX.LIMITS, "${key}")`), `${key} has no LIMITS`);
});

test("layout: damaged or foreign stored values fall back or are cleaned", () => {
  const get = loadLayout();
  const def = get('defaultLayout("popup")');
  for (const raw of ["null", "42", '"x"', "[]", "{ pages: 3 }"]) assert.deepEqual(get(`sanitizeLayout(${raw}, "popup")`), def, raw);

  const l = get(`sanitizeLayout({
    pages: [
      { id: "audio", name: "  Mein Ton  ", modules: ["level", "level", "nope", "mixer", 7] },
      { id: "audio", modules: ["color"] },
      { id: "start", modules: ["color"] },
      { id: "bad id!", modules: ["color"] },
      { id: "x1", name: "${"N".repeat(40)}", modules: ["level", "color"] },
      null,
    ],
    start: ["speed", "speed", "mixer", "gone"],
    collapsed: ["audio/level", 5, "${"k".repeat(80)}"],
    hidden: { level: ["pan", "pan", "nope"], gone: ["x"] },
    order: { level: ["width", "volume", "nope"] },
    known: MODULES.map((m) => m.id),
  }, "popup")`);
  assert.deepEqual(l.pages.map((p) => p.id), ["audio", "x1"]);
  assert.equal(l.pages[0].name, "Mein Ton");
  assert.equal(l.pages[1].name.length, 24);
  assert.deepEqual(l.pages[0].modules, ["level"], "duplicates, unknown and sidebar-only modules dropped");
  assert.deepEqual(l.pages[1].modules, ["color"], "a module stays on its first page");
  assert.deepEqual(l.start, ["speed"]);
  assert.deepEqual(l.collapsed, ["audio/level"]);
  assert.deepEqual(l.hidden, { level: ["pan"] });
  assert.deepEqual(l.order.level, ["width", "volume", "pan", "mono", "swap"], "missing items appended");
});

test("layout: modules new since the layout was saved go to their default page, hidden ones stay hidden", () => {
  const get = loadLayout();
  // An older layout that didn't know "sound" yet, and where the user removed "room".
  const l = get(`sanitizeLayout({
    pages: [{ id: "audio", modules: ["level"] }, { id: "mine", modules: [] }],
    start: [],
    known: MODULES.map((m) => m.id).filter((id) => id !== "sound"),
  }, "popup")`);
  assert.deepEqual(l.pages[0].modules, ["level", "sound"]);
  assert.ok(!allModules(l).includes("room"), "a module the user removed doesn't come back");
  // A new module whose default page was deleted goes to the first page.
  const k = get(`sanitizeLayout({ pages: [{ id: "mine", modules: [] }], start: [], known: ["level"] }, "popup")`);
  assert.ok(k.pages[0].modules.includes("color"));
  assert.ok(k.known.includes("color"));
});

test("layout: placing, pinning, removing and reordering modules", () => {
  const get = loadLayout();
  let l = get('placeModule(defaultLayout("popup"), "room", "video", 0)');
  assert.equal(l.pages.find((p) => p.id === "video").modules[0], "room");
  assert.ok(!l.pages.find((p) => p.id === "audio").modules.includes("room"), "moved, not copied");

  l = get(`placeModule(${JSON.stringify(l)}, "room", "start")`);
  assert.equal(l.start.at(-1), "room", "pinned");
  assert.equal(l.pages.find((p) => p.id === "video").modules[0], "room", "pinned modules stay on their page");

  l = get(`removeModule(${JSON.stringify(l)}, "start", "room")`);
  assert.ok(!l.start.includes("room"));
  l = get(`removeModule(${JSON.stringify(l)}, "video", "room")`);
  assert.equal(get(`pageOf(${JSON.stringify(l)}, "room")`), null);

  l = get(`setModuleOrder(${JSON.stringify(l)}, "audio", ["equalizer", "analyzer", "nope"])`);
  assert.deepEqual(l.pages.find((p) => p.id === "audio").modules.slice(0, 3), ["equalizer", "analyzer", "level"]);
  assert.deepEqual(get(`placeModule(${JSON.stringify(l)}, "room", "missing")`), l, "unknown page: unchanged");
});

test("layout: pages are added, renamed, moved and deleted", () => {
  const get = loadLayout();
  const [added, id] = get('addPage(defaultLayout("popup"), "Neu")');
  assert.match(id, /^p[a-z0-9]+$/);
  assert.equal(added.pages.at(-1).name, "Neu");
  let l = get(`renamePage(${JSON.stringify(added)}, "${id}", "  ")`);
  assert.equal(l.pages.at(-1).name, null, "an empty name goes back to the default name");
  l = get(`movePage(${JSON.stringify(l)}, "${id}", -1)`);
  assert.equal(l.pages.at(-2).id, id);
  assert.deepEqual(get(`movePage(${JSON.stringify(l)}, "playback", -1)`), l, "the first page can't move left");
  l = get(`placeModule(${JSON.stringify(l)}, "sleep", "${id}")`);
  l = get(`toggleCollapsed(${JSON.stringify(l)}, "${id}/sleep")`);
  l = get(`deletePage(${JSON.stringify(l)}, "${id}")`);
  assert.ok(!l.pages.some((p) => p.id === id));
  assert.equal(get(`pageOf(${JSON.stringify(l)}, "sleep")`), null, "its modules are unplaced");
  assert.deepEqual(l.collapsed, []);

  let many = get('defaultLayout("popup")');
  for (let i = 0; i < 20; i++) many = get(`addPage(${JSON.stringify(many)}, "x")[0]`);
  assert.equal(many.pages.length, 12, "at most 12 pages");
});

test("layout: items are hidden and reordered per module", () => {
  const get = loadLayout();
  let l = get('toggleItem(defaultLayout("popup"), "level", "pan")');
  assert.deepEqual(l.hidden.level, ["pan"]);
  l = get(`toggleItem(${JSON.stringify(l)}, "level", "pan")`);
  assert.deepEqual(l.hidden.level, []);
  l = get(`setItemOrder(${JSON.stringify(l)}, "level", ["swap", "volume"])`);
  assert.deepEqual(get(`itemOrder(sanitizeLayout(${JSON.stringify(l)}, "popup"), MODULE_BY_ID.get("level"))`), ["swap", "volume", "pan", "width", "mono"]);
});

test("layout: a card's view (list, knobs, faders, tiles) is kept per page and moves with the card", () => {
  const get = loadLayout();
  const def = get('defaultLayout("popup")');
  assert.equal(get(`viewOf(defaultLayout("popup"), "start", MODULE_BY_ID.get("level"))`), "knobs", "Start shows knobs");
  assert.equal(get(`viewOf(defaultLayout("popup"), "audio", MODULE_BY_ID.get("level"))`), "list", "the Audio page keeps the sliders");
  assert.equal(get(`viewOf(defaultLayout("popup"), "audio", MODULE_BY_ID.get("sound"))`), "list", "modules without sliders are lists");
  for (const [key, view] of Object.entries(def.views)) {
    const [page, module] = key.split("/");
    assert.ok(page === "start" || def.pages.find((p) => p.id === page)?.modules.includes(module), `${key}: no such card`);
    assert.ok(["knobs", "faders", "tiles"].includes(view));
  }

  let l = get('setView(defaultLayout("popup"), "audio/level", "faders")');
  assert.equal(l.views["audio/level"], "faders");
  l = get(`placeModule(${JSON.stringify(l)}, "level", "video")`);
  assert.equal(l.views["video/level"], "faders", "the view moves with the card");
  assert.equal(l.views["audio/level"], undefined);
  l = get(`setView(${JSON.stringify(l)}, "video/level", "list")`);
  assert.equal(l.views["video/level"], undefined, "list is the default and isn't stored");

  const cleaned = get(`sanitizeLayout({ ...defaultLayout("popup"), views: { "audio/level": "wobble", "audio/eq": "knobs", x: 5 } }, "popup")`);
  assert.deepEqual(cleaned.views, { "audio/eq": "knobs" }, "unknown views are dropped");
});
