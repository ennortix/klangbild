// Mixer tab of the sidebar: every media element of every tab that plays or played,
// each with its own volume and mute on top of the tab's settings (until the page is
// reloaded), plus the browser's own tab mute, which also works for DRM media.

const MIXER_GAIN_MAX = 200; // %
const LEVEL_FLOOR = -60; // dBFS at the meter's left end

// Re-attaching unchanged nodes would cancel a click or slider drag in progress.
function syncChildren(parent, nodes) {
  const current = parent.children;
  if (current.length === nodes.length && nodes.every((n, i) => current[i] === n)) return;
  parent.replaceChildren(...nodes);
}

function renderMixer() {
  const list = el("div", { className: "mixer" });
  const empty = el("div", { className: "hint", textContent: t("mixerEmpty") });
  const message = el("div", { className: "hint error" });
  const groups = new Map(); // tabId -> { node, body, items: Map(key -> row), tab, … }
  const known = new Set(); // tabs that had media, so paused media stays listed

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
            func: () => globalThis.__avfxMediaList?.() ?? null,
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
    const mute = el("button", { type: "button", className: "chip small" }, icon("tabMuted"), t("muteTab"));
    mute.addEventListener("click", () =>
      browser.tabs.update(g.tab.id, { muted: !g.tab.mutedInfo?.muted }).then(() => poll(true))
    );
    const body = el("div", { className: "mixer-items" });
    const head = el("div", { className: "mixer-tab-head" }, favicon, title, mute);
    g = { node: el("section", { className: "mixer-tab" }, head, body), body, favicon, title, mute, items: new Map(), tab };
    groups.set(tab.id, g);
    return g;
  }

  function rowFor(g, key, item) {
    let r = g.items.get(key);
    if (r) return r;
    const name = el("span", { className: "mixer-name" });
    const state = el("span", { className: "mixer-state" });
    const play = el("button", { type: "button", className: "stepper", title: t("playPause") }, icon("playPause"));
    play.addEventListener("click", () => send(g.tab.id, r.item, { action: "play" }));
    const meter = el("div", { className: "meter" }, el("div", { className: "meter-fill" }));
    const range = el("input", { type: "range", min: 0, max: MIXER_GAIN_MAX, step: 1 });
    const value = el("span", { className: "mixer-value" });
    const mute = el("button", { type: "button", className: "stepper", title: t("mute") }, icon("tabMuted"));
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
    const node = el(
      "div",
      { className: "mixer-item" },
      el("div", { className: "mixer-item-head" }, icon(item.kind === "video" ? "video" : "audio"), name, state, play),
      meter,
      el("div", { className: "mixer-controls" }, range, value, mute),
      note
    );
    r = { node, name, state, play, meter, range, value, mute, note, item, isDragging: () => dragging };
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
  }

  function show(results) {
    const seen = new Set();
    const order = [];
    // The panel's tab first, then audible ones, then tab order.
    results.sort(
      (a, b) => (b.tab.id === tabId) - (a.tab.id === tabId) || b.tab.audible - a.tab.audible || a.tab.index - b.tab.index
    );
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

      const keys = new Set();
      const rows = [];
      const perKind = { video: 0, audio: 0 };
      for (const item of items) {
        const key = `${item.frameId}:${item.id}`;
        keys.add(key);
        const r = rowFor(g, key, item);
        updateRow(r, item, ++perKind[item.kind]);
        rows.push(r.node);
      }
      for (const key of g.items.keys()) if (!keys.has(key)) g.items.delete(key);
      if (!items.length) {
        g.noAccess ??= el("div", { className: "hint" });
        g.noAccess.textContent = t(disabled ? "mixerDisabledHere" : "mixerNoAccess");
        rows.push(g.noAccess);
      }
      syncChildren(g.body, rows);
    }
    for (const id of groups.keys()) if (!seen.has(id)) groups.delete(id);
    syncChildren(list, order);
    empty.hidden = order.length > 0;
  }

  let busy = false;
  async function poll(once = false) {
    if (!busy && activeSection === "mixer" && !document.hidden) {
      busy = true;
      try {
        show(await collect());
      } catch (e) {
        console.warn("[Klangbild] Mixer update failed:", e);
      } finally {
        busy = false;
      }
    }
    if (!once) setTimeout(poll, 400);
  }
  poll();

  return [el("div", { className: "hint", textContent: t("mixerHint") }), message, empty, list];
}
