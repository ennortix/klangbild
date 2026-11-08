// The panel's layout: pages (the tabs) holding module cards (modules.js). Pages can be
// added, renamed, reordered and deleted; modules sorted, moved to another page, removed,
// collapsed and pinned to the Start page; a module's items sorted and hidden. The popup
// and the sidebar each keep their own layout in storage.local[LAYOUT_KEY][surface].
//
// Start is the dashboard: always the first page, it shows pinned modules, which stay on
// their own page too. Every other module is on at most one page; one on none is only
// offered in "Add module".

const LAYOUT_KEY = "panelLayout";
const SURFACE = IN_SIDEBAR ? "sidebar" : "popup";
const START = "start";
const PAGE_NAME_MAX = 24;
const MAX_PAGES = 12;
const PAGE_ID = /^[a-z0-9-]{1,24}$/i;

// The built-in pages: names follow the browser's language until the page is renamed.
const PAGE_INFO = {
  start: { icon: "star", name: () => t("pageStart") },
  playback: { icon: "playback", name: () => t("pagePlayback") },
  audio: { icon: "audio", name: () => t("tabAudio") },
  video: { icon: "video", name: () => t("tabVideo") },
  presets: { icon: "preset", name: () => t("presets") },
  extras: { icon: "extras", name: () => t("tabExtras") },
  mixer: { icon: "mixer", name: () => t("tabMixer") },
  customize: { icon: "tune", name: () => t("tabCustomize") },
};

// How a card shows its sliders (dial.js): the list of sliders, knobs, faders or tiles.
const VIEWS = ["list", "knobs", "faders", "tiles"];
const VIEW_STYLE = { knobs: "knob", faders: "fader", tiles: "tile" };
const hasDials = (m) => m.items.some((i) => i.control);

const modulesFor = (surface) => MODULES.filter((m) => surface === "sidebar" || !m.sidebar);

function defaultLayout(surface) {
  const sidebar = surface === "sidebar";
  const pages = [
    ["playback", ["speed", "sync"]],
    ["audio", ["analyzer", "level", "equalizer", "sound", "separation", "room"]],
    ["video", ["color", "effects", "colorVision", "geometry", "ambilight"]],
    ["presets", ["presets"]],
    // the sidebar's timeline has the transport buttons
    ["extras", [...(sidebar ? [] : ["transport"]), "abLoop", "sleep", "screenshot", "defaults", "site", "shortcuts"]],
    ...(sidebar ? [["mixer", ["mixer"]], ["customize", ["limits", "jumps", "steps"]]] : []),
  ];
  return {
    pages: pages.map(([id, modules]) => ({ id, name: null, modules })),
    start: sidebar ? ["speed", "level", "equalizer", "color"] : ["speed", "level", "equalizer"],
    collapsed: [],
    // Start is the overview: compact knobs and faders. Speed keeps its precise slider.
    views: {
      "start/level": "knobs",
      "start/equalizer": "faders",
      "start/color": "knobs",
      "audio/equalizer": "faders",
      "audio/room": "knobs",
      "video/color": "knobs",
      "video/effects": "knobs",
      "video/ambilight": "tiles",
    },
    hidden: {},
    order: {},
    known: modulesFor(surface).map((m) => m.id),
  };
}

const uniqueOf = (list, ok) => [...new Set(Array.isArray(list) ? list.filter(ok) : [])];

