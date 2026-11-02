// End-to-end: the built Chrome extension in a real (headless) Chrome against local test
// pages. Messages go through the extension's service worker exactly like the popup's,
// levels are read back from the content script's own analyser ("spectrum").
// Skipped without Chrome; set CHROME_PATH to point at one.
//
// Fixtures: test/fixtures/video-<fps>fps.webm, made with
//   ffmpeg -f lavfi -i testsrc2=size=160x90:rate=<fps> -t 6 -c:v libvpx-vp9 -b:v 40k video-<fps>fps.webm
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const skip = !fs.existsSync(CHROME) && `no Chrome at ${CHROME} (set CHROME_PATH)`;

// 16-bit stereo PCM WAV from two sample functions (-1..1).
function wavOf(fnL, fnR, { seconds = 4, rate = 48000 } = {}) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fnL(i, rate))) * 32767), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fnR(i, rate))) * 32767), 46 + i * 4);
  }
  return buf;
}

// Deterministic noise in roughly the speech band (difference of two one-pole lowpasses).
function bandNoise(seed) {
  let s = seed;
  let a = 0;
  let b = 0;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const x = s / 2147483648 - 1;
    a += 0.5 * (x - a);
    b += 0.02 * (x - b);
    return (a - b) * 2;
  };
}

// "Dialog" in the center (a quiet 1 kHz tone), louder unrelated noise left and right.
function dialogWav() {
  const nl = bandNoise(1);
  const nr = bandNoise(2);
  const tone = (i, rate) => 0.15 * Math.sin((2 * Math.PI * 1000 * i) / rate);
  return wavOf((i, rate) => tone(i, rate) + 0.6 * nl(), (i, rate) => tone(i, rate) + 0.6 * nr(), { seconds: 12 });
}

// 16-bit stereo PCM WAV with a 440 Hz sine; amplitude per channel (0 = silent).
function wav({ left, right, seconds = 4, rate = 48000 }) {
  const n = seconds * rate;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.sin((i / rate) * 2 * Math.PI * 440) * 32767;
    buf.writeInt16LE(Math.round(v * left), 44 + i * 4);
    buf.writeInt16LE(Math.round(v * right), 46 + i * 4);
  }
  return buf;
}

// 3 s cycles: 1 s of a 440 Hz tone (-13 dBFS), then 2 s of faint noise (about -60 dBFS).
function pausesWav() {
  const noise = bandNoise(3);
  const fn = (i, rate) => ((i / rate) % 3 < 1 ? 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate) : 0.002 * noise());
  return wavOf(fn, fn, { seconds: 21 });
}

const FILES = {
  "/left.wav": ["audio/wav", wav({ left: 0.5, right: 0 })],
  "/pauses.wav": ["audio/wav", pausesWav()],
  // long enough for "continue watching" (2 minutes and more), small at 8 kHz
  "/long.wav": ["audio/wav", wav({ left: 0.05, right: 0.05, seconds: 150, rate: 8000 })],
  "/quiet.wav": ["audio/wav", wav({ left: 0.02, right: 0.02, seconds: 12 })],
  "/loud.wav": ["audio/wav", wav({ left: 0.9, right: 0.9, seconds: 12 })],
  "/dialog.wav": ["audio/wav", dialogWav()],
};
for (const f of fs.readdirSync(path.join(__dirname, "fixtures"))) {
  FILES[`/${f}`] = ["video/webm", fs.readFileSync(path.join(__dirname, "fixtures", f))];
}

