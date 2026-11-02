const { DEFAULTS } = AVFX;

// Groups hold "controls" (sliders), "toggles" (chips), a "choice" (chip group)
// or a "custom" renderer from spectrum.js / presets.js / tools.js.
const SECTIONS = [
  {
    id: "playback",
    icon: "playback",
    title: t("tabPlayback"),
    groups: [
      {
        controls: [{ key: "speed", icon: "speed", label: t("speed"), ...AVFX.SPEED, unit: "×" }],
      },
      { choice: { key: "speed", options: [0.5, 0.75, 1, 1.25, 1.5, 2, 3], unit: "×" } },
      {
        controls: [
          {
            key: "audioDelay",
            icon: "delay",
            label: t("audioDelay"),
            min: AVFX.MIN_DELAY_MS,
            max: AVFX.MAX_DELAY_MS,
            step: 5,
            unit: "ms",
            hint: t("audioDelayHint"),
          },
        ],
      },
      {
        toggles: [
          { key: "preservePitch", icon: "pitch", label: t("preservePitch") },
          { key: "skipSilence", icon: "skipSilence", label: t("skipSilence"), hint: t("skipSilenceHint") },
        ],
      },
    ],
  },
  {
    id: "audio",
    icon: "audio",
    title: t("tabAudio"),
    groups: [
      { title: t("analyzer"), icon: "spectrum", custom: renderSpectrum },
      {
        controls: [
          { key: "volume", icon: "volume", label: t("volume"), min: 0, max: 400, step: 1, unit: "%" },
          { key: "pan", icon: "pan", label: t("balance"), min: -100, max: 100, step: 1, unit: "" },
          { key: "width", icon: "width", label: t("stereoWidth"), min: 0, max: 200, step: 1, unit: "%", hint: t("stereoWidthHint") },
        ],
      },
      {
        title: t("equalizer"), icon: "equalizer",
        controls: [
          { key: "bass", icon: "bass", label: t("bass"), min: -15, max: 15, step: 0.5, unit: "dB" },
          { key: "mid", icon: "mid", label: t("mids"), min: -15, max: 15, step: 0.5, unit: "dB" },
          { key: "treble", icon: "treble", label: t("treble"), min: -15, max: 15, step: 0.5, unit: "dB" },
        ],
      },
      {
        toggles: [
          { key: "mono", icon: "mono", label: t("mono") },
          { key: "swap", icon: "swap", label: t("swapChannels") },
          { key: "voice", icon: "voice", label: t("enhanceVoice") },
          { key: "compressor", icon: "compressor", label: t("compressor") },
          { key: "limiter", icon: "limiter", label: t("limiter") },
          { key: "autoGain", icon: "autoGain", label: t("autoGain") },
        ],
      },
      {
        title: t("separation"), icon: "voice",
        controls: [
          { key: "dialog", icon: "dialog", label: t("dialog"), min: -100, max: 100, step: 1, unit: "", hint: t("dialogHint") },
        ],
      },
      {
        title: t("room"), icon: "reverb",
        controls: [{ key: "reverb", icon: "reverb", label: t("reverb"), min: 0, max: 100, step: 1, unit: "%" }],
      },
    ],
  },
  {
    id: "video",
    icon: "video",
    title: t("tabVideo"),
    groups: [
      {
        title: t("color"), icon: "color",
        controls: [
          { key: "brightness", icon: "brightness", label: t("brightness"), min: 0, max: 300, step: 1, unit: "%" },
          { key: "contrast", icon: "contrast", label: t("contrast"), min: 0, max: 300, step: 1, unit: "%" },
          { key: "saturate", icon: "saturate", label: t("saturation"), min: 0, max: 300, step: 1, unit: "%" },
          { key: "hue", icon: "hue", label: t("hue"), min: 0, max: 360, step: 1, unit: "°" },
          { key: "gamma", icon: "gamma", label: t("gamma"), min: 0.2, max: 3, step: 0.05, unit: "" },
          {
            key: "temperature",
            icon: "temperature",
            label: t("temperature"),
            min: -100,
            max: 100,
            step: 1,
            unit: "",
            hint: t("temperatureHint"),
          },
        ],
      },
      {
        title: t("effects"), icon: "effects",
        controls: [
          { key: "sharpen", icon: "sharpen", label: t("sharpness"), min: 0, max: 100, step: 1, unit: "%" },
          { key: "blur", icon: "blur", label: t("blur"), min: 0, max: 10, step: 0.1, unit: "px" },
          { key: "grayscale", icon: "grayscale", label: t("grayscale"), min: 0, max: 100, step: 1, unit: "%" },
          { key: "sepia", icon: "sepia", label: t("sepia"), min: 0, max: 100, step: 1, unit: "%" },
          { key: "invert", icon: "invert", label: t("invert"), min: 0, max: 100, step: 1, unit: "%" },
        ],
      },
      {
        choice: {
          key: "colorVision",
          icon: "eye",
          label: t("colorVision"),
          options: AVFX.COLOR_VISION,
          format: (o) => t(`cvd_${o}`),
          hint: t("colorVisionHint"),
        },
      },
      {
        title: t("geometry"), icon: "geometry",
        controls: [
          { key: "zoom", icon: "zoom", label: t("zoom"), min: 50, max: 300, step: 1, unit: "%" },
          { key: "offsetX", icon: "moveX", label: t("offsetX"), min: -50, max: 50, step: 1, unit: "%" },
          { key: "offsetY", icon: "moveY", label: t("offsetY"), min: -50, max: 50, step: 1, unit: "%", hint: t("offsetHint") },
        ],
      },
      {
        toggles: [
          { key: "flipH", icon: "flipH", label: t("flipH") },
          { key: "flipV", icon: "flipV", label: t("flipV") },
        ],
      },
      { choice: { key: "rotate", icon: "rotate", label: t("rotate"), options: [0, 90, 180, 270], unit: "°" } },
      {
        title: t("ambilight"), icon: "ambilight",
        controls: [
          { key: "ambilight", icon: "ambilight", label: t("ambilightStrength"), min: 0, max: 100, step: 1, unit: "%", hint: t("ambilightHint") },
        ],
      },
    ],
  },
  {
    id: "extras",
    icon: "extras",
    title: t("tabExtras"),
    groups: [
      { title: t("presets"), icon: "preset", custom: renderPresets },
      { title: t("tools"), icon: "tools", custom: renderTools },
      { title: t("defaultSettings"), icon: "globe", custom: renderDefaults },
      { title: t("siteTitle"), icon: "power", custom: renderSiteSwitch },
      { title: t("shortcuts"), icon: "keyboard", custom: renderShortcuts },
    ],
  },
];

