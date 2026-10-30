// Firefox loads common.js via the manifest; Chrome runs this file as a service worker.
if (!globalThis.AVFX) importScripts("common.js");

// Hands saved per-site settings to content scripts. Every frame of a tab
// (including cross-origin iframes) uses the settings of the tab's top-level site.
function savedSettings(url) {
  const host = AVFX.hostOf(url);
  if (!host) return Promise.resolve(null);
  const key = AVFX.siteKey(host);
  return browser.storage.local.get(key).then((r) => r[key] ?? null);
}

// Screenshots arrive as data URLs from content scripts. Chrome downloads those
// directly (its service worker has no URL.createObjectURL), Firefox needs a blob URL.
async function download({ dataUrl, filename }) {
  filename = filename.replace(/[\\/:*?"<>|]/g, "_");
  if (typeof URL.createObjectURL !== "function") {
    await browser.downloads.download({ url: dataUrl, filename });
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  const url = URL.createObjectURL(blob);
  try {
    await browser.downloads.download({ url, filename });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

AVFX.onMessage((msg, sender) => {
  switch (msg?.type) {
    case "init":
      return sender.tab?.url ? savedSettings(sender.tab.url) : undefined;
    case "download":
      return download(msg).then(() => true);
  }
  return undefined;
});

// ---------- Keyboard shortcuts ----------

function delayText(ms) {
  if (ms === 0) return AVFX.t("avOffsetZero");
  return ms > 0 ? AVFX.t("audioDelayedBy", ms) : AVFX.t("pictureDelayedBy", -ms);
}

// Returns [patch, osd text] for setting-changing commands.
function settingsCommand(command, s) {
  const { SPEED, MIN_DELAY_MS, MAX_DELAY_MS, clamp } = AVFX;
  const speed = (delta) => {
    const v = Math.round(clamp(s.speed + delta, SPEED.min, SPEED.max) * 100) / 100;
    return [{ speed: v }, AVFX.t("osdSpeed", AVFX.formatNumber(v, 2))];
  };
  const delay = (delta) => {
    const v = clamp(s.audioDelay + delta, MIN_DELAY_MS, MAX_DELAY_MS);
    return [{ audioDelay: v }, delayText(v)];
  };

  switch (command) {
    case "speed-up":
      return speed(0.25);
    case "speed-down":
      return speed(-0.25);
    case "delay-up":
      return delay(10);
    case "delay-down":
      return delay(-10);
    case "toggle-fx":
      return [{ enabled: !s.enabled }, AVFX.t(s.enabled ? "effectsOff" : "effectsOn")];
  }
  return null;
}

async function handleCommand(command, tab) {
  const state = await AVFX.getTabState(tab.id); // also injects into tabs opened before installation
  const frame = await AVFX.findPrimaryFrame(tab.id).catch(() => null);
  const osd = (text) => {
    if (text) browser.tabs.sendMessage(tab.id, { type: "osd", text }, AVFX.frameTarget(frame) ?? { frameId: 0 }).catch(() => {});
  };

  if (command === "loop" || command === "screenshot") {
    if (!frame) {
      osd(AVFX.t("noMedia"));
      return;
    }
    const action = command === "loop" ? "loop-cycle" : "screenshot";
    const r = await browser.tabs.sendMessage(tab.id, { type: "action", action }, AVFX.frameTarget(frame));
    osd(r?.text);
    return;
  }

  const current = AVFX.sanitize(state.settings);
  const result = settingsCommand(command, current);
  if (!result) return;

  const [patch, text] = result;
  const settings = { ...current, ...patch };
  await browser.tabs.sendMessage(tab.id, { type: "set", settings });
  osd(text);
  // An open popup shows the new values (fails silently when none is open).
  browser.runtime.sendMessage({ type: "settings-changed", tabId: tab.id, settings }).catch(() => {});

  // Keep remembered site settings in sync.
  const host = AVFX.hostOf(tab.url);
  if (host && (await savedSettings(tab.url))) {
    await browser.storage.local.set({ [AVFX.siteKey(host)]: settings });
  }
}

browser.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  handleCommand(command, tab).catch((e) => console.warn("[Klangbild] Keyboard shortcut failed:", e));
});