// Stored layouts can be old (modules added since), hand-edited or damaged.
function sanitizeLayout(raw, surface) {
  const available = new Map(modulesFor(surface).map((m) => [m.id, m]));
  const fallback = defaultLayout(surface);
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.pages)) return fallback;

  const placed = new Set();
  const ids = new Set();
  const pages = [];
  for (const p of raw.pages) {
    if (pages.length >= MAX_PAGES) break;
    if (!p || typeof p.id !== "string" || !PAGE_ID.test(p.id) || p.id === START || ids.has(p.id)) continue;
    ids.add(p.id);
    const name = typeof p.name === "string" && p.name.trim() ? p.name.trim().slice(0, PAGE_NAME_MAX) : null;
    const modules = uniqueOf(p.modules, (id) => available.has(id) && !placed.has(id));
    modules.forEach((id) => placed.add(id));
    pages.push({ id: p.id, name, modules });
  }

  const hidden = {};
  const order = {};
  for (const m of available.values()) {
    const items = new Set(m.items.map((i) => i.id));
    const off = uniqueOf(raw.hidden?.[m.id], (id) => items.has(id));
    if (off.length) hidden[m.id] = off;
    const sorted = uniqueOf(raw.order?.[m.id], (id) => items.has(id));
    if (sorted.length) order[m.id] = [...sorted, ...m.items.map((i) => i.id).filter((id) => !sorted.includes(id))];
  }

  // Modules that are new since this layout was saved go to their default page.
  const known = new Set(Array.isArray(raw.known) ? raw.known : []);
  for (const id of available.keys()) {
    if (known.has(id) || placed.has(id)) continue;
    const home = fallback.pages.find((p) => p.modules.includes(id));
    const target = home && (pages.find((p) => p.id === home.id) ?? pages[0]);
    if (target) {
      target.modules.push(id);
      placed.add(id);
    }
  }

  return {
    pages,
    start: uniqueOf(raw.start, (id) => available.has(id)),
    collapsed: uniqueOf(raw.collapsed, (k) => typeof k === "string" && k.length <= 60).slice(0, 200),
    views: Object.fromEntries(
      Object.entries(raw.views && typeof raw.views === "object" ? raw.views : {})
        .filter(([k, v]) => k.length <= 60 && VIEWS.includes(v) && v !== "list")
        .slice(0, 200)
    ),
    hidden,
    order,
    known: [...available.keys()],
  };
}

// ---------- Changes (each returns a new layout) ----------

function pageOf(l, moduleId) {
  return l.pages.find((p) => p.modules.includes(moduleId)) ?? null;
}

function modulesOn(l, pageId) {
  return pageId === START ? l.start : (l.pages.find((p) => p.id === pageId)?.modules ?? []);
}

// Puts a module on a page (at index, default: the end). On Start it is pinned and stays
// on its own page; anywhere else it leaves the page it was on.
function placeModule(l, moduleId, pageId, index = Infinity) {
  const n = structuredClone(l);
  if (pageId === START) {
    n.start = n.start.filter((id) => id !== moduleId);
    n.start.splice(Math.min(index, n.start.length), 0, moduleId);
    return n;
  }
  const page = n.pages.find((p) => p.id === pageId);
  if (!page) return l;
  // The card keeps its view and folding on the new page.
  const from = pageOf(n, moduleId);
  if (from && from.id !== pageId) {
    const [oldKey, newKey] = [`${from.id}/${moduleId}`, `${pageId}/${moduleId}`];
    if (n.views[oldKey]) n.views[newKey] = n.views[oldKey];
    delete n.views[oldKey];
    n.collapsed = n.collapsed.map((k) => (k === oldKey ? newKey : k));
  }
  for (const p of n.pages) p.modules = p.modules.filter((id) => id !== moduleId);
  page.modules.splice(Math.min(index, page.modules.length), 0, moduleId);
  return n;
}

function removeModule(l, pageId, moduleId) {
  const n = structuredClone(l);
  if (pageId === START) n.start = n.start.filter((id) => id !== moduleId);
  else for (const p of n.pages) if (p.id === pageId) p.modules = p.modules.filter((id) => id !== moduleId);
  return n;
}

// The new order of a page's modules; ids that aren't on the page are ignored.
function setModuleOrder(l, pageId, ids) {
  const n = structuredClone(l);
  const now = modulesOn(n, pageId);
  const next = [...ids.filter((id) => now.includes(id)), ...now.filter((id) => !ids.includes(id))];
  if (pageId === START) n.start = next;
  else n.pages.find((p) => p.id === pageId).modules = next;
  return n;
}

function itemOrder(l, m) {
  return l.order[m.id] ?? m.items.map((i) => i.id);
}

