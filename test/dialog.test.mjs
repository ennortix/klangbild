import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { read } from "./helpers.mjs";

const ctx = vm.createContext({ Math, Float64Array, Uint32Array });
ctx.globalThis = ctx;
vm.runInContext(read("dialog.js"), ctx);
const D = ctx.AVFXDialog;
const RATE = 48000;

// Deterministic noise
function noise(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 2147483648 - 1;
  };
}

// Runs `seconds` of stereo input through a processor in 128-sample blocks (like an
// AudioWorklet) and returns the output.
function run(amount, makeL, makeR, seconds = 1) {
  const p = D.createProcessor(RATE);
  p.setAmount(amount);
  const n = Math.round(RATE * seconds);
  const xL = new Float64Array(n);
  const xR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xL[i] = makeL(i);
    xR[i] = makeR(i);
  }
  const yL = new Float64Array(n);
  const yR = new Float64Array(n);
  for (let i = 0; i < n; i += 128) {
    p.process(xL.subarray(i, i + 128), xR.subarray(i, i + 128), yL.subarray(i, i + 128), yR.subarray(i, i + 128));
  }
  return { xL, xR, yL, yR, latency: p.latency };
}

const rmsDb = (a, from = 0) => {
  let s = 0;
  for (let i = from; i < a.length; i++) s += a[i] * a[i];
  return 10 * Math.log10(s / (a.length - from));
};

// Level of one sine frequency (Goertzel-like projection) in the output.
function toneDb(a, hz, from) {
  let c = 0;
  let s = 0;
  for (let i = from; i < a.length; i++) {
    c += a[i] * Math.cos((2 * Math.PI * hz * i) / RATE);
    s += a[i] * Math.sin((2 * Math.PI * hz * i) / RATE);
  }
  return 20 * Math.log10((2 * Math.hypot(c, s)) / (a.length - from));
}

test("FFT: forward then inverse returns the input", () => {
  const fft = D.makeFft(64);
  const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i) + i / 10);
  const im = Float64Array.from({ length: 64 }, (_, i) => Math.cos(i * 3));
  const [r0, i0] = [re.slice(), im.slice()];
  fft(re, im, false);
  fft(re, im, true);
  for (let i = 0; i < 64; i++) {
    assert.ok(Math.abs(re[i] / 64 - r0[i]) < 1e-9 && Math.abs(im[i] / 64 - i0[i]) < 1e-9, `sample ${i}`);
  }
});

test("gains: 0 is neutral, the ends cut the other part by MAX_DB", () => {
  assert.deepEqual([...D.gains(0)], [1, 1]);
  const [v, b] = D.gains(100);
  assert.equal(v, 1);
  assert.ok(Math.abs(20 * Math.log10(b) + D.MAX_DB) < 1e-9);
  const [v2, b2] = D.gains(-100);
  assert.equal(b2, 1);
  assert.ok(Math.abs(20 * Math.log10(v2) + D.MAX_DB) < 1e-9);
  assert.deepEqual([...D.gains(500)], [...D.gains(100)], "clamped");
});

test("bandWeight: 1 in the speech band, 0 an octave outside", () => {
  assert.equal(D.bandWeight(1000), 1);
  assert.equal(D.bandWeight(150), 1);
  assert.equal(D.bandWeight(75), 0);
  assert.equal(D.bandWeight(12000), 0);
  assert.equal(D.bandWeight(0), 0);
  assert.ok(D.bandWeight(100) > 0 && D.bandWeight(100) < 1);
});

test("with gains of 1 the processor is transparent, only delayed by its latency", () => {
  const rnd = noise(1);
  const rnd2 = noise(2);
  const { xL, xR, yL, yR, latency } = run(0, () => rnd() * 0.5, () => rnd2() * 0.5, 0.25);
  let err = 0;
  for (let i = latency; i < xL.length; i++) {
    err = Math.max(err, Math.abs(yL[i] - xL[i - latency]), Math.abs(yR[i] - xR[i - latency]));
  }
  assert.ok(err < 1e-9, `max error ${err}`);
});

