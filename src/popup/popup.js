const { DEFAULTS } = AVFX;

// The controls live in modules (modules.js), placed on pages by the layout (layout.js).

let tabId = null;
let host = null;
let tabLoading = false; // the tab was still loading when the panel opened
let panelReady = false; // init() is done (tabId null then means "no access")
let settings = { ...DEFAULTS };
// Refresh functions for every control. renderLayout() starts them over from
// fixedUpdaters (the timeline and header, which are rendered once).
let updaters = [];
let fixedUpdaters = [];


// ---------- Rendering ----------

function renderRange(c) {
  const range = el("input", { type: "range" });
  const num = el("input", { type: "number" });
  const reset = el("button", { type: "button", className: "reset", textContent: t("reset") });
  const name = el("span", { className: "name" }, icon(c.icon), c.label);
  const row = el(
    "div",
    { className: "row" },
    el("div", { className: "label" }, name, reset),
    range,
    el("div", { className: "num" }, num, el("span", { textContent: c.unit }))
  );
  row.dataset.key = c.key;
  // The sidebar steps with − / +; the compact popup shows hints as tooltips.
  if (IN_SIDEBAR) {
    const stepper = (dir, text) => {
      const b = el("button", {
        type: "button",
        className: `stepper ${dir > 0 ? "plus" : "minus"}`,
        textContent: text,
        title: t(dir > 0 ? "increase" : "decrease"),
      });
      b.addEventListener("click", () => update({ [c.key]: nudge(settings[c.key], dir, sliderSpec(c)) }));
      return b;
    };
    row.classList.add("stepped");
    range.before(stepper(-1, "−"));
    range.after(stepper(1, "+"));
    if (c.hint) row.append(el("div", { className: "hint", textContent: c.hint }));
  } else if (c.hint) {
    name.title = c.hint;
    name.classList.add("has-hint");
  }

  const set = (raw) => {
    const text = String(raw).trim().replace(",", ".");
    const v = Number(text);
    // An emptied field would be Number("") = 0, i.e. silence at volume 0.
    if (text === "" || Number.isNaN(v)) {
      refresh();
      return;
    }
    const { min, max } = sliderSpec(c);
    update({ [c.key]: AVFX.clamp(v, min, max) });
  };
  range.addEventListener("input", () => set(range.value));
  num.addEventListener("change", () => set(num.value));
  reset.addEventListener("click", () => update({ [c.key]: DEFAULTS[c.key] }));
  row.querySelector(".label").addEventListener("dblclick", () => update({ [c.key]: DEFAULTS[c.key] }));
  const syncSlider = enhanceSlider({
    row,
    range,
    control: c,
    get: () => settings[c.key],
    set: (v) => update({ [c.key]: v }),
    reset: () => update({ [c.key]: DEFAULTS[c.key] }),
  });

  updaters.push(() => {
    const spec = sliderSpec(c);
    Object.assign(range, { min: spec.rangeMin, max: spec.rangeMax, step: spec.step });
    Object.assign(num, { min: spec.min, max: spec.max, step: spec.step });
    const v = settings[c.key];
    range.value = v;
    syncSlider();
    if (document.activeElement !== num) num.value = v;
    row.classList.toggle("changed", v !== DEFAULTS[c.key]);
  });
  return row;
}

function renderToggle(toggle) {
  const chip = el("button", { type: "button", className: "chip" }, icon(toggle.icon), toggle.label);
  if (toggle.hint) chip.title = toggle.hint;
  chip.addEventListener("click", () => update({ [toggle.key]: !settings[toggle.key] }));
  updaters.push(() => chip.setAttribute("aria-pressed", String(settings[toggle.key])));
  return chip;
}

// Without a label the chips belong to the control above, e.g. quick speeds.
function renderChoice(ch) {
  // Short values (speeds, angles) line up as equal segments; named options stay chips.
  const wrap = el("div", { className: ch.format ? "toggles" : "toggles segmented" });
  for (const opt of ch.options) {
    const text = ch.format ? ch.format(opt) : `${AVFX.formatNumber(opt, 2)}${ch.unit}`;
    const chip = el("button", { type: "button", className: "chip", textContent: text });
    chip.addEventListener("click", () => update({ [ch.key]: opt }));
    updaters.push(() => chip.setAttribute("aria-pressed", String(settings[ch.key] === opt)));
    wrap.append(chip);
  }
  const nodes = [wrap];
  if (ch.hint && IN_SIDEBAR) nodes.push(el("div", { className: "hint", textContent: ch.hint }));
  else if (ch.hint) wrap.title = ch.hint;
  if (ch.label) nodes.unshift(el("div", { className: "group-title" }, icon(ch.icon), ch.label));
  return nodes;
}

