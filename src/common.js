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

  DEFAULTS: Object.freeze({
    enabled: true,

    // Playback
    speed: 1,
    preservePitch: true,
    audioDelay: 0, // ms; negative delays the picture instead

    // Audio
    volume: 100, // %
    bass: 0, // dB
    mid: 0, // dB
    treble: 0, // dB
    pan: 0, // -100 (left) .. 100 (right)
    mono: false,
    compressor: false,
    voice: false, // speech clarity: cut rumble, lift presence range
    limiter: false, // brickwall at -1 dBFS, avoids clipping when boosting

    // Video
    brightness: 100,
    contrast: 100,
    saturate: 100,
    hue: 0, // deg
    sharpen: 0, // %
    blur: 0, // px
    grayscale: 0,
    sepia: 0,
    invert: 0,
    zoom: 100,
    rotate: 0, // 0 | 90 | 180 | 270
    flipH: false,
    flipV: false,
  }),

  MAX_DELAY_MS: 5000,
  // Video delay buffers decoded frames, so it is kept much shorter.
  MIN_DELAY_MS: -1000,

  SPEED: { min: 0.25, max: 4, step: 0.05 },

  // Built-in presets. They reset all effects but keep speed and A/V sync,
  // which depend on the content and the playback device, not on taste.
  PRESETS: [
    { id: "voice", name: "Clear speech", icon: "voice", patch: { voice: true, compressor: true, bass: -3, treble: 2 } },
    { id: "night", name: "Night mode", icon: "night", patch: { compressor: true, limiter: true, bass: -6, volume: 130 } },
    { id: "bass", name: "Bass boost", icon: "bass", patch: { bass: 9, mid: -1, limiter: true } },
    { id: "cinema", name: "Cinema", icon: "video", patch: { bass: 4, treble: 3, contrast: 115, saturate: 115 } },
    { id: "vivid", name: "Vivid colors", icon: "saturate", patch: { saturate: 140, contrast: 110, sharpen: 30 } },
    { id: "eyes", name: "Easy on the eyes", icon: "brightness", patch: { brightness: 85, sepia: 30, contrast: 95 } },
  ],

  PLAYBACK_KEYS: ["speed", "preservePitch", "audioDelay"],

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
    const { DEFAULTS, SPEED, MIN_DELAY_MS, MAX_DELAY_MS, clamp } = globalThis.AVFX;
    const out = { ...DEFAULTS };
    if (!input || typeof input !== "object") return out;
    for (const [key, def] of Object.entries(DEFAULTS)) {
      const v = input[key];
      if (typeof v === typeof def && (typeof v !== "number" || Number.isFinite(v))) out[key] = v;
    }
    out.speed = clamp(out.speed, SPEED.min, SPEED.max); // playbackRate throws outside its range
    out.audioDelay = clamp(out.audioDelay, MIN_DELAY_MS, MAX_DELAY_MS);
    if (![0, 90, 180, 270].includes(out.rotate)) out.rotate = 0;
    return out;
  },

  // Firefox resolves executeScript paths relative to the calling page (popup/), so
  // they must be root-absolute there; Chrome always resolves from the extension root.
  CONTENT_FILES: ["common.js", "videodelay.js", "content.js"].map(
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
      s.mono ||
      s.compressor ||
      s.voice ||
      s.limiter
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

  formatTime(t) {
    if (!Number.isFinite(t)) return "–";
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, "0");
    return `${m}:${s}`;
  },
};