function setItemOrder(l, moduleId, ids) {
  const n = structuredClone(l);
  n.order[moduleId] = ids;
  return n;
}

function toggleItem(l, moduleId, itemId) {
  const n = structuredClone(l);
  const off = new Set(n.hidden[moduleId] ?? []);
  if (off.has(itemId)) off.delete(itemId);
  else off.add(itemId);
  n.hidden[moduleId] = [...off];
  return n;
}

function viewOf(l, pageId, m) {
  return hasDials(m) ? (l.views[`${pageId}/${m.id}`] ?? "list") : "list";
}

function setView(l, key, view) {
  const n = structuredClone(l);
  if (view === "list") delete n.views[key];
  else n.views[key] = view;
  return n;
}

function toggleCollapsed(l, key) {
  const n = structuredClone(l);
  n.collapsed = n.collapsed.includes(key) ? n.collapsed.filter((k) => k !== key) : [...n.collapsed, key];
  return n;
}

function addPage(l, name) {
  if (l.pages.length >= MAX_PAGES) return [l, null];
  const n = structuredClone(l);
  let id;
  do id = `p${Math.random().toString(36).slice(2, 8)}`;
  while (n.pages.some((p) => p.id === id));
  n.pages.push({ id, name: name.slice(0, PAGE_NAME_MAX), modules: [] });
  return [n, id];
}

function renamePage(l, pageId, name) {
  const n = structuredClone(l);
  const page = n.pages.find((p) => p.id === pageId);
  if (page) page.name = name.trim().slice(0, PAGE_NAME_MAX) || null;
  return n;
}

function movePage(l, pageId, dir) {
  const n = structuredClone(l);
  const i = n.pages.findIndex((p) => p.id === pageId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= n.pages.length) return l;
  [n.pages[i], n.pages[j]] = [n.pages[j], n.pages[i]];
  return n;
}

// Its modules aren't lost: "Add module" offers them again.
function deletePage(l, pageId) {
  const n = structuredClone(l);
  n.pages = n.pages.filter((p) => p.id !== pageId);
  n.collapsed = n.collapsed.filter((k) => !k.startsWith(`${pageId}/`));
  for (const k of Object.keys(n.views)) if (k.startsWith(`${pageId}/`)) delete n.views[k];
  return n;
}

// ---------- State ----------

let layout = defaultLayout(SURFACE);
let editing = false;
let tabFreeOnly = false; // the site is disabled: only modules that don't need the tab
let noAccess = false; // no access to the tab: its modules are shown, but switched off
let currentPage = null;
let addOpenOn = null; // the page whose "Add module" list stays open across a re-render
// The page shown last, per surface: popup and sidebar have different pages.
const LAST_PAGE_KEY = IN_SIDEBAR ? "lastPageSidebar" : "lastTab";

async function loadLayout() {
  const stored = (await browser.storage.local.get(LAYOUT_KEY))[LAYOUT_KEY];
  layout = sanitizeLayout(stored?.[SURFACE], SURFACE);
}

async function saveLayout(next) {
  layout = sanitizeLayout(next, SURFACE);
  const stored = (await browser.storage.local.get(LAYOUT_KEY).catch(() => ({})))[LAYOUT_KEY];
  const other = stored && typeof stored === "object" ? stored : {};
  await browser.storage.local.set({ [LAYOUT_KEY]: { ...other, [SURFACE]: layout } }).catch(() => {});
}

// Saves and redraws; focusKey (data-focus) gets the keyboard focus back afterwards.
function commitLayout(next, focusKey = null) {
  saveLayout(next);
  layout = sanitizeLayout(next, SURFACE);
  renderLayout(focusKey);
}

const pageName = (p) => p.name ?? PAGE_INFO[p.id]?.name() ?? t("newPage");
const pageIcon = (p) => PAGE_INFO[p.id]?.icon ?? "grid";

