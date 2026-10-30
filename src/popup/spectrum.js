// Spectrum bars and level meter. createSpectrumView() is shared with the analyzer
// window; renderSpectrum() feeds it from the primary media element of the tab and
// only polls while the audio tab is visible.

const METER_FLOOR_DB = -60;

// draw(data) takes { bands, rms, peak } or null (silence). The overlay can hold
// messages shown on top of the bars.
function createSpectrumView() {
  const canvas = el("canvas", { className: "spectrum" });
  const overlay = el("div", { className: "spectrum-empty", hidden: true });
  const fill = el("div", { className: "meter-fill" });
  const peakMark = el("div", { className: "meter-peak" });
  const value = el("span", { className: "meter-value", textContent: "– dB" });

  const ctx = canvas.getContext("2d");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  const bars = new Float32Array(48);
  let peakHold = -Infinity;
  let peakAt = 0;
  let gradient = null;

  function draw(data) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gradient = ctx.createLinearGradient(0, h, 0, 0);
      gradient.addColorStop(0, accent);
      gradient.addColorStop(1, "#c3b9ff");
    }
    ctx.clearRect(0, 0, w, h);

    // Bars fall off slowly instead of jumping to zero.
    for (let i = 0; i < bars.length; i++) bars[i] = Math.max(data?.bands?.[i] ?? 0, bars[i] * 0.85);
    const bw = w / bars.length;
    ctx.fillStyle = gradient;
    for (let i = 0; i < bars.length; i++) {
      const bh = Math.max(dpr, bars[i] * h);
      ctx.fillRect(i * bw + dpr / 2, h - bh, bw - dpr, bh);
    }

    // Chrome's messaging turns -Infinity into null, hence the extra checks.
    const finite = (x) => (Number.isFinite(x) ? x : -Infinity);
    const pct = (db) => AVFX.clamp(((db - METER_FLOOR_DB) / -METER_FLOOR_DB) * 100, 0, 100);
    const now = performance.now();
    const peak = finite(data?.peak);
    if (peak >= peakHold || now - peakAt > 1200) {
      peakHold = peak;
      peakAt = now;
    }
    fill.style.width = `${pct(finite(data?.rms))}%`;
    peakMark.style.left = `${pct(peakHold)}%`;
    peakMark.classList.toggle("clip", peakHold > -1);
    value.textContent = Number.isFinite(data?.rms) ? `${data.rms.toFixed(1)} dB` : "– dB";
  }

  return {
    nodes: [
      el("div", { className: "spectrum-box" }, canvas, overlay),
      el("div", { className: "meter-row" }, el("div", { className: "meter" }, fill, peakMark), value),
    ],
    canvas,
    overlay,
    draw,
  };
}

function openSystemAnalyzer() {
  browser.windows.create({ url: browser.runtime.getURL("popup/analyzer.html"), type: "popup", width: 560, height: 520 });
}

function renderSpectrum() {
  const view = createSpectrumView();
  const start = el("button", { type: "button", className: "chip" }, icon("spectrum"), t("startAnalyzer"));
  const system = el("button", { type: "button", className: "chip" }, icon("audio"), t("systemAudio"));
  const emptyText = el("span");
  const emptyNote = el("small");
  view.overlay.append(emptyText, el("div", { className: "toggles" }, start, system), emptyNote);

  start.addEventListener("click", async () => {
    await sendToPrimary({ type: "action", action: "attach-audio" });
    primaryCache.at = -Infinity; // the element now has a chain, re-query
  });
  system.addEventListener("click", openSystemAnalyzer);

  function draw(data) {
    const live = Boolean(data?.bands);
    view.overlay.hidden = live;
    if (!live) {
      emptyText.textContent = t(data?.drm ? "drmVideo" : "noAudioEffect");
      emptyNote.textContent = t(data?.drm ? "drmAnalyzeHint" : "webAudioHint");
      start.hidden = Boolean(data?.drm);
    }
    view.draw(live ? data : null);
  }

  async function poll() {
    if (activeSection === "audio" && tabId !== null && !document.hidden) {
      draw(await sendToPrimary({ type: "spectrum" }));
    }
    setTimeout(poll, 50);
  }
  poll();

  return view.nodes;
}
