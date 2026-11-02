// Extras for the effect sliders. The thumb carries three rings and turns like a knob
// around the point where it was grabbed: the ring it was grabbed by sets the step size –
// inner 1 step per notch (fine), middle 5, outer 10 – one notch every 18°, clockwise up.
// Hovering lights up the ring under the pointer and names its step size below the thumb.
// Two modes (options page, prefs.knob):
// - drag (default): pulled along the track the thumb drags – in steps of the ring it was
//   grabbed by (1, 5 or 10) –; pulled up or down away from it, it turns.
// - turn: a press on the thumb always turns.
// Both: a click on the track jumps there, a double-click resets, the mouse wheel steps
// (Shift: 10 steps), and a bubble above the thumb shows the value while it changes.

const DIAL = {
  notches: 20, // per turn
  // outer radius of the inner and middle ring as a share of the thumb's radius
  inner: 0.42,
  middle: 0.72,
  dead: 6, // px around the center where the angle is too shaky to count
  // Drag mode: a press turns once the pointer leaves the track's line by `turnAt` px, and
  // drags once it went `dragAt` px along it without that – circling on the thumb's own
  // rings leaves the line long before it got that far sideways.
  turnAt: 6,
  dragAt: 15,
  wheelPauseMs: 400, // a wheel right after scrolling keeps scrolling the panel
  bubbleMs: 900,
};

// Signed difference b − a of two angles in degrees, in (-180, 180].
function angleDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// Ring at distance d from the thumb's center (share of its radius).
function ringAt(d) {
  if (d < DIAL.inner) return "inner";
  if (d < DIAL.middle) return "middle";
  return "outer";
}

// Steps per notch in a ring: fine inside, coarse outside.
const RING_STEPS = { inner: 1, middle: 5, outer: 10 };

// The value on a k times coarser grid (through the default), within the bounds: dragging
// by the middle ring moves in 5 steps, by the outer one in 10.
function snapTo(value, k, spec) {
  const { min, max, step, anchor = 0 } = spec;
  const big = step * k;
  return AVFX.clamp(onGrid(anchor + Math.round((value - anchor) / big) * big, spec), min, max);
}

// k grid steps from the value (on the grid through the default), within the bounds.
function stepBy(value, k, spec) {
  const { min, max, step, anchor = 0 } = spec;
  const pos = Math.round((value - anchor) / step);
  return AVFX.clamp(onGrid(anchor + (pos + k) * step, spec), min, max);
}

// "+3,5 dB", "1,25×", "120 %": signed where the slider goes below zero.
function formatValue(v, c, spec) {
  const digits = Math.max(decimalsOf(spec.step), 0);
  const sign = c.min < 0 && v > 0 ? "+" : "";
  const unit = c.unit ?? "";
  const gap = unit && !["×", "°"].includes(unit) ? " " : "";
  return `${sign}${AVFX.formatNumber(v, digits)}${gap}${unit}`;
}

// ---------- DOM ----------

// The mode, from the prefs; the root gets "knob-mode". The thumb looks the same in both.
let knobMode = false;
const knobSliders = new Set(); // refresh functions of the sliders, called on a switch
function setKnobMode(on) {
  knobMode = on === true;
  document.documentElement.classList.toggle("knob-mode", knobMode);
  for (const f of knobSliders) f();
}
if (globalThis.browser?.storage) {
  browser.storage.local
    .get(AVFX.PREFS_KEY)
    .then((r) => setKnobMode({ ...AVFX.PREFS_DEFAULTS, ...r[AVFX.PREFS_KEY] }.knob))
    .catch(() => {});
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && AVFX.PREFS_KEY in changes) setKnobMode({ ...AVFX.PREFS_DEFAULTS, ...changes[AVFX.PREFS_KEY].newValue }.knob);
  });
}

// Drag mode: drag or turn, from the movement (dx, dy) since a press – along the track is
// a drag, away from it (up or down) a turn. null: not decided yet.
function pressMode(dx, dy) {
  if (Math.abs(dy) > DIAL.turnAt) return "turn";
  if (Math.abs(dx) >= DIAL.dragAt) return "drag";
  return null;
}

// Value at a pointer x on a slider (the thumb's center), on the step grid.
function valueAt(range, x, s) {
  const r = range.getBoundingClientRect();
  const size = thumbSize();
  const frac = AVFX.clamp((x - r.left - size / 2) / Math.max(1, r.width - size), 0, 1);
  return stepBy(s.rangeMin + frac * (s.rangeMax - s.rangeMin), 0, { ...s, min: s.rangeMin, max: s.rangeMax });
}

// px, the thumb's size in popup.css (.fx-range)
const thumbSize = () => 30;

let lastScroll = -Infinity;
document.addEventListener("scroll", () => (lastScroll = performance.now()), { capture: true, passive: true });

// The thumb's center in the viewport.
function thumbCenter(range, v, s) {
  const r = range.getBoundingClientRect();
  const size = thumbSize();
  const frac = AVFX.clamp((v - s.rangeMin) / (s.rangeMax - s.rangeMin || 1), 0, 1);
  return { x: r.left + size / 2 + frac * (r.width - size), y: r.top + r.height / 2 };
}