function visiblePages() {
  const pages = [{ id: START, name: null, modules: layout.start }, ...layout.pages];
  if (!tabFreeOnly) return pages;
  return pages
    .map((p) => ({ ...p, modules: p.modules.filter((id) => MODULE_BY_ID.get(id).tabFree) }))
    .filter((p) => p.modules.length);
}

// Whether a module's node is on screen: polling (spectrum, mixer, tools) only runs then.
function isShown(node) {
  return node.isConnected && !document.hidden && Boolean(node.closest(".page.active")) && !node.closest(".module.collapsed");
}

// ---------- Rendering ----------

function renderLayout(focusKey = null) {
  updaters = fixedUpdaters.slice();
  const nav = $("tabs");
  const main = $("panels");
  nav.replaceChildren();
  main.replaceChildren();
  document.body.classList.toggle("editing", editing);
  showEditButton();

  const pages = visiblePages();
  if (!pages.some((p) => p.id === currentPage)) {
    let last = null;
    try {
      last = localStorage.getItem(LAST_PAGE_KEY);
    } catch {}
    currentPage = pages.some((p) => p.id === last) ? last : (pages[0]?.id ?? null);
  }

  for (const page of pages) {
    const tab = el("button", { type: "button", role: "tab", title: pageName(page) }, icon(pageIcon(page)), el("span", { textContent: pageName(page) }));
    const panel = el("section", { className: "panel page", role: "tabpanel" });
    tab.dataset.section = panel.dataset.section = page.id;
    tab.addEventListener("click", () => selectPage(page.id));

    if (editing) panel.append(renderPageTools(page, pages));
    const cards = el("div", { className: "cards" });
    for (const id of page.modules) cards.append(renderCard(page, MODULE_BY_ID.get(id), cards));
    if (!page.modules.length) {
      cards.append(el("div", { className: "page-empty", textContent: t(page.id === START ? "startEmpty" : "pageEmpty") }));
    }
    panel.append(cards);
    if (editing) panel.append(renderAddModule(page));
    nav.append(tab);
    main.append(panel);
  }

  if (editing && layout.pages.length < MAX_PAGES) {
    const add = labelled(el("button", { type: "button", className: "nav-add", title: t("addPage") }, icon("plus")), t("addPage"));
    add.addEventListener("click", () => {
      const [next, id] = addPage(layout, t("newPage"));
      currentPage = id;
      commitLayout(next, `page-name:${id}`);
    });
    nav.append(add);
  }

  selectPage(currentPage);
  applyAccess();
  refresh();
  if (focusKey) document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
}

function selectPage(id) {
  currentPage = id;
  for (const b of $("tabs").querySelectorAll("button[role=tab]")) b.setAttribute("aria-selected", String(b.dataset.section === id));
  for (const p of $("panels").querySelectorAll(".page")) p.classList.toggle("active", p.dataset.section === id);
  try {
    localStorage.setItem(LAST_PAGE_KEY, id);
  } catch {}
}

// Without access to the tab, its modules stay visible but can't be used.
function applyAccess() {
  if (!noAccess) return;
  for (const n of document.querySelectorAll(".module:not(.tab-free) .module-body :is(input, button, select)")) n.disabled = true;
  for (const d of document.querySelectorAll(".module:not(.tab-free) .dial")) {
    d.classList.add("disabled");
    d.querySelector(".dial-ctrl").tabIndex = -1;
  }
}

// el() assigns properties, so ARIA attributes are set here.
function labelled(node, label) {
  node.setAttribute("aria-label", label);
  return node;
}

function cardButton(iconName, title, onClick) {
  const b = labelled(el("button", { type: "button", className: "card-btn", title }, icon(iconName)), title);
  b.addEventListener("click", onClick);
  return b;
}

