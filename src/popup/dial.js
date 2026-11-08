// The other ways to show a slider control: a knob (turned by dragging up and down), a
// fader (a vertical slider, as on a mixing desk) and a tile (a big value, dragged sideways).
// The card's view (layout.js) picks one; the list view keeps renderRange() from popup.js.
// All three: the arrow keys step (Page Up/Down: 10 steps), the wheel steps (Shift: 10),
// a double-click resets, a click on the value lets you type it.

const DIAL_DRAG_PX = 220; // a drag over this many pixels covers the whole range (knob, tile)
const KNOB_SWEEP = 270; // degrees from the lowest to the highest value

// The point a fill starts from: 0 for sliders that go below zero, else the lowest value.
function dialOrigin(spec) {
  return spec.rangeMin < 0 && spec.rangeMax > 0 ? 0 : spec.rangeMin;
}

function dialFraction(v, spec) {
  return AVFX.clamp((v - spec.rangeMin) / (spec.rangeMax - spec.rangeMin || 1), 0, 1);
}

// SVG arc on a circle around (32, 32) from angle a to b (degrees, 0 = up, clockwise).
function arcPath(a, b, r = 26) {
  const point = (deg) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(32 + r * Math.cos(rad)).toFixed(2)} ${(32 + r * Math.sin(rad)).toFixed(2)}`;
  };
  const [from, to] = a <= b ? [a, b] : [b, a];
  if (to - from < 0.01) return `M${point(from)}`;
  return `M${point(from)}A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${point(to)}`;
}

function svgNode(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

// style: "knob" | "fader" | "tile"
function renderDial(c, style) {
  const node = el("div", { className: `dial ${style}` });
  node.dataset.key = c.key;
  const ctrl = el("div", { className: "dial-ctrl", tabIndex: 0, title: c.hint ?? "" });
  ctrl.setAttribute("role", "slider");
  ctrl.setAttribute("aria-label", c.label);
  const value = el("button", { type: "button", className: "dial-value", title: t("dialTypeValue") });
  const label = el("div", { className: "dial-label" }, icon(c.icon), el("span", { textContent: c.label }));
  const get = () => settings[c.key];
  const spec = () => sliderSpec(c);
  const set = (v) => {
    const s = spec();
    update({ [c.key]: snapTo(AVFX.clamp(v, s.min, s.max), 1, s) });
  };
  const reset = () => update({ [c.key]: DEFAULTS[c.key] });

  // Drawing
  let draw;
  if (style === "knob") {
    const half = KNOB_SWEEP / 2;
    const track = svgNode("path", { class: "dial-track", d: arcPath(-half, half) });
    const fill = svgNode("path", { class: "dial-fill" });
    const pointer = svgNode("circle", { class: "dial-pointer", cx: 32, cy: 6, r: 4.5 });
    const svg = svgNode("svg", { viewBox: "0 0 64 64", "aria-hidden": "true" });
    svg.append(track, fill, pointer);
    ctrl.append(svg, value);
    draw = (v, s) => {
      const angle = (f) => -half + f * KNOB_SWEEP;
      fill.setAttribute("d", arcPath(angle(dialFraction(dialOrigin(s), s)), angle(dialFraction(v, s))));
      pointer.setAttribute("transform", `rotate(${angle(dialFraction(v, s)).toFixed(1)} 32 32)`);
    };
    node.append(ctrl, label);
  } else if (style === "fader") {
    const fill = el("div", { className: "dial-fill" });
    const thumb = el("div", { className: "dial-thumb" });
    const zero = el("div", { className: "dial-zero" });
    ctrl.append(el("div", { className: "dial-track" }, zero, fill, thumb));
    draw = (v, s) => {
      const f = dialFraction(v, s);
      const o = dialFraction(dialOrigin(s), s);
      fill.style.bottom = `${Math.min(f, o) * 100}%`;
      fill.style.height = `${Math.abs(f - o) * 100}%`;
      thumb.style.bottom = `${f * 100}%`;
      zero.style.bottom = `${o * 100}%`;
      zero.hidden = o === 0;
    };
    node.append(value, ctrl, label);
  } else {
    const fill = el("div", { className: "dial-fill" });
    ctrl.append(fill, el("div", { className: "dial-tile-text" }, label, value));
    draw = (v, s) => {
      const f = dialFraction(v, s);
      const o = dialFraction(dialOrigin(s), s);
      fill.style.left = `${Math.min(f, o) * 100}%`;
      fill.style.width = `${Math.abs(f - o) * 100}%`;
    };
    node.append(ctrl);
  }

  updaters.push(() => {
    const s = spec();
    const v = get();
    draw(v, s);
    if (!value.querySelector("input")) value.textContent = formatValue(v, c, s);
    ctrl.setAttribute("aria-valuemin", s.min);
    ctrl.setAttribute("aria-valuemax", s.max);
    ctrl.setAttribute("aria-valuenow", v);
    ctrl.setAttribute("aria-valuetext", formatValue(v, c, s));
    node.classList.toggle("changed", v !== DEFAULTS[c.key]);
  });

  const off = () => node.classList.contains("disabled");

  // Dragging: knob and tile move relative to where they were grabbed, the fader follows
  // the pointer along its track (a click jumps there).
  ctrl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || off() || e.target.closest(".dial-value")) return;
    e.preventDefault();
    ctrl.focus();
    ctrl.setPointerCapture(e.pointerId);
    node.classList.add("active");
    const s = spec();
    const start = { x: e.clientX, y: e.clientY, v: get() };
    const trackBox = ctrl.querySelector(".dial-track")?.getBoundingClientRect();
    const move = (ev) => {
      if (style === "fader") {
        const f = 1 - AVFX.clamp((ev.clientY - trackBox.top) / trackBox.height, 0, 1);
        set(s.rangeMin + f * (s.rangeMax - s.rangeMin));
        return;
      }
      const delta = style === "knob" ? start.y - ev.clientY : ev.clientX - start.x;
      const fine = ev.shiftKey ? 0.2 : 1;
      set(start.v + (delta / DIAL_DRAG_PX) * fine * (s.rangeMax - s.rangeMin));
    };
    const end = () => {
      ctrl.removeEventListener("pointermove", move);
      ctrl.removeEventListener("pointerup", end);
      ctrl.removeEventListener("pointercancel", end);
      node.classList.remove("active");
    };
    if (style === "fader") move(e);
    ctrl.addEventListener("pointermove", move);
    ctrl.addEventListener("pointerup", end);
    ctrl.addEventListener("pointercancel", end);
  });

  ctrl.addEventListener("dblclick", (e) => {
    if (!off() && !e.target.closest(".dial-value")) reset();
  });

  ctrl.addEventListener("wheel", (e) => {
    if (off()) return;
    e.preventDefault();
    update({ [c.key]: stepToward(get(), (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1), spec()) });
  }, { passive: false });

  ctrl.addEventListener("keydown", (e) => {
    if (off() || e.target !== ctrl) return;
    const s = spec();
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (k) update({ [c.key]: stepBy(get(), k, s) });
    else if (e.key === "Home") update({ [c.key]: s.min });
    else if (e.key === "End") update({ [c.key]: s.max });
    else if (e.key === "Delete" || e.key === "Backspace") reset();
    else return;
    e.preventDefault();
  });

  // Typing a value: the value turns into a number field until Enter, Escape or blur.
  value.addEventListener("click", () => {
    if (off() || value.querySelector("input")) return;
    const s = spec();
    const input = el("input", { type: "number", min: s.min, max: s.max, step: "any", value: get() });
    input.setAttribute("aria-label", c.label);
    value.replaceChildren(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const text = input.value.trim().replace(",", ".");
      if (save && text !== "" && !Number.isNaN(Number(text))) set(Number(text));
      value.replaceChildren();
      refresh();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => finish(true));
  });

  return node;
}