if (IN_SIDEBAR) {
  SECTIONS.push(
    { id: "mixer", icon: "mixer", title: t("tabMixer"), groups: [{ custom: renderMixer }] },
    { id: "customize", icon: "tune", title: t("tabCustomize"), groups: [{ custom: renderCustomize }] }
  );
}

let tabId = null;
let host = null;
let tabLoading = false; // the tab was still loading when the panel opened
let panelReady = false; // init() is done (tabId null then means "no access")
let settings = { ...DEFAULTS };
const updaters = []; // refresh functions for every control
let activeSection = null;


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
  const wrap = el("div", { className: "toggles" });
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

function render() {
  const tabs = $("tabs");
  const panels = $("panels");

  SECTIONS.forEach((section, i) => {
    const tab = el("button", { type: "button", role: "tab", title: section.title }, icon(section.icon), el("span", { textContent: section.title }));
    const panel = el("section", { className: "panel", role: "tabpanel" });

    for (const g of section.groups) {
      if (g.title) panel.append(el("div", { className: "group-title" }, icon(g.icon), g.title));
      if (g.controls) g.controls.forEach((c) => panel.append(renderRange(c)));
      if (g.toggles) panel.append(el("div", { className: "toggles" }, ...g.toggles.map(renderToggle)));
      if (g.choice) panel.append(...renderChoice(g.choice));
      if (g.custom) panel.append(...g.custom());
    }

    const select = () => {
      tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", "false"));
      panels.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.setAttribute("aria-selected", "true");
      panel.classList.add("active");
      activeSection = section.id;
      try {
        localStorage.setItem("lastTab", section.id);
      } catch {}
    };
    tab.addEventListener("click", select);
    tabs.append(tab);
    panels.append(panel);

    let last = null;
    try {
      last = localStorage.getItem("lastTab");
    } catch {}
    if (last ? last === section.id : i === 0) select();
  });

  updaters.push(() => {
    $("enabled").checked = settings.enabled;
    document.body.classList.toggle("bypassed", !settings.enabled);
  });
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
      browser.storage.local.set({ [AVFX.siteKey(host)]: settings });
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
  $("rememberFor").replaceChildren(before, el("b", { textContent: text }), after);
}

async function init() {
  if (IN_SIDEBAR) await loadUi().catch(() => {});
  localizePage();
  if (IN_SIDEBAR) {
    $("timeline").append(...renderTimeline());
    $("timeline").hidden = false;
  }
  render();

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
    document.querySelectorAll("main input, main button, header input").forEach((i) => (i.disabled = true));
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
  const list = (await browser.storage.local.get(key))[key] ?? [];
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

function renderSiteSwitch() {
  const off = el("button", { type: "button", className: "chip" }, icon("power"), t("disableHere"));
  off.addEventListener("click", () => setSiteDisabled(true));
  off.disabled = !host;
  return [el("div", { className: "hint", textContent: t("disableHereHint") }), el("div", { className: "toggles" }, off)];
}

function showDisabled() {
  setStatus(t("disabledHere"), true);
  const on = el("button", { type: "button", className: "chip" }, icon("power"), t("enableHere"));
  on.addEventListener("click", () => setSiteDisabled(false));
  $("tabs").hidden = true;
  $("timeline").hidden = true;
  $("panels").replaceChildren(el("section", { className: "panel active" }, el("div", { className: "toggles" }, on)));
  document.querySelector(".switch").hidden = true;
  document.querySelector("footer").hidden = true;
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
  const key = AVFX.siteKey(host);
  if (e.target.checked) browser.storage.local.set({ [key]: settings });
  else browser.storage.local.remove(key);
});

init();
if (IN_SIDEBAR) followActiveTab();
