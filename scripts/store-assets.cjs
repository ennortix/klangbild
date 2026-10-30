// Renders the store screenshots and promo images into store/images/ by showing the
// real popup (src/popup) with a mocked extension API and sample values in Chrome.
// Needs puppeteer-core (npm install) and a Chrome; set CHROME_PATH if it isn't at
// the default Windows location. Nothing is played back.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "store", "images");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

// Replaces chrome.* inside the popup iframe. ?tab= picks the panel tab, ?s= the settings.
const MOCK = String.raw`
(() => {
  const q = new URLSearchParams(location.search);
  const settings = JSON.parse(q.get("s") || "{}");
  try { localStorage.setItem("lastTab", q.get("tab") || "audio"); } catch {}
  const url = "https://video.example.com/watch?v=demo";
  const bands = Array.from({ length: 48 }, (_, i) =>
    Math.max(0.05, Math.min(1, 0.92 - i * 0.011 + 0.12 * Math.sin(i * 0.55) + 0.08 * Math.sin(i * 1.7))));
  const state = { time: 754.2, duration: 2710, paused: false, loopA: 741.5, loopB: 768.9, kind: "video", drm: false };
  const reply = (msg) => {
    switch (msg.type) {
      case "get": return { settings, mediaCount: 1 };
      case "spectrum": return { bands, rms: -14.2, peak: -5.8 };
      case "action": return { ok: true, text: null, state };
      default: return { ok: true };
    }
  };
  const api = {
    runtime: { id: "demo", getURL: (p) => "/" + p, onMessage: { addListener() {} }, sendMessage: async () => undefined },
    tabs: { query: async () => [{ id: 1, url }], sendMessage: async (_t, msg) => reply(msg), create: async () => ({}) },
    scripting: { executeScript: async () => [{ frameId: 0, result: { score: 1, kind: "video", hasAudioChain: true, drm: false } }] },
    storage: { local: {
      get: async (k) => (k === "presets"
        ? { presets: [{ name: "Late-night series", settings: {} }, { name: "Podcast voice", settings: {} }] }
        : { [k]: settings }),
      set: async () => {}, remove: async () => {},
    } },
    commands: { getAll: async () => [
      { name: "_execute_action", shortcut: "Alt+Shift+A" },
      { name: "delay-up", description: "Audio delay +10 ms", shortcut: "Alt+Shift+Right" },
      { name: "delay-down", description: "Audio delay −10 ms", shortcut: "Alt+Shift+Left" },
      { name: "toggle-fx", description: "All effects on/off", shortcut: "Alt+Shift+E" },
      { name: "speed-up", description: "Faster (+0.25×)", shortcut: "Alt+Shift+Up" },
      { name: "loop", description: "A-B loop: set A → set B → off", shortcut: "Alt+Shift+L" },
    ] },
    windows: { create: async () => ({}) },
  };
  Object.defineProperty(window, "chrome", { value: api, configurable: true, writable: true });
})();
`;

// A stylized "video" so the shots don't show anyone's content.
const SCENE = `
<div class="player" style="FILTER">
  <div class="sky"></div><div class="sun"></div><div class="hill h1"></div><div class="hill h2"></div>
  <div class="bar"><span class="play"></span><span class="track"><span></span></span><span class="time">12:34 / 45:10</span></div>
</div>`;

const STYLE = `
* { box-sizing: border-box; }
body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #fff; overflow: hidden;
  background: radial-gradient(circle at 20% 15%, #2c2360 0%, transparent 55%), linear-gradient(135deg, #17142b, #0d0e18); }
.stage { display: flex; align-items: center; gap: 56px; width: 100%; height: 100%; padding: 0 72px; }
.copy { flex: 1; min-width: 0; }
h1 { font-size: 46px; line-height: 1.1; margin: 0 0 16px; letter-spacing: -0.02em; }
p { font-size: 21px; line-height: 1.45; color: #c9c6e8; margin: 0 0 32px; }
.brand { display: flex; align-items: center; gap: 12px; font-size: 22px; font-weight: 600; margin-bottom: 28px; color: #e8e6ff; }
.player { position: relative; width: 560px; height: 315px; border-radius: 14px; overflow: hidden; box-shadow: 0 20px 60px #0008; }
.sky { position: absolute; inset: 0; background: linear-gradient(#ff9a6b, #f6c37a 45%, #7cc4d8 46%, #3c7f9e); }
.sun { position: absolute; left: 330px; top: 70px; width: 90px; height: 90px; border-radius: 50%; background: #fff3c4; box-shadow: 0 0 60px #ffe28a; }
.hill { position: absolute; border-radius: 50%; }
.h1 { left: -80px; top: 190px; width: 460px; height: 260px; background: #2f6b4f; }
.h2 { left: 220px; top: 215px; width: 520px; height: 260px; background: #24543f; }
.bar { position: absolute; left: 0; right: 0; bottom: 0; height: 44px; display: flex; align-items: center; gap: 14px; padding: 0 16px; background: linear-gradient(transparent, #000a); font-size: 13px; }
.play { width: 0; height: 0; border-left: 14px solid #fff; border-top: 8px solid transparent; border-bottom: 8px solid transparent; }
.track { flex: 1; height: 4px; border-radius: 2px; background: #fff5; }
.track span { display: block; width: 28%; height: 100%; border-radius: 2px; background: #7c6cff; }
.panel-frame { position: relative; flex-shrink: 0; border-radius: 12px; overflow: hidden; box-shadow: 0 20px 60px #000a, 0 0 0 1px #ffffff1a; }
.panel-frame.clipped::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(transparent, #16171d); }
iframe { display: block; border: 0; width: 360px; }
`;

