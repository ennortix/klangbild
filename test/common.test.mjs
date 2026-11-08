import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCommon, plain, read } from "./helpers.mjs";

const { AVFX } = loadCommon();

test("sanitize: garbage input gives the defaults", () => {
  for (const bad of [null, undefined, 42, "x", [], true]) {
    assert.deepEqual(plain(AVFX.sanitize(bad)), plain(AVFX.DEFAULTS), JSON.stringify(bad));
  }
});

test("sanitize: NaN, Infinity and wrong types are replaced", () => {
  const s = AVFX.sanitize({ gamma: NaN, width: Infinity, reverb: "50", swap: 1, colorVision: 3, speed: -Infinity });
  assert.equal(s.gamma, 1);
  assert.equal(s.width, 100);
  assert.equal(s.reverb, 0);
  assert.equal(s.swap, false);
  assert.equal(s.colorVision, "none");
  assert.equal(s.speed, 1);
});

test("sanitize: unknown keys are dropped", () => {
  assert.equal("evil" in AVFX.sanitize({ evil: 1 }), false);
});

test("sanitize: every numeric setting is clamped at both ends", () => {
  for (const [key, [min, max]] of Object.entries(AVFX.LIMITS)) {
    assert.equal(AVFX.sanitize({ [key]: min - 1000 })[key], min, `${key} below`);
    assert.equal(AVFX.sanitize({ [key]: max + 1000 })[key], max, `${key} above`);
    assert.equal(AVFX.sanitize({ [key]: (min + max) / 2 })[key], (min + max) / 2, `${key} inside`);
  }
  assert.equal(AVFX.sanitize({ speed: 100 }).speed, 16);
  assert.equal(AVFX.sanitize({ speed: 0 }).speed, 0.1, "Chrome throws below 0.0625");
  assert.equal(AVFX.sanitize({ audioDelay: -1e9 }).audioDelay, AVFX.MIN_DELAY_MS);
  assert.equal(AVFX.sanitize({ rotate: 45 }).rotate, 0);
});

test("sanitize: gamma can't reach 0 (the SVG filter divides by it)", () => {
  assert.equal(AVFX.sanitize({ gamma: 0 }).gamma, 0.1);
  assert.equal(AVFX.sanitize({ gamma: -5 }).gamma, 0.1);
});

test("sanitize: colorVision only accepts known values", () => {
  for (const v of ["PROTAN", "__proto__", "", "constructor"]) assert.equal(AVFX.sanitize({ colorVision: v }).colorVision, "none", v);
  for (const v of AVFX.COLOR_VISION) assert.equal(AVFX.sanitize({ colorVision: v }).colorVision, v);
});

test("LIMITS cover every slider and contain its everyday range", () => {
  const { LIMITS, RANGES, SPEED } = AVFX;
  const everyday = { ...RANGES, speed: [SPEED.min, SPEED.max], audioDelay: [AVFX.MIN_DELAY_MS, AVFX.MAX_DELAY_MS] };
  assert.deepEqual(Object.keys(LIMITS).sort(), Object.keys(everyday).sort());
  for (const [key, [min, max]] of Object.entries(everyday)) {
    assert.ok(LIMITS[key][0] <= min && LIMITS[key][1] >= max, key);
  }
  assert.equal(LIMITS.audioDelay[0], AVFX.MIN_DELAY_MS, "the picture delay buffer is not extended");
});

test("sanitize: values beyond the everyday ranges survive (sidebar's extended limits)", () => {
  const s = AVFX.sanitize({ speed: 8, volume: 600, bass: 20, audioDelay: 8000 });
  assert.deepEqual([s.speed, s.volume, s.bass, s.audioDelay], [8, 600, 20, 8000]);
});

test("sanitize: defaults lie inside their ranges", () => {
  for (const [key, [min, max]] of Object.entries(AVFX.RANGES)) {
    assert.ok(AVFX.DEFAULTS[key] >= min && AVFX.DEFAULTS[key] <= max, key);
  }
});