function renderCard(page, m, list) {
  const key = `${page.id}/${m.id}`;
  const collapsed = layout.collapsed.includes(key) && !editing;
  const card = el("section", { className: "module" });
  card.dataset.key = card.dataset.module = m.id;
  card.classList.toggle("collapsed", collapsed);
  card.classList.toggle("tab-free", Boolean(m.tabFree));

  const head = el("div", { className: "module-head" });
  const body = el("div", { className: "module-body" });
  const chevron = icon("chevron");
  chevron.classList.add("chevron");
  const title = el(
    "button",
    { type: "button", className: "module-title", title: t(collapsed ? "expand" : "collapse") },
    icon(m.icon),
    el("span", { textContent: m.title }),
    chevron
  );
  title.setAttribute("aria-expanded", String(!collapsed));

  if (editing) {
    const grip = labelled(el("button", { type: "button", className: "card-btn grip", title: t("dragHint") }, icon("grip")), `${m.title}: ${t("dragHint")}`);
    grip.dataset.focus = `card:${key}`;
    sortable(grip, card, {
      list,
      onCommit: (ids, focus) => commitLayout(setModuleOrder(layout, page.id, ids), focus),
      targets: () =>
        [...$("tabs").querySelectorAll("button[role=tab]")]
          .filter((tab) => tab.dataset.section !== page.id)
          .map((tab) => ({ el: tab, drop: () => commitLayout(placeModule(layout, m.id, tab.dataset.section)) })),
    });
    head.append(grip, title);
    if (page.id !== START && layout.pages.length > 1) head.append(renderMoveSelect(page, m));
    head.append(cardButton("close", t(page.id === START ? "unpin" : "removeModule"), () => commitLayout(removeModule(layout, page.id, m.id))));
  } else {
    title.addEventListener("click", () => {
      const now = !card.classList.contains("collapsed");
      card.classList.toggle("collapsed", now);
      title.setAttribute("aria-expanded", String(!now));
      title.title = t(now ? "expand" : "collapse");
      saveLayout(toggleCollapsed(layout, key));
      if (!now) refresh();
    });
    const pinned = layout.start.includes(m.id);
    const pin = cardButton(pinned ? "starFilled" : "star", t(pinned ? "unpin" : "pin"), () =>
      commitLayout(pinned ? removeModule(layout, START, m.id) : placeModule(layout, m.id, START))
    );
    pin.classList.add("pin");
    pin.setAttribute("aria-pressed", String(pinned));
    head.append(title, pin);
  }

  // Items: inline ones (chips) share a row with their neighbours. While editing, each
  // item is a row of its own with a grip and an eye, and its controls are inert.
  const renderers = buildModule(m);
  const off = new Set(layout.hidden[m.id] ?? []);
  const view = viewOf(layout, page.id, m);
  card.dataset.view = view;
  if (editing && hasDials(m)) body.append(renderViewSwitch(key, view));
  let row = null;
  let dials = null; // the grid of knobs, faders or tiles that slider items join
  for (const id of itemOrder(layout, m)) {
    const item = m.items.find((i) => i.id === id);
    if (!item || (off.has(id) && !editing)) continue;
    const asDial = !editing && item.control && view !== "list";
    const content = asDial ? [] : (renderers[id]?.() ?? []);
    const wrap = el("div", { className: `mod-item ${item.kind}` });
    wrap.dataset.key = wrap.dataset.item = id;
    if (editing) {
      wrap.classList.toggle("off", off.has(id));
      wrap.append(renderItemTools(m, item, off.has(id), wrap, body), el("div", { className: "mod-item-content", inert: true }, ...content));
      body.append(wrap);
    } else if (item.control && view !== "list") {
      wrap.append(renderDial(item.control, VIEW_STYLE[view]));
      if (!dials) body.append((dials = el("div", { className: `dial-grid ${view}` })));
      dials.append(wrap);
      row = null;
    } else if (item.kind === "inline") {
      wrap.append(...content);
      if (!row) body.append((row = el("div", { className: "toggles mod-row" })));
      row.append(wrap);
      dials = null;
    } else {
      wrap.append(...content);
      body.append(wrap);
      row = dials = null;
    }
  }
  if (!editing && !body.children.length) body.append(el("div", { className: "hint", textContent: t("moduleEmpty") }));
  body.append(el("div", { className: "hint card-msg", hidden: true }));
  card.append(head, body);
  return card;
}

