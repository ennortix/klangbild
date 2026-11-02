// Loads the extension's scripts into a Node vm context with a mocked extension API.
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = path.join(ROOT, "src");
export const read = (file) => fs.readFileSync(path.join(SRC, file), "utf8");
export const readJson = (file) => JSON.parse(read(file));

export const DE = readJson("_locales/de/messages.json");
export const EN = readJson("_locales/en/messages.json");

// browser.i18n with the $1..$n substitution of the real one.
function i18n(messages, lang) {
  return {
    getMessage: (key, subs = []) => messages[key]?.message.replace(/\$(\d)/g, (_, n) => subs[n - 1] ?? "") ?? "",
    getUILanguage: () => lang,
  };
}

// storage.local backed by a plain object (`.data`), values copied like the real one.
export function makeStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      if (keys === null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(items) {
      Object.assign(data, structuredClone(items));
    },
    async remove(keys) {
      for (const k of [].concat(keys)) delete data[k];
    },
  };
}

// A context with common.js loaded (as Firefox, German UI). `api` is merged into `browser`.
export function loadCommon(api = {}) {
  const ctx = vm.createContext({
    navigator: { userAgent: "Mozilla/5.0 Firefox/130.0" },
    console,
    structuredClone,
    URL,
    crypto: globalThis.crypto,
    TextEncoder,
    setTimeout,
    clearTimeout,
    browser: {
      i18n: i18n(DE, "de"),
      runtime: { onMessage: { addListener() {} } },
      ...api,
    },
  });
  ctx.globalThis = ctx;
  vm.runInContext(read("common.js"), ctx);
  return ctx;
}

// background.js on top of common.js; badge calls are recorded in `badges`, messages
// to tabs in `sent`. updated(tabId, change) runs the tabs.onUpdated listeners.
export function loadBackground(storage = makeStorage()) {
  const badges = [];
  const sent = [];
  const onUpdated = [];
  const ctx = loadCommon({
    storage: { local: storage },
    action: {
      setBadgeText: async (o) => badges.push(o.text),
      setBadgeBackgroundColor: async () => {},
    },
    commands: { onCommand: { addListener() {} } },
    tabs: {
      onUpdated: { addListener: (fn) => onUpdated.push(fn) },
      onRemoved: { addListener() {} },
      sendMessage: async (tabId, msg) => sent.push({ tabId, msg }),
    },
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => {} },
  });
  ctx.importScripts = () => {};
  vm.runInContext(read("background.js"), ctx);
  const updated = async (tabId, change) => {
    for (const fn of onUpdated) await fn(tabId, change, { id: tabId, url: change.url });
  };
  return { ctx, badges, sent, updated };
}

// options.js with stubbed DOM helpers; `nodes` holds the elements fetched with $().
export function loadOptions(storage = makeStorage()) {
  const nodes = {};
  const fakeEl = () => ({
    textContent: "",
    hidden: false,
    classList: { add() {}, remove() {} },
    prepend() {},
    addEventListener() {},
    replaceChildren() {},
    setAttribute() {},
    click() {},
    options: [],
    value: "",
  });
  const ctx = loadCommon({
    storage: { local: storage, onChanged: { addListener() {} } },
    runtime: { onMessage: { addListener() {} }, getManifest: () => ({ version: "0.0.0" }) },
  });
  Object.assign(ctx, {
    $: (id) => (nodes[id] ??= fakeEl()),
    el: () => fakeEl(),
    icon: () => fakeEl(),
    localizePage() {},
  });
  ctx.t = (key, ...subs) => ctx.AVFX.t(key, ...subs);
  vm.runInContext(read("options/options.js"), ctx);
  return { ctx, nodes };
}

// A File-like object for importBackup().
export const jsonFile = (content) => ({
  text: async () => (typeof content === "string" ? content : JSON.stringify(content)),
});

// Copies an object out of the vm realm, so deepStrictEqual compares structure only.
export const plain = (v) => JSON.parse(JSON.stringify(v));