// Media is served with Range support: without it `seekable` stays empty and Chrome
// ignores every currentTime change, as it would on a real site without it.
function serveFile(req, res, [type, body]) {
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!range) {
    res.writeHead(200, { "content-type": type, "content-length": body.length, "accept-ranges": "bytes" });
    return res.end(body);
  }
  const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
  const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
  res.writeHead(206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${body.length}`,
    "accept-ranges": "bytes",
  });
  res.end(body.subarray(start, end + 1));
}

// routed=1: the element carries Klangbild's "routed" mark, as if an older instance had
// routed it. lock=1: and the page really routes it into its own AudioContext first, so
// nobody else can (what an older Klangbild in Firefox leaves behind after an update).
// dark=1: black page with room around the picture (for the ambilight).
function page(tag, src, { routed = false, lock = false, dark = false } = {}) {
  const size = tag === "video" ? 'width="320" height="180"' : "";
  const body = dark ? "margin:0;padding:100px;background:#000" : "margin:0";
  const mark = routed || lock ? " data-klangbild-audio" : "";
  const script = lock
    ? `<script>const c = new AudioContext(); c.createMediaElementSource(document.getElementById("m")).connect(c.destination);</script>`
    : "";
  return `<!doctype html><meta charset="utf-8"><body style="${body}"><${tag} id="m" src="${src}" loop autoplay ${size}${mark}></${tag}>${script}`;
}

let server;
let origin;
let browser;
let worker;
let workerTarget;
let pageCount = 0;

before(async () => {
  if (skip) return;
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build.mjs"), "chrome"], { stdio: "ignore" });

  server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (FILES[url.pathname]) return serveFile(req, res, FILES[url.pathname]);
    if (url.pathname === "/media.html") {
      // csp=1: a strict policy like many big sites (no foreign scripts or workers).
      const csp = url.searchParams.get("csp") ? { "content-security-policy": "default-src 'self'; script-src 'none'; worker-src 'none'" } : {};
      res.writeHead(200, { "content-type": "text/html", ...csp });
      const q = (k) => url.searchParams.has(k);
      return res.end(page(url.searchParams.get("tag"), url.searchParams.get("src"), { routed: q("routed"), lock: q("lock"), dark: q("dark") }));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;

  const puppeteer = require("puppeteer-core");
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    pipe: true, // required for enableExtensions with paths
    enableExtensions: [path.join(ROOT, "dist", "chrome")],
    // Muted: the tests measure inside the page, nothing needs to reach the speakers.
    args: ["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
  });
  workerTarget = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().endsWith("/background.js"));
  worker = await workerTarget.worker();
});

after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  server?.close();
});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeout = 5000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(100);
  }
  throw new Error("timed out");
}

// Opens a test page in its own tab (unique URL, so the tab can be found again) and
// runs fn({ tab, send }). The tab is always closed afterwards.
// With `playing`, it waits until the media plays and the content script tracks it.
async function withMedia(tag, src, fn, { playing = true, csp = false, query = "" } = {}) {
  const tab = await browser.newPage();
  try {
    const url = `${origin}/media.html?tag=${tag}&src=${encodeURIComponent(src)}&n=${++pageCount}${csp ? "&csp=1" : ""}${query}`;
    await tab.goto(url);
    const tabId = await worker.evaluate((url) => chrome.tabs.query({ url }).then((t) => t[0].id), url);
    const send = (msg) => worker.evaluate((id, msg) => chrome.tabs.sendMessage(id, msg, { frameId: 0 }), tabId, msg);
    if (playing) {
      await tab.waitForFunction(() => {
        const m = document.getElementById("m");
        return !m.paused && m.currentTime > 0.2;
      });
      await waitFor(async () => (await send({ type: "get" }))?.mediaCount === 1);
    }
    return await fn({ tab, send, tabId, url });
  } finally {
    await tab.close();
  }
}

// The frame's media list as the sidebar's mixer sees it.
const mediaListOf = (tabId) =>
  worker.evaluate(
    (id) =>
      chrome.scripting
        .executeScript({ target: { tabId: id }, func: () => globalThis.__avfxMediaList?.() ?? null })
        .then((r) => r[0].result),
    tabId
  );

const mediaProp = (tab, expr) => tab.evaluate(`(() => { const m = document.getElementById("m"); return ${expr}; })()`);

// RMS in dBFS at the end of the content script's chain, averaged over a few reads.
async function levelDb(send, reads = 5) {
  let sum = 0;
  for (let i = 0; i < reads; i++) {
    sum += (await send({ type: "spectrum" })).rms ?? -Infinity; // silence: -Infinity arrives as null
    await pause(60);
  }
  return sum / reads;
}

// Sends settings and waits for the parameter ramps to settle.
async function set(send, settings, settle = 400) {
  await send({ type: "set", settings });
  await pause(settle);
}

test("content script reports the media and the defaults", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ send }) => {
    const state = await send({ type: "get" });
    assert.equal(state.mediaCount, 1);
    assert.equal(state.settings.volume, 100);
    assert.equal(state.disabled, undefined);
  }));

test("mono keeps the level of a one-sided source (regression: right channel was silent)", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ send }) => {
    await set(send, { swap: true }); // routes through Web Audio, level unchanged
    const stereo = await levelDb(send);
    await set(send, { mono: true });
    const mono = await levelDb(send);
    assert.ok(Number.isFinite(stereo) && stereo > -40, `signal present (${stereo})`);
    assert.ok(Math.abs(mono - stereo) < 1, `mono ${mono.toFixed(1)} dB vs stereo ${stereo.toFixed(1)} dB`);
  }));

test("volume 50 % lowers the level by 6 dB", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ send }) => {
    await set(send, { swap: true });
    const full = await levelDb(send);
    await set(send, { swap: true, volume: 50 });
    const half = await levelDb(send);
    assert.ok(Math.abs(full - half - 6.02) < 0.5, `${(full - half).toFixed(2)} dB`);
  }));

for (const [file, direction] of [["/quiet.wav", 1], ["/loud.wav", -1]]) {
  test(`loudness leveling ${direction > 0 ? "raises quiet" : "lowers loud"} media`, { skip }, () =>
    withMedia("audio", file, async ({ send }) => {
      await set(send, { limiter: true }); // same chain, without leveling
      const before = await levelDb(send);
      await set(send, { autoGain: true }, 5000);
      const after = await levelDb(send);
      assert.ok((after - before) * direction > 8, `${before.toFixed(1)} → ${after.toFixed(1)} dB`);
      await set(send, { limiter: true }); // off again
      const off = await levelDb(send);
      assert.ok(Math.abs(off - before) < 1, `switching off restores the level (${off.toFixed(1)} dB)`);
    }));
}

for (const fps of [24, 50]) {
  test(`frame step uses the measured frame rate (${fps} fps)`, { skip }, () =>
    withMedia("video", `/video-${fps}fps.webm`, async ({ tab, send }) => {
      let state;
      await waitFor(async () => {
        state = (await send({ type: "action", action: "state" })).state;
        return state.video?.fps;
      });
      assert.equal(state.video.fps, fps);
      await send({ type: "action", action: "frame", dir: 1 }); // pauses
      const t0 = await mediaProp(tab, "m.currentTime");
      await send({ type: "action", action: "frame", dir: 1 });
      const t1 = await mediaProp(tab, "m.currentTime");
      await send({ type: "action", action: "frame", dir: -1 });
      const t2 = await mediaProp(tab, "m.currentTime");
      assert.ok(Math.abs(t1 - t0 - 1 / fps) < 1e-3, `forward ${(t1 - t0).toFixed(4)} s`);
      assert.ok(Math.abs(t2 - t0) < 1e-3, `back ${(t2 - t0).toFixed(4)} s`);
    }));
}

test("frame step before the rate is known falls back to 1/30 s", { skip }, (t) =>
  withMedia(
    "video",
    "/video-24fps.webm",
    async ({ tab, send }) => {
      // Paused before any frame is presented: nothing measured yet.
      await tab.evaluate(() => {
        const m = document.getElementById("m");
        m.autoplay = false;
        m.pause();
      });
      await waitFor(async () => (await send({ type: "get" }))?.mediaCount === 1);
      await waitFor(() => mediaProp(tab, "m.readyState >= 2"));
      const t0 = await mediaProp(tab, "m.currentTime");
      await send({ type: "action", action: "frame", dir: 1 });
      const t1 = await mediaProp(tab, "m.currentTime");
      const state = (await send({ type: "action", action: "state" })).state;
      if (state.video?.fps) return t.skip("the browser presented enough frames before the pause");
      assert.ok(Math.abs(t1 - t0 - 1 / 30) < 1e-3, `step ${(t1 - t0).toFixed(4)} s`);
    },
    { playing: false }
  ));

test("seek clamps at the start and the end", { skip }, () =>
  withMedia("video", "/video-24fps.webm", async ({ tab, send }) => {
    await tab.evaluate(() => {
      const m = document.getElementById("m");
      m.loop = false;
      m.pause();
    });
    await send({ type: "action", action: "seek", seconds: -1000 });
    assert.equal(await mediaProp(tab, "m.currentTime"), 0);
    await send({ type: "action", action: "seek", seconds: 1000 });
    const [time, duration] = await mediaProp(tab, "[m.currentTime, m.duration]");
    assert.equal(time, duration);
  }));

test("video filters and offset reach the element and go away again", { skip }, () =>
  withMedia("video", "/video-24fps.webm", async ({ tab, send }) => {
    await send({ type: "set", settings: { gamma: 1.5, colorVision: "deutan", offsetX: 10 } });
    const css = await tab.evaluate(() => {
      const m = document.getElementById("m");
      const filter = document.getElementById("avfx-filter");
      return {
        filter: m.style.filter,
        transform: m.style.transform,
        steps: filter ? [...filter.children].map((c) => c.localName) : null,
      };
    });
    assert.match(css.filter, /url\("?#avfx-filter"?\)/);
    assert.match(css.transform, /translate\(10%(, 0%)?\)/);
    assert.deepEqual(css.steps, ["feComponentTransfer", "feColorMatrix"]);

    await send({ type: "set", settings: {} });
    assert.deepEqual(await mediaProp(tab, "[m.style.filter, m.style.transform]"), ["", ""]);
  }));

test("a disabled site is left alone and says so", { skip }, async () => {
  await worker.evaluate(() => chrome.storage.local.set({ disabledSites: ["127.0.0.1"] }));
  try {
    await withMedia(
      "video",
      "/video-24fps.webm",
      async ({ tab, send, tabId }) => {
        const state = await send({ type: "get" });
        assert.equal(state.disabled, true);
        // the mixer learns why it can't offer anything here
        assert.deepEqual(await mediaListOf(tabId), { disabled: true });
        await send({ type: "set", settings: { brightness: 50 } }).catch(() => {}); // nobody answers
        assert.equal(await mediaProp(tab, "m.style.filter"), "");
      },
      { playing: false }
    );
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove("disabledSites"));
  }
});

// Opens the panel page in a tab, as the sidebar (popup.html?sidebar) or the popup. Its
// "active tab" is the media tab: tabs.query({ active }) is pointed there.
async function openPanel(tabId, url, { sidebar }) {
  const extId = new URL(worker.url()).host;
  const panel = await browser.newPage();
  await panel.setViewport({ width: sidebar ? 320 : 400, height: 900 });
  await panel.evaluateOnNewDocument(
    (id, url) => {
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = async (q) => (q?.active ? [{ id, url, active: true }] : query(q));
    },
    tabId,
    url
  );
  await panel.goto(`chrome-extension://${extId}/popup/popup.html${sidebar ? "?sidebar" : ""}`);
  await panel.waitForFunction(() => document.querySelector(".row") && !document.getElementById("status").textContent.includes("…"));
  return panel;
}