const SHOTS = [
  {
    file: "screenshot-1-audio.png", tab: "audio", frame: 640,
    settings: { volume: 130, bass: 4, mid: -1, treble: 3, voice: true, compressor: true },
    title: "Shape the sound of any video – live",
    text: "3-band equalizer, voice enhancer, compressor, limiter, volume boost up to 400 % and a live spectrum.",
  },
  {
    file: "screenshot-2-playback.png", tab: "playback", frame: 420,
    settings: { speed: 1.25, audioDelay: -180, preservePitch: true },
    title: "Audio out of sync? Fixed.",
    text: "Delay the sound – or the picture, e.g. for Bluetooth headphones. Plus speed control with pitch correction.",
  },
  {
    file: "screenshot-3-video.png", tab: "video", frame: 640, filter: "filter: brightness(112%) contrast(108%) saturate(140%)",
    settings: { brightness: 112, contrast: 108, saturate: 140, sharpen: 30 },
    title: "A better picture in one click",
    text: "Brightness, contrast, saturation, sharpness, zoom, flip and rotate – applied instantly to any video.",
  },
  {
    file: "screenshot-4-extras.png", tab: "extras", frame: 640,
    settings: { bass: 4, treble: 3, contrast: 115, saturate: 115 },
    title: "Presets, loops and frame stepping",
    text: "One-click presets, an A-B loop, frame-by-frame stepping, screenshots and keyboard shortcuts.",
  },
];

function stagePage(shot) {
  const src = `/src/popup/popup.html?tab=${shot.tab}&s=${encodeURIComponent(JSON.stringify(shot.settings))}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body style="width:1280px;height:800px">
  <div class="stage">
    <div class="copy">
      <div class="brand"><img src="/src/icons/icon.svg" width="36" height="36">Klangbild</div>
      <h1>${shot.title}</h1><p>${shot.text}</p>
      ${SCENE.replace("FILTER", shot.filter || "")}
    </div>
    <div class="panel-frame"><iframe src="${src}" style="height:${shot.frame}px"></iframe></div>
  </div></body></html>`;
}

function promoPage(w, h, withPanel) {
  const big = h > 300;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}
  .promo { display: flex; align-items: center; justify-content: ${withPanel ? "space-between" : "center"}; gap: 40px; width: 100%; height: 100%; padding: 0 ${big ? 90 : 30}px; }
  .name { font-size: ${big ? 64 : 40}px; font-weight: 700; letter-spacing: -0.02em; margin: ${big ? 22 : 12}px 0 ${big ? 12 : 6}px; }
  .tag { font-size: ${big ? 26 : 17}px; color: #c9c6e8; }
  </style></head><body style="width:${w}px;height:${h}px">
  <div class="promo"><div>
    <img src="/src/icons/icon.svg" width="${big ? 110 : 72}" height="${big ? 110 : 72}">
    <div class="name">Klangbild</div><div class="tag">Live audio &amp; video editing<br>for every website</div>
  </div>
  ${withPanel ? `<div class="panel-frame" style="height:470px"><iframe src="/src/popup/popup.html?tab=audio&s=${encodeURIComponent(JSON.stringify(SHOTS[0].settings))}" style="height:640px"></iframe></div>` : ""}
  </div></body></html>`;
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function serve(pages) {
  return http
    .createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname === "/mock.js") return res.writeHead(200, { "Content-Type": TYPES[".js"] }).end(MOCK);
      if (pages[url.pathname]) return res.writeHead(200, { "Content-Type": TYPES[".html"] }).end(pages[url.pathname]);
      const file = path.join(ROOT, decodeURIComponent(url.pathname));
      if (!file.startsWith(path.join(ROOT, "src")) || !fs.existsSync(file)) return res.writeHead(404).end();
      let body = fs.readFileSync(file);
      if (url.pathname === "/src/popup/popup.html") {
        body = body.toString().replace(`<script src="../common.js"></script>`, `<script src="/mock.js"></script>\n    <script src="../common.js"></script>`);
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(body);
    })
    .listen(0);
}

(async () => {
  const pages = { "/promo-small": promoPage(440, 280, false), "/promo-marquee": promoPage(1400, 560, true) };
  SHOTS.forEach((s, i) => (pages[`/shot-${i}`] = stagePage(s)));
  const server = serve(pages);
  const base = `http://127.0.0.1:${server.address().port}`;
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--mute-audio"] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const shoot = async (route, file, width, height) => {
      await page.setViewport({ width, height, deviceScaleFactor: 1 });
      await page.goto(base + route, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 1200)); // spectrum bars settle
      // Fit each panel to its content; taller ones fade out at the bottom.
      await page.evaluate((maxH) => {
        for (const frame of document.querySelectorAll(".panel-frame")) {
          const iframe = frame.querySelector("iframe");
          const h = iframe.contentDocument.documentElement.scrollHeight;
          const limit = Math.min(maxH, frame.style.height ? parseInt(frame.style.height, 10) : maxH);
          iframe.style.height = `${Math.min(h, limit)}px`;
          frame.style.height = "";
          frame.classList.toggle("clipped", h > limit);
        }
      }, height - 80);
      await new Promise((r) => setTimeout(r, 300));
      await page.screenshot({ path: path.join(OUT, file), clip: { x: 0, y: 0, width, height } });
      console.log(`wrote store/images/${file}`);
    };
    for (let i = 0; i < SHOTS.length; i++) await shoot(`/shot-${i}`, SHOTS[i].file, 1280, 800);
    await shoot("/promo-small", "promo-small-440x280.png", 440, 280);
    await shoot("/promo-marquee", "promo-marquee-1400x560.png", 1400, 560);
    if (errors.length) throw new Error("Page errors: " + errors.join(" | "));
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