// opts: { row, range, control, get(), set(v), reset() }. Returns sync(), which the
// panel calls when the value changed elsewhere (fills the track up to the thumb).
function enhanceSlider({ row, range, control: c, get, set, reset }) {
  const spec = () => sliderSpec(c);
  const bubble = el("div", { className: "slider-bubble", hidden: true });
  const tip = el("div", { className: "ring-tip", hidden: true });
  range.classList.add("fx-range");
  row.classList.add("has-bubble");
  row.append(bubble, tip);
  const hint = () => (range.title = t(knobMode ? "sliderHintTurn" : "sliderHintDrag"));
  hint();
  knobSliders.add(hint);

  const sync = () => {
    const s = spec();
    const frac = AVFX.clamp((get() - s.rangeMin) / (s.rangeMax - s.rangeMin || 1), 0, 1);
    range.style.setProperty("--fill", `${(frac * 100).toFixed(2)}%`);
  };

  let hideTimer = 0;
  let held = false;
  function showBubble() {
    sync();
    const s = spec();
    bubble.textContent = formatValue(get(), c, s);
    bubble.hidden = false;
    const rowBox = row.getBoundingClientRect();
    bubble.style.left = `${thumbCenter(range, get(), s).x - rowBox.left}px`;
    bubble.style.top = `${range.offsetTop}px`;
    clearTimeout(hideTimer);
    if (!held) hideTimer = setTimeout(() => (bubble.hidden = true), DIAL.bubbleMs);
  }
  const change = (v) => {
    if (v !== get()) set(v);
    showBubble();
  };

  // The ring under the pointer (or the grabbed one) lights up, its step size below.
  const lightRing = (ring) => {
    if (!ring) {
      delete range.dataset.ring;
      tip.hidden = true;
      return;
    }
    range.dataset.ring = ring;
    tip.textContent = `±${RING_STEPS[ring]}`;
    tip.hidden = false;
    const rowBox = row.getBoundingClientRect();
    tip.style.left = `${thumbCenter(range, get(), spec()).x - rowBox.left}px`;
    tip.style.top = `${range.offsetTop + range.offsetHeight}px`;
  };
  // Distance of a pointer from the thumb's center, as a share of its radius.
  const fromThumb = (e) => {
    const center = thumbCenter(range, get(), spec());
    return { center, d: Math.hypot(e.clientX - center.x, e.clientY - center.y) / (thumbSize() / 2) };
  };

  // A press on the thumb turns it around the point where it was grabbed (the thumb moves
  // along meanwhile, the center stays) – or, in drag mode, drags it if the pointer goes
  // along the track first. A press on the track stays native.
  let turn = null; // { id, x, y, startX, startY, angle, acc, ring, mode }
  const angleOf = (e) => (Math.atan2(e.clientY - turn.y, e.clientX - turn.x) * 180) / Math.PI;
  range.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    held = true;
    const { center, d } = fromThumb(e);
    if (d > 1.1) return showBubble();
    e.preventDefault();
    range.focus({ preventScroll: true, focusVisible: false }); // arrow keys go on from here
    range.setPointerCapture(e.pointerId);
    const mode = knobMode ? "turn" : null;
    turn = { id: e.pointerId, ...center, startX: e.clientX, startY: e.clientY, acc: 0, ring: ringAt(d), mode };
    turn.angle = angleOf(e);
    lightRing(turn.ring);
    showBubble();
  });
  range.addEventListener("mousedown", (e) => turn && e.preventDefault()); // no native drag
  const hover = (e) => {
    const { d } = fromThumb(e);
    lightRing(d <= 1.1 ? ringAt(d) : null);
  };
  range.addEventListener("pointerleave", () => turn || lightRing(null));
  range.addEventListener("pointermove", (e) => {
    if (!turn) return hover(e);
    if (e.pointerId !== turn.id) return;
    turn.mode ??= pressMode(e.clientX - turn.startX, e.clientY - turn.startY);
    if (turn.mode === "drag") {
      const s = spec();
      change(snapTo(valueAt(range, e.clientX - (turn.startX - turn.x), s), RING_STEPS[turn.ring], s));
      return lightRing(turn.ring); // the tip follows the thumb
    }
    const a = angleOf(e);
    if (Math.hypot(e.clientX - turn.x, e.clientY - turn.y) < DIAL.dead) {
      turn.angle = a;
      turn.acc = 0;
      return;
    }
    turn.acc += angleDelta(turn.angle, a);
    turn.angle = a;
    const notchDeg = 360 / DIAL.notches;
    const notches = Math.trunc(turn.acc / notchDeg + Math.sign(turn.acc) * 1e-6);
    if (notches && turn.mode === "turn") {
      turn.acc -= notches * notchDeg;
      change(stepBy(get(), notches * RING_STEPS[turn.ring], spec()));
      lightRing(turn.ring); // the tip follows the thumb
    }
  });
  const release = (e) => {
    if (turn && e?.pointerId === turn.id) {
      turn = null;
      if (range.matches(":hover")) hover(e);
      else lightRing(null);
    }
    if (!held) return;
    held = false;
    showBubble();
  };
  range.addEventListener("pointerup", release);
  range.addEventListener("pointercancel", release);
  range.addEventListener("lostpointercapture", release);
  range.addEventListener("input", showBubble);
  range.addEventListener("dblclick", () => {
    reset();
    showBubble();
  });

  range.addEventListener(
    "wheel",
    (e) => {
      if (performance.now() - lastScroll < DIAL.wheelPauseMs) return; // still scrolling the panel
      const delta = e.deltaY || e.deltaX;
      if (!delta) return;
      e.preventDefault();
      change(stepBy(get(), (delta < 0 ? 1 : -1) * (e.shiftKey ? 10 : 1), spec()));
    },
    { passive: false }
  );
  knobSliders.add(sync);
  return sync;
}
