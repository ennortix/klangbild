(() => {
  // The popup may inject this script again via scripting.executeScript. After an
  // extension update Chrome keeps the old, orphaned instance running in the same
  // world (Firefox kills it): it is told to retire so this one can take over.
  if (window.__avfxAlive?.()) return;
  const TAKEOVER = "klangbild-takeover";
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  const api = browser;
  window.__avfxAlive = () => {
    try {
      return Boolean(api.runtime?.id); // undefined once the extension context is gone
    } catch {
      return false;
    }
  };
  let retired = false;

  const { DEFAULTS, MAX_DELAY_MS, MIN_DELAY_MS, needsAudioGraph, formatTime, sanitize } = AVFX;
  const RAMP = 0.03; // seconds, smooths parameter changes to avoid clicks
  const FRAME_STEP = 1 / 30; // the real frame rate isn't exposed, 30 fps is the common case

  let settings = { ...DEFAULTS };
  let receivedSet = false; // a "set" from the popup wins over the saved settings arriving later
  let audioCtx = null;
  const media = new Set(); // tracked elements; detached paused ones are pruned
  const listened = new WeakSet(); // elements that already carry our event listeners
  const chains = new WeakMap(); // element -> Web Audio nodes
  const audioBlocked = new WeakSet(); // createMediaElementSource failed, e.g. element taken by an older extension instance
  const savedStyle = new WeakMap(); // element -> { [prop]: [value, priority] } inline styles we currently override
  const videoDelays = new WeakMap(); // element -> AVFXVideoDelay
  const videoDelayFailed = new WeakSet(); // e.g. DRM video, frames can't be read
  const loops = new Map(); // element -> { a, b } (seconds, b may be null)
  const encrypted = new WeakSet(); // elements that fired "encrypted" (EME/DRM)
  const rateFights = new WeakMap(); // element -> { count, since }, see onRateChange

  // DRM media (Prime Video, Netflix, …): Firefox outputs silence once such an element is
  // routed through Web Audio and refuses to hand out its frames, so we never touch them.
  function isProtected(el) {
    return Boolean(el.mediaKeys) || encrypted.has(el);
  }

  // Settings actually applied; with bypass everything is neutral except speed.
  function effective() {
    if (settings.enabled) return settings;
    return { ...DEFAULTS, speed: settings.speed, preservePitch: settings.preservePitch };
  }

  // ---------- Audio ----------

  function getAudioContext() {
    if (!audioCtx) audioCtx = new AudioContext({ latencyHint: "interactive" });
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function biquad(ac, type, frequency, q) {
    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    if (q) f.Q.value = q;
    return f;
  }

  function buildChain(el) {
    const ac = getAudioContext();
    let source;
    try {
      source = ac.createMediaElementSource(el);
    } catch (e) {
      // An element can be routed only once; after an extension update the old
      // instance still owns it until the page is reloaded.
      console.warn("[Klangbild] Audio routing not possible:", e);
      audioBlocked.add(el);
      return null;
    }

    const delay = ac.createDelay(MAX_DELAY_MS / 1000);
    const highpass = biquad(ac, "highpass", 10); // voice mode raises it to cut rumble
    const bass = biquad(ac, "lowshelf", 200);
    const mid = biquad(ac, "peaking", 1000, 0.8);
    const treble = biquad(ac, "highshelf", 4000);
    const presence = biquad(ac, "peaking", 3000, 1); // voice mode lifts speech intelligibility

    // Downmixes to mono when channelCount is switched to 1.
    const monoMix = ac.createGain();
    monoMix.channelCountMode = "explicit";
    monoMix.channelInterpretation = "speakers";
    monoMix.channelCount = 2;

    const panner = ac.createStereoPanner();

    const compressor = ac.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.005;
    compressor.release.value = 0.2;

    const gain = ac.createGain();

    const limiter = ac.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.1;

    const analyser = ac.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.7;

    source.connect(delay);
    delay.connect(highpass);
    highpass.connect(bass);
    bass.connect(mid);
    mid.connect(treble);
    treble.connect(presence);
    presence.connect(monoMix);
    monoMix.connect(panner);
    analyser.connect(ac.destination);

    const chain = {
      delay, highpass, bass, mid, treble, presence, monoMix, panner,
      compressor, gain, limiter, analyser,
      compressorOn: null, limiterOn: null,
    };
    setDynamics(chain, false, false);
    return chain;
  }

  // panner -> [compressor] -> gain -> [limiter] -> analyser
  function setDynamics(chain, compressorOn, limiterOn) {
    if (chain.compressorOn === compressorOn && chain.limiterOn === limiterOn) return;
    for (const n of [chain.panner, chain.compressor, chain.gain, chain.limiter]) n.disconnect();

    let node = chain.panner;
    if (compressorOn) {
      node.connect(chain.compressor);
      node = chain.compressor;
    }
    node.connect(chain.gain);
    node = chain.gain;
    if (limiterOn) {
      node.connect(chain.limiter);
      node = chain.limiter;
    }
    node.connect(chain.analyser);

    chain.compressorOn = compressorOn;
    chain.limiterOn = limiterOn;
  }

  function applyAudio(el, s, force = false) {
    let chain = chains.get(el);
    if (!chain) {
      // Routing through Web Audio is permanent for an element, so only do it when needed.
      if (!force && !needsAudioGraph(s)) return;
      // Wait for metadata: by then a DRM player has announced itself and is left alone.
      // The loadedmetadata listener calls us again.
      if (isProtected(el) || audioBlocked.has(el) || el.readyState < HTMLMediaElement.HAVE_METADATA) return;
      chain = buildChain(el);
      if (!chain) return;
      chains.set(el, chain);
    }

    const t = audioCtx.currentTime;
    chain.gain.gain.setTargetAtTime(s.volume / 100, t, RAMP);
    chain.delay.delayTime.setTargetAtTime(Math.max(0, s.audioDelay) / 1000, t, RAMP);
    chain.highpass.frequency.setTargetAtTime(s.voice ? 120 : 10, t, RAMP);
    chain.bass.gain.setTargetAtTime(s.bass, t, RAMP);
    chain.mid.gain.setTargetAtTime(s.mid, t, RAMP);
    chain.treble.gain.setTargetAtTime(s.treble, t, RAMP);
    chain.presence.gain.setTargetAtTime(s.voice ? 5 : 0, t, RAMP);
    chain.panner.pan.setTargetAtTime(s.pan / 100, t, RAMP);
    chain.monoMix.channelCount = s.mono ? 1 : 2;
    setDynamics(chain, s.compressor, s.limiter);
  }

  // 48 log-spaced bands (30 Hz – 16 kHz, 0..1) plus RMS/peak level in dBFS.
  function spectrum() {
    const p = primaryMedia();
    if (p && isProtected(p.el) && !chains.has(p.el)) return { drm: true };
    // The primary element may be a muted video while a separate element carries the
    // sound, so audible elements win, then playing ones, then the primary one.
    const audible = (el) => !el.muted && el.volume > 0;
    const ranked = [...media]
      .filter((el) => chains.has(el))
      .sort((x, y) => audible(y) - audible(x) || x.paused - y.paused || (y === p?.el) - (x === p?.el));
    const chain = chains.get(ranked[0]);
    if (!chain) return null;
    return { ...AVFX.analyse(chain.analyser), paused: p?.el.paused ?? true };
  }

  // ---------- Playback ----------

  function applyPlayback(el, s) {
    el.preservesPitch = s.preservePitch;
    if (Math.abs(el.playbackRate - s.speed) > 0.001) {
      try {
        el.playbackRate = s.speed;
      } catch (e) {
        console.warn("[Klangbild] Cannot set speed:", e);
      }
    }
  }

  // Many players reset playbackRate on their own (e.g. when switching quality).
  // Some reset it on every change, so corrections are capped instead of ping-ponging forever.
  function onRateChange(e) {
    const el = e.target;
    if (retired || settings.speed === 1 || Math.abs(el.playbackRate - settings.speed) <= 0.001) return;

    const now = performance.now();
    const fight = rateFights.get(el);
    if (!fight || now - fight.since > 2000) rateFights.set(el, { count: 1, since: now });
    else if (++fight.count > 10) return;
    applyPlayback(el, effective());
  }

  // ---------- Video ----------

  let sharpenSvg = null;

  // CSS has no sharpen filter, so an SVG convolution filter is injected and referenced.
  function sharpenFilter(amount) {
    if (!sharpenSvg) {
      const NS = "http://www.w3.org/2000/svg";
      sharpenSvg = document.createElementNS(NS, "svg");
      sharpenSvg.setAttribute("aria-hidden", "true");
      sharpenSvg.style.cssText = "position:absolute !important; width:0 !important; height:0 !important;";
      const filter = document.createElementNS(NS, "filter");
      filter.id = "avfx-sharpen-filter";
      const conv = document.createElementNS(NS, "feConvolveMatrix");
      conv.setAttribute("order", "3");
      conv.setAttribute("preserveAlpha", "true");
      filter.append(conv);
      sharpenSvg.append(filter);
    }
    if (!sharpenSvg.isConnected) document.documentElement.append(sharpenSvg);

    const a = amount / 100;
    sharpenSvg.querySelector("feConvolveMatrix").setAttribute("kernelMatrix", `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0`);
    return "url(#avfx-sharpen-filter)";
  }

  // Overrides an inline style and remembers the page's own value; null restores it.
  // Styles we never touched are left alone, so the page can keep changing them.
  function overrideStyle(el, prop, value) {
    let saved = savedStyle.get(el);
    if (!saved) savedStyle.set(el, (saved = {}));

    if (value) {
      if (!(prop in saved)) saved[prop] = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
      el.style.setProperty(prop, value, "important");
    } else if (prop in saved) {
      el.style.setProperty(prop, ...saved[prop]);
      delete saved[prop];
    }
  }

  function applyVideo(el, s) {
    if (!(el instanceof HTMLVideoElement)) return;

    const filters = [];
    if (s.sharpen !== 0) filters.push(sharpenFilter(s.sharpen));
    if (s.brightness !== 100) filters.push(`brightness(${s.brightness}%)`);
    if (s.contrast !== 100) filters.push(`contrast(${s.contrast}%)`);
    if (s.saturate !== 100) filters.push(`saturate(${s.saturate}%)`);
    if (s.hue !== 0) filters.push(`hue-rotate(${s.hue}deg)`);
    if (s.blur !== 0) filters.push(`blur(${s.blur}px)`);
    if (s.grayscale !== 0) filters.push(`grayscale(${s.grayscale}%)`);
    if (s.sepia !== 0) filters.push(`sepia(${s.sepia}%)`);
    if (s.invert !== 0) filters.push(`invert(${s.invert}%)`);

    overrideStyle(el, "filter", filters.join(" ") || null);

    const transforms = [];
    let scale = s.zoom / 100;
    if (s.rotate % 180 === 90 && el.clientWidth && el.clientHeight) {
      // Keep a rotated landscape video inside its box.
      const w = el.clientWidth;
      const h = el.clientHeight;
      scale *= Math.min(w / h, h / w);
    }
    if (s.rotate) transforms.push(`rotate(${s.rotate}deg)`);
    if (scale !== 1 || s.flipH || s.flipV) {
      transforms.push(`scale(${(s.flipH ? -1 : 1) * scale}, ${(s.flipV ? -1 : 1) * scale})`);
    }

    // Our transforms are appended to the page's own (e.g. a player's centering translate).
    const base = savedStyle.get(el)?.transform?.[0] ?? el.style.getPropertyValue("transform");
    overrideStyle(el, "transform", transforms.length ? `${base} ${transforms.join(" ")}`.trim() : null);
  }

  // Negative audio delay = sound is late, so the picture gets delayed instead.
  function applyVideoDelay(el, s) {
    if (!(el instanceof HTMLVideoElement)) return;
    const ms = s.audioDelay < 0 && !isProtected(el) ? Math.min(-s.audioDelay, -MIN_DELAY_MS) : 0;
    let vd = videoDelays.get(el);

    if (!ms) {
      vd?.destroy();
      videoDelays.delete(el);
      return;
    }
    if (!vd) {
      if (videoDelayFailed.has(el)) return;
      vd = AVFXVideoDelay.create(el, () => {
        videoDelays.delete(el);
        videoDelayFailed.add(el);
      });
      if (!vd) return;
      videoDelays.set(el, vd);
    }
    vd.delayMs = ms;
  }

  // ---------- Tools ----------

  let loopRaf = 0;

  function checkLoop(el) {
    const loop = loops.get(el);
    if (loop && loop.b !== null && !el.paused && el.currentTime >= loop.b) el.currentTime = loop.a;
  }

  // rAF gives frame-accurate jumps; the timeupdate listener covers background
  // tabs, where rAF doesn't run.
  function loopTick() {
    loopRaf = 0;
    for (const el of loops.keys()) checkLoop(el);
    if ([...loops.values()].some((l) => l.b !== null)) loopRaf = requestAnimationFrame(loopTick);
  }

  function setLoop(el, loop) {
    if (loop) loops.set(el, loop);
    else loops.delete(el);
    if (!loopRaf) loopRaf = requestAnimationFrame(loopTick);
  }

  // A → B → off
  function cycleLoop(el) {
    const loop = loops.get(el);
    if (!loop) {
      setLoop(el, { a: el.currentTime, b: null });
      return AVFX.t("loopA", formatTime(el.currentTime));
    }
    if (loop.b === null && el.currentTime > loop.a + 0.1) {
      setLoop(el, { a: loop.a, b: el.currentTime });
      return AVFX.t("loopAB", formatTime(loop.a), formatTime(el.currentTime));
    }
    setLoop(el, null);
    return AVFX.t("loopOff");
  }

  async function screenshot(el) {
    if (isProtected(el)) return { ok: false, text: AVFX.t("drmNoScreenshot") };
    if (!(el instanceof HTMLVideoElement) || !el.videoWidth) {
      return { ok: false, text: AVFX.t("noFrame") };
    }
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    const ctx = canvas.getContext("2d");
    const filter = getComputedStyle(el).filter;
    if (filter && filter !== "none") ctx.filter = filter;
    ctx.drawImage(el, 0, 0);

    let dataUrl;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      return { ok: false, text: AVFX.t("screenshotNotAllowed") };
    }
    const time = formatTime(el.currentTime).replace(/[:.]/g, "-");
    await browser.runtime.sendMessage({ type: "download", dataUrl, filename: `${location.hostname || "video"}_${time}.png` });
    return { ok: true, text: AVFX.t("screenshotSaved") };
  }

  function toolState(el) {
    const loop = loops.get(el);
    return {
      kind: el.localName,
      time: el.currentTime,
      duration: el.duration,
      paused: el.paused,
      loopA: loop?.a ?? null,
      loopB: loop?.b ?? null,
      hasAudioChain: chains.has(el),
      drm: isProtected(el),
      audioBlocked: audioBlocked.has(el),
    };
  }

  async function runAction(msg) {
    const el = primaryMedia()?.el;
    if (!el) return { ok: false, text: AVFX.t("noMedia") };

    let text = null;
    switch (msg.action) {
      case "play":
        if (el.paused) await el.play().catch(() => {});
        else el.pause();
        break;
      case "frame":
        el.pause();
        el.currentTime = AVFX.clamp(el.currentTime + msg.dir * FRAME_STEP, 0, el.duration || Infinity);
        text = AVFX.t("frameAt", formatTime(el.currentTime));
        break;
      case "loop-a": {
        const b = loops.get(el)?.b;
        setLoop(el, { a: el.currentTime, b: b > el.currentTime ? b : null });
        break;
      }
      case "loop-b": {
        const a = loops.get(el)?.a ?? 0;
        if (el.currentTime > a + 0.1) setLoop(el, { a, b: el.currentTime });
        break;
      }
      case "loop-clear":
        setLoop(el, null);
        break;
      case "loop-cycle":
        text = cycleLoop(el);
        break;
      case "screenshot":
        return { ...(await screenshot(el)), state: toolState(el) };
      case "attach-audio":
        if (isProtected(el)) return { ok: false, text: AVFX.t("drmProtected"), state: toolState(el) };
        applyAudio(el, effective(), true);
        if (!chains.has(el)) {
          const text = AVFX.t(audioBlocked.has(el) ? "audioBlockedReload" : "noMediaData");
          return { ok: false, text, state: toolState(el) };
        }
        break;
    }
    return { ok: true, text, state: toolState(el) };
  }

  // ---------- On-screen display ----------

  let osd = null;

  function showOsd(text) {
    if (!osd) {
      const host = document.createElement("div");
      host.style.cssText =
        "position:fixed !important; z-index:2147483647 !important; pointer-events:none !important; margin:0 !important;";
      // Inline styles inside a closed shadow root: unaffected by page CSS and CSP.
      const label = document.createElement("div");
      Object.assign(label.style, {
        font: "600 15px/1.2 system-ui, sans-serif",
        color: "#fff",
        background: "rgba(22, 23, 29, 0.85)",
        border: "1px solid rgba(124, 108, 255, 0.9)",
        borderRadius: "8px",
        padding: "8px 12px",
        whiteSpace: "nowrap",
        opacity: "0",
        transition: "opacity 0.2s",
      });
      host.attachShadow({ mode: "closed" }).append(label);
      osd = { host, label, timer: 0 };
    }

    // Inside a fullscreen player the OSD must live in the fullscreen element.
    const fs = document.fullscreenElement;
    const parent = fs && !(fs instanceof HTMLMediaElement) ? fs : document.documentElement;
    if (osd.host.parentNode !== parent) parent.append(osd.host);

    const r = primaryMedia()?.el.getBoundingClientRect();
    osd.host.style.setProperty("left", `${Math.max(r?.left ?? 0, 0) + 16}px`, "important");
    osd.host.style.setProperty("top", `${Math.max(r?.top ?? 0, 0) + 16}px`, "important");
    osd.label.textContent = text;
    osd.label.style.opacity = "1";
    clearTimeout(osd.timer);
    osd.timer = setTimeout(() => (osd.label.style.opacity = "0"), 1300);
  }

  // ---------- Media tracking ----------

  function applyTo(el) {
    if (retired) return;
    const s = effective();
    applyPlayback(el, s);
    applyAudio(el, s);
    applyVideo(el, s);
    applyVideoDelay(el, s);
  }

  function applyAll() {
    prune();
    for (const el of media) applyTo(el);
  }

  // Removed and paused elements are forgotten (SPAs create many over time).
  // They come back through the observer or their own "play" listener.
  function prune() {
    for (const el of media) {
      if (!el.isConnected && el.paused) {
        media.delete(el);
        loops.delete(el);
      }
    }
  }

  function mediaScore(el) {
    if (!el.isConnected && el.paused) return -1;
    let score = 0;
    if (!el.paused) score += 1e8;
    if (el.readyState >= 2) score += 1e7;
    if (el instanceof HTMLVideoElement) {
      const r = el.getBoundingClientRect();
      score += Math.min(r.width * r.height, 9e6);
    }
    return score;
  }

  // The element shortcuts, tools and the spectrum refer to: playing beats paused, big beats small.
  function primaryMedia() {
    prune();
    let best = null;
    let bestScore = -1;
    for (const el of media) {
      const score = mediaScore(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best && { el: best, score: bestScore };
  }

  // Queried by AVFX.findPrimaryFrame() through scripting.executeScript.
  function primaryInfo() {
    const p = primaryMedia();
    if (!p) return null;
    return {
      score: p.score,
      kind: p.el.localName,
      hasAudioChain: chains.has(p.el),
      drm: isProtected(p.el),
      audioBlocked: audioBlocked.has(p.el),
    };
  }
  globalThis.__avfxPrimary = primaryInfo;

  function resumeAudio() {
    if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  }

  function register(el) {
    if (retired || media.has(el)) return;
    media.add(el);
    if (!listened.has(el)) {
      listened.add(el);
      el.addEventListener("ratechange", onRateChange);
      el.addEventListener("loadedmetadata", () => applyTo(el));
      el.addEventListener("encrypted", () => {
        encrypted.add(el);
        applyVideoDelay(el, effective()); // drops a running delay overlay
      });
      el.addEventListener("play", () => {
        register(el); // may have been pruned while detached
        resumeAudio();
      });
      el.addEventListener("timeupdate", () => checkLoop(el));
      // B at the very end: playback ends before B is reached.
      el.addEventListener("ended", () => {
        const loop = loops.get(el);
        if (loop?.b != null) {
          el.currentTime = loop.a;
          el.play().catch(() => {});
        }
      });
      // New source (e.g. next episode in the same element): the old loop is meaningless.
      el.addEventListener("emptied", () => loops.delete(el));
    }
    applyTo(el);
  }

  const observedRoots = new WeakSet();
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      }
    }
  });

  function observe(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  // Content scripts may open even closed shadow roots: Firefox via a property, Chrome via chrome.dom.
  function shadowRootOf(el) {
    return "openOrClosedShadowRoot" in el ? el.openOrClosedShadowRoot : globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el);
  }

  // Also descends into shadow roots, where neither querySelectorAll nor the "play" listener reach.
  function scan(root) {
    if (root instanceof HTMLMediaElement) register(root);
    if (!root.querySelectorAll) return;
    root.querySelectorAll("video, audio").forEach(register);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType !== Node.ELEMENT_NODE) continue; // the document/shadow root itself
      const shadow = shadowRootOf(n);
      if (shadow && !observedRoots.has(shadow)) {
        observe(shadow);
        scan(shadow);
      }
    }
  }

  let rescanTimer = 0;

  function startObserving() {
    scan(document);
    observe(document.documentElement);
    // Shadow roots attached after their host was inserted aren't reported by the observer.
    rescanTimer = setInterval(() => {
      if (!document.hidden) scan(document);
    }, 3000);
  }

  // Runs in the old instance when a new one takes over. Web Audio routing can't be
  // undone, so it is made transparent; styles and overlays are removed.
  function retire() {
    retired = true;
    clearInterval(rescanTimer);
    observer.disconnect();
    loops.clear();
    for (const el of media) {
      if (chains.has(el)) applyAudio(el, DEFAULTS);
      applyVideo(el, DEFAULTS);
      applyVideoDelay(el, DEFAULTS);
    }
    media.clear();
  }
  document.addEventListener(TAKEOVER, retire, { once: true });

  // Autoplay policy: a context created without user activation starts suspended.
  for (const type of ["pointerdown", "keydown"]) window.addEventListener(type, resumeAudio, true);

  // Catches media that start playing without being found by the observer.
  document.addEventListener(
    "play",
    (e) => {
      if (e.target instanceof HTMLMediaElement) register(e.target);
    },
    true
  );

  // Resizing changes the fit scale of rotated videos.
  window.addEventListener("resize", () => {
    if (settings.rotate % 180 === 90) applyAll();
  });

  // ---------- Messaging ----------

  AVFX.onMessage((msg) => {
    if (retired) return undefined;
    switch (msg?.type) {
      case "get":
        return { settings, mediaCount: media.size };
      case "set":
        receivedSet = true;
        settings = sanitize(msg.settings);
        applyAll();
        return { ok: true };
      case "osd":
        showOsd(msg.text);
        return true;
      case "action":
        return runAction(msg);
      case "spectrum":
        return spectrum();
      case "probe": {
        // Fallback for AVFX.findPrimaryFrame(): only frames with media answer.
        // Chrome has no getFrameId; the caller then broadcasts to all frames.
        const info = primaryInfo();
        return info ? { frameId: browser.runtime.getFrameId?.(window), ...info } : undefined;
      }
    }
    return undefined;
  });

  browser.runtime
    .sendMessage({ type: "init" })
    .then((saved) => {
      if (saved && !receivedSet) {
        settings = sanitize(saved);
        applyAll();
      }
    })
    .catch(() => {});

  if (document.documentElement) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving, { once: true });
})();