function refresh() {
  updaters.forEach((fn) => fn());
}

// ---------- State ----------

let saveTimer = null;

function update(patch) {
  settings = { ...settings, ...patch };
  refresh();
  if (tabId !== null) {
    browser.tabs.sendMessage(tabId, { type: "set", settings }).catch(() => {});
  }
  if ($("siteSave").checked && host) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // unticked in the meantime: the site's entry was just removed and stays so
      if ($("siteSave").checked) browser.storage.local.set({ [AVFX.siteKey(host)]: settings });
    }, 250);
  }
}

// Presets reset all effects; built-in ones keep speed and A/V sync.
function applyPreset(values, { keepPlayback }) {
  const base = { ...DEFAULTS, enabled: true };
  if (keepPlayback) for (const k of AVFX.PLAYBACK_KEYS) base[k] = settings[k];
  update(AVFX.sanitize({ ...base, ...values }));
}

// Tools and the spectrum talk to the frame holding the most relevant media element.
let primaryCache = { at: -Infinity, frame: null };

function primaryFrame() {
  if (tabId === null) return Promise.resolve(null);
  if (performance.now() - primaryCache.at > 2000) {
    primaryCache = { at: performance.now(), frame: AVFX.findPrimaryFrame(tabId).catch(() => null) };
  }
  return primaryCache.frame;
}

async function sendToPrimary(msg) {
  const frame = await primaryFrame();
  if (!frame) return null;
  return browser.tabs.sendMessage(tabId, msg, AVFX.frameTarget(frame)).catch(() => null);
}

let baseStatus = "";

// Problems with the primary media element can appear later (e.g. a DRM stream
// starting after an unencrypted ad), so the status is re-checked while the popup is open.
async function watchMediaStatus() {
  const f = await primaryFrame();
  $("reloadResume").hidden = !f?.audioBlocked;
  if (f?.audioBlocked) {
    setStatus(t("statusAudioBlocked"), true);
  } else if (f?.drm && f.hasAudioChain) {
    setStatus(t("statusDrmSilent"), true);
  } else if (f?.drm) {
    setStatus(t("statusDrm"), true);
  } else {
    setStatus(baseStatus);
  }
  setTimeout(watchMediaStatus, 2000);
}

function setStatus(text, isError = false) {
  const s = $("status");
  s.textContent = text;
  s.classList.toggle("error", isError);
}

// "Remember for <b>host</b>": the host's position in the sentence depends on the language.
// A private-use character marks it: Chrome drops U+0000 from substitutions.
const HOST_MARKER = "\uE000";

function renderRememberFor(text) {
  const [before, after = ""] = t("rememberFor", HOST_MARKER).split(HOST_MARKER);
  $("rememberFor").replaceChildren(before, el("b", { textContent: text, title: text }), after);
}

async function init() {
  await Promise.all([IN_SIDEBAR ? loadUi() : null, loadLayout()]).catch(() => {});
  localizePage();
  if (IN_SIDEBAR) {
    $("timeline").append(...renderTimeline());
    $("timeline").hidden = false;
  }
  updaters.push(() => {
    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("bypassed", !settings.enabled);
  });
  fixedUpdaters = updaters.slice();
  initLayoutUi();
  renderLayout();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = tab?.url ? AVFX.hostOf(tab.url) : null;
  tabLoading = tab?.status === "loading";
  renderRememberFor(host || t("thisSite"));
  $("siteSave").disabled = !host;

  if (host) {
    const key = AVFX.siteKey(host);
    const stored = await browser.storage.local.get(key);
    $("siteSave").checked = Boolean(stored[key]);
  }

  try {
    const state = await AVFX.getTabState(tabId);
    if (state.disabled) {
      showDisabled();
      panelReady = true;
      return;
    }
    settings = AVFX.sanitize(state.settings);
    const n = state.mediaCount;
    baseStatus = n === 1 ? t("mediaFoundOne") : n > 1 ? t("mediaFoundMany", n) : t("ready");
    // The settings came from a rule (options page): say which.
    const { [AVFX.RULES_KEY]: rules } = await browser.storage.local.get(AVFX.RULES_KEY);
    const rule = tab?.url ? AVFX.findRule(AVFX.sanitizeRules(rules), tab.url) : null;
    if (rule) baseStatus += ` · ${t("ruleActive", rule.pattern)}`;
    setStatus(baseStatus);
    watchMediaStatus();
  } catch {
    tabId = null;
    setStatus(t("notAvailable"), true);
    noAccess = true;
    applyAccess();
    document.querySelectorAll("header input, #siteBar :is(input, button)").forEach((i) => (i.disabled = true));
  }
  panelReady = true;
  refresh();
}