function renderViewSwitch(key, view) {
  const box = el("div", { className: "toggles segmented view-switch", role: "group" });
  box.setAttribute("aria-label", t("viewTitle"));
  for (const v of VIEWS) {
    const b = el("button", { type: "button", className: "chip", textContent: t(`view_${v}`) });
    b.setAttribute("aria-pressed", String(v === view));
    b.dataset.focus = `view:${key}:${v}`;
    b.addEventListener("click", () => commitLayout(setView(layout, key, v), b.dataset.focus));
    box.append(b);
  }
  return el("div", { className: "view-row" }, el("span", { className: "hint", textContent: t("viewTitle") }), box);
}

function renderItemTools(m, item, hidden, wrap, list) {
  const grip = labelled(el("button", { type: "button", className: "card-btn grip", title: t("dragHint") }, icon("grip")), `${item.label}: ${t("dragHint")}`);
  grip.dataset.focus = `item:${m.id}/${item.id}`;
  sortable(grip, wrap, { list, onCommit: (ids, focus) => commitLayout(setItemOrder(layout, m.id, ids), focus) });
  const eye = cardButton(hidden ? "eyeOff" : "eye", t(hidden ? "showItem" : "hideItem", item.label), () =>
    commitLayout(toggleItem(layout, m.id, item.id), `eye:${m.id}/${item.id}`)
  );
  eye.dataset.focus = `eye:${m.id}/${item.id}`;
  eye.setAttribute("aria-pressed", String(!hidden));
  return el("div", { className: "item-tools" }, grip, eye);
}

function renderMoveSelect(page, m) {
  const select = el("select", { className: "move-select", title: t("moveTo") });
  for (const p of layout.pages) select.append(el("option", { value: p.id, textContent: pageName(p), selected: p.id === page.id }));
  select.addEventListener("change", () => commitLayout(placeModule(layout, m.id, select.value)));
  return select;
}

function renderPageTools(page, pages) {
  const box = el("div", { className: "page-tools" });
  box.append(el("div", { className: "hint", textContent: t("editHint") }));
  if (page.id !== START) {
    const i = layout.pages.findIndex((p) => p.id === page.id);
    const name = labelled(el("input", { type: "text", value: pageName(page), maxLength: PAGE_NAME_MAX, placeholder: t("pageName") }), t("pageName"));
    name.dataset.focus = `page-name:${page.id}`;
    name.addEventListener("change", () => commitLayout(renamePage(layout, page.id, name.value)));
    name.addEventListener("keydown", (e) => {
      if (e.key === "Enter") name.blur();
    });
    const left = cardButton("arrowLeft", t("movePageLeft"), () => commitLayout(movePage(layout, page.id, -1), `page-left:${page.id}`));
    const right = cardButton("arrowRight", t("movePageRight"), () => commitLayout(movePage(layout, page.id, 1), `page-right:${page.id}`));
    left.dataset.focus = `page-left:${page.id}`;
    right.dataset.focus = `page-right:${page.id}`;
    left.disabled = i === 0;
    right.disabled = i === layout.pages.length - 1;
    const del = cardButton("trash", t("deletePage"), () => {
      const index = pages.findIndex((p) => p.id === page.id);
      currentPage = pages[index - 1]?.id ?? START;
      commitLayout(deletePage(layout, page.id));
    });
    del.classList.add("danger");
    box.append(el("div", { className: "page-name-row" }, name, left, right, del));
  }
  const reset = el("button", { type: "button", className: "chip" }, icon("reset"), t("resetLayout"));
  reset.addEventListener("click", () => {
    currentPage = null;
    commitLayout(defaultLayout(SURFACE));
  });
  box.append(el("div", { className: "toggles" }, reset));
  return box;
}