const showSection = (panel, index) => panel.evaluate((i) => document.querySelectorAll("nav button")[i].click(), index);

const rowProp = (panel, key, expr) =>
  panel.evaluate((key, expr) => new Function("row", `return ${expr}`)(document.querySelector(`.row[data-key="${key}"]`)), key, expr);

test("sidebar: the timeline shows the media and its buttons seek", { skip }, () =>
  withMedia("video", "/video-24fps.webm", async ({ tab, tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: true });
    try {
      assert.equal(await panel.$eval("#timeline", (t) => t.hidden), false);
      await panel.waitForFunction(() => document.querySelector(".tl-time").textContent.includes("/"));
      const buttons = await panel.$$(".tl-btn"); // −30 −5 frame play frame +5 +30
      assert.equal(buttons.length, 7);
      // Chrome may already have paused the video of the background tab.
      await tab.evaluate(() => {
        const m = document.getElementById("m");
        m.loop = false;
        m.pause();
      });
      await buttons[3].click();
      await waitFor(async () => !(await mediaProp(tab, "m.paused")));
      await panel.waitForFunction(() => document.querySelectorAll(".tl-btn")[3].getAttribute("aria-pressed") === "true");
      await buttons[3].click();
      await waitFor(() => mediaProp(tab, "m.paused"));
      await tab.evaluate(() => (document.getElementById("m").currentTime = 0));
      await buttons[5].click();
      await waitFor(async () => Math.abs((await mediaProp(tab, "m.currentTime")) - 5) < 0.1);
      await panel.$eval(".tl-bar", (bar) => {
        bar.value = 2;
        bar.dispatchEvent(new Event("change"));
      });
      await waitFor(async () => Math.abs((await mediaProp(tab, "m.currentTime")) - 2) < 0.1);
      await buttons[0].click(); // −30 s clamps at the start
      await waitFor(async () => (await mediaProp(tab, "m.currentTime")) === 0);
      await panel.waitForFunction(() => document.querySelector(".tl-time").textContent.startsWith("0:00.0 /"));
    } finally {
      await panel.close();
    }
  }));

