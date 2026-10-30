const { DEFAULTS } = AVFX;

// Groups hold "controls" (sliders), "toggles" (chips), a "choice" (chip group)
// or a "custom" renderer from spectrum.js / presets.js / tools.js.
const SECTIONS = [
  {
    id: "playback",
    icon: "playback",
    title: "Playback",
    groups: [
      {
        controls: [
          { key: "speed", icon: "speed", label: "Speed", ...AVFX.SPEED, unit: "×" },
          {
            key: "audioDelay",
            icon: "delay",
            label: "Audio delay",
            min: AVFX.MIN_DELAY_MS,
            max: AVFX.MAX_DELAY_MS,
            step: 5,
            unit: "ms",
            hint: "Positive: sound is early → the sound is delayed. Negative: sound is late (e.g. Bluetooth) → the picture is delayed.",
          },
        ],
      },
      { toggles: [{ key: "preservePitch", icon: "pitch", label: "Preserve pitch" }] },
    ],
  },
  {
    id: "audio",
    icon: "audio",
    title: "Audio",
    groups: [
      { title: "Analyzer", icon: "spectrum", custom: renderSpectrum },
      {
        controls: [
          { key: "volume", icon: "volume", label: "Volume", min: 0, max: 400, step: 1, unit: "%" },
          { key: "pan", icon: "pan", label: "Balance (L ↔ R)", min: -100, max: 100, step: 1, unit: "" },
        ],
      },
      {
        title: "Equalizer", icon: "equalizer",
        controls: [
          { key: "bass", icon: "bass", label: "Bass (200 Hz)", min: -15, max: 15, step: 0.5, unit: "dB" },
          { key: "mid", icon: "mid", label: "Mids (1 kHz)", min: -15, max: 15, step: 0.5, unit: "dB" },
          { key: "treble", icon: "treble", label: "Treble (4 kHz)", min: -15, max: 15, step: 0.5, unit: "dB" },
        ],
      },
      {
        toggles: [
          { key: "mono", icon: "mono", label: "Mono" },
          { key: "voice", icon: "voice", label: "Enhance voice" },
          { key: "compressor", icon: "compressor", label: "Compressor" },
          { key: "limiter", icon: "limiter", label: "Limiter" },
        ],
      },
    ],
  },
  {
    id: "video",
    icon: "video",
    title: "Video",
    groups: [
      {
        title: "Color", icon: "color",
        controls: [
          { key: "brightness", icon: "brightness", label: "Brightness", min: 0, max: 300, step: 1, unit: "%" },
          { key: "contrast", icon: "contrast", label: "Contrast", min: 0, max: 300, step: 1, unit: "%" },
          { key: "saturate", icon: "saturate", label: "Saturation", min: 0, max: 300, step: 1, unit: "%" },
          { key: "hue", icon: "hue", label: "Hue", min: 0, max: 360, step: 1, unit: "°" },
        ],
      },
      {
        title: "Effects", icon: "effects",
        controls: [
          { key: "sharpen", icon: "sharpen", label: "Sharpness", min: 0, max: 100, step: 1, unit: "%" },
          { key: "blur", icon: "blur", label: "Blur", min: 0, max: 10, step: 0.1, unit: "px" },
          { key: "grayscale", icon: "grayscale", label: "Grayscale", min: 0, max: 100, step: 1, unit: "%" },
          { key: "sepia", icon: "sepia", label: "Sepia", min: 0, max: 100, step: 1, unit: "%" },
          { key: "invert", icon: "invert", label: "Invert", min: 0, max: 100, step: 1, unit: "%" },
        ],
      },
      {
        title: "Geometry", icon: "geometry",
        controls: [{ key: "zoom", icon: "zoom", label: "Zoom", min: 50, max: 300, step: 1, unit: "%" }],
      },
      {
        toggles: [
          { key: "flipH", icon: "flipH", label: "Flip horizontally" },
          { key: "flipV", icon: "flipV", label: "Flip vertically" },
        ],
      },
      { choice: { key: "rotate", icon: "rotate", label: "Rotate", options: [0, 90, 180, 270], unit: "°" } },
    ],
  },
  {
    id: "extras",
    icon: "extras",
    title: "Extras",
    groups: [
      { title: "Presets", icon: "preset", custom: renderPresets },
      { title: "Tools", icon: "tools", custom: renderTools },
      { title: "Keyboard shortcuts", icon: "keyboard", custom: renderShortcuts },
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
  const reset = el("button", { type: "button", className: "reset", textContent: "reset" });
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

function renderToggle(t) {
  const chip = el("button", { type: "button", className: "chip" }, icon(t.icon), t.label);
  chip.addEventListener("click", () => update({ [t.key]: !settings[t.key] }));
  updaters.push(() => chip.setAttribute("aria-pressed", String(settings[t.key])));
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
    setStatus("Audio effects blocked – probably after an extension update. Please reload the page.", true);
  } else if (f?.drm && f.hasAudioChain) {
    setStatus("A copy-protected video was routed through Web Audio and is now silent – please reload the page.", true);
  } else if (f?.drm) {
    setStatus("Copy-protected video (DRM): audio effects don't work here – speed and video filters do.", true);
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

async function init() {
  render();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  host = tab?.url ? AVFX.hostOf(tab.url) : null;
  $("host").textContent = host || "this site";
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
    baseStatus =
      n > 0
        ? `${n} media element${n === 1 ? "" : "s"} found – changes apply instantly.`
        : "Ready – changes apply to all video/audio in this tab (including embedded players).";
    setStatus(baseStatus);
    watchMediaStatus();
  } catch {
    tabId = null;
    setStatus("Not available on this page (e.g. about: pages or addons.mozilla.org).", true);
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
