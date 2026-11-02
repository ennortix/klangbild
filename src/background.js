// Firefox loads common.js via the manifest; Chrome runs this file as a service worker.
if (!globalThis.AVFX) importScripts("common.js");

// Settings remembered for the site of a URL, or null.
function siteSettings(url) {
  const host = AVFX.hostOf(url);
  if (!host) return Promise.resolve(null);
  const key = AVFX.siteKey(host);
  return browser.storage.local.get(key).then((r) => r[key] ?? null);
}

// Hands saved settings to content scripts: the site's own, else the default for all
// sites. Every frame of a tab (including cross-origin iframes) uses the settings of
// the tab's top-level site.
async function savedSettings(url) {
  const site = await siteSettings(url);
  if (site) return site;
  const r = await browser.storage.local.get(AVFX.DEFAULTS_KEY);
  return r[AVFX.DEFAULTS_KEY] ?? null;
}

async function loadPrefs() {
  const r = await browser.storage.local.get(AVFX.PREFS_KEY);
  return { ...AVFX.PREFS_DEFAULTS, ...r[AVFX.PREFS_KEY] };
}

// ---------- Rules ----------

// The rule that matches the address, or null.
async function ruleFor(url) {
  const r = await browser.storage.local.get(AVFX.RULES_KEY);
  return AVFX.findRule(AVFX.sanitizeRules(r[AVFX.RULES_KEY]), url);
}

// The saved settings with the matching rule applied on top (null: nothing saved, no rule).
async function settingsFor(url, rule) {
  const base = await savedSettings(url);
  if (!rule) return base;
  const { presets } = await browser.storage.local.get("presets");
  return AVFX.applyRule(base, rule, presets);
}

// Pattern of the rule each tab's settings came from. Single-page sites (YouTube, …)
// change the address without loading a page: when that enters, leaves or switches a
// rule, the tab gets the new settings. Lost when Chrome stops the worker, then a later
// address change only applies a rule it enters.
const tabRules = new Map(); // tabId -> pattern | null

browser.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (!change.url) return;
  const rule = await ruleFor(change.url);
  const before = tabRules.get(tabId);
  const now = rule?.pattern ?? null;
  tabRules.set(tabId, now);
  if (now === (before ?? null)) return;
  if (await isDisabled(change.url)) return;
  const settings = AVFX.sanitize(await settingsFor(change.url, rule));
  // All frames; a page that is still loading gets the same from "init" anyway.
  await browser.tabs.sendMessage(tabId, { type: "set", settings }).catch(() => {});
  browser.runtime.sendMessage({ type: "settings-changed", tabId, settings }).catch(() => {});
});
browser.tabs.onRemoved.addListener((tabId) => tabRules.delete(tabId));

async function isDisabled(url) {
  const host = AVFX.hostOf(url);
  const r = await browser.storage.local.get(AVFX.DISABLED_KEY);
  return Boolean(host && (r[AVFX.DISABLED_KEY] ?? []).includes(host));
}

// What a content script starts with: { settings, disabled, rule, resume }.
async function initData(url, tabId) {
  if (await isDisabled(url)) return { settings: null, disabled: true };
  const rule = await ruleFor(url);
  if (tabId !== undefined) tabRules.set(tabId, rule?.pattern ?? null);
  const prefs = await loadPrefs();
  return { settings: await settingsFor(url, rule), disabled: false, rule: rule?.pattern ?? null, resume: prefs.resume };
}

// ---------- Continue watching ----------

// Positions are kept under a hash of the address, so storage holds no readable history.
// Never in private windows. Writes go one after another (several tabs may play).
async function resumeId(key) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(bytes).slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let resumeWrites = Promise.resolve();

function resumeUpdate(change) {
  resumeWrites = resumeWrites
    .then(async () => {
      const r = await browser.storage.local.get(AVFX.RESUME_KEY);
      const all = r[AVFX.RESUME_KEY] && typeof r[AVFX.RESUME_KEY] === "object" ? r[AVFX.RESUME_KEY] : {};
      change(all);
      const ids = Object.keys(all);
      if (ids.length > AVFX.RESUME.maxEntries) {
        ids.sort((a, b) => (all[a].at ?? 0) - (all[b].at ?? 0));
        for (const id of ids.slice(0, ids.length - AVFX.RESUME.maxEntries)) delete all[id];
      }
      await browser.storage.local.set({ [AVFX.RESUME_KEY]: all });
    })
    .catch((e) => console.warn("[Klangbild] Saving the position failed:", e));
  return resumeWrites;
}

