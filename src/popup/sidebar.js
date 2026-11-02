// Extras of the Firefox sidebar (IN_SIDEBAR): a timeline with jump buttons for the
// tab's primary media, sliders reaching AVFX.LIMITS ("extended limits") and custom
// slider steps. The popup keeps the everyday ranges and steps.

const UI_KEY = "sidebarUi";
const UI_DEFAULTS = Object.freeze({ extended: true, steps: {}, jumpShort: 5, jumpLong: 30 });
const JUMP_RANGE = [0.1, 3600]; // seconds
const MIN_STEP = 0.001;

let ui = { ...UI_DEFAULTS };

function sanitizeUi(v) {
  const out = { ...UI_DEFAULTS, steps: {} };
  if (!v || typeof v !== "object") return out;
  if (typeof v.extended === "boolean") out.extended = v.extended;
  for (const k of ["jumpShort", "jumpLong"]) {
    if (Number.isFinite(v[k])) out[k] = AVFX.clamp(v[k], ...JUMP_RANGE);
  }
  if (v.steps && typeof v.steps === "object") {
    for (const [k, s] of Object.entries(v.steps)) {
      if (Object.hasOwn(AVFX.LIMITS, k) && Number.isFinite(s) && s >= MIN_STEP) out.steps[k] = s;
    }
  }
  return out;
}

async function loadUi() {
  ui = sanitizeUi((await browser.storage.local.get(UI_KEY))[UI_KEY]);
}

function saveUi(patch) {
  ui = sanitizeUi({ ...ui, ...patch });
  refresh();
  return browser.storage.local.set({ [UI_KEY]: ui }).catch(() => {});
}

// ---------- Following the tab ----------

// Decides when the sidebar starts over for its tab: after a real page load, or when the
// site changes. Firefox also reports pushState, replaceState and hash changes as
// status "complete" (without a "loading" before), and players that keep the position
// in the URL do that all the time.
function navigationWatcher(currentHost, loading = false) {
  return (change) => {
    if (change.url && AVFX.hostOf(change.url) !== currentHost()) return true;
    if (change.status === "loading") loading = true;
    if (change.status === "complete" && loading) return true;
    return false;
  };
}

// ---------- Slider geometry ----------

const decimalsOf = (n) => (String(n).split(".")[1] ?? "").length;

// Bounds and step of a slider. The step grid is anchored at the default value, so it
// stays reachable with any step (speed step 0.3: … 0.7, 1, 1.3 …). A range input only
// stops at min + k·step, so its ends are moved onto that grid; the number field accepts
// the full bounds.
function sliderSpec(c) {
  const lim = IN_SIDEBAR && ui.extended ? AVFX.LIMITS[c.key] : null;
  const min = lim ? lim[0] : c.min;
  const max = lim ? lim[1] : c.max;
  const step = (IN_SIDEBAR && ui.steps[c.key]) || c.step;
  const anchor = AVFX.DEFAULTS[c.key] ?? 0;
  const spec = { min, max, step, anchor };
  return {
    ...spec,
    rangeMin: onGrid(anchor - Math.floor((anchor - min) / step + 1e-9) * step, spec),
    rangeMax: onGrid(anchor + Math.floor((max - anchor) / step + 1e-9) * step, spec),
  };
}

function onGrid(v, { step, anchor = 0 }) {
  return Number(v.toFixed(Math.min(Math.max(decimalsOf(step), decimalsOf(anchor)), 6)));
}

// The next grid point above (dir 1) or below (dir -1) the value. Never moves the other
// way: a value beyond the bounds (extended limits switched off) stays where it is.
function nudge(value, dir, spec) {
  const { min, max, step, anchor = 0 } = spec;
  const pos = (value - anchor) / step;
  const k = dir > 0 ? Math.floor(pos + 1e-9) + 1 : Math.ceil(pos - 1e-9) - 1;
  const next = AVFX.clamp(onGrid(anchor + k * step, spec), min, max);
  return (dir > 0 ? next < value : next > value) ? value : next;
}

// ---------- Timeline ----------