test("sidebar: extended limits, − / + and own slider steps", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ send, tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: true });
    try {
      assert.equal(await rowProp(panel, "volume", 'row.querySelector("input[type=range]").max'), "800");
      assert.equal(await rowProp(panel, "speed", 'row.querySelector("input[type=range]").max'), "16");
      await showSection(panel, 1); // Audio
      await panel.click('.row[data-key="volume"] .stepper:last-of-type');
      await waitFor(async () => (await send({ type: "get" })).settings.volume === 101);

      // Customize tab: volume step 10
      await showSection(panel, 5); // Customize
      const stepInput = await panel.evaluateHandle(() =>
        [...document.querySelectorAll(".setting-row")].find((r) => r.querySelector("input").placeholder === "1" && r.textContent.match(/Volume|Lautstärke/)).querySelector("input")
      );
      await stepInput.evaluate((i) => {
        i.value = "10";
        i.dispatchEvent(new Event("change"));
      });
      assert.equal(await rowProp(panel, "volume", 'row.querySelector("input[type=range]").step'), "10");
      await showSection(panel, 1);
      await panel.click('.row[data-key="volume"] .stepper:last-of-type');
      await waitFor(async () => (await send({ type: "get" })).settings.volume === 110);
      await panel.click('.row[data-key="volume"] .stepper:first-of-type');
      await waitFor(async () => (await send({ type: "get" })).settings.volume === 100);

      // Extended limits off: back to the everyday range
      await showSection(panel, 5);
      await panel.evaluate(() => document.querySelector('.panel.active .chip[aria-pressed="true"]').click());
      assert.equal(await rowProp(panel, "volume", 'row.querySelector("input[type=range]").max'), "400");
      const stored = await worker.evaluate(() => chrome.storage.local.get("sidebarUi"));
      assert.deepEqual(stored.sidebarUi, { extended: false, steps: { volume: 10 }, jumpShort: 5, jumpLong: 30 });
    } finally {
      await worker.evaluate(() => chrome.storage.local.remove("sidebarUi"));
      await panel.close();
    }
  }));

test("popup: compact, no timeline and the everyday ranges", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: false });
    try {
      assert.equal(await panel.$eval("#timeline", (t) => t.hidden), true);
      assert.equal(await panel.$(".stepper"), null);
      assert.equal(await rowProp(panel, "volume", 'row.querySelector("input[type=range]").max'), "400");
      assert.equal(await panel.$$eval("nav button", (b) => b.length), 4, "no Customize tab");
      assert.ok(await rowProp(panel, "audioDelay", 'row.querySelector(".name").title.length > 20'), "hint as tooltip");
      assert.equal(await rowProp(panel, "audioDelay", 'row.querySelector(".hint")'), null);
    } finally {
      await panel.close();
    }
  }));


for (const csp of [false, true]) {
  test(`voice ↔ background lowers decorrelated noise, keeps the centered tone${csp ? " (strict CSP page)" : ""}`, { skip }, () =>
    withMedia(
      "audio",
      "/dialog.wav",
      async ({ send, tabId }) => {
        await set(send, { swap: true, mono: false }); // Web Audio, neutral
        await set(send, { swap: false });
        const before = await levelDb(send, 8);
        await set(send, { dialog: 100 }, 1500); // the worklet module loads first
        const [item] = await mediaListOf(tabId);
        assert.ok(["worklet", "script"].includes(item.dialog), `dialog node: ${item.dialog}`);
        const after = await levelDb(send, 8);
        assert.ok(before - after > 5, `level ${before.toFixed(1)} → ${after.toFixed(1)} dB (${item.dialog})`);
        await set(send, { dialog: 0 }, 600);
        const back = await levelDb(send, 8);
        assert.ok(Math.abs(back - before) < 1.5, `back to ${back.toFixed(1)} dB (was ${before.toFixed(1)})`);
        assert.equal((await mediaListOf(tabId))[0].dialog, null, "node taken out of the chain at 0");
        console.log(`# dialog node on ${csp ? "strict CSP" : "normal"} page: ${item.dialog}`);
      },
      { csp }
    ));
}

test("mixer: lists the media, its own volume and mute change the level", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ send, tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: true });
    try {
      await showSection(panel, 4); // Mixer
      await panel.waitForSelector(".mixer-item");
      assert.equal(await panel.$eval(".mixer-name", (n) => n.textContent), "left.wav");
      assert.equal(await panel.$eval(".mixer-tab", (n) => n.classList.contains("current")), true);

      await set(send, { swap: true }); // so the level can be compared before and after
      const full = await levelDb(send);
      await panel.$eval(".mixer-controls input[type=range]", (r) => {
        r.value = 50;
        r.dispatchEvent(new Event("input"));
        r.dispatchEvent(new Event("change"));
      });
      await pause(400);
      const half = await levelDb(send);
      assert.ok(Math.abs(full - half - 6.02) < 0.7, `mixer 50 %: ${(full - half).toFixed(2)} dB`);
      assert.equal((await mediaListOf(tabId))[0].gain, 50);
      // the tab's own settings are untouched
      assert.equal((await send({ type: "get" })).settings.volume, 100);

      await panel.click(".mixer-controls .stepper");
      await pause(400);
      assert.ok((await levelDb(send)) < -80, "muted");
      await panel.waitForFunction(() => document.querySelector(".mixer-item").classList.contains("muted"));

      // the browser's tab mute
      await panel.click(".mixer-tab-head .chip");
      await waitFor(() => worker.evaluate((id) => chrome.tabs.get(id).then((t) => t.mutedInfo.muted), tabId));
    } finally {
      await panel.close();
    }
  }));