// Noise limited to roughly the speech band (difference of two one-pole lowpasses),
// so the frequency weighting alone can't remove it.
function bandNoise(seed) {
  const rnd = noise(seed);
  let a = 0;
  let b = 0;
  return () => {
    const x = rnd();
    a += 0.5 * (x - a);
    b += 0.02 * (x - b);
    return (a - b) * 2;
  };
}

test("positive: a centered voice-band tone stays, decorrelated noise in the speech band drops", () => {
  const tone = (i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  const from = RATE / 4; // after the statistics settled
  const toneChange = toneDb(run(100, tone, tone).yL, 1000, from) - toneDb(run(0, tone, tone).yL, 1000, from);
  assert.ok(Math.abs(toneChange) < 0.5, `tone changed by ${toneChange.toFixed(2)} dB`);

  const noiseOf = (amount) => {
    const l = bandNoise(5);
    const r = bandNoise(6);
    return rmsDb(run(amount, l, r).yL, from);
  };
  const noiseChange = noiseOf(100) - noiseOf(0);
  assert.ok(noiseChange < -12, `speech-band noise only changed by ${noiseChange.toFixed(2)} dB`);

  // Both at once: the tone keeps its level while the noise around it drops.
  const l = bandNoise(7);
  const r = bandNoise(8);
  const mixL = (i) => tone(i) + l();
  const mixR = (i) => tone(i) + r();
  const mixed = run(100, mixL, mixR);
  const l2 = bandNoise(7);
  const r2 = bandNoise(8);
  const plain = run(0, (i) => tone(i) + l2(), (i) => tone(i) + r2());
  const mixedTone = toneDb(mixed.yL, 1000, from) - toneDb(plain.yL, 1000, from);
  assert.ok(Math.abs(mixedTone) < 2, `tone in the mix changed by ${mixedTone.toFixed(2)} dB`);
});

test("negative: the centered tone drops, a hard-panned tone stays", () => {
  const center = (i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  const left = (i) => 0.3 * Math.sin((2 * Math.PI * 2500 * i) / RATE);
  const L = (i) => center(i) + left(i);
  const R = (i) => center(i);
  const from = RATE / 4;
  const neutral = run(0, L, R);
  const quiet = run(-100, L, R);
  const centerChange = toneDb(quiet.yR, 1000, from) - toneDb(neutral.yR, 1000, from);
  const sideChange = toneDb(quiet.yL, 2500, from) - toneDb(neutral.yL, 2500, from);
  assert.ok(centerChange < -15, `center tone changed by ${centerChange.toFixed(2)} dB`);
  assert.ok(Math.abs(sideChange) < 1.5, `panned tone changed by ${sideChange.toFixed(2)} dB`);
});

test("a NaN or Infinity sample doesn't break the separation for good", () => {
  const tone = (i) => 0.3 * Math.sin((2 * Math.PI * 1000 * i) / RATE);
  const from = RATE / 2;
  const clean = toneDb(run(100, tone, tone).yL, 1000, from);
  for (const bad of [NaN, Infinity, -Infinity]) {
    const glitch = (i) => (i === 3000 ? bad : tone(i));
    const out = run(100, glitch, glitch);
    assert.ok(out.yL.every(Number.isFinite), `${bad}: output stays finite`);
    const level = toneDb(out.yL, 1000, from);
    assert.ok(Math.abs(level - clean) < 0.5, `${bad}: centered tone ${level.toFixed(1)} dB, clean ${clean.toFixed(1)} dB`);
  }
});

test("centered bass outside the speech band counts as background", () => {
  const bass = (i) => 0.3 * Math.sin((2 * Math.PI * 50 * i) / RATE);
  const from = RATE / 4;
  const neutral = run(0, bass, bass);
  const voice = run(100, bass, bass);
  const change = toneDb(voice.yL, 50, from) - toneDb(neutral.yL, 50, from);
  assert.ok(change < -15, `centered 50 Hz changed by ${change.toFixed(2)} dB`);
});