test("RANGES match the popup sliders", () => {
  const popup = read("popup/modules.js");
  const sliders = [...popup.matchAll(/key: "(\w+)",[^}]*?min: (-?[\d.]+),\s*max: (-?[\d.]+)/gs)];
  assert.ok(sliders.length > 15, "found the slider definitions");
  for (const [, key, min, max] of sliders) {
    if (key === "audioDelay") continue; // has its own constants
    const range = key === "speed" ? [AVFX.SPEED.min, AVFX.SPEED.max] : AVFX.RANGES[key];
    assert.ok(range, `${key} has no range in AVFX.RANGES`);
    assert.deepEqual([...range], [Number(min), Number(max)], key);
  }
});

test("built-in presets survive sanitize unchanged", () => {
  for (const p of AVFX.PRESETS) {
    const s = AVFX.sanitize({ ...AVFX.DEFAULTS, ...p.patch });
    for (const [k, v] of Object.entries(p.patch)) assert.equal(s[k], v, `${p.id}.${k}`);
  }
});

test("needsAudioGraph: new audio keys need the graph, video keys don't", () => {
  const d = AVFX.DEFAULTS;
  assert.equal(AVFX.needsAudioGraph(d), false);
  for (const patch of [{ width: 0 }, { width: 200 }, { swap: true }, { reverb: 1 }, { mono: true }, { autoGain: true }, { dialog: 30 }, { dialog: -1 }]) {
    assert.equal(AVFX.needsAudioGraph({ ...d, ...patch }), true, JSON.stringify(patch));
  }
  for (const patch of [{ gamma: 2 }, { temperature: 50 }, { colorVision: "protan" }, { offsetX: 10 }]) {
    assert.equal(AVFX.needsAudioGraph({ ...d, ...patch }), false, JSON.stringify(patch));
  }
});

test("formatTime: rounding never shows 60 seconds", () => {
  assert.equal(AVFX.formatTime(0), "0:00.0");
  assert.equal(AVFX.formatTime(59.94), "0:59.9");
  assert.equal(AVFX.formatTime(59.96), "1:00.0");
  assert.equal(AVFX.formatTime(119.97), "2:00.0");
  assert.equal(AVFX.formatTime(3599.99), "60:00.0");
  assert.equal(AVFX.formatTime(754.2), "12:34.2");
  for (let t = 0; t < 7200; t += 0.01) assert.doesNotMatch(AVFX.formatTime(t), /:6\d/, String(t));
});

test("formatTime: non-finite times", () => {
  assert.equal(AVFX.formatTime(Infinity), "–");
  assert.equal(AVFX.formatTime(NaN), "–");
  assert.equal(AVFX.formatTime(undefined), "–");
});

test("sleep countdown text (tools.js) at minute boundaries", () => {
  const text = (ms) => AVFX.formatTime(ms / 1000).replace(/\.\d$/, "");
  assert.equal(text(59_960), "1:00");
  assert.equal(text(90 * 60_000), "90:00");
  assert.equal(text(0), "0:00");
});

// ---------- stereo matrix ----------

