// Options page: remembered sites, disabled sites, custom presets, the default for all
// sites and a JSON backup of all of them. Everything lives in storage.local, see
// popup.js/presets.js/defaults.js.

const { DEFAULTS, DEFAULTS_KEY, DISABLED_KEY, RULES_KEY, PREFS_KEY, PREFS_DEFAULTS, RESUME_KEY } = AVFX;
const SITE_PREFIX = AVFX.siteKey("");
const BACKUP_APP = "klangbild";

// "3 changed values": how far stored settings differ from the defaults.
function changedText(values) {
  const s = AVFX.sanitize(values);
  const n = Object.keys(DEFAULTS).filter((k) => k !== "enabled" && s[k] !== DEFAULTS[k]).length;
  return n === 1 ? t("changedValue") : t("changedValues", n);
}

function listItem(label, meta, onDelete) {
  const name = el("span", { className: "preset-apply" }, label, el("span", { className: "site-meta", textContent: meta }));
  const del = el("button", { type: "button", className: "icon-btn", title: t("delete") }, icon("trash"));
  del.addEventListener("click", onDelete);
  return el("div", { className: "preset-item" }, name, del);
}

function emptyHint(key) {
  return el("div", { className: "hint", textContent: t(key) });
}

async function render() {
  const all = await browser.storage.local.get(null);

  const siteKeys = Object.keys(all)
    .filter((k) => k.startsWith(SITE_PREFIX))
    .sort();
  $("sites").replaceChildren(
    ...(siteKeys.length
      ? siteKeys.map((k) =>
          listItem(k.slice(SITE_PREFIX.length), changedText(all[k]), () => browser.storage.local.remove(k))
        )
      : [emptyHint("noSites")])
  );
  $("deleteSites").hidden = !siteKeys.length;

  const disabled = Array.isArray(all[DISABLED_KEY]) ? all[DISABLED_KEY] : [];
  $("disabled").replaceChildren(
    ...(disabled.length
      ? [...disabled].sort().map((h) =>
          listItem(h, "", () => browser.storage.local.set({ [DISABLED_KEY]: disabled.filter((x) => x !== h) }))
        )
      : [emptyHint("noDisabledSites")])
  );

  const presets = Array.isArray(all.presets) ? all.presets : [];
  $("presets").replaceChildren(
    ...(presets.length
      ? presets.map((p) =>
          listItem(p.name, changedText(p.settings), () =>
            browser.storage.local.set({ presets: presets.filter((x) => x !== p) })
          )
        )
      : [emptyHint("noCustomPresets")])
  );

  renderRules(AVFX.sanitizeRules(all[RULES_KEY]), presets);

  const prefs = { ...PREFS_DEFAULTS, ...all[PREFS_KEY] };
  $("resumeToggle").setAttribute("aria-pressed", String(prefs.resume));
  $("knobToggle").checked = prefs.knob;
  const positions = Object.keys(isRecord(all[RESUME_KEY]) ? all[RESUME_KEY] : {}).length;
  $("resumeClear").replaceChildren(icon("trash"), t("forgetPositions", positions));
  $("resumeClear").hidden = !positions;

  const def = all[DEFAULTS_KEY];
  $("defaultStatus").textContent = def ? `${t("defaultActive")} (${changedText(def)})` : t("defaultNone");
  $("removeDefault").hidden = !def;
}

// ---------- Rules ----------

function presetLabel(preset, userPresets) {
  if (preset.startsWith("builtin:")) {
    const id = preset.slice(8);
    return AVFX.PRESETS.some((p) => p.id === id) ? t(`preset_${id}`) : t("presetMissing");
  }
  const name = preset.slice(5);
  return userPresets.some((p) => p?.name === name) ? name : t("presetMissing");
}

function ruleMeta(rule, userPresets) {
  const parts = [];
  if (rule.preset) parts.push(presetLabel(rule.preset, userPresets));
  if (rule.speed !== null) parts.push(`${AVFX.formatNumber(rule.speed, 2)}×`);
  return parts.join(" · ");
}