// Every module that isn't on this page; a click puts it here (on Start: pins it).
function renderAddModule(page) {
  const here = new Set(modulesOn(layout, page.id));
  const options = modulesFor(SURFACE).filter((m) => !here.has(m.id));
  const details = el("details", { className: "add-module", open: addOpenOn === page.id });
  details.addEventListener("toggle", () => (addOpenOn = details.open ? page.id : null));
  const list = el("div", { className: "add-list" });
  for (const m of options) {
    const from = pageOf(layout, m.id);
    const where = page.id === START || !from ? (from ? pageName(from) : t("notPlaced")) : t("moveFrom", pageName(from));
    const b = el("button", { type: "button", className: "add-item" }, icon(m.icon), el("span", { textContent: m.title }), el("small", { textContent: where }));
    b.addEventListener("click", () => {
      addOpenOn = page.id;
      commitLayout(placeModule(layout, m.id, page.id));
    });
    list.append(b);
  }
  if (!options.length) list.append(el("div", { className: "hint", textContent: t("allModulesHere") }));
  details.append(el("summary", {}, icon("plus"), el("span", { textContent: t("addModule") })), list);
  return details;
}

function showEditButton() {
  const b = $("editLayout");
  b.hidden = tabFreeOnly;
  b.classList.toggle("active", editing);
  b.replaceChildren(icon(editing ? "check" : "edit"));
  b.title = t(editing ? "editDone" : "editLayout");
  labelled(b, b.title).setAttribute("aria-pressed", String(editing));
}

// Called once by popup.js (not on load, so the tests can load this file without a page).
function initLayoutUi() {
  const b = $("editLayout");
  b.dataset.focus = "edit-layout";
  b.addEventListener("click", () => {
    editing = !editing;
    addOpenOn = null;
    renderLayout("edit-layout");
  });
}

// ---------- Dragging ----------

// Lets the grip drag `node` within `list` (pointer), or step it with the arrow keys.
// Dropping on one of targets() (a page tab) calls its drop() instead of reordering.
function sortable(grip, node, { list, onCommit, targets = () => [] }) {
  const keys = () => [...list.children].filter((c) => c.dataset.key).map((c) => c.dataset.key);

  grip.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // Listening on window: moving the node in the DOM would end a pointer capture.
    const before = keys().join();
    const style = getComputedStyle(list);
    const columns = style.display === "grid" && style.gridTemplateColumns.split(" ").length > 1;
    let target = null;
    node.classList.add("dragging");

    const move = (ev) => {
      target = null;
      for (const tg of targets()) {
        const r = tg.el.getBoundingClientRect();
        const hit = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
        tg.el.classList.toggle("drop-target", hit);
        if (hit) target = tg;
      }
      // Over a tab (the bar is at the bottom): hold still instead of scrolling.
      if (target) return;
      if (ev.clientY < 30) scrollBy(0, -12);
      else if (ev.clientY > innerHeight - 30) scrollBy(0, 12);
      // The nearest sibling decides; the node goes before or after it by its middle.
      let best = null;
      let bestDist = Infinity;
      for (const other of list.children) {
        if (other === node || !other.dataset.key) continue;
        const r = other.getBoundingClientRect();
        const dx = ev.clientX - AVFX.clamp(ev.clientX, r.left, r.right);
        const dy = ev.clientY - AVFX.clamp(ev.clientY, r.top, r.bottom);
        if (dx * dx + dy * dy < bestDist) [best, bestDist] = [{ other, r }, dx * dx + dy * dy];
      }
      if (!best) return;
      const { other, r } = best;
      const first = columns ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2;
      if (first && other.previousElementSibling !== node) other.before(node);
      else if (!first && other.nextElementSibling !== node) other.after(node);
    };
    const end = () => {
      removeEventListener("pointermove", move);
      removeEventListener("pointerup", end);
      removeEventListener("pointercancel", end);
      node.classList.remove("dragging");
      for (const tg of targets()) tg.el.classList.remove("drop-target");
      if (target) return target.drop();
      const after = keys();
      if (after.join() !== before) onCommit(after, null);
    };
    addEventListener("pointermove", move);
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);
  });

  grip.addEventListener("keydown", (e) => {
    const dir = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
    if (!dir) return;
    e.preventDefault();
    const order = keys();
    const i = order.indexOf(node.dataset.key);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onCommit(order, grip.dataset.focus);
  });
}
