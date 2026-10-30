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
        controls: [
          { key: "speed", icon: "speed", label: t("speed"), ...AVFX.SPEED, unit: "×" },
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
      { toggles: [{ key: "preservePitch", icon: "pitch", label: t("preservePitch") }] },
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
          { key: "voice", icon: "voice", label: t("enhanceVoice") },
          { key: "compressor", icon: "compressor", label: t("compressor") },
          { key: "limiter", icon: "limiter", label: t("limiter") },
        ],
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
        title: t("geometry"), icon: "geometry",
        controls: [{ key: "zoom", icon: "zoom", label: t("zoom"), min: 50, max: 300, step: 1, unit: "%" }],
      },
      {
        toggles: [
          { key: "flipH", icon: "flipH", label: t("flipH") },
          { key: "flipV", icon: "flipV", label: t("flipV") },
        ],
      },
      { choice: { key: "rotate", icon: "rotate", label: t("rotate"), options: [0, 90, 180, 270], unit: "°" } },
    ],
  },
  {
    id: "extras",
    icon: "extras",
    title: t("tabExtras"),
    groups: [
      { title: t("presets"), icon: "preset", custom: renderPresets },
      { title: t("tools"), icon: "tools", custom: renderTools },
      { title: t("shortcuts"), icon: "keyboard", custom: renderShortcuts },
    ],
  },
];

let tabId = null;
let host = null;
let settings = { ...DEFAULTS };
const updaters = []; // refresh functions for every control
let activeSection = null;


// ---------- Rendering ----------

function renderRange(c) {
  const range = el("input", { type: "range", min: c.min, max: c.max, step: c.step });
  const num = el("input", { type: "number", min: c.min, max: c.max, step: c.step });
  const reset = el("button", { type: "button", className: "reset", textContent: t("reset") });
  const row = el(
    "div",
    { className: "row" },
    el("div", { className: "label" }, el("span", { className: "name" }, icon(c.icon), c.label), reset),
    range,
    el("div", { className: "num" }, num, el("span", { textContent: c.unit }))
  );
  if (c.hint) row.append(el("div", { className: "hint", textContent: c.hint }));

  const set = (raw) => {
    const text = String(raw).trim().replace(",", ".");
    const v = Number(text);
    // An emptied field would be Number("") = 0, i.e. silence at volume 0.
    if (text === "" || Number.isNaN(v)) {
      refresh();
      return;
    }
    update({ [c.key]: AVFX.clamp(v, c.min, c.max) });
  };
  range.addEventListener("input", () => set(range.value));
  num.addEventListener("change", () => set(num.value));
  reset.addEventListener("click", () => update({ [c.key]: DEFAULTS[c.key] }));
  row.querySelector(".label").addEventListener("dblclick", () => update({ [c.key]: DEFAULTS[c.key] }));

  updaters.push(() => {
    const v = settings[c.key];
    range.value = v;
    if (document.activeElement !== num) num.value = v;
    row.classList.toggle("changed", v !== DEFAULTS[c.key]);
  });
  return row;
}

function renderToggle(toggle) {
  const chip = el("button", { type: "button", className: "chip" }, icon(toggle.icon), toggle.label);
  chip.addEventListener("click", () => update({ [toggle.key]: !settings[toggle.key] }));
  updaters.push(() => chip.setAttribute("aria-pressed", String(settings[toggle.key])));
  return chip;
}

function renderChoice(ch) {
  const wrap = el("div", { className: "toggles" });
  for (const opt of ch.options) {
    const chip = el("button", { type: "button", className: "chip", textContent: `${opt}${ch.unit}` });
    chip.addEventListener("click", () => update({ [ch.key]: opt }));
    updaters.push(() => chip.setAttribute("aria-pressed", String(settings[ch.key] === opt)));
    wrap.append(chip);
  }
  return [el("div", { className: "group-title" }, icon(ch.icon), ch.label), wrap];
}

function render() {
  const tabs = $("tabs");
  const panels = $("panels");

  SECTIONS.forEach((section, i) => {
    const tab = el("button", { type: "button", role: "tab" }, icon(section.icon), section.title);
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
function renderRememberFor(text) {
  const [before, after = ""] = t("rememberFor", "\u0000").split("\u0000");
  $("rememberFor").replaceChildren(before, el("b", { textContent: text }), after);
}

async function init() {
  localizePage();
  render();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = tab?.url ? AVFX.hostOf(tab.url) : null;
  renderRememberFor(host || t("thisSite"));
  $("siteSave").disabled = !host;

  if (host) {
    const key = AVFX.siteKey(host);
    const stored = await browser.storage.local.get(key);
    $("siteSave").checked = Boolean(stored[key]);
  }

  try {
    const state = await AVFX.getTabState(tabId);
    settings = AVFX.sanitize(state.settings);
    const n = state.mediaCount;
    baseStatus = n === 1 ? t("mediaFoundOne") : n > 1 ? t("mediaFoundMany", n) : t("ready");
    setStatus(baseStatus);
    watchMediaStatus();
  } catch {
    tabId = null;
    setStatus(t("notAvailable"), true);
    document.querySelectorAll("main input, main button, header input").forEach((i) => (i.disabled = true));
  }
  refresh();
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

$("siteSave").addEventListener("change", (e) => {
  const key = AVFX.siteKey(host);
  if (e.target.checked) browser.storage.local.set({ [key]: settings });
  else browser.storage.local.remove(key);
});

init();