function renderRules(rules, userPresets) {
  $("rules").replaceChildren(
    ...(rules.length
      ? rules.map((r) =>
          listItem(r.pattern, ruleMeta(r, userPresets), () =>
            browser.storage.local.set({ [RULES_KEY]: rules.filter((x) => x !== r) })
          )
        )
      : [emptyHint("noRules")])
  );

  // Keeps the selection while the list of presets is rebuilt.
  const select = $("rulePreset");
  const chosen = select.value;
  select.replaceChildren(
    el("option", { value: "", textContent: t("rulePresetNone") }),
    ...AVFX.PRESETS.map((p) => el("option", { value: `builtin:${p.id}`, textContent: t(`preset_${p.id}`) })),
    ...userPresets.map((p) => el("option", { value: `user:${p.name}`, textContent: p.name }))
  );
  if ([...select.options].some((o) => o.value === chosen)) select.value = chosen;
}

async function addRule() {
  const status = $("ruleStatus");
  const pattern = $("rulePattern").value.trim();
  const preset = $("rulePreset").value;
  const speedText = $("ruleSpeed").value.trim();
  const speed = speedText === "" ? null : Number(speedText);
  const fail = (key) => {
    status.textContent = t(key);
    status.classList.add("error");
  };
  // A pattern must at least match an address made from itself, else it's useless.
  const sample = `https://${pattern.replace(/^[a-z]+:\/\//i, "").replace(/^\*\./, "").replace(/\*/g, "x")}`;
  if (!pattern || !AVFX.ruleMatches(pattern, sample)) return fail("ruleBadPattern");
  if (!preset && speed === null) return fail("ruleNeedsAction");
  if (speed !== null && !Number.isFinite(speed)) return fail("ruleBadPattern");

  const { [RULES_KEY]: stored } = await browser.storage.local.get(RULES_KEY);
  // The same pattern again replaces the rule.
  const rules = AVFX.sanitizeRules(stored).filter((r) => r.pattern !== pattern);
  await browser.storage.local.set({ [RULES_KEY]: AVFX.sanitizeRules([...rules, { pattern, preset, speed }]) });
  $("rulePattern").value = "";
  $("ruleSpeed").value = "";
  status.textContent = t("ruleAdded");
  status.classList.remove("error");
}

// ---------- Backup ----------

