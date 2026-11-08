// Mixer tab of the sidebar: every media element of every tab that plays or played,
// each with its own volume and mute on top of the tab's settings (until the page is
// reloaded), plus the browser's own tab mute, which also works for DRM media.
// On top a crossfader between two tabs; the background page keeps and applies it.
// Detection: each playing medium is marked "voice" or "sound", and media playing the
// same audio (in two tabs, or twice in one) are pointed out, see AVFX.VOICE/DUPLICATE.

const MIXER_GAIN_MAX = 200; // %
const LEVEL_FLOOR = -60; // dBFS at the meter's left end

// Re-attaching unchanged nodes would cancel a click or slider drag in progress.
function syncChildren(parent, nodes) {
  const current = parent.children;
  if (current.length === nodes.length && nodes.every((n, i) => current[i] === n)) return;
  parent.replaceChildren(...nodes);
}

// Crossfader: tab A and B, a slider from "only A" to "only B", a quick switch between
// the two and the automatic mode, which lowers B while A plays. refresh(tabs) runs on
// every poll of the mixer.
function renderCrossfader() {
  let config = { ...AVFX.CROSSFADE_DEFAULTS };
  let dragging = false;
  // Only the changed fields: the background page merges them with its current config.
  const send = async (patch) => {
    config = AVFX.sanitizeCrossfade({ ...config, ...patch });
    const info = await browser.runtime.sendMessage({ type: "crossfade-set", patch }).catch(() => null);
    if (info) show(info);
  };
  const quickSwitch = async () => {
    const info = await browser.runtime.sendMessage({ type: "crossfade-switch" }).catch(() => null);
    if (info) show(info);
  };

  const pick = (key) => {
    const select = el("select", { className: "device-select", title: t(key === "a" ? "crossfadeTabATip" : "crossfadeTabBTip") });
    select.addEventListener("change", () => {
      const id = select.value === "" ? null : Number(select.value);
      const other = key === "a" ? "b" : "a";
      // Choosing the other side's tab swaps the two.
      send(id !== null && id === config[other] ? { [key]: id, [other]: config[key] } : { [key]: id });
    });
    return select;
  };
  const selects = { a: pick("a"), b: pick("b") };

  const range = el("input", { type: "range", min: -100, max: 100, step: 1, title: t("crossfadeSliderTip") });
  range.addEventListener("input", () => {
    dragging = true;
    send({ position: Number(range.value) });
  });
  range.addEventListener("change", () => (dragging = false));
  range.addEventListener("dblclick", () => send({ position: 0 }));
  const levels = el("span", { className: "mixer-value crossfade-levels", title: t("crossfadeLevelsTip") });

  // The letters at the slider's ends jump to that side alone.
  const only = (letter, position) => {
    const button = el("button", { type: "button", className: "crossfade-letter", textContent: letter, title: t(`crossfadeOnly${letter}`) });
    button.addEventListener("click", () => send({ position }));
    return button;
  };
  const onlyA = only("A", -100);
  const onlyB = only("B", 100);

  const switcher = el("button", { type: "button", className: "chip small", title: t("crossfadeSwitchTip") }, t("crossfadeSwitch"));
  switcher.addEventListener("click", quickSwitch);
  const auto = el("button", { type: "button", className: "chip small", title: t("crossfadeAutoTip") }, t("crossfadeAuto"));
  auto.addEventListener("click", () => send({ auto: !config.auto }));
  const duck = el("input", { type: "range", min: 0, max: 100, step: 1, title: t("crossfadeDuckTip") });
  let duckDragging = false;
  duck.addEventListener("input", () => {
    duckDragging = true;
    send({ duck: Number(duck.value) });
  });
  duck.addEventListener("change", () => (duckDragging = false));
  duck.addEventListener("dblclick", () => send({ duck: AVFX.CROSSFADE_DEFAULTS.duck }));
  const duckValue = el("span", { className: "mixer-value", title: t("crossfadeDuckTip") });
  const duckRow = el(
    "div",
    { className: "crossfade-duck" },
    el("span", { textContent: t("crossfadeDuck"), title: t("crossfadeDuckTip") }),
    duck,
    duckValue
  );
  // What makes A count as playing: any sound, or only a voice.
  const triggers = ["sound", "voice"].map((trigger) => {
    const button = el(
      "button",
      { type: "button", className: "chip small", title: t(trigger === "voice" ? "crossfadeTriggerVoiceTip" : "crossfadeTriggerSoundTip") },
      icon(trigger === "voice" ? "voice" : "audio"),
      t(trigger === "voice" ? "crossfadeTriggerVoice" : "crossfadeTriggerSound")
    );
    button.addEventListener("click", () => send({ trigger }));
    return [trigger, button];
  });
  const triggerRow = el(
    "div",
    { className: "crossfade-duck" },
    el("span", { textContent: t("crossfadeTrigger"), title: t("crossfadeTriggerTip") }),
    ...triggers.map(([, button]) => button)
  );
  const status = el("div", { className: "hint" });

  const side = (letter, select) =>
    el(
      "label",
      { className: "crossfade-pick" },
      el("span", { className: "crossfade-letter", textContent: letter, title: select.title }),
      select
    );
  const node = el(
    "section",
    { className: "crossfade" },
    el(
      "div",
      { className: "crossfade-head" },
      icon("pan"),
      el("span", { className: "crossfade-title", textContent: t("crossfader"), title: t("crossfadeHint") }),
      switcher,
      auto
    ),
    el("div", { className: "hint", textContent: t("crossfadeHint") }),
    side("A", selects.a),
    side("B", selects.b),
    el("div", { className: "crossfade-slider" }, onlyA, range, onlyB),
    levels,
    triggerRow,
    duckRow,
    status
  );

  let tabList = [];
  function fillSelects() {
    for (const [key, select] of Object.entries(selects)) {
      if (document.activeElement === select) continue; // rebuilding would close it
      const options = [el("option", { value: "", textContent: t("crossfadeNone") })];
      for (const tab of tabList) options.push(el("option", { value: String(tab.id), textContent: tab.title || tab.url || `#${tab.id}` }));
      const signature = options.map((o) => `${o.value}:${o.textContent}`).join("|");
      if (select.dataset.signature !== signature) {
        select.replaceChildren(...options);
        select.dataset.signature = signature;
      }
      select.value = config[key] === null ? "" : String(config[key]);
    }
  }

  function show(info) {
    config = info.config;
    if (!dragging) range.value = config.position;
    const percent = (g) => Math.round(g * 100);
    levels.textContent = t("crossfadeLevels", percent(info.gains.a), percent(info.gains.b));
    auto.setAttribute("aria-pressed", String(config.auto));
    const ready = config.a !== null && config.b !== null;
    for (const button of [onlyA, onlyB]) button.disabled = !ready;
    switcher.disabled = config.a === null && config.b === null;
    onlyA.setAttribute("aria-pressed", String(config.position === -100));
    onlyB.setAttribute("aria-pressed", String(config.position === 100));
    duckRow.hidden = !config.auto;
    triggerRow.hidden = !config.auto;
    for (const [trigger, button] of triggers) button.setAttribute("aria-pressed", String(config.trigger === trigger));
    if (!duckDragging) duck.value = config.duck;
    duckValue.textContent = `${config.duck} %`;
    const voice = config.trigger === "voice";
    status.textContent = !config.auto
      ? ""
      : info.ducking
        ? t(voice ? "crossfadeDuckingVoice" : "crossfadeDucking")
        : t(voice ? "crossfadeAutoVoiceHint" : "crossfadeAutoHint");
    status.hidden = !status.textContent;
    fillSelects();
  }

  // Offered: the mixer's tabs plus the chosen ones, which may be quiet right now.
  async function refresh(tabs) {
    const info = await browser.runtime.sendMessage({ type: "crossfade-get" }).catch(() => null);
    if (!info) return;
    const ids = new Set(tabs.map((tab) => tab.id));
    const chosen = await Promise.all(
      [info.config.a, info.config.b]
        .filter((id) => id !== null && !ids.has(id))
        .map((id) => browser.tabs.get(id).catch(() => null))
    );
    tabList = [...tabs, ...chosen.filter(Boolean)];
    show(info);
  }

  return { node, refresh, role: (id) => (id === config.a ? "A" : id === config.b ? "B" : "") };
}