test("mixer: media from another origin without CORS is mixed through its own volume (no silence)", { skip }, () =>
  // localhost vs 127.0.0.1: same server, different origin, no CORS headers
  withMedia("audio", origin.replace("127.0.0.1", "localhost") + "/left.wav", async ({ tab, send, tabId }) => {
    const [item] = await mediaListOf(tabId);
    assert.equal(item.native, true);
    const id = item.id;
    assert.deepEqual(await send({ type: "media-mix", id, gain: 50 }), { ok: true });
    assert.equal(await mediaProp(tab, "m.volume"), 0.5);
    const after = (await mediaListOf(tabId))[0];
    assert.equal(after.hasAudioChain, false, "not routed through Web Audio");
    assert.equal(after.gain, 50);
    await send({ type: "media-mix", id, gain: 300 }); // capped at 100 %
    assert.equal(await mediaProp(tab, "m.volume"), 1);
    await send({ type: "media-mix", id, gain: 80 });
    await send({ type: "media-mix", id, muted: true });
    assert.equal(await mediaProp(tab, "m.volume"), 0);
    await send({ type: "media-mix", id, muted: false, gain: 100 });
    assert.equal(await mediaProp(tab, "m.volume"), 1, "the element's own volume is restored");
    assert.equal((await mediaListOf(tabId))[0].gain, 100);
  }));

test("sidebar: the timeline says so on a tab without access", { skip }, async () => {
  const panel = await openPanel(999999, "about:blank", { sidebar: true });
  try {
    await panel.waitForFunction(() => document.querySelector(".tl-time").textContent !== "" && !document.querySelector(".tl-time").textContent.endsWith("…"));
    const text = await panel.$eval(".tl-time", (n) => n.textContent);
    assert.equal(text, await panel.evaluate(() => chrome.i18n.getMessage("notAvailable")));
    assert.equal(await panel.$$eval(".tl-btn", (b) => b.every((x) => x.disabled)), true);
  } finally {
    await panel.close();
  }
});

test("panel: the host marker survives Chrome's i18n (U+0000 didn't)", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: false });
    try {
      // HOST_MARKER is the panel's own constant (popup.js). Chrome keeps U+0000 in a single
      // string substitution but drops it from an array, which is what AVFX.t() passes.
      assert.equal(await panel.evaluate("AVFX.t('rememberFor', HOST_MARKER).includes(HOST_MARKER)"), true);
      assert.equal(await panel.$eval("#rememberFor b", (b) => b.textContent), "127.0.0.1");
      // the analyzer's empty state fits its box in the compact popup
      await showSection(panel, 1);
      await panel.waitForFunction(() => !document.querySelector(".spectrum-empty").hidden);
      const fits = await panel.$eval(".spectrum-empty", (o) => o.scrollHeight <= o.clientHeight + 1);
      assert.equal(fits, true, "empty state fits the spectrum box");
    } finally {
      await panel.close();
    }
  }));

test("sidebar: a 200 px wide sidebar has no overlapping controls", { skip }, () =>
  withMedia("video", "/video-24fps.webm", async ({ tabId, url }) => {
    const panel = await openPanel(tabId, url, { sidebar: true });
    try {
      await panel.setViewport({ width: 200, height: 800 });
      await showSection(panel, 0);
      await pause(300);
      const r = await panel.evaluate(() => {
        const box = (n) => n.getBoundingClientRect();
        const overlap = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const buttons = [...document.querySelectorAll(".tl-btn")].map(box);
        const footer = [document.querySelector("footer .check"), document.getElementById("resetAll")].map(box);
        const speed = document.querySelector('.row[data-key="speed"]');
        return {
          scroll: document.documentElement.scrollWidth,
          buttonsOverlap: buttons.some((b, i) => i && overlap(buttons[i - 1], b)),
          buttonsInside: buttons.every((b) => b.right <= 200),
          contentFits: [...document.querySelectorAll(".tl-btn")].every((b) => b.scrollWidth <= b.clientWidth + 1),
          footerOverlap: overlap(footer[0], footer[1]),
          sliderWidth: box(speed.querySelector("input[type=range]")).width,
        };
      });
      assert.ok(r.scroll <= 200, `page width ${r.scroll}`);
      assert.equal(r.buttonsOverlap, false, "timeline buttons overlap");
      assert.equal(r.buttonsInside, true);
      assert.equal(r.contentFits, true, "timeline button content overflows");
      assert.equal(r.footerOverlap, false, "footer overlaps");
      assert.ok(r.sliderWidth > 120, `speed slider only ${r.sliderWidth} px`);
    } finally {
      await panel.close();
    }
  }));