async function resumeMessage(msg, sender) {
  const key = AVFX.resumeKey(msg.url);
  if (!key || sender.tab?.incognito || !(await loadPrefs()).resume) return null;
  const id = await resumeId(key);
  if (msg.type === "resume-get") {
    const r = await browser.storage.local.get(AVFX.RESUME_KEY);
    return r[AVFX.RESUME_KEY]?.[id] ?? null;
  }
  const { time, duration, done } = msg;
  await resumeUpdate((all) => {
    if (done) delete all[id];
    else if (Number.isFinite(time) && Number.isFinite(duration)) all[id] = { t: Math.round(time * 10) / 10, d: Math.round(duration * 10) / 10, at: Date.now() };
  });
  return true;
}

// Speed on the toolbar icon, "off" while all effects are bypassed.
// Up to 4 characters fit the badge: 12.75× (sidebar's extended limits) shows "12,8".
function badgeSpeed(speed) {
  for (const digits of [2, 1, 0]) {
    const text = AVFX.formatNumber(speed, digits);
    if (text.length <= 4) return text;
  }
  return AVFX.formatNumber(speed, 0);
}

function setBadge(tabId, { speed, enabled }) {
  let text = "";
  if (!enabled) text = AVFX.t("badgeOff");
  else if (speed !== 1) text = badgeSpeed(speed);
  browser.action.setBadgeText({ tabId, text }).catch(() => {});
  browser.action.setBadgeBackgroundColor({ tabId, color: enabled ? "#7c6cff" : "#6b7280" }).catch(() => {});
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
      return sender.tab?.url ? initData(sender.tab.url, sender.tab.id) : undefined;
    case "resume-get":
    case "resume-save":
      return resumeMessage(msg, sender);
    case "download":
      return download(msg).then(() => true);
    case "badge":
      if (sender.tab?.id !== undefined) setBadge(sender.tab.id, msg);
      return undefined;
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
  const { SPEED, MIN_DELAY_MS, MAX_DELAY_MS } = AVFX;
  // Shortcuts stay in the everyday range, but don't pull back a value that the
  // sidebar's extended limits put beyond it.
  const step = (key, delta, min, max) =>
    AVFX.clamp(s[key] + delta, Math.min(min, s[key]), Math.max(max, s[key]));
  const speed = (delta) => {
    const v = Math.round(step("speed", delta, SPEED.min, SPEED.max) * 100) / 100;
    return [{ speed: v }, AVFX.t("osdSpeed", AVFX.formatNumber(v, 2))];
  };
  const delay = (delta) => {
    const v = step("audioDelay", delta, MIN_DELAY_MS, MAX_DELAY_MS);
    return [{ audioDelay: v }, delayText(v)];
  };
  const volume = (delta) => {
    const v = Math.round(step("volume", delta, 0, 400) / 10) * 10;
    return [{ volume: v }, AVFX.t("osdVolume", v)];
  };

  switch (command) {
    case "speed-up":
      return speed(0.25);
    case "speed-down":
      return speed(-0.25);
    case "speed-reset":
      return speed(1 - s.speed);
    case "volume-up":
      return volume(10);
    case "volume-down":
      return volume(-10);
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
  if (state.disabled) return;
  const frame = await AVFX.findPrimaryFrame(tab.id).catch(() => null);
  const osd = (text) => {
    if (text) browser.tabs.sendMessage(tab.id, { type: "osd", text }, AVFX.frameTarget(frame) ?? { frameId: 0 }).catch(() => {});
  };

  const ACTIONS = {
    loop: { action: "loop-cycle" },
    screenshot: { action: "screenshot" },
    "seek-back": { action: "seek", seconds: -10 },
    "seek-forward": { action: "seek", seconds: 10 },
  };
  if (ACTIONS[command]) {
    if (!frame) {
      osd(AVFX.t("noMedia"));
      return;
    }
    const r = await browser.tabs.sendMessage(tab.id, { type: "action", ...ACTIONS[command] }, AVFX.frameTarget(frame));
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
  if (host && (await siteSettings(tab.url))) {
    await browser.storage.local.set({ [AVFX.siteKey(host)]: settings });
  }
}

browser.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await browser.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  handleCommand(command, tab).catch((e) => console.warn("[Klangbild] Keyboard shortcut failed:", e));
});