function buildMixer() {
  const list = el("div", { className: "mixer" });
  const crossfader = renderCrossfader();
  const empty = el("div", { className: "hint", textContent: t("mixerEmpty") });
  const message = el("div", { className: "hint error" });
  const groups = new Map(); // tabId -> { node, body, items: Map(key -> row), tab, … }
  const known = new Set(); // tabs that had media, so paused media stays listed
  const duplicates = new Map(); // "keyA|keyB" of a pair found playing the same audio

  // Voice and duplicate detection, on unless switched off (remembered in this panel).
  let detecting = true;
  try {
    detecting = localStorage.getItem("mixerDetect") !== "off";
  } catch {}
  const detectChip = el("button", { type: "button", className: "chip small", title: t("mixerDetectTip") }, icon("voice"), t("mixerDetect"));
  const showDetect = () => detectChip.setAttribute("aria-pressed", String(detecting));
  detectChip.addEventListener("click", () => {
    detecting = !detecting;
    try {
      localStorage.setItem("mixerDetect", detecting ? "on" : "off");
    } catch {}
    showDetect();
    poll(true);
  });
  showDetect();

  async function collect() {
    const tabs = await browser.tabs.query({});
    const candidates = tabs.filter(
      (tab) => !tab.discarded && (tab.audible || tab.mutedInfo?.muted || known.has(tab.id) || tab.id === tabId)
    );
    return Promise.all(
      candidates.map(async (tab) => {
        let results = [];
        try {
          results = await browser.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: (detect) => globalThis.__avfxMediaList?.(detect) ?? null,
            args: [detecting],
          });
        } catch {} // restricted pages: only the tab mute is offered
        const disabled = results.some((r) => r.result?.disabled);
        const items = results.flatMap((r) => (Array.isArray(r.result) ? r.result : []).map((m) => ({ ...m, frameId: r.frameId })));
        if (items.length) known.add(tab.id);
        else known.delete(tab.id);
        return { tab, items, disabled };
      })
    );
  }

  async function send(tab, item, patch) {
    const r = await browser.tabs
      .sendMessage(tab, { type: "media-mix", id: item.id, ...patch }, { frameId: item.frameId })
      .catch(() => null);
    message.textContent = r?.ok ? "" : (r?.text ?? t("noMedia"));
    poll(true);
  }

  function groupFor(tab) {
    let g = groups.get(tab.id);
    if (g) return g;
    const favicon = el("img", { className: "mixer-favicon", alt: "", width: 16, height: 16 });
    const title = el("button", { type: "button", className: "mixer-tab-title", title: t("goToTab") });
    title.addEventListener("click", () => {
      browser.tabs.update(g.tab.id, { active: true });
      browser.windows.update(g.tab.windowId, { focused: true }).catch(() => {});
    });
    const mute = el("button", { type: "button", className: "chip small", title: t("muteTabTip") }, icon("tabMuted"), t("muteTab"));
    mute.addEventListener("click", () =>
      browser.tabs.update(g.tab.id, { muted: !g.tab.mutedInfo?.muted }).then(() => poll(true))
    );
    const body = el("div", { className: "mixer-items" });
    const role = el("span", { className: "crossfade-letter", hidden: true });
    const head = el("div", { className: "mixer-tab-head" }, favicon, role, title, mute);
    g = { node: el("section", { className: "mixer-tab" }, head, body), body, favicon, role, title, mute, items: new Map(), tab };
    groups.set(tab.id, g);
    return g;
  }

  function rowFor(g, key, item) {
    let r = g.items.get(key);
    if (r) return r;
    const name = el("span", { className: "mixer-name" });
    const state = el("span", { className: "mixer-state", title: t("mixerStateTip") });
    const play = el("button", { type: "button", className: "stepper", title: t("playPause") }, icon("playPause"));
    play.addEventListener("click", () => send(g.tab.id, r.item, { action: "play" }));
    const meter = el("div", { className: "meter", title: t("mixerLevelTip") }, el("div", { className: "meter-fill" }));
    const range = el("input", { type: "range", min: 0, max: MIXER_GAIN_MAX, step: 1, title: t("mixerGainTip") });
    const value = el("span", { className: "mixer-value", title: t("mixerGainTip") });
    const mute = el("button", { type: "button", className: "stepper", title: t("mixerMuteTip") }, icon("tabMuted"));
    let dragging = false;
    range.addEventListener("input", () => {
      dragging = true;
      value.textContent = `${range.value} %`;
      send(g.tab.id, r.item, { gain: Number(range.value) });
    });
    range.addEventListener("change", () => (dragging = false));
    range.addEventListener("dblclick", () => send(g.tab.id, r.item, { gain: 100 }));
    mute.addEventListener("click", () => send(g.tab.id, r.item, { muted: !r.item.muted }));
    const note = el("div", { className: "hint", hidden: true });
    const badge = el("span", { className: "mixer-badge", hidden: true });
    const dupText = el("span");
    const dupMute = el("button", { type: "button", className: "chip small", title: t("mixerDuplicateMuteTip") }, icon("tabMuted"), t("mute"));
    dupMute.addEventListener("click", () => send(g.tab.id, r.item, { muted: true }));
    const dup = el("div", { className: "mixer-dup", hidden: true, title: t("mixerDuplicateTip") }, icon("repeat"), dupText, dupMute);
    const node = el(
      "div",
      { className: "mixer-item" },
      el("div", { className: "mixer-item-head" }, icon(item.kind === "video" ? "video" : "audio"), name, badge, state, play),
      meter,
      el("div", { className: "mixer-controls" }, range, value, mute),
      dup,
      note
    );
    r = { node, name, state, play, meter, range, value, mute, note, badge, dup, dupText, dupMute, item, isDragging: () => dragging };
    g.items.set(key, r);
    return r;
  }

  function updateRow(r, item, number) {
    r.item = item;
    r.name.textContent = item.label ?? `${t(item.kind === "video" ? "mediaVideo" : "mediaAudio")} ${number}`;
    r.name.title = r.name.textContent;
    r.state.textContent = item.paused ? t("paused") : AVFX.formatTime(item.time);
    r.play.setAttribute("aria-pressed", String(!item.paused));
    const level = item.level ?? -Infinity;
    r.meter.firstChild.style.width = `${Math.max(0, Math.min(1, 1 - level / LEVEL_FLOOR)) * 100}%`;
    r.meter.hidden = !item.hasAudioChain;
    r.range.disabled = item.drm;
    r.mute.disabled = item.drm;
    r.range.max = item.native ? 100 : MIXER_GAIN_MAX;
    if (!r.isDragging() && document.activeElement !== r.range) {
      r.range.value = Math.min(item.gain, Number(r.range.max));
      r.value.textContent = `${item.gain} %`;
    }
    r.mute.setAttribute("aria-pressed", String(item.muted));
    r.node.classList.toggle("muted", item.muted || item.elementMuted);
    r.node.classList.toggle("primary", item.primary);
    const notes = [];
    if (item.drm) notes.push(t("mixerDrm"));
    else if (item.audioBlocked) notes.push(t("statusAudioBlocked"));
    else if (item.native) notes.push(t("mixerNative"));
    if (item.elementMuted) notes.push(t("mutedByPage"));
    r.note.textContent = notes.join(" ");
    r.note.hidden = !notes.length;

    // voice: true/false once analysed, null when not (paused, DRM, other server, …)
    const kind = !detecting || item.paused || item.voice == null ? null : item.voice ? "voice" : item.sound ? "sound" : null;
    r.badge.hidden = !kind;
    if (kind && r.badge.dataset.kind !== kind) {
      r.badge.dataset.kind = kind;
      r.badge.replaceChildren(icon(kind === "voice" ? "voice" : "audio"), t(kind === "voice" ? "mixerVoice" : "mixerSound"));
      r.badge.title = t(kind === "voice" ? "mixerVoiceTip" : "mixerSoundTip");
    }
  }

  // Pairs of playing media whose level histories match (same audio, maybe offset).
  // A pair stays flagged down to a lower correlation, so it doesn't flicker.
  function findDuplicates(entries) {
    const { VOICE, DUPLICATE } = AVFX;
    const frames = (ms) => Math.round(ms / VOICE.frameMs);
    const found = new Map(); // row -> { other, lagMs }
    // Silenced media don't count: once one of a pair is muted, the hint (and its button,
    // which would silence the other one as well) has done its job.
    const silenced = (e) => e.item.muted || e.item.elementMuted || e.tab.mutedInfo?.muted;
    const candidates = entries
      .filter((e) => detecting && !e.item.paused && e.item.levels && !silenced(e))
      .map((e) => ({ ...e, levels: AVFX.smoothLevels(e.item.levels, VOICE.floor) }));
    const pairs = new Set();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const a = candidates[i];
        const b = candidates[j];
        const pair = [a.id, b.id].sort().join("|"); // the row order changes with the tabs' sound
        const match = AVFX.envelopeMatch(a.levels, b.levels, frames(DUPLICATE.maxLagMs), frames(DUPLICATE.minOverlapMs), DUPLICATE.minStd);
        const needed = duplicates.has(pair) ? DUPLICATE.minCorr - 0.05 : DUPLICATE.minCorr;
        if (!match || match.corr < needed) continue;
        pairs.add(pair);
        const lagMs = match.lag * VOICE.frameMs; // > 0: b is heard later than a
        // each row names its closest match
        if (!(found.get(b.r)?.corr >= match.corr)) found.set(b.r, { other: a, lagMs, corr: match.corr });
        if (!(found.get(a.r)?.corr >= match.corr)) found.set(a.r, { other: b, lagMs: -lagMs, corr: match.corr });
      }
    }
    duplicates.clear();
    for (const pair of pairs) duplicates.set(pair, true);
    for (const e of entries) {
      const hit = found.get(e.r);
      e.r.dup.hidden = !hit;
      if (!hit) continue;
      const name = hit.other.tab.id === e.tab.id ? hit.other.r.name.textContent : hit.other.tab.title || hit.other.tab.url || "";
      const seconds = AVFX.formatNumber(Math.abs(hit.lagMs) / 1000, 1);
      const when = Math.abs(hit.lagMs) < 60 ? t("mixerDuplicateSame") : t(hit.lagMs > 0 ? "mixerDuplicateLater" : "mixerDuplicateEarlier", seconds);
      e.r.dupText.textContent = t("mixerDuplicate", name, when);
      e.r.dupMute.hidden = e.item.muted || e.item.drm;
    }
  }

  function show(results) {
    const seen = new Set();
    const order = [];
    // The panel's tab first, then audible ones, then tab order.
    results.sort(
      (a, b) => (b.tab.id === tabId) - (a.tab.id === tabId) || b.tab.audible - a.tab.audible || a.tab.index - b.tab.index
    );
    const entries = [];
    for (const { tab, items, disabled } of results) {
      if (!items.length && !tab.audible && !tab.mutedInfo?.muted) continue;
      const g = groupFor(tab);
      g.tab = tab;
      seen.add(tab.id);
      order.push(g.node);
      g.title.textContent = tab.title || tab.url || "";
      if (tab.favIconUrl && g.favicon.src !== tab.favIconUrl) g.favicon.src = tab.favIconUrl;
      g.favicon.hidden = !tab.favIconUrl;
      g.mute.setAttribute("aria-pressed", String(Boolean(tab.mutedInfo?.muted)));
      g.node.classList.toggle("current", tab.id === tabId);
      g.role.textContent = crossfader.role(tab.id);
      g.role.title = g.role.textContent ? t(`crossfadeRole${g.role.textContent}`) : "";
      g.role.hidden = !g.role.textContent;

      const keys = new Set();
      const rows = [];
      const perKind = { video: 0, audio: 0 };
      for (const item of items) {
        const key = `${item.frameId}:${item.id}`;
        keys.add(key);
        const r = rowFor(g, key, item);
        updateRow(r, item, ++perKind[item.kind]);
        rows.push(r.node);
        entries.push({ id: `${tab.id}:${key}`, tab, item, r });
      }
      for (const key of g.items.keys()) if (!keys.has(key)) g.items.delete(key);
      if (!items.length) {
        g.noAccess ??= el("div", { className: "hint" });
        g.noAccess.textContent = t(disabled ? "mixerDisabledHere" : "mixerNoAccess");
        rows.push(g.noAccess);
      }
      syncChildren(g.body, rows);
    }
    findDuplicates(entries);
    for (const id of groups.keys()) if (!seen.has(id)) groups.delete(id);
    syncChildren(list, order);
    empty.hidden = order.length > 0;
  }

  // Runs while the card is shown; stops when the layout is re-rendered without it.
  let busy = false;
  const watched = [crossfader.node, list];
  async function poll(once = false) {
    if (!watched.some((n) => n.isConnected)) return;
    if (!busy && watched.some(isShown)) {
      busy = true;
      try {
        const results = await collect();
        show(results);
        const shown = results.filter(({ tab, items }) => items.length || tab.audible || tab.mutedInfo?.muted);
        await crossfader.refresh(shown.map(({ tab }) => tab));
      } catch (e) {
        console.warn("[Klangbild] Mixer update failed:", e);
      } finally {
        busy = false;
      }
    }
    if (!once) setTimeout(poll, 400);
  }
  setTimeout(poll, 0);

  return {
    hint: () => [el("div", { className: "hint", textContent: t("mixerHint") })],
    crossfader: () => [crossfader.node],
    media: () => [el("div", { className: "toggles mixer-options" }, detectChip), message, empty, list],
  };
}