function renderTimeline() {
  const fmt = AVFX.formatTime;
  const time = el("span", { className: "tl-time", textContent: t("connecting") });
  const state = el("span", { className: "tl-state" });
  const bar = el("input", { type: "range", className: "tl-bar", min: 0, max: 1, step: "any", value: 0, disabled: true });
  const loop = el("div", { className: "tl-loop", hidden: true });
  let last = null;
  let dragging = false;

  function show(st) {
    last = st;
    for (const b of buttons) b.disabled = !st;
    if (!st) {
      time.textContent = t("noMediaPlaying");
      state.textContent = "";
      bar.disabled = true;
      bar.value = 0;
      loop.hidden = true;
      return;
    }
    const d = st.duration;
    const seekable = Number.isFinite(d) && d > 0;
    bar.disabled = !seekable;
    state.textContent = t(st.paused ? "paused" : "playing");
    // Real time won by skipping pauses, from 1 s on
    if (st.silenceSaved >= 1) state.textContent += ` · ${t("silenceSaved", fmt(st.silenceSaved))}`;
    play.setAttribute("aria-pressed", String(!st.paused));
    if (dragging) return;
    if (seekable) {
      bar.max = d;
      bar.value = st.time;
      time.textContent = `${fmt(st.time)} / ${fmt(d)}`;
    } else {
      time.textContent = Number.isFinite(d) ? fmt(st.time) : `${fmt(st.time)} · ${t("live")}`;
    }
    // A-B loop region under the bar
    loop.hidden = !seekable || st.loopA === null;
    if (!loop.hidden) {
      const b = st.loopB ?? st.loopA;
      loop.style.left = `${(st.loopA / d) * 100}%`;
      loop.style.width = `max(2px, ${((b - st.loopA) / d) * 100}%)`;
    }
  }

  async function act(action, extra = {}) {
    const r = await sendToPrimary({ type: "action", action, ...extra });
    show(r?.state ?? null);
  }

  bar.addEventListener("input", () => {
    dragging = true;
    time.textContent = `${fmt(Number(bar.value))} / ${fmt(last?.duration)}`;
  });
  bar.addEventListener("change", async () => {
    await act("seek-to", { time: Number(bar.value) });
    dragging = false;
  });

  const button = (ic, action, extra, title, label = "") => {
    const b = el("button", { type: "button", className: "tl-btn", title }, icon(ic));
    if (label) b.append(el("span", { textContent: label }));
    b.addEventListener("click", () => act(action, typeof extra === "function" ? extra() : extra));
    return b;
  };
  const seconds = (n) => AVFX.formatNumber(n, 1);
  const jump = (key, dir) => {
    const b = button(dir < 0 ? "seekBack" : "seekFwd", "seek", () => ({ seconds: dir * ui[key] }), "");
    b.classList.add("jump");
    updaters.push(() => {
      b.title = t(dir < 0 ? "seekBackBy" : "seekFwdBy", seconds(ui[key]));
      b.querySelector("span")?.remove();
      b.append(el("span", { textContent: `${dir < 0 ? "−" : "+"}${seconds(ui[key])}` }));
    });
    return b;
  };
  const play = button("playPause", "play", {}, t("playPause"));
  const buttons = [
    jump("jumpLong", -1),
    jump("jumpShort", -1),
    button("frameBack", "frame", { dir: -1 }, t("frameBack")),
    play,
    button("frameFwd", "frame", { dir: 1 }, t("frameFwd")),
    jump("jumpShort", 1),
    jump("jumpLong", 1),
  ];

  async function poll() {
    if (tabId !== null && !document.hidden && !dragging) await act("state");
    else if (tabId === null && panelReady) {
      show(null);
      time.textContent = t("notAvailable");
    }
    setTimeout(poll, 250);
  }
  poll();

  return [
    el("div", { className: "tl-head" }, time, state),
    el("div", { className: "tl-track" }, bar, el("div", { className: "tl-lane" }, loop)),
    el("div", { className: "tl-buttons" }, ...buttons),
  ];
}

// ---------- Customize tab ----------

function numberInput(value, { min, max, placeholder = "" }, onChange) {
  const input = el("input", { type: "number", min, max, step: "any", value: value ?? "", placeholder });
  input.addEventListener("change", () => {
    const text = input.value.trim().replace(",", ".");
    const v = text === "" ? null : Number(text);
    onChange(v === null || Number.isNaN(v) ? null : AVFX.clamp(v, min, max));
  });
  return input;
}

function settingRow(iconName, label, input, unit) {
  return el(
    "label",
    { className: "setting-row" },
    el("span", { className: "name" }, icon(iconName), label),
    el("span", { className: "num" }, input, el("span", { textContent: unit }))
  );
}

function renderCustomize() {
  const extended = el("button", { type: "button", className: "chip" }, icon("speed"), t("extendedLimits"));
  extended.addEventListener("click", () => saveUi({ extended: !ui.extended }));
  updaters.push(() => extended.setAttribute("aria-pressed", String(ui.extended)));

  const jumpRow = (key, label) => {
    const input = numberInput(ui[key], { min: JUMP_RANGE[0], max: JUMP_RANGE[1] }, (v) => {
      saveUi({ [key]: v ?? UI_DEFAULTS[key] });
      input.value = ui[key];
    });
    return settingRow("seekFwd", label, input, "s");
  };

  const stepInputs = [];
  const stepRows = [];
  for (const section of SECTIONS) {
    for (const g of section.groups) {
      for (const c of g.controls ?? []) {
        const input = numberInput(ui.steps[c.key], { min: MIN_STEP, max: (AVFX.LIMITS[c.key][1] - AVFX.LIMITS[c.key][0]) / 2, placeholder: AVFX.formatNumber(c.step, 3) }, (v) => {
          const steps = { ...ui.steps };
          if (v === null || v === c.step) delete steps[c.key];
          else steps[c.key] = v;
          saveUi({ steps });
          input.value = ui.steps[c.key] ?? "";
        });
        stepInputs.push(input);
        stepRows.push(settingRow(c.icon, c.label, input, c.unit));
      }
    }
  }
  const resetSteps = el("button", { type: "button", className: "chip" }, icon("reset"), t("resetSteps"));
  resetSteps.addEventListener("click", () => {
    saveUi({ steps: {} });
    for (const i of stepInputs) i.value = "";
  });

  const L = AVFX.LIMITS;
  const n = (v) => AVFX.formatNumber(v, 2);
  return [
    el("div", { className: "group-title" }, icon("speed"), t("limitsTitle")),
    el("div", { className: "toggles" }, extended),
    el("div", {
      className: "hint",
      textContent: t(
        "extendedLimitsHint",
        `${n(L.speed[0])}–${n(L.speed[1])}`,
        n(L.volume[1]),
        n(L.bass[1]),
        n(L.audioDelay[1])
      ),
    }),
    el("div", { className: "group-title" }, icon("seekFwd"), t("jumpWidths")),
    el("div", { className: "setting-list" }, jumpRow("jumpShort", t("jumpShort")), jumpRow("jumpLong", t("jumpLong"))),
    el("div", { className: "group-title" }, icon("tune"), t("sliderSteps")),
    el("div", { className: "hint", textContent: t("sliderStepsHint") }),
    el("div", { className: "setting-list" }, ...stepRows),
    el("div", { className: "toggles" }, resetSteps),
  ];
}