// Output [L, R] for an input [L, R] through the gains, [from][to].
const mix = (g, [l, r]) => [l * g[0][0] + r * g[1][0], l * g[0][1] + r * g[1][1]];
const s = (patch) => ({ ...AVFX.DEFAULTS, ...patch });
const close = (a, b, msg) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${msg}: ${a} vs ${b}`));

test("stereoGains: original, swap, mono, width 0 and 200", () => {
  close(mix(AVFX.stereoGains(s({})), [1, 0.25]), [1, 0.25], "original");
  close(mix(AVFX.stereoGains(s({ swap: true })), [1, 0.25]), [0.25, 1], "swap");
  close(mix(AVFX.stereoGains(s({ width: 0 })), [1, 0.25]), [0.625, 0.625], "width 0");
  close(mix(AVFX.stereoGains(s({ width: 200 })), [1, 0.25]), [1.375, -0.125], "width 200");
});

test("stereoGains: mono puts the same signal on both sides, whatever width and swap", () => {
  for (const width of [0, 100, 200]) {
    for (const swap of [false, true]) {
      close(mix(AVFX.stereoGains(s({ mono: true, width, swap })), [1, 0.25]), [0.625, 0.625], `w${width} swap ${swap}`);
    }
  }
});

test("stereoGains: up to 100 % width a full-scale signal never exceeds 1", () => {
  for (let width = 0; width <= 100; width += 5) {
    const g = AVFX.stereoGains(s({ width }));
    for (const input of [[1, 1], [1, -1], [1, 0], [-1, 1]]) {
      for (const v of mix(g, input)) assert.ok(Math.abs(v) <= 1 + 1e-9, `width ${width} input ${input}`);
    }
  }
});

// ---------- colour vision correction ----------

test("colorVisionMatrix: 20 finite values, white stays white, alpha untouched", () => {
  for (const type of AVFX.COLOR_VISION.filter((t) => t !== "none")) {
    const v = AVFX.colorVisionMatrix(type).trim().split(/\s+/).map(Number);
    assert.equal(v.length, 20, type);
    assert.ok(v.every(Number.isFinite), type);
    assert.deepEqual(v.slice(15), [0, 0, 0, 1, 0], `${type} alpha row`);
    for (let r = 0; r < 3; r++) {
      const sum = v[r * 5] + v[r * 5 + 1] + v[r * 5 + 2];
      assert.ok(Math.abs(sum - 1) < 1e-3, `${type} row ${r} sums to ${sum}`);
      assert.equal(v[r * 5 + 3], 0, "no alpha bleed");
      assert.equal(v[r * 5 + 4], 0, "no offset");
    }
  }
});

test("colorVisionMatrix: 'none' is not a matrix (svgFilter skips it)", () => {
  assert.throws(() => AVFX.colorVisionMatrix("none"));
});

// ---------- loudness leveling ----------

// Feeds a constant level for `seconds` in 100 ms steps.
function level(rmsDb, seconds, state = { power: null, gain: 0 }) {
  for (let t = 0; t < seconds; t += 0.1) state = AVFX.autoGainStep(state, rmsDb, 0.1);
  return state;
}

test("autoGainStep: steady level is moved to the target", () => {
  const { target } = AVFX.AUTO_GAIN;
  assert.ok(Math.abs(level(target - 6, 1).gain - 6) < 1e-9, "quiet is boosted");
  assert.ok(Math.abs(level(target + 6, 1).gain + 6) < 1e-9, "loud is cut");
  assert.equal(level(target, 1).gain, 0);
});

test("autoGainStep: boost and cut are limited", () => {
  assert.equal(level(-45, 30).gain, AVFX.AUTO_GAIN.maxBoost);
  assert.equal(level(0, 30).gain, -AVFX.AUTO_GAIN.maxCut);
});

test("autoGainStep: silence and pauses keep the gain", () => {
  const before = level(-30, 10);
  for (const db of [-Infinity, NaN, -80, AVFX.AUTO_GAIN.gate]) {
    assert.deepEqual(plain(AVFX.autoGainStep(before, db, 0.1)), plain(before), String(db));
  }
  assert.deepEqual(plain(level(-Infinity, 10)), { power: null, gain: 0 }, "silence from the start isn't boosted");
});

test("autoGainStep: a level change is followed within the averaging window", () => {
  const { window } = AVFX.AUTO_GAIN;
  const loud = level(-30, 20); // settled, +12 dB
  const after1 = level(-10, 1, loud);
  const after3 = level(-10, window * 3, loud);
  assert.ok(after1.gain < loud.gain && after1.gain > -8, `moves, not jumps (${after1.gain})`);
  assert.ok(Math.abs(after3.gain - -8) < 1, `settles after ~3 windows (${after3.gain})`);
});

test("autoGainStep: a long dt (throttled background tab) can't overshoot", () => {
  const s = AVFX.autoGainStep(level(-30, 10), -10, 60);
  assert.ok(Math.abs(s.gain - -8) < 1e-6);
});

// ---------- frame rate ----------

const frames = (fps, n = 60, jitter = 0) => Array.from({ length: n }, (_, i) => 1 / fps + (i % 2 ? jitter : -jitter));

test("frameDuration: common frame rates", () => {
  for (const fps of [24, 25, 30, 50, 60, 120]) {
    assert.ok(Math.abs(AVFX.frameDuration(frames(fps)) - 1 / fps) < 1e-9, String(fps));
  }
});

test("frameDuration: NTSC rates aren't mistaken for whole ones", () => {
  assert.equal(AVFX.frameDuration(frames(23.976)), 1 / 23.976);
  assert.equal(AVFX.frameDuration(frames(29.97)), 1 / 29.97);
  assert.equal(AVFX.frameDuration(frames(59.94)), 1 / 59.94);
});

test("frameDuration: millisecond timestamps (WebM 24 fps = 41/42 ms)", () => {
  const ms = Array.from({ length: 60 }, (_, i) => (Math.round((i + 1) * 1000 / 24) - Math.round(i * 1000 / 24)) / 1000);
  assert.equal(AVFX.frameDuration(ms), 1 / 24);
  const ms25 = Array(60).fill(0.04);
  assert.equal(AVFX.frameDuration(ms25), 1 / 25);
});

test("frameDuration: seeks and stalls are ignored", () => {
  const samples = frames(25);
  samples[10] = 5; // seek forward
  samples[20] = -3; // seek back
  samples[30] = 0.12; // stall: 3 frames at once
  samples[40] = 0;
  assert.equal(AVFX.frameDuration(samples), 1 / 25);
});

test("frameDuration: an uncommon rate is kept as measured", () => {
  assert.ok(Math.abs(1 / AVFX.frameDuration(frames(15)) - 15) < 1e-9);
  assert.ok(Math.abs(1 / AVFX.frameDuration(frames(10)) - 10) < 1e-9);
});

test("frameDuration: too few or useless samples give null", () => {
  assert.equal(AVFX.frameDuration([]), null);
  assert.equal(AVFX.frameDuration(frames(25, 5)), null);
  assert.equal(AVFX.frameDuration(Array(60).fill(0)), null);
  assert.equal(AVFX.frameDuration(Array(60).fill(NaN)), null);
});

test("crossfader: gains, automatic position and sanitizing", () => {
  const g = (p) => plain(AVFX.crossfadeGains(p));
  assert.deepEqual(g(0), { a: 1, b: 1 });
  assert.deepEqual(g(-100), { a: 1, b: 0 });
  assert.deepEqual(g(100), { a: 0, b: 1 });
  assert.deepEqual(g(-25), { a: 1, b: 0.75 });
  assert.deepEqual(g(500), { a: 0, b: 1 });
  const c = { position: 30, auto: true, duck: 20 };
  assert.equal(AVFX.crossfadePosition(c, false), 30);
  assert.equal(AVFX.crossfadePosition(c, true), -80);
  assert.equal(AVFX.crossfadePosition({ ...c, position: -95 }, true), -95, "the slider may go lower");
  assert.equal(AVFX.crossfadePosition({ ...c, auto: false }, true), 30);
  assert.deepEqual(plain(AVFX.sanitizeCrossfade(null)), plain(AVFX.CROSSFADE_DEFAULTS));
  assert.deepEqual(plain(AVFX.sanitizeCrossfade({ a: 3, b: 3, position: -300, auto: 1, duck: "x" })), {
    a: 3, b: null, position: -100, auto: false, duck: 25, trigger: "sound",
  });
  assert.equal(AVFX.sanitizeCrossfade({ a: -1, b: 1.5 }).a, null);
});

// ---------- Detection ----------

// Frame levels (dB per 20 ms) of a signal whose amplitude follows amp(t).
const levelsOf = (amp, seconds = 2) => {
  const n = (seconds * 1000) / 20;
  return Array.from({ length: n }, (_, i) => 20 * Math.log10(Math.max(1e-6, amp((i * 20) / 1000))));
};

test("levelSpread: speech with pauses spreads, a held note doesn't", () => {
  const { VOICE } = AVFX;
  const speech = AVFX.levelSpread(levelsOf((t) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * 0.3 + 0.003), VOICE.clamp);
  assert.ok(speech >= VOICE.minStd, `speech ${speech}`);
  const note = AVFX.levelSpread(levelsOf((t) => 0.3 * (1 + 0.1 * Math.sin(2 * Math.PI * 0.5 * t))), VOICE.clamp);
  assert.ok(note < VOICE.minStd, `note ${note}`);
  // gaps (frames not measured) are skipped, digital silence counts as the clamp
  const gappy = levelsOf((t) => Math.max(0, Math.sin(2 * Math.PI * 4 * t)) * 0.3 + 0.003).map((v, i) => (i % 5 === 0 ? NaN : v));
  assert.ok(AVFX.levelSpread(gappy, VOICE.clamp) >= VOICE.minStd);
  assert.ok(AVFX.levelSpread([...Array(50).fill(-20), ...Array(50).fill(-400)], VOICE.clamp) === 25);
  assert.equal(AVFX.levelSpread([NaN, NaN], VOICE.clamp), 0);
});

test("frameLevels and channelCorrelation", () => {
  const rate = 1000;
  const left = Float32Array.from({ length: 100 }, (_, i) => (i < 50 ? 0 : 0.5));
  const levels = AVFX.frameLevels(left, left, rate, 20);
  assert.equal(levels.length, 5);
  assert.ok(levels[0] < -100 && Math.abs(levels[4] - 20 * Math.log10(0.5)) < 0.01);
  const sine = Float32Array.from({ length: 1000 }, (_, i) => Math.sin(i / 7));
  assert.ok(Math.abs(AVFX.channelCorrelation(sine, sine) - 1) < 1e-9);
  assert.ok(Math.abs(AVFX.channelCorrelation(sine, sine.map((v) => -v)) + 1) < 1e-9);
  assert.equal(AVFX.channelCorrelation(sine, new Float32Array(1000)), 1, "silent right channel: mono");
});

test("bandShare: power in the speech band", () => {
  const binHz = 10;
  const db = (inBand, outBand) => Float32Array.from({ length: 2000 }, (_, k) => (k * binHz >= 250 && k * binHz <= 4000 ? inBand : outBand));
  assert.ok(AVFX.bandShare(db(-20, -80), db(-20, -80), binHz, 250, 4000) > 0.99);
  assert.ok(AVFX.bandShare(db(-80, -20), db(-80, -20), binHz, 250, 4000) < 0.01);
  assert.equal(AVFX.bandShare(db(-Infinity, -Infinity), db(-Infinity, -Infinity), binHz, 250, 4000), 0);
});

test("isVoice: every feature has to agree", () => {
  const voice = { level: -25, share: 0.8, std: 8, corr: 0.95 };
  assert.equal(AVFX.isVoice(voice), true);
  for (const [key, value] of [["level", -60], ["share", 0.3], ["std", 2], ["corr", 0]]) {
    assert.equal(AVFX.isVoice({ ...voice, [key]: value }), false, key);
  }
});

test("envelopeMatch: finds the same audio at its offset, not different audio", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296) * 30 - 60;
  const base = Array.from({ length: 800 }, rnd);
  const a = { start: 1000, values: base.slice(100, 700) };
  const b = { start: 1040, values: base.slice(100, 700).map((v) => v - 6) }; // 40 frames later, quieter
  const m = AVFX.envelopeMatch(a, b, 150, 200, 3);
  assert.equal(m.lag, 40);
  assert.ok(m.corr > 0.99);
  const other = { start: 1000, values: Array.from({ length: 600 }, rnd) };
  assert.ok(AVFX.envelopeMatch(a, other, 150, 200, 3).corr < 0.5);
  // gaps (null) are skipped; too little overlap or a flat level gives nothing
  const gappy = { ...b, values: b.values.map((v, i) => (i % 3 ? v : null)) };
  assert.equal(AVFX.envelopeMatch(a, gappy, 150, 200, 3).lag, 40);
  assert.equal(AVFX.envelopeMatch(a, { start: 1000, values: a.values.slice(0, 100) }, 150, 200, 3), null);
  assert.equal(AVFX.envelopeMatch(a, { start: 1000, values: a.values.map(() => -30) }, 150, 200, 3), null);
});