// The sound of the primary media is held by an older Klangbild (after an update): only a
// reload frees it. The content script keeps the position and continues there.
async function reloadAndResume() {
  $("reloadResume").disabled = true;
  await sendToPrimary({ type: "action", action: "remember-position" });
  await browser.tabs.reload(tabId);
  if (!IN_SIDEBAR) window.close(); // the sidebar reloads itself when the tab has loaded
}

// ---------- Disabling for a site ----------

// The page is reloaded either way: Web Audio routing can't be undone in a running page.
async function setSiteDisabled(disabled) {
  const key = AVFX.DISABLED_KEY;
  const stored = (await browser.storage.local.get(key))[key];
  const list = Array.isArray(stored) ? stored : [];
  const next = disabled ? [...new Set([...list, host])] : list.filter((h) => h !== host);
  await browser.storage.local.set({ [key]: next });
  await browser.tabs.reload(tabId);
  if (!IN_SIDEBAR) window.close(); // the sidebar reloads itself when the tab has loaded
}

// Unlike the popup, the sidebar stays open: it starts over for the newly active tab,
// after a page load and when the site changes. The selected section is remembered.
async function followActiveTab() {
  const { id: windowId } = await browser.windows.getCurrent();
  const restart = () => location.reload();
  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId && info.tabId !== tabId) restart();
  });
  const needsRestart = navigationWatcher(() => host, tabLoading);
  browser.tabs.onUpdated.addListener((id, change) => {
    if (id === tabId && needsRestart(change)) restart();
  });
}

function buildSiteSwitch() {
  const off = el("button", { type: "button", className: "chip" }, icon("power"), t("disableHere"));
  off.addEventListener("click", () => setSiteDisabled(true));
  updaters.push(() => (off.disabled = !host));
  return { hint: () => [el("div", { className: "hint", textContent: t("disableHereHint") })], disable: () => [off] };
}

function showDisabled() {
  setStatus(t("disabledHere"), true);
  const on = el("button", { type: "button", className: "chip" }, icon("power"), t("enableHere"));
  on.addEventListener("click", () => setSiteDisabled(false));
  $("timeline").hidden = true;
  document.querySelector(".switch").hidden = true;
  $("siteBar").hidden = true;
  editing = false;
  if (!IN_SIDEBAR) {
    $("tabs").hidden = true;
    $("editLayout").hidden = true;
    $("panels").replaceChildren(el("section", { className: "panel page active" }, el("div", { className: "toggles" }, on)));
    return;
  }
  // The sidebar keeps the modules that don't depend on this site (mixer, its own settings).
  $("status").after(el("div", { className: "toggles" }, on));
  tabFreeOnly = true;
  renderLayout();
}

// Changes made with keyboard shortcuts while the popup is open.
AVFX.onMessage((msg) => {
  if (msg?.type === "settings-changed" && msg.tabId === tabId) {
    settings = AVFX.sanitize(msg.settings);
    refresh();
  }
  return undefined;
});

$("enabled").addEventListener("change", (e) => update({ enabled: e.target.checked }));

$("resetAll").prepend(icon("reset"));

$("resetAll").addEventListener("click", () => update({ ...DEFAULTS }));
$("reloadResume").addEventListener("click", reloadAndResume);

$("siteSave").addEventListener("change", (e) => {
  clearTimeout(saveTimer);
  const key = AVFX.siteKey(host);
  if (e.target.checked) browser.storage.local.set({ [key]: settings });
  else browser.storage.local.remove(key);
});

init();
if (IN_SIDEBAR) followActiveTab();
