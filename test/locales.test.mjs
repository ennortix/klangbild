import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DE, EN, ROOT, read } from "./helpers.mjs";

const SCRIPTS = [
  "background.js",
  "common.js",
  "content.js",
  "popup/popup.js",
  "popup/tools.js",
  "popup/defaults.js",
  "popup/presets.js",
  "popup/sliderfx.js",
  "options/options.js",
];

function usedKeys() {
  const keys = new Set();
  for (const f of SCRIPTS) for (const m of read(f).matchAll(/\bt\("([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  for (const o of ["none", "protan", "deutan", "tritan"]) keys.add(`cvd_${o}`); // t(`cvd_${o}`)
  for (const f of ["manifests/chrome.json", "manifests/firefox.json"]) {
    for (const m of fs.readFileSync(path.join(ROOT, f), "utf8").matchAll(/__MSG_(\w+)__/g)) keys.add(m[1]);
  }
  for (const f of ["options/options.html", "popup/popup.html"]) {
    for (const m of read(f).matchAll(/data-i18n[\w-]*="(\w+)"/g)) keys.add(m[1]);
  }
  return keys;
}

test("de and en have the same keys", () => {
  assert.deepEqual(Object.keys(DE).sort(), Object.keys(EN).sort());
});

test("every key used in code and manifests exists", () => {
  const missing = [...usedKeys()].filter((k) => !DE[k] || !EN[k]);
  assert.deepEqual(missing, []);
});

test("placeholders match between de and en", () => {
  const placeholders = (s) => [...new Set(s.match(/\$\d/g) ?? [])].sort().join();
  const diff = Object.keys(DE).filter((k) => placeholders(DE[k].message) !== placeholders(EN[k].message));
  assert.deepEqual(diff, []);
});

test("badge text 'off' fits the toolbar badge", () => {
  assert.ok(DE.badgeOff.message.length <= 4);
  assert.ok(EN.badgeOff.message.length <= 4);
});
