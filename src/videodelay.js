// Delays the picture of a <video> (used for negative audio delay, i.e. sound
// arriving late): the element is made invisible and a canvas on top of it shows
// buffered frames `delayMs` later. The element keeps playing, so its sound stays
// on time while the picture lags behind.
globalThis.AVFXVideoDelay = class VideoDelay {
  static create(video, onFail) {
    if (!video.parentNode) return null;
    return new VideoDelay(video, onFail);
  }

  constructor(video, onFail) {
    this.video = video;
    this.onFail = onFail;
    this.delayMs = 0;
    this.frames = []; // { at: performance.now() timestamp, bmp: ImageBitmap }
    this.lastTime = -1;
    this.capturing = false;
    this.destroyed = false;
    this.vstyle = getComputedStyle(video); // live object

    this.canvas = document.createElement("canvas");
    this.canvas.setAttribute("aria-hidden", "true");
    // Clicks go through to the player underneath.
    this.canvas.style.cssText = "position:absolute !important; pointer-events:none !important; margin:0 !important;";
    this.ctx2d = this.canvas.getContext("2d");

    this.origOpacity = [video.style.getPropertyValue("opacity"), video.style.getPropertyPriority("opacity")];
    this.hideVideo(true);

    this.tick = this.tick.bind(this);
    this.raf = requestAnimationFrame(this.tick);
  }

  // Re-checked every frame: players that rewrite the whole style attribute would
  // otherwise make the undelayed video visible again.
  hideVideo(hide) {
    const style = this.video.style;
    if (hide) {
      if (style.getPropertyValue("opacity") !== "0" || style.getPropertyPriority("opacity") !== "important") {
        style.setProperty("opacity", "0", "important");
      }
    } else if (this.hidden) {
      style.setProperty("opacity", ...this.origOpacity);
    }
    this.hidden = hide;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
    this.hideVideo(false);
    for (const f of this.frames) f.bmp.close();
    this.frames = [];
  }

  fail(err) {
    console.warn("[Klangbild] Picture delay not possible:", err);
    this.destroy();
    this.onFail?.();
  }

  // Keeps the canvas exactly over the video; returns false if nothing to draw on.
  layout() {
    const v = this.video;
    const c = this.canvas;

    if (!v.isConnected) {
      c.remove();
      return false;
    }
    if (c.previousSibling !== v) v.after(c);

    // When the <video> itself is fullscreen the canvas can't be seen; show the original.
    const fullscreen = document.fullscreenElement === v;
    this.hideVideo(!fullscreen);
    c.style.display = fullscreen ? "none" : "block";
    if (fullscreen) return false;

    const s = c.style;
    // A fixed video has no offsetParent; its offsets are relative to the viewport.
    s.setProperty("position", this.vstyle.position === "fixed" ? "fixed" : "absolute", "important");
    s.left = `${v.offsetLeft}px`;
    s.top = `${v.offsetTop}px`;
    s.width = `${v.offsetWidth}px`;
    s.height = `${v.offsetHeight}px`;
    s.zIndex = this.vstyle.zIndex;
    s.filter = this.vstyle.filter;
    s.transform = this.vstyle.transform;
    s.transformOrigin = this.vstyle.transformOrigin;

    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(v.offsetWidth * dpr));
    const h = Math.max(1, Math.round(v.offsetHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    return true;
  }

  // Where the frame lands inside the canvas, honouring object-fit.
  fitRect() {
    const { width: cw, height: ch } = this.canvas;
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
    const fit = this.vstyle.objectFit;
    if (!vw || !vh || fit === "fill") return { x: 0, y: 0, w: cw, h: ch };

    let r = fit === "cover" ? Math.max(cw / vw, ch / vh) : Math.min(cw / vw, ch / vh);
    if (fit === "none" || (fit === "scale-down" && r > 1)) r = 1;
    const w = vw * r;
    const h = vh * r;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h };
  }

  capture(rect) {
    const v = this.video;
    if (this.capturing || v.readyState < 2 || v.currentTime === this.lastTime) return;
    this.lastTime = v.currentTime;
    this.capturing = true;

    const at = performance.now();
    // Capture at display size, not source size, to keep the buffer small.
    const opts = {
      resizeWidth: Math.max(1, Math.round(Math.min(rect.w, v.videoWidth))),
      resizeHeight: Math.max(1, Math.round(Math.min(rect.h, v.videoHeight))),
      resizeQuality: "medium",
    };
    createImageBitmap(v, opts)
      .then((bmp) => {
        if (this.destroyed) bmp.close();
        else this.frames.push({ at, bmp });
      })
      .catch((e) => this.fail(e))
      .finally(() => (this.capturing = false));
  }

  tick() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);
    if (!this.layout()) return;

    const rect = this.fitRect();
    this.capture(rect);

    // Show the newest frame that is at least delayMs old, drop everything older.
    const cutoff = performance.now() - this.delayMs;
    let show = null;
    while (this.frames.length && this.frames[0].at <= cutoff) {
      show?.bmp.close();
      show = this.frames.shift();
    }
    if (show) {
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.drawImage(show.bmp, rect.x, rect.y, rect.w, rect.h);
      show.bmp.close();
    }
  }
};