// A plain JSON object, not an array, string or null.
function isRecord(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function withoutEnabled(values) {
  const { enabled, ...rest } = AVFX.sanitize(values);
  return rest;
}

async function exportBackup() {
  const all = await browser.storage.local.get(null);
  const sites = {};
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(SITE_PREFIX)) sites[k.slice(SITE_PREFIX.length)] = v;
  }
  const backup = {
    app: BACKUP_APP,
    version: browser.runtime.getManifest().version,
    exported: new Date().toISOString(),
    sites,
    presets: all.presets ?? [],
    defaults: all[DEFAULTS_KEY] ?? null,
    disabled: all[DISABLED_KEY] ?? [],
    rules: AVFX.sanitizeRules(all[RULES_KEY]),
    prefs: { ...PREFS_DEFAULTS, ...all[PREFS_KEY] },
    // Positions for "continue watching" stay out: they are a viewing history.
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
  const date = backup.exported.slice(0, 10);
  el("a", { href: url, download: `klangbild-backup-${date}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Merges a backup into storage: entries with the same site or preset name are replaced.
async function importBackup(file) {
  const status = $("backupStatus");
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    data = null;
  }
  if (data?.app !== BACKUP_APP) {
    status.textContent = t("importFailed");
    status.classList.add("error");
    return;
  }

  const patch = {};
  let siteCount = 0;
  for (const [host, values] of Object.entries(isRecord(data.sites) ? data.sites : {})) {
    if (!host || !isRecord(values)) continue;
    patch[AVFX.siteKey(host)] = AVFX.sanitize(values);
    siteCount++;
  }

  // Same name twice (also after trimming or shortening): the later one wins.
  const byName = new Map();
  for (const p of Array.isArray(data.presets) ? data.presets : []) {
    const name = typeof p?.name === "string" ? p.name.trim().slice(0, 40) : "";
    if (!name) continue;
    byName.delete(name);
    byName.set(name, { name, settings: withoutEnabled(p.settings) });
  }
  const imported = [...byName.values()];
  if (imported.length) {
    const { presets = [] } = await browser.storage.local.get("presets");
    const names = new Set(imported.map((p) => p.name));
    patch.presets = [...presets.filter((p) => !names.has(p.name)), ...imported];
  }

  if (isRecord(data.defaults)) patch[DEFAULTS_KEY] = withoutEnabled(data.defaults);

  const hosts = (Array.isArray(data.disabled) ? data.disabled : []).filter((h) => typeof h === "string" && h);
  if (hosts.length) {
    const { [DISABLED_KEY]: current = [] } = await browser.storage.local.get(DISABLED_KEY);
    patch[DISABLED_KEY] = [...new Set([...current, ...hosts])];
  }

  // Rules with the same pattern are replaced.
  const rules = AVFX.sanitizeRules(data.rules);
  if (rules.length) {
    const { [RULES_KEY]: current } = await browser.storage.local.get(RULES_KEY);
    const patterns = new Set(rules.map((r) => r.pattern));
    patch[RULES_KEY] = AVFX.sanitizeRules([...AVFX.sanitizeRules(current).filter((r) => !patterns.has(r.pattern)), ...rules]);
  }
  if (isRecord(data.prefs)) {
    const prefs = {};
    for (const [k, v] of Object.entries(PREFS_DEFAULTS)) if (typeof data.prefs[k] === typeof v) prefs[k] = data.prefs[k];
    if (Object.keys(prefs).length) {
      const { [PREFS_KEY]: current } = await browser.storage.local.get(PREFS_KEY);
      patch[PREFS_KEY] = { ...PREFS_DEFAULTS, ...current, ...prefs };
    }
  }

  await browser.storage.local.set(patch);
  status.textContent = t("importDone", siteCount, imported.length);
  status.classList.remove("error");
}

// ---------- Init ----------

localizePage();
$("deleteSites").prepend(icon("trash"));
$("removeDefault").prepend(icon("trash"));
$("export").prepend(icon("download"));
$("import").prepend(icon("upload"));

$("deleteSites").addEventListener("click", async () => {
  const all = await browser.storage.local.get(null);
  await browser.storage.local.remove(Object.keys(all).filter((k) => k.startsWith(SITE_PREFIX)));
});
$("removeDefault").addEventListener("click", () => browser.storage.local.remove(DEFAULTS_KEY));
$("export").addEventListener("click", exportBackup);
$("addRule").prepend(icon("plus"));
$("addRule").addEventListener("click", addRule);
$("rulePattern").placeholder = t("rulePatternPlaceholder");
$("ruleSpeed").placeholder = t("ruleSpeedPlaceholder");
$("rulePattern").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addRule();
});
$("resumeToggle").prepend(icon("resume"));
$("resumeToggle").addEventListener("click", async () => {
  const { [PREFS_KEY]: prefs } = await browser.storage.local.get(PREFS_KEY);
  const next = { ...PREFS_DEFAULTS, ...prefs };
  next.resume = !next.resume;
  await browser.storage.local.set({ [PREFS_KEY]: next });
});
$("knobToggle").addEventListener("change", async (e) => {
  const { [PREFS_KEY]: prefs } = await browser.storage.local.get(PREFS_KEY);
  await browser.storage.local.set({ [PREFS_KEY]: { ...PREFS_DEFAULTS, ...prefs, knob: e.target.checked } });
});
$("resumeClear").addEventListener("click", () => browser.storage.local.remove(RESUME_KEY));
$("import").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  const [file] = e.target.files;
  if (file) importBackup(file);
  e.target.value = "";
});

// The popup may change storage while this page is open.
browser.storage.onChanged.addListener(render);
render();
