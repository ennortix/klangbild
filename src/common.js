// Shared between content script, background and popup.
// All values are stored in the unit shown in the UI (%, ms, dB, ...).

// No top-level const/let here: this file can be injected twice into the same world.

// Chrome only has `chrome`; its MV3 APIs return promises just like Firefox' `browser`.
// Always reassigned: after an update an orphaned instance may have left a stale one.
if (!/\bFirefox\//.test(navigator.userAgent)) globalThis.browser = globalThis.chrome;

globalThis.AVFX = {
  IS_FIREFOX: /\bFirefox\//.test(navigator.userAgent),

  // Chrome ignores promises returned from onMessage listeners, sendResponse works in
  // both. A handler returning undefined doesn't answer, so another frame or page can.
  onMessage(handler) {
    browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      const result = handler(msg, sender);
      if (result === undefined) return false;
      Promise.resolve(result).then(sendResponse, (e) => {
        console.warn("[Klangbild]", e);
        sendResponse(undefined);
      });
      return true;
    });
  },

  // Text in the browser's UI language from _locales/. Falls back to the key, e.g.
  // in a content script orphaned by an extension update.
  t(key, ...subs) {
    try {
      return browser.i18n.getMessage(key, subs.map(String)) || key;
    } catch {
      return key;
    }
  },

  // Formats numbers like the UI language, e.g. 1.25 → "1,25" in German.
  formatNumber(v, digits) {
    return v.toLocaleString(browser.i18n.getUILanguage(), { maximumFractionDigits: digits });
  },

  DEFAULTS: Object.freeze({
    enabled: true,

    // Playback
    speed: 1,
    preservePitch: true,
    audioDelay: 0, // ms; negative delays the picture instead
    skipSilence: false, // plays pauses faster, see silenceStep()

    // Audio
    volume: 100, // %
    bass: 0, // dB
    mid: 0, // dB
    treble: 0, // dB
    pan: 0, // -100 (left) .. 100 (right)
    width: 100, // % stereo width: 0 = mono, 200 = extra wide
    swap: false, // swap left and right channel
    mono: false,
    compressor: false,
    voice: false, // speech clarity: cut rumble, lift presence range
    limiter: false, // brickwall at -1 dBFS, avoids clipping when boosting
    autoGain: false, // loudness leveling: quiet media louder, loud media quieter
    reverb: 0, // % wet signal of a generated room impulse response
    dialog: 0, // -100 (voice quieter) .. 100 (background quieter), see dialog.js

    // Video
    brightness: 100,
    contrast: 100,
    saturate: 100,
    hue: 0, // deg
    gamma: 1, // > 1 lifts dark areas
    temperature: 0, // -100 (cool) .. 100 (warm)
    sharpen: 0, // %
    blur: 0, // px
    grayscale: 0,
    sepia: 0,
    invert: 0,
    colorVision: "none", // "none" | "protan" | "deutan" | "tritan": color blindness correction
    zoom: 100,
    offsetX: 0, // % of the element size, moves a zoomed picture
    offsetY: 0,
    rotate: 0, // 0 | 90 | 180 | 270
    flipH: false,
    flipV: false,
    ambilight: 0, // % strength of the glow around the picture, see ambilight.js
  }),

  MAX_DELAY_MS: 5000,
  // Video delay buffers decoded frames, so it is kept much shorter.
  MIN_DELAY_MS: -1000,

  SPEED: { min: 0.25, max: 4, step: 0.05 },

  // Hard limits of every numeric setting: sanitize() clamps to them (so hand-edited
  // backups can't push values out of range) and the sidebar's "extended limits"
  // sliders reach them. Speed: Chrome throws below 0.0625× and above 16×. The audio
  // delay line is created for the full positive range; the picture delay buffers
  // decoded frames, so it stays at MIN_DELAY_MS.
  LIMITS: {
    speed: [0.1, 16],
    audioDelay: [-1000, 10000],
    volume: [0, 800],
    bass: [-24, 24],
    mid: [-24, 24],
    treble: [-24, 24],
    pan: [-100, 100],
    width: [0, 300],
    reverb: [0, 100],
    dialog: [-100, 100],
    brightness: [0, 500],
    contrast: [0, 500],
    saturate: [0, 500],
    hue: [0, 360],
    gamma: [0.1, 5], // the SVG filter divides by it
    temperature: [-100, 100],
    sharpen: [0, 200],
    blur: [0, 30],
    grayscale: [0, 100],
    sepia: [0, 100],
    invert: [0, 100],
    zoom: [25, 500],
    offsetX: [-100, 100],
    offsetY: [-100, 100],
    ambilight: [0, 100],
  },

  // Everyday [min, max] of the numeric settings, same as the popup's sliders.
  RANGES: {
    volume: [0, 400],
    bass: [-15, 15],
    mid: [-15, 15],
    treble: [-15, 15],
    pan: [-100, 100],
    width: [0, 200],
    reverb: [0, 100],
    dialog: [-100, 100],
    brightness: [0, 300],
    contrast: [0, 300],
    saturate: [0, 300],
    hue: [0, 360],
    gamma: [0.2, 3], // the SVG filter divides by it
    temperature: [-100, 100],
    sharpen: [0, 100],
    blur: [0, 10],
    grayscale: [0, 100],
    sepia: [0, 100],
    invert: [0, 100],
    zoom: [50, 300],
    offsetX: [-50, 50],
    offsetY: [-50, 50],
    ambilight: [0, 100],
  },

  // Built-in presets. They reset all effects but keep speed and A/V sync,
  // which depend on the content and the playback device, not on taste. Names are
  // the _locales/ messages preset_<id>.
  PRESETS: [
    { id: "voice", icon: "voice", patch: { voice: true, compressor: true, bass: -3, treble: 2 } },
    { id: "night", icon: "night", patch: { compressor: true, limiter: true, bass: -6, volume: 130 } },
    { id: "bass", icon: "bass", patch: { bass: 9, mid: -1, limiter: true } },
    { id: "cinema", icon: "video", patch: { bass: 4, treble: 3, contrast: 115, saturate: 115 } },
    { id: "vivid", icon: "saturate", patch: { saturate: 140, contrast: 110, sharpen: 30 } },
    { id: "eyes", icon: "brightness", patch: { brightness: 85, sepia: 30, contrast: 95 } },
  ],

  PLAYBACK_KEYS: ["speed", "preservePitch", "audioDelay"],

  COLOR_VISION: ["none", "protan", "deutan", "tritan"],

  // storage.local key of the settings sites without their own start with.
  DEFAULTS_KEY: "defaults",
  // storage.local key of the hosts Klangbild leaves alone (array of hostnames).
  DISABLED_KEY: "disabledSites",

  siteKey(host) {
    return `site:${host}`;
  },

  hostOf(url) {
    try {
      return new URL(url).hostname || null;
    } catch {
      return null;
    }
  },

  clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  },

  // Drops unknown keys and replaces values of the wrong type or out of range,
  // e.g. presets saved by an older version or corrupted storage.
  sanitize(input) {
    const { DEFAULTS, COLOR_VISION, LIMITS, clamp } = globalThis.AVFX;
    const out = { ...DEFAULTS };
    if (!input || typeof input !== "object") return out;
    for (const [key, def] of Object.entries(DEFAULTS)) {
      const v = input[key];
      if (typeof v === typeof def && (typeof v !== "number" || Number.isFinite(v))) out[key] = v;
    }
    if (![0, 90, 180, 270].includes(out.rotate)) out.rotate = 0;
    for (const [key, [min, max]] of Object.entries(LIMITS)) out[key] = clamp(out[key], min, max);
    if (!COLOR_VISION.includes(out.colorVision)) out.colorVision = "none";
    return out;
  },

  // Firefox resolves executeScript paths relative to the calling page (popup/), so
  // they must be root-absolute there; Chrome always resolves from the extension root.
  CONTENT_FILES: ["common.js", "videodelay.js", "ambilight.js", "dialog.js", "content.js"].map(
    (f) => (/\bFirefox\//.test(navigator.userAgent) ? "/" : "") + f
  ),

  // Settings of the tab's top frame. Tabs opened before the extension was
  // installed or updated have no content script yet, so it is injected first.
  async getTabState(tabId) {
    const get = () => browser.tabs.sendMessage(tabId, { type: "get" }, { frameId: 0 });
    try {
      return await get();
    } catch {
      await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: globalThis.AVFX.CONTENT_FILES,
      });
      return await get();
    }
  },

  // True when any setting requires routing the element through Web Audio.
  needsAudioGraph(s) {
    return (
      s.volume !== 100 ||
      s.audioDelay > 0 ||
      s.bass !== 0 ||
      s.mid !== 0 ||
      s.treble !== 0 ||
      s.pan !== 0 ||
      s.width !== 100 ||
      s.swap ||
      s.mono ||
      s.compressor ||
      s.voice ||
      s.dialog !== 0 ||
      s.limiter ||
      s.autoGain ||
      s.skipSilence || // listens to the sound
      s.reverb > 0
    );
  },

  // Asks every frame of the tab for its most relevant media element and returns
  // the frame with the best one: { frameId, score, kind, hasAudioChain, drm, audioBlocked } or null.
  async findPrimaryFrame(tabId) {
    try {
      const results = await browser.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: () => globalThis.__avfxPrimary?.() ?? null,
      });
      let best = null;
      for (const r of results) {
        if (r.result && (!best || r.result.score > best.score)) best = { frameId: r.frameId, ...r.result };
      }
      if (best) return best;
    } catch (e) {
      console.warn("[Klangbild] Frame query failed, using fallback:", e);
    }
    // Pages with many ad/sandboxed iframes can make executeScript fail as a whole.
    // Fall back to a broadcast that only frames holding media answer (first one wins).
    return (await browser.tabs.sendMessage(tabId, { type: "probe" }).catch(() => null)) ?? null;
  },

  // 48 log-spaced bands (30 Hz – 16 kHz, 0..1) plus RMS/peak level in dBFS of an
  // AnalyserNode. Used for page media (content script) and system audio (analyzer window).
  analyse(an) {
    const freq = new Uint8Array(an.frequencyBinCount);
    an.getByteFrequencyData(freq);
    const hzPerBin = an.context.sampleRate / an.fftSize;
    const BANDS = 48;
    const lo = Math.log(30);
    const hi = Math.log(16000);
    const bands = [];
    for (let i = 0; i < BANDS; i++) {
      const from = Math.floor(Math.exp(lo + ((hi - lo) * i) / BANDS) / hzPerBin);
      const to = Math.max(from + 1, Math.floor(Math.exp(lo + ((hi - lo) * (i + 1)) / BANDS) / hzPerBin));
      let max = 0;
      for (let b = from; b < to && b < freq.length; b++) max = Math.max(max, freq[b]);
      bands.push(max / 255);
    }

    const wave = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(wave);
    let sum = 0;
    let peak = 0;
    for (const v of wave) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { bands, rms: db(Math.sqrt(sum / wave.length)), peak: db(peak) };
  },

  // sendMessage options for a frame from findPrimaryFrame(). The probe fallback in
  // Chrome can't tell the frame id, then the message goes to all frames.
  frameTarget(frame) {
    return Number.isInteger(frame?.frameId) ? { frameId: frame.frameId } : undefined;
  },

  // Rounded to tenths before splitting, so 59.96 s becomes "1:00.0", not "0:60.0".
  formatTime(t) {
    if (!Number.isFinite(t)) return "–";
    const tenths = Math.round(t * 10);
    const m = Math.floor(tenths / 600);
    const s = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
    return `${m}:${s}`;
  },

  // Loudness leveling: the level is measured before the leveling gain (feed-forward,
  // so the user's volume isn't fought against) and averaged over `window` seconds.
  AUTO_GAIN: {
    target: -18, // dBFS RMS the average level is moved to
    gate: -50, // quieter blocks (pauses, silence) don't count, so they aren't boosted
    maxBoost: 12, // dB
    maxCut: 12, // dB
    window: 3, // seconds
  },

  // One measurement step: state { power, gain } (mean square, dB) and the RMS level
  // in dBFS of the last `dt` seconds. Returns the new state.
  autoGainStep(state, rmsDb, dt) {
    const { AUTO_GAIN: A, clamp } = globalThis.AVFX;
    if (!(rmsDb > A.gate)) return state; // also -Infinity and NaN
    const p = 10 ** (rmsDb / 10);
    const power = state.power == null ? p : state.power + (1 - Math.exp(-dt / A.window)) * (p - state.power);
    return { power, gain: clamp(A.target - 10 * Math.log10(power), -A.maxCut, A.maxBoost) };
  },

  // Skipping silence: pauses play SKIP_SILENCE.factor times faster. Silence is relative
  // to the recording (a lecture with room noise never gets digitally silent): the level
  // of what is heard is followed (at once up, `decay` dB/s down towards quieter speech),
  // and what stays `below` dB under it for `minQuiet` seconds is a pause. The threshold
  // stays within floor..ceiling dBFS: under the ceiling, a quiet speaker after loud
  // music is still speech. In a pause the level sinks only by `holdDecay` dB/s, so long
  // pauses in a noisy room are skipped for a while too.
  SKIP_SILENCE: { below: 20, floor: -60, ceiling: -36, decay: 3, holdDecay: 1, minQuiet: 0.25, factor: 3 },

  // One measurement step: state { level, quiet, silent } (level null until sound was
  // heard) and the RMS level in dBFS of the last `dt` seconds. Returns the new state.
  silenceStep(state, rmsDb, dt) {
    const { SKIP_SILENCE: S, clamp } = globalThis.AVFX;
    const rms = rmsDb > -Infinity ? rmsDb : -Infinity; // also NaN
    if (state.level === null && rms === -Infinity) return { level: null, quiet: 0, silent: false }; // nothing heard yet
    let level = Math.max(state.level ?? rms, rms);
    const isQuiet = rms < clamp(level - S.below, S.floor, S.ceiling);
    level = isQuiet ? level - S.holdDecay * dt : Math.max(rms, level - S.decay * dt);
    const quiet = isQuiet ? state.quiet + dt : 0;
    return { level, quiet, silent: quiet >= S.minQuiet - 1e-9 };
  },

  // Continue watching: positions of longer media, per page address. Time parameters and
  // the fragment don't make another video.
  RESUME: { minDuration: 120, minTime: 30, endMargin: 20, rewind: 2, maxEntries: 1000 },
  RESUME_KEY: "resumePositions",
  PREFS_KEY: "prefs",
  PREFS_DEFAULTS: Object.freeze({ resume: true, knob: false }), // knob: sliders turn instead of drag (sliderfx.js)

  resumeKey(url) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) return null;
      u.hash = "";
      for (const p of ["t", "start", "time_continue", "timestamp"]) u.searchParams.delete(p);
      u.searchParams.sort();
      return u.href;
    } catch {
      return null;
    }
  },

  // Where to continue, or null: same length (±2 s), not at the very start or end, and
  // only if the page hasn't started somewhere itself (a link with a time, its own resume).
  resumeTime(saved, duration, currentTime) {
    const { RESUME: R } = globalThis.AVFX;
    if (!saved || !Number.isFinite(saved.t) || !Number.isFinite(duration) || duration < R.minDuration) return null;
    if (Math.abs(saved.d - duration) > 2 || currentTime > 5) return null;
    if (saved.t < R.minTime || saved.t > duration - R.endMargin) return null;
    return saved.t - R.rewind;
  },

  // Rules: settings for addresses. A pattern is a host, optionally with a path:
  // "example.com" (and its subdomains), "*.example.com", "example.com/podcasts/*",
  // "example.com/watch?v=*". * matches anything, a path without * is a prefix. Hosts
  // ignore case, paths don't (video ids). The most specific matching rule wins.
  RULES_KEY: "rules",
  MAX_RULES: 200,

  ruleMatches(pattern, url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return false;
    }
    if (!/^https?:$/.test(u.protocol) || typeof pattern !== "string") return false;
    const p = pattern.trim().replace(/^[a-z]+:\/\//i, "");
    const slash = p.indexOf("/");
    const hostPat = (slash < 0 ? p : p.slice(0, slash)).toLowerCase().replace(/^\*\./, "");
    const pathPat = slash < 0 ? "" : p.slice(slash);
    if (!hostPat || hostPat.includes("*")) return false;
    const host = hostPat.includes(":") ? u.host : u.hostname; // "localhost:8080"
    if (host !== hostPat && !host.endsWith(`.${hostPat}`)) return false;
    if (!pathPat) return true;
    const glob = pathPat.includes("*") ? pathPat : `${pathPat}*`;
    const re = glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${re}$`).test(u.pathname + u.search);
  },

  findRule(rules, url) {
    let best = null;
    let bestScore = -1;
    for (const rule of Array.isArray(rules) ? rules : []) {
      if (!globalThis.AVFX.ruleMatches(rule?.pattern, url)) continue;
      const score = rule.pattern.replace(/\*/g, "").trim().length;
      if (score > bestScore) {
        best = rule;
        bestScore = score;
      }
    }
    return best;
  },

  // A preset like a click in the panel (built-in ones keep speed and A/V sync), then
  // the rule's own speed. preset: "" | "builtin:<id>" | "user:<name>".
  applyRule(base, rule, userPresets = []) {
    const { DEFAULTS, PRESETS, PLAYBACK_KEYS, sanitize } = globalThis.AVFX;
    let s = sanitize(base);
    const preset = typeof rule?.preset === "string" ? rule.preset : "";
    const sep = preset.indexOf(":");
    const kind = sep > 0 ? preset.slice(0, sep) : "";
    const id = preset.slice(sep + 1);
    if (kind === "builtin") {
      const found = PRESETS.find((p) => p.id === id);
      if (found) {
        const keep = Object.fromEntries(PLAYBACK_KEYS.map((k) => [k, s[k]]));
        s = { ...DEFAULTS, enabled: s.enabled, ...keep, ...found.patch };
      }
    } else if (kind === "user") {
      const found = (Array.isArray(userPresets) ? userPresets : []).find((p) => p?.name === id);
      if (found) s = { ...DEFAULTS, ...found.settings, enabled: s.enabled };
    }
    if (Number.isFinite(rule?.speed)) s.speed = rule.speed;
    return sanitize(s);
  },

  sanitizeRules(list) {
    const { LIMITS, MAX_RULES, clamp } = globalThis.AVFX;
    const out = [];
    for (const r of Array.isArray(list) ? list : []) {
      const pattern = typeof r?.pattern === "string" ? r.pattern.trim().slice(0, 300) : "";
      if (!pattern || out.length >= MAX_RULES) continue;
      const preset = typeof r.preset === "string" && /^(builtin|user):./.test(r.preset) ? r.preset.slice(0, 60) : "";
      const speed = Number.isFinite(r.speed) ? clamp(r.speed, ...LIMITS.speed) : null;
      if (preset || speed !== null) out.push({ pattern, preset, speed });
    }
    return out;
  },

  FRAME_RATES: [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 100, 119.88, 120],

  // Seconds per frame from measured frame durations (mediaTime differences of
  // consecutive frames), or null with too few. Outliers (seeks, stalls) are dropped;
  // the mean evens out millisecond timestamps (WebM: 24 fps alternates 41/42 ms).
  // Close to a common frame rate (1 %) the result snaps to it.
  frameDuration(samples) {
    const sorted = samples.filter((d) => d > 0.004 && d < 0.25).sort((a, b) => a - b);
    if (sorted.length < 10) return null;
    const median = sorted[Math.floor(sorted.length / 2)];
    const inliers = sorted.filter((d) => Math.abs(d - median) <= median * 0.25);
    const fps = inliers.length / inliers.reduce((sum, d) => sum + d, 0);
    let best = null;
    for (const rate of globalThis.AVFX.FRAME_RATES) {
      if (Math.abs(rate - fps) / rate < 0.01 && (best === null || Math.abs(rate - fps) < Math.abs(best - fps))) best = rate;
    }
    return 1 / (best ?? fps);
  },

  // Stereo width, channel swap and mono as a 2×2 matrix of gains, [from][to]. Mid/side:
  // each output keeps (1 + w) / 2 of its own channel and (1 - w) / 2 of the other;
  // w = 0 is a mono mix of both channels.
  stereoGains(s) {
    const w = s.mono ? 0 : s.width / 100;
    const own = (1 + w) / 2;
    const other = (1 - w) / 2;
    return [0, 1].map((from) => [0, 1].map((to) => ((from === to) !== s.swap ? own : other)));
  },

  // Daltonization: simulate the color vision deficiency (Machado et al. 2009, full
  // severity), take what gets lost and shift it into channels that are still seen.
  // Returns the correction matrix I + shift × (I − sim) as feColorMatrix values.
  colorVisionMatrix(type) {
    const CVD = {
      protan: {
        sim: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
        shift: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]], // red error into green and blue
      },
      deutan: {
        sim: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
        shift: [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]],
      },
      tritan: {
        sim: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
        shift: [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]], // blue error into red and green
      },
    };
    const { sim, shift } = CVD[type];
    const rows = [0, 1, 2].map((r) =>
      [0, 1, 2].map((c) => (r === c ? 1 : 0) + [0, 1, 2].reduce((sum, k) => sum + shift[r][k] * ((k === c ? 1 : 0) - sim[k][c]), 0))
    );
    return rows.map((row) => `${row.map((v) => v.toFixed(4)).join(" ")} 0 0`).join("  ") + "  0 0 0 1 0";
  },
};
