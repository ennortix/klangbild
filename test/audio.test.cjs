// Runs the stereo part of content.js's audio graph in a real Chrome (Web Audio can't be
// tested in Node). Skipped when no Chrome is found; set CHROME_PATH to point at one.
// The node layout below mirrors buildChain() in src/content.js: keep them in sync.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const COMMON = fs.readFileSync(path.join(__dirname, "..", "src", "common.js"), "utf8");
const skip = !fs.existsSync(CHROME) && `no Chrome at ${CHROME} (set CHROME_PATH)`;

let browser;
let page;

before(async () => {
  if (skip) return;
  const puppeteer = require("puppeteer-core");
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    // Muted: the tests measure inside the page, nothing needs to reach the speakers.
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  page = await browser.newPage();
  await page.goto("about:blank");
  // common.js with a minimal extension API, as in the content script.
  await page.evaluate(`globalThis.browser = { runtime: { onMessage: { addListener() {} } }, i18n: {} };`);
  await page.evaluate(COMMON.replace("globalThis.browser = globalThis.chrome;", ""));
});

after(() => browser?.close());

// Renders input L = 1, R = 0.25 through stereoMix -> splitter -> matrix -> merger -> panner.
function render(settings, channels = 2) {
  return page.evaluate(
    async (patch, channels) => {
      const s = { ...AVFX.DEFAULTS, ...patch };
      const ac = new OfflineAudioContext(2, 4800, 48000);
      const buf = ac.createBuffer(channels, 4800, 48000);
      buf.getChannelData(0).fill(1);
      if (channels > 1) buf.getChannelData(1).fill(0.25);
      const src = ac.createBufferSource();
      src.buffer = buf;

      const stereoMix = ac.createGain();
      stereoMix.channelCountMode = "explicit";
      stereoMix.channelInterpretation = "speakers";
      stereoMix.channelCount = 2;
      const splitter = ac.createChannelSplitter(2);
      const merger = ac.createChannelMerger(2);
      const gains = AVFX.stereoGains(s);
      for (const from of [0, 1]) {
        for (const to of [0, 1]) {
          const g = ac.createGain();
          g.gain.value = gains[from][to];
          splitter.connect(g, from);
          g.connect(merger, 0, to);
        }
      }
      const panner = ac.createStereoPanner();
      panner.pan.value = s.pan / 100;
      src.connect(stereoMix);
      stereoMix.connect(splitter);
      merger.connect(panner);
      panner.connect(ac.destination);
      src.start();
      const out = await ac.startRendering();
      return [0, 1].map((c) => Math.round(out.getChannelData(c)[2400] * 1000) / 1000);
    },
    settings,
    channels
  );
}

test("original stereo passes unchanged", { skip }, async () => {
  assert.deepEqual(await render({}), [1, 0.25]);
});

test("swap exchanges the channels", { skip }, async () => {
  assert.deepEqual(await render({ swap: true }), [0.25, 1]);
});

test("width 0 is a mono mix", { skip }, async () => {
  assert.deepEqual(await render({ width: 0 }), [0.625, 0.625]);
});

test("width 200 widens", { skip }, async () => {
  assert.deepEqual(await render({ width: 200 }), [1.375, -0.125]);
});

test("mono plays on both sides (also with swap and width)", { skip }, async () => {
  for (const patch of [{ mono: true }, { mono: true, swap: true }, { mono: true, width: 200 }]) {
    assert.deepEqual(await render(patch), [0.625, 0.625], JSON.stringify(patch));
  }
});

test("a mono source plays on both sides", { skip }, async () => {
  assert.deepEqual(await render({}, 1), [1, 1]);
  assert.deepEqual(await render({ swap: true }, 1), [1, 1]);
});

// The sleep timer fades with element.volume, which must still act on an element
// that is routed through Web Audio.
test("element.volume still applies after createMediaElementSource", { skip }, async () => {
  const { full, low } = await page.evaluate(async () => {
    const sr = 48000;
    const n = sr * 2;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / sr) * 2 * Math.PI * 440) * 16000, true);

    const audio = new Audio(URL.createObjectURL(new Blob([buf], { type: "audio/wav" })));
    audio.loop = true;
    const ac = new AudioContext();
    const an = ac.createAnalyser();
    ac.createMediaElementSource(audio).connect(an);
    an.connect(ac.destination);
    await audio.play();
    await ac.resume();
    const rms = async () => {
      await new Promise((r) => setTimeout(r, 300));
      const d = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(d);
      return Math.sqrt(d.reduce((s, x) => s + x * x, 0) / d.length);
    };
    const full = await rms();
    audio.volume = 0.1;
    const low = await rms();
    audio.pause();
    return { full, low };
  });
  assert.ok(full > 0.1, `signal present (${full})`);
  assert.ok(Math.abs(low / full - 0.1) < 0.03, `10 % volume gives ${low / full}`);
});
