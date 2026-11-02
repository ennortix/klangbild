// Ambilight: a soft glow around the picture of a <video> in the colors of its edges.
// A tiny canvas gets the current frame, the browser stretches and blurs it over a box
// around the picture, and a hole (clip-path) keeps the picture itself untouched. It
// lies on top of the page, but clicks go through and it blends with "screen": it lights
// up dark surroundings (dark themes, black bars in fullscreen) and vanishes on white.
globalThis.AVFXAmbilight = class Ambilight {
  static FRAME_MS = 33; // ~30 updates per second are plenty for a blurred glow

  constructor(video) {
    this.video = video;
    this.strength = 0; // 0..1
    this.destroyed = false;
    this.lastDraw = 0;
    this.lastTime = -1;
    this.vstyle = getComputedStyle(video); // live object

    // Inline styles in a closed shadow root: page CSS (e.g. "canvas { display: none }")
    // can't reach it. Blending, filter, clip and mask sit on the host, which is what
    // blends with the page.
    this.host = document.createElement("div");
    this.host.setAttribute("aria-hidden", "true");
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText = "display:block; width:100%; height:100%;";
    this.host.attachShadow({ mode: "closed" }).append(this.canvas);
    this.ctx2d = this.canvas.getContext("2d", { alpha: false });

    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.host.remove();
  }

  hide() {
    if (this.host.isConnected) this.host.remove();
  }

  // Where the frame lands inside the element's box (object-fit), in viewport pixels.
  pictureRect(r) {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const fit = this.vstyle.objectFit;
    if (!vw || !vh || fit === "fill" || fit === "cover") return r;
    let s = Math.min(r.width / vw, r.height / vh);
    if (fit === "none" || (fit === "scale-down" && s > 1)) s = 1;
    const w = vw * s;
    const h = vh * s;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  tick(now) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (now - this.lastDraw < Ambilight.FRAME_MS) return;
    this.lastDraw = now;
    this.layout();
  }

  layout() {
    const v = this.video;
    const fs = document.fullscreenElement;
    // A fullscreen <video> itself can't have anything on top of it.
    if (!v.isConnected || !this.strength || fs === v || v.readyState < 2) return this.hide();
    const r = v.getBoundingClientRect();
    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    if (r.width < 40 || r.height < 40 || r.right < 0 || r.bottom < 0 || r.left > vpW || r.top > vpH) return this.hide();

    const parent = fs && fs.contains(v) ? fs : document.documentElement;
    if (this.host.parentNode !== parent) parent.append(this.host);

    // The box: the picture plus a margin, at least the whole element (its black bars),
    // cut to the viewport.
    const p = this.pictureRect(r);
    const m = Math.round(Math.min(Math.max(Math.min(p.width, p.height) * 0.25, 32), 260));
    const left = Math.max(Math.min(p.left - m, r.left), 0);
    const top = Math.max(Math.min(p.top - m, r.top), 0);
    const right = Math.min(Math.max(p.left + p.width + m, r.right), vpW);
    const bottom = Math.min(Math.max(p.top + p.height + m, r.bottom), vpH);
    const w = right - left;
    const h = bottom - top;
    if (w < 1 || h < 1) return this.hide();

    // Hole where the picture is; evenodd cuts it out of the outer rectangle.
    const hx = p.left - left;
    const hy = p.top - top;
    const px = (n) => Math.round(n * 10) / 10;
    const clip = `path(evenodd, "M0 0H${px(w)}V${px(h)}H0Z M${px(hx)} ${px(hy)}h${px(p.width)}v${px(p.height)}h${px(-p.width)}Z")`;
    const fade = Math.round(m * 0.8);
    const mask =
      `linear-gradient(to right, transparent, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent), ` +
      `linear-gradient(to bottom, transparent, #000 ${fade}px, #000 calc(100% - ${fade}px), transparent)`;
    const css = {
      position: "fixed",
      left: `${px(left)}px`,
      top: `${px(top)}px`,
      width: `${px(w)}px`,
      height: `${px(h)}px`,
      margin: "0",
      padding: "0",
      border: "0",
      "z-index": "2147483646",
      "pointer-events": "none",
      "mix-blend-mode": "screen",
      filter: `blur(${Math.round(m * 0.35)}px) saturate(1.4)`,
      "clip-path": clip,
      "mask-image": mask,
      "-webkit-mask-image": mask,
      "mask-composite": "intersect",
      "-webkit-mask-composite": "source-in",
      opacity: String(this.strength),
      display: "block",
    };
    const style = this.host.style;
    for (const [k, value] of Object.entries(css)) {
      if (style.getPropertyValue(k) !== value) style.setProperty(k, value, "important");
    }
    this.draw(w, h);
  }

  // The whole frame stretched over the box: just outside the picture lies the color of
  // its outer strip. Small on purpose, the browser scales it up smoothly.
  draw(w, h) {
    const v = this.video;
    const cw = 64;
    const ch = Math.max(8, Math.min(64, Math.round((cw * h) / w)));
    const c = this.canvas;
    const resized = c.width !== cw || c.height !== ch;
    if (resized) {
      c.width = cw;
      c.height = ch;
    }
    if (!resized && v.currentTime === this.lastTime) return; // paused: the last frame stays
    this.lastTime = v.currentTime;
    try {
      this.ctx2d.drawImage(v, 0, 0, cw, ch);
    } catch {
      this.hide(); // e.g. a frame that can't be drawn yet
    }
  }
};
