// The panel's modules: groups of controls that the layout (layout.js) shows as cards on
// pages. Each module lists its items (one slider, one chip, a list …) in their default
// order; the layout can reorder and hide them. build() returns a renderer per item; items
// that share state (a status line and its buttons) get it from the same build() call.
//   sidebar: only in the sidebar (Firefox) / side panel (Chrome)
//   tabFree: works without access to the panel's tab (looks at all tabs or at the panel
//            itself), so it stays usable on browser pages and disabled sites

// Item helpers. kind "inline" items (chips) line up in a row with their neighbours.
const sliderItem = (c) => ({ id: c.key, label: c.label, kind: "block", control: c, render: () => [renderRange(c)] });
const chipItem = (c) => ({ id: c.key, label: c.label, kind: "inline", render: () => [renderToggle(c)] });
const choiceItem = (id, label, c) => ({ id, label, kind: "block", render: () => renderChoice(c) });
const partItem = (id, label, kind = "block") => ({ id, label, kind });

const MODULES = [
  // ---------- Playback ----------
  {
    id: "speed",
    icon: "speed",
    title: t("tabPlayback"),
    items: [
      sliderItem({ key: "speed", icon: "speed", label: t("speed"), ...AVFX.SPEED, unit: "×" }),
      choiceItem("speedQuick", t("itemQuick"), { key: "speed", options: [0.5, 0.75, 1, 1.25, 1.5, 2, 3], unit: "×" }),
      chipItem({ key: "preservePitch", icon: "pitch", label: t("preservePitch") }),
      chipItem({ key: "skipSilence", icon: "skipSilence", label: t("skipSilence"), hint: t("skipSilenceHint") }),
    ],
  },
  {
    id: "sync",
    icon: "delay",
    title: t("moduleSync"),
    items: [
      sliderItem({
        key: "audioDelay",
        icon: "delay",
        label: t("audioDelay"),
        min: AVFX.MIN_DELAY_MS,
        max: AVFX.MAX_DELAY_MS,
        step: 5,
        unit: "ms",
        hint: t("audioDelayHint"),
      }),
    ],
  },

  // ---------- Audio ----------
  {
    id: "analyzer",
    icon: "spectrum",
    title: t("analyzer"),
    items: [partItem("spectrum", t("analyzer"))],
    build: () => ({ spectrum: renderSpectrum }),
  },
  {
    id: "level",
    icon: "volume",
    title: t("moduleLevel"),
    items: [
      sliderItem({ key: "volume", icon: "volume", label: t("volume"), min: 0, max: 400, step: 1, unit: "%" }),
      sliderItem({ key: "pan", icon: "pan", label: t("balance"), min: -100, max: 100, step: 1, unit: "" }),
      sliderItem({ key: "width", icon: "width", label: t("stereoWidth"), min: 0, max: 200, step: 1, unit: "%", hint: t("stereoWidthHint") }),
      chipItem({ key: "mono", icon: "mono", label: t("mono") }),
      chipItem({ key: "swap", icon: "swap", label: t("swapChannels") }),
    ],
  },
  {
    id: "equalizer",
    icon: "equalizer",
    title: t("equalizer"),
    items: [
      sliderItem({ key: "bass", icon: "bass", label: t("bass"), min: -15, max: 15, step: 0.5, unit: "dB" }),
      sliderItem({ key: "mid", icon: "mid", label: t("mids"), min: -15, max: 15, step: 0.5, unit: "dB" }),
      sliderItem({ key: "treble", icon: "treble", label: t("treble"), min: -15, max: 15, step: 0.5, unit: "dB" }),
    ],
  },
  {
    id: "sound",
    icon: "compressor",
    title: t("moduleSound"),
    items: [
      chipItem({ key: "voice", icon: "voice", label: t("enhanceVoice") }),
      chipItem({ key: "compressor", icon: "compressor", label: t("compressor") }),
      chipItem({ key: "limiter", icon: "limiter", label: t("limiter") }),
      chipItem({ key: "autoGain", icon: "autoGain", label: t("autoGain") }),
    ],
  },
  {
    id: "separation",
    icon: "voice",
    title: t("separation"),
    items: [sliderItem({ key: "dialog", icon: "dialog", label: t("dialog"), min: -100, max: 100, step: 1, unit: "", hint: t("dialogHint") })],
  },
  {
    id: "room",
    icon: "reverb",
    title: t("room"),
    items: [sliderItem({ key: "reverb", icon: "reverb", label: t("reverb"), min: 0, max: 100, step: 1, unit: "%" })],
  },

  // ---------- Video ----------
  {
    id: "color",
    icon: "color",
    title: t("color"),
    items: [
      sliderItem({ key: "brightness", icon: "brightness", label: t("brightness"), min: 0, max: 300, step: 1, unit: "%" }),
      sliderItem({ key: "contrast", icon: "contrast", label: t("contrast"), min: 0, max: 300, step: 1, unit: "%" }),
      sliderItem({ key: "saturate", icon: "saturate", label: t("saturation"), min: 0, max: 300, step: 1, unit: "%" }),
      sliderItem({ key: "hue", icon: "hue", label: t("hue"), min: 0, max: 360, step: 1, unit: "°" }),
      sliderItem({ key: "gamma", icon: "gamma", label: t("gamma"), min: 0.2, max: 3, step: 0.05, unit: "" }),
      sliderItem({ key: "temperature", icon: "temperature", label: t("temperature"), min: -100, max: 100, step: 1, unit: "", hint: t("temperatureHint") }),
    ],
  },
  {
    id: "effects",
    icon: "effects",
    title: t("effects"),
    items: [
      sliderItem({ key: "sharpen", icon: "sharpen", label: t("sharpness"), min: 0, max: 100, step: 1, unit: "%" }),
      sliderItem({ key: "blur", icon: "blur", label: t("blur"), min: 0, max: 10, step: 0.1, unit: "px" }),
      sliderItem({ key: "grayscale", icon: "grayscale", label: t("grayscale"), min: 0, max: 100, step: 1, unit: "%" }),
      sliderItem({ key: "sepia", icon: "sepia", label: t("sepia"), min: 0, max: 100, step: 1, unit: "%" }),
      sliderItem({ key: "invert", icon: "invert", label: t("invert"), min: 0, max: 100, step: 1, unit: "%" }),
    ],
  },
  {
    id: "colorVision",
    icon: "eye",
    title: t("colorVision"),
    items: [
      choiceItem("colorVision", t("colorVision"), {
        key: "colorVision",
        options: AVFX.COLOR_VISION,
        format: (o) => t(`cvd_${o}`),
        hint: t("colorVisionHint"),
      }),
    ],
  },
  {
    id: "geometry",
    icon: "geometry",
    title: t("geometry"),
    items: [
      sliderItem({ key: "zoom", icon: "zoom", label: t("zoom"), min: 50, max: 300, step: 1, unit: "%" }),
      sliderItem({ key: "offsetX", icon: "moveX", label: t("offsetX"), min: -50, max: 50, step: 1, unit: "%" }),
      sliderItem({ key: "offsetY", icon: "moveY", label: t("offsetY"), min: -50, max: 50, step: 1, unit: "%", hint: t("offsetHint") }),
      chipItem({ key: "flipH", icon: "flipH", label: t("flipH") }),
      chipItem({ key: "flipV", icon: "flipV", label: t("flipV") }),
      choiceItem("rotate", t("rotate"), { key: "rotate", icon: "rotate", label: t("rotate"), options: [0, 90, 180, 270], unit: "°" }),
    ],
  },
  {
    id: "ambilight",
    icon: "ambilight",
    title: t("ambilight"),
    items: [
      sliderItem({ key: "ambilight", icon: "ambilight", label: t("ambilightStrength"), min: 0, max: 100, step: 1, unit: "%", hint: t("ambilightHint") }),
    ],
  },

  // ---------- Presets ----------
  {
    id: "presets",
    icon: "preset",
    title: t("presets"),
    items: [partItem("builtin", t("itemBuiltin")), partItem("custom", t("customPresets"))],
    build: () => buildPresets(),
  },

  // ---------- Tools (tools.js) ----------
  {
    id: "transport",
    icon: "playPause",
    title: t("moduleTransport"),
    items: [partItem("position", t("itemPosition")), partItem("buttons", t("itemControls")), partItem("videoInfo", t("itemVideoInfo"))],
    build: () => buildTransport(),
  },
  {
    id: "abLoop",
    icon: "loop",
    title: t("abLoop"),
    items: [
      partItem("setA", t("setA"), "inline"),
      partItem("setB", t("setB"), "inline"),
      partItem("loopOff", t("off"), "inline"),
      partItem("repeat", t("repeatAll"), "inline"),
      partItem("loopInfo", t("itemStatus")),
    ],
    build: () => buildLoop(),
  },
  {
    id: "sleep",
    icon: "sleep",
    title: t("sleepTimer"),
    items: [partItem("sleepChips", t("itemQuick")), partItem("sleepInfo", t("itemStatus"))],
    build: () => buildSleep(),
  },
  {
    id: "screenshot",
    icon: "camera",
    title: t("screenshot"),
    items: [partItem("saveFrame", t("saveFrame"), "inline")],
    build: () => buildScreenshot(),
  },
  {
    id: "defaults",
    icon: "globe",
    title: t("defaultSettings"),
    items: [
      partItem("status", t("itemStatus")),
      partItem("use", t("useAsDefault"), "inline"),
      partItem("remove", t("removeDefault"), "inline"),
      partItem("manage", t("manageData"), "inline"),
    ],
    build: () => buildDefaults(),
  },
  {
    id: "site",
    icon: "power",
    title: t("siteTitle"),
    items: [partItem("hint", t("itemHint")), partItem("disable", t("disableHere"), "inline")],
    build: () => buildSiteSwitch(),
  },
  {
    id: "shortcuts",
    icon: "keyboard",
    title: t("shortcuts"),
    items: [partItem("list", t("shortcuts")), partItem("edit", t("changeShortcuts"), "inline")],
    build: () => buildShortcuts(),
  },

  // ---------- Sidebar only ----------
  {
    id: "mixer",
    icon: "mixer",
    title: t("tabMixer"),
    sidebar: true,
    tabFree: true,
    items: [partItem("hint", t("itemHint")), partItem("crossfader", t("crossfader")), partItem("media", t("itemMedia"))],
    build: () => buildMixer(),
  },
  {
    id: "limits",
    icon: "speed",
    title: t("limitsTitle"),
    sidebar: true,
    tabFree: true,
    items: [partItem("extended", t("extendedLimits"), "inline"), partItem("hint", t("itemHint"))],
    build: () => buildLimits(),
  },
  {
    id: "jumps",
    icon: "seekFwd",
    title: t("jumpWidths"),
    sidebar: true,
    tabFree: true,
    items: [partItem("jumpShort", t("jumpShort")), partItem("jumpLong", t("jumpLong"))],
    build: () => buildJumps(),
  },
  {
    id: "steps",
    icon: "tune",
    title: t("sliderSteps"),
    sidebar: true,
    tabFree: true,
    items: [partItem("hint", t("itemHint")), partItem("list", t("sliderSteps")), partItem("reset", t("resetSteps"), "inline")],
    build: () => buildSteps(),
  },
];

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

// Every slider, for the step sizes of the Customize page.
const CONTROLS = MODULES.flatMap((m) => m.items.filter((i) => i.control).map((i) => i.control));

// Renderers of a module's items: its own build(), or each item's render().
function buildModule(m) {
  return m.build ? m.build() : Object.fromEntries(m.items.map((i) => [i.id, i.render]));
}