test("an element held by another routing is reported at once, a false mark goes away", { skip }, async () => {
  // Marked but free (e.g. the page copied a routed element): reported, until routing works.
  await withMedia(
    "audio",
    "/left.wav",
    async ({ tabId, send }) => {
      assert.equal((await mediaListOf(tabId))[0].audioBlocked, true, "reported before any slider moved");
      await set(send, { volume: 50 });
      const [item] = await mediaListOf(tabId);
      assert.equal(item.hasAudioChain, true);
      assert.equal(item.audioBlocked, false, "the mark was wrong, the element is ours now");
    },
    { query: "&routed=1" }
  );
  // Really held: stays reported, also after a slider moved.
  await withMedia(
    "audio",
    "/left.wav",
    async ({ tabId, send }) => {
      assert.equal((await mediaListOf(tabId))[0].audioBlocked, true);
      await set(send, { volume: 50 });
      const [item] = await mediaListOf(tabId);
      assert.deepEqual([item.hasAudioChain, item.audioBlocked], [false, true]);
    },
    { query: "&lock=1" }
  );
});

test("panel: reload and continue at the same position when the sound is held elsewhere", { skip }, () =>
  withMedia(
    "audio",
    "/quiet.wav",
    async ({ tab, tabId, url }) => {
      const panel = await openPanel(tabId, url, { sidebar: true });
      try {
        await panel.waitForFunction(() => !document.getElementById("reloadResume").hidden, { timeout: 5000 });
        await mediaProp(tab, "(m.currentTime = 7.5, true)");
        await pause(200);
        const reloaded = tab.waitForNavigation();
        await panel.click("#reloadResume");
        await reloaded;
        await tab.waitForFunction(() => document.getElementById("m").currentTime > 7, { timeout: 8000 });
        assert.equal(await mediaProp(tab, "m.paused"), false, "keeps playing");
        // the position is used once: another reload starts at the beginning again
        await tab.reload();
        await pause(1000); // waiting right away sometimes still hits the old document
        await tab.waitForFunction(() => document.getElementById("m").currentTime > 0.2);
        assert.ok((await mediaProp(tab, "m.currentTime")) < 5);
      } finally {
        await panel.close();
      }
    },
    { query: "&lock=1" }
  ));

test("skip silence: pauses play 3× as fast, the sound at its speed, the saved time is counted", { skip }, () =>
  withMedia("audio", "/pauses.wav", async ({ tab, send }) => {
    await set(send, { skipSilence: true }, 0);
    // [position in the 3 s cycle, playbackRate] every 50 ms for 6 s
    const sample = (n) =>
      tab.evaluate(async (n) => {
        const m = document.getElementById("m");
        const out = [];
        for (let i = 0; i < n; i++) {
          out.push([m.currentTime % 3, m.playbackRate]);
          await new Promise((r) => setTimeout(r, 50));
        }
        return out;
      }, n);
    const samples = await sample(120);
    const tone = samples.filter(([p]) => p > 0.3 && p < 0.9);
    const quiet = samples.filter(([p]) => p > 1.6 && p < 2.8);
    assert.ok(tone.length > 5 && quiet.length > 5, `${tone.length} tone, ${quiet.length} pause samples`);
    assert.ok(tone.every(([, r]) => r === 1), `tone at 1×: ${JSON.stringify(tone.map(([, r]) => r))}`);
    const fast = quiet.filter(([, r]) => r === 3).length / quiet.length;
    assert.ok(fast > 0.8, `pauses at 3×: ${(fast * 100).toFixed(0)} %`);
    const { state } = await send({ type: "action", action: "state" });
    assert.ok(state.silenceSaved > 1, `saved ${state.silenceSaved} s`);

    await set(send, { skipSilence: true, speed: 1.5 }, 1500);
    const rates = [...new Set((await sample(60)).map(([, r]) => r))].sort();
    assert.deepEqual(rates, [1.5, 4.5], "on top of the speed setting");

    await set(send, { skipSilence: false, speed: 1 });
    await tab.waitForFunction(() => document.getElementById("m").playbackRate === 1, { timeout: 2000 });
  }));

test("continue watching: a longer recording continues where it was left, in a new tab", { skip }, async () => {
  const url = `${origin}/media.html?tag=audio&src=%2Flong.wav&n=resume-${++pageCount}`;
  const open = async (address = url) => {
    const tab = await browser.newPage();
    await tab.goto(address);
    await tab.waitForFunction(() => !document.getElementById("m").paused);
    return tab;
  };
  try {
    let tab = await open();
    await mediaProp(tab, "(m.currentTime = 75, true)");
    await pause(500);
    await mediaProp(tab, "(m.pause(), true)"); // saves at once
    await pause(500);
    await tab.close();

    tab = await open();
    await tab.waitForFunction(() => document.getElementById("m").currentTime > 70, { timeout: 5000 });
    const t = await mediaProp(tab, "m.currentTime");
    assert.ok(t < 80, `continued at ${t}`);
    await tab.close();

    // The page starting somewhere itself (a link with a time) wins.
    tab = await open(`${url}#start`);
    await mediaProp(tab, "(m.currentTime = 20, true)");
    await pause(1500);
    assert.ok((await mediaProp(tab, "m.currentTime")) < 40, "not pulled to the saved position");
    await tab.close();
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove("resumePositions"));
  }
});

test("rules: a matching address gets the rule's speed, also when a page changes its address itself", { skip }, async () => {
  const pattern = `${new URL(origin).host}/media.html?*rule=on*`;
  await worker.evaluate((pattern) => chrome.storage.local.set({ rules: [{ pattern, preset: "", speed: 1.5 }] }), pattern);
  try {
    await withMedia(
      "audio",
      "/quiet.wav",
      async ({ tab }) => {
        const rate = (r) => tab.waitForFunction((r) => document.getElementById("m").playbackRate === r, { timeout: 3000 }, r);
        await rate(1.5);
        await tab.evaluate(() => history.pushState(null, "", location.href.replace("rule=on", "rule=off")));
        await rate(1);
        await tab.evaluate(() => history.pushState(null, "", location.href.replace("rule=off", "rule=on")));
        await rate(1.5);
      },
      { query: "&rule=on" }
    );
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove("rules"));
  }
});

test("ambilight: a glow around the picture, the picture itself untouched", { skip }, () =>
  withMedia(
    "video",
    "/video-24fps.webm",
    async ({ tab, send }) => {
      await mediaProp(tab, "(m.pause(), m.currentTime = 0.5, true)");
      await pause(300);
      const box = await mediaProp(tab, "(() => { const r = m.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()");
      // RGB at points of a screenshot, read back through a canvas.
      const pixels = async (points) => {
        const png = await tab.screenshot({ encoding: "base64" });
        return tab.evaluate(
          async (png, points) => {
            const img = new Image();
            img.src = `data:image/png;base64,${png}`;
            await img.decode();
            const c = document.createElement("canvas");
            c.width = img.width;
            c.height = img.height;
            const ctx = c.getContext("2d");
            ctx.drawImage(img, 0, 0);
            return points.map(([x, y]) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3)]);
          },
          png,
          points
        );
      };
      const points = [
        [box.x - 15, box.y + box.h / 2], // left of the picture
        [box.x + box.w / 2, box.y - 15], // above
        [box.x + box.w / 2, box.y + box.h / 2], // inside
        [box.x + box.w + 95, box.y + box.h / 2], // far away: stays black
      ];
      const sum = (p) => p[0] + p[1] + p[2];
      const off = await pixels(points);
      await set(send, { ambilight: 100 }, 600);
      const on = await pixels(points);
      assert.deepEqual([sum(off[0]), sum(off[1])], [0, 0], "black page without");
      assert.ok(sum(on[0]) > 30 && sum(on[1]) > 30, `glow: ${JSON.stringify(on.slice(0, 2))}`);
      assert.ok(off[2].every((v, i) => Math.abs(v - on[2][i]) <= 2), `picture untouched: ${off[2]} vs ${on[2]}`);
      assert.equal(sum(on[3]), 0, "the glow fades out");
      // Clicks go through the glow to the page.
      assert.equal(await tab.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName, points[0]), "body");
      await set(send, { ambilight: 0 }, 300);
      assert.deepEqual((await pixels(points.slice(0, 1)))[0], off[0], "gone again");
    },
    { query: "&dark=1" }
  ));

test("panel sliders: double-click resets, the wheel steps, a bubble shows the value, the thumb turns like a knob (or drags)", { skip }, () =>
  withMedia("audio", "/quiet.wav", async ({ tabId, url }) => {
    await worker.evaluate(() => chrome.storage.local.set({ prefs: { resume: true, knob: true } }));
    const panel = await openPanel(tabId, url, { sidebar: false });
    try {
      await panel.waitForFunction(() => document.documentElement.classList.contains("knob-mode"));
      // Show the section holding the volume slider.
      for (let i = 0; i < 6; i++) {
        await showSection(panel, i);
        if (await rowProp(panel, "volume", "row.offsetParent !== null")) break;
      }
      const volume = () => rowProp(panel, "volume", "Number(row.querySelector('input[type=range]').value)");
      const bubble = () => rowProp(panel, "volume", "(b => b.hidden ? null : b.textContent)(row.querySelector('.slider-bubble'))");
      const box = await rowProp(panel, "volume", "(r => { const b = r.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })(row.querySelector('input[type=range]'))");
      const thumbX = box.x + 8 + ((100 - 0) / 400) * (box.w - 16); // at 100 %
      const cy = box.y + box.h / 2;

      await panel.mouse.move(box.x + box.w / 2, cy);
      await pause(500); // not right after a scroll
      await panel.mouse.wheel({ deltaY: -100 });
      await panel.waitForFunction(() => true);
      assert.equal(await volume(), 101, "wheel up: one step");
      assert.equal(await bubble(), "101 %");
      await panel.keyboard.down("Shift");
      await panel.mouse.wheel({ deltaY: 100 });
      await panel.keyboard.up("Shift");
      assert.equal(await volume(), 91, "Shift: ten steps");

      await panel.mouse.click(thumbX, cy, { clickCount: 2 });
      await waitFor(async () => (await volume()) === 100);

      // The thumb turns like a knob: grabbed in its inner ring a quarter turn clockwise is
      // 5 notches (18° each) = +5, in the middle ring +25, in the outer ring +50. The center
      // of the turn stays where the thumb was grabbed, the thumb itself moves along.
      const thumb = async () => {
        const v = await volume();
        return { v, x: box.x + 15 + (v / 400) * (box.w - 30), y: cy };
      };
      const turnThumb = async (share, degrees) => {
        const t = await thumb();
        const r = 15 * share; // thumb radius 15 px
        await panel.mouse.move(t.x, t.y - r);
        await panel.mouse.down();
        const R = 40; // then around it at a comfortable distance
        for (let d = 0; d <= degrees; d += 5) {
          const a = (d * Math.PI) / 180;
          await panel.mouse.move(t.x + R * Math.sin(a), t.y - R * Math.cos(a));
        }
        await panel.mouse.up();
        return t.v;
      };
      let base = await turnThumb(0.2, 92);
      assert.equal(await volume(), base + 5, "inner ring");
      base = await turnThumb(0.6, 92);
      assert.equal(await volume(), base + 25, "middle ring");
      base = await turnThumb(0.9, 92);
      assert.equal(await volume(), base + 50, "outer ring");
      // Circling right on the outer ring itself, starting at its top (first moving
      // sideways): still a turn, +50 for a quarter.
      {
        const t0 = await thumb();
        await panel.mouse.move(t0.x, t0.y - 13);
        await panel.mouse.down();
        for (let d = 0; d <= 92; d += 4) {
          const a = (d * Math.PI) / 180;
          await panel.mouse.move(t0.x + 13 * Math.sin(a), t0.y - 13 * Math.cos(a));
        }
        await panel.mouse.up();
        assert.equal(await volume(), t0.v + 50, "on the ring from its top");
        await panel.mouse.click(box.x + 15 + 0.25 * (box.w - 30), cy); // back near 100 % via the track
      }
      // counter-clockwise goes down
      base = await turnThumb(0.9, 0);
      const t = await thumb();
      await panel.mouse.move(t.x, t.y - 13);
      await panel.mouse.down();
      for (let d = 0; d >= -92; d -= 5) {
        const a = (d * Math.PI) / 180;
        await panel.mouse.move(t.x + 40 * Math.sin(a), t.y - 40 * Math.cos(a));
      }
      await panel.mouse.up();
      assert.equal(await volume(), base - 50, "counter-clockwise");
      // Hovering lights up the ring under the pointer, leaving the slider clears it.
      const ringLit = () => rowProp(panel, "volume", "row.querySelector('input').dataset.ring ?? null");
      const h = await thumb();
      for (const [share, ring] of [[0.2, "inner"], [0.6, "middle"], [0.9, "outer"]]) {
        await panel.mouse.move(h.x, h.y - 15 * share);
        assert.equal(await ringLit(), ring, `hover ${ring}`);
      }
      await panel.mouse.move(h.x, h.y - 60);
      assert.equal(await ringLit(), null, "no highlight off the thumb");
      assert.equal(await rowProp(panel, "volume", "getComputedStyle(row.querySelector('input')).cursor"), "pointer");

      // The tip under the thumb names the hovered ring's step size.
      await panel.mouse.move(h.x, h.y - 13);
      assert.equal(await rowProp(panel, "volume", "(t => t.hidden ? null : t.textContent)(row.querySelector('.ring-tip'))"), "±10");

      // A press on the track still jumps there.
      await panel.mouse.click(box.x + 15 + 0.75 * (box.w - 30), cy);
      assert.ok(Math.abs((await volume()) - 300) <= 2, `track click: ${await volume()}`);

      // Drag mode (the options page's switch): pulled along the track the thumb drags,
      // pulled up and circled on its outer ring it still turns +10 per notch.
      await worker.evaluate(() => chrome.storage.local.set({ prefs: { resume: true, knob: false } }));
      await panel.waitForFunction(() => !document.documentElement.classList.contains("knob-mode"));
      const v0 = await volume();
      const gx = box.x + 15 + (v0 / 400) * (box.w - 30);
      await panel.mouse.move(gx + 3, cy);
      assert.equal(await ringLit(), "inner", "rings light up in drag mode too");
      await panel.mouse.down();
      await panel.mouse.move(gx + 3 - (100 / 400) * (box.w - 30), cy + 1, { steps: 12 });
      await panel.mouse.up();
      assert.ok(Math.abs((await volume()) - (v0 - 100)) <= 2, `dragged from ${v0} to ${await volume()}`);
      // grabbed by the outer ring, it drags in 10s
      {
        const t2 = await thumb();
        await panel.mouse.move(t2.x - 13, t2.y);
        await panel.mouse.down();
        await panel.mouse.move(t2.x - 13 + (37 / 400) * (box.w - 30), t2.y + 1, { steps: 12 });
        const v = await volume();
        await panel.mouse.up();
        assert.equal(v % 10, 0, `outer ring drags in 10s: ${v}`);
        assert.ok(Math.abs(v - (t2.v + 37)) <= 7, `near the pointer: ${t2.v} → ${v}`);
      }
      {
        const t1 = await thumb();
        await panel.mouse.move(t1.x, t1.y - 13);
        await panel.mouse.down();
        for (let d = 0; d <= 92; d += 4) {
          const a = (d * Math.PI) / 180;
          await panel.mouse.move(t1.x + 13 * Math.sin(a), t1.y - 13 * Math.cos(a));
        }
        await panel.mouse.up();
        assert.equal(await volume(), t1.v + 50, "outer ring turns in drag mode");
      }
    } finally {
      await panel.close();
      await worker.evaluate(() => chrome.storage.local.remove("prefs"));
    }
  }));

// Must stay the last test: it reloads the extension.
test("update (Chrome): the new instance takes over the old one's audio routing", { skip }, () =>
  withMedia("audio", "/left.wav", async ({ tabId, send }) => {
    await set(send, { swap: true }); // routed by the instance that is about to be orphaned
    const full = await levelDb(send);

    const old = workerTarget;
    // Loading the same unpacked folder again is an update: same ID, new instance.
    // (runtime.reload() doesn't take effect for extensions loaded this way.)
    await browser.installExtension(path.join(ROOT, "dist", "chrome"));
    workerTarget = await browser.waitForTarget(
      (t) => t !== old && t.type() === "service_worker" && t.url().endsWith("/background.js")
    );
    worker = await workerTarget.worker();
    await waitFor(() => worker.evaluate(() => typeof AVFX === "object").catch(() => false));
    await worker.evaluate((id) => AVFX.getTabState(id), tabId); // injects the new instance, like opening the panel

    await set(send, { swap: true, volume: 50 });
    const [item] = await mediaListOf(tabId);
    assert.deepEqual([item.hasAudioChain, item.audioBlocked], [true, false]);
    const half = await levelDb(send);
    assert.ok(Math.abs(full - half - 6.02) < 0.5, `new instance controls the volume: ${(full - half).toFixed(2)} dB`);
    await set(send, { swap: true, volume: 0 });
    assert.equal(await levelDb(send), -Infinity, "volume 0 is silent");
  }));
