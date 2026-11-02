(() => {
  // The popup may inject this script again via scripting.executeScript. After an
  // extension update Chrome keeps the old, orphaned instance running in a world of its
  // own (Firefox kills it): it is told to retire so this one can take over. Both share
  // only the DOM, so that is where they talk, see "Handing the audio over".
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
  let disabledHere = false; // the user switched Klangbild off for this site

  const { DEFAULTS, MAX_DELAY_MS, MIN_DELAY_MS, needsAudioGraph, formatTime, sanitize } = AVFX;
  const RAMP = 0.03; // seconds, smooths parameter changes to avoid clicks
  const FRAME_STEP = 1 / 30; // until the frame rate is measured, see measureFrameRate()

  let settings = { ...DEFAULTS };
  let receivedSet = false; // a "set" from the popup wins over the saved settings arriving later
  let audioCtx = null;
  const media = new Set(); // tracked elements; detached paused ones are pruned
  const listened = new WeakSet(); // elements that already carry our event listeners
  const chains = new WeakMap(); // element -> Web Audio nodes
  const audioBlocked = new WeakSet(); // createMediaElementSource failed, e.g. element taken by an older extension instance
  // Marks routed elements in the page, so a later instance that can't reach the routing
  // (Firefox after an update) knows at once, before the user moves a slider in vain.
  const ROUTED_ATTR = "data-klangbild-audio";
  const routedElsewhere = new WeakSet(); // carries ROUTED_ATTR, but not routed by this world
  const savedStyle = new WeakMap(); // element -> { [prop]: [value, priority] } inline styles we currently override
  const videoDelays = new WeakMap(); // element -> AVFXVideoDelay
  const videoDelayFailed = new WeakSet(); // e.g. DRM video, frames can't be read
  const loops = new Map(); // element -> { a, b } (seconds, b may be null)
  const encrypted = new WeakSet(); // elements that fired "encrypted" (EME/DRM)
  const rateFights = new WeakMap(); // element -> { count, since }, see onRateChange
  // Mixer (sidebar): per-element volume and mute on top of the tab's settings.
  // Cross-origin media without CORS would go silent in Web Audio: they are mixed with the
  // element's own volume instead (native: true, at most 100 %, base = volume before).
  const mixes = new WeakMap(); // element -> { gain: %, muted, native?, base? }
  const mediaIds = new WeakMap(); // element -> id for the mixer
  let nextMediaId = 1;

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

  // The element's sound is held by routing we can't control (an older instance).
  function audioLocked(el) {
    return !chains.has(el) && !remote.has(el) && (audioBlocked.has(el) || routedElsewhere.has(el));
  }

  // ---------- Handing the audio over ----------

  // An element can be routed through Web Audio only once, and the routing can't be
  // released. After an update in Chrome the old instance keeps running and keeps the
  // routing of its elements: it stays their audio engine, and the new instance sends it
  // the settings with an event on the element. A cancelled event means "alive and holding
  // it"; answers come back as AUDIO_REPLY on the element. Firefox kills the old instance,
  // nobody answers there and the element stays blocked until the page is reloaded.
  // The page sees these events too and could send its own, but only for its own media,
  // and what arrives is sanitized like stored settings.
  const AUDIO_EVENT = "klangbild-audio";
  const AUDIO_REPLY = "klangbild-audio-reply";
  const served = new Set(); // after retiring: elements still routed for the new instance
  const remote = new WeakSet(); // routed by an older instance that still runs

  // Old instance: listens on each element it routed, see buildChain().
  function serveAudio(e) {
    const el = e.currentTarget;
    if (!retired || disabledHere || !chains.has(el)) return;
    e.preventDefault();
    served.add(el);
    if (typeof e.detail !== "string") return; // a ping
    let request;
    try {
      request = JSON.parse(e.detail);
    } catch {
      return;
    }
    if (request?.settings) {
      const gain = Number(request.gain);
      applyAudio(el, sanitize(request.settings), false, Number.isFinite(gain) ? AVFX.clamp(gain, 0, 2) : 1);
    }
    if (request?.analyse) {
      const reply = JSON.stringify(AVFX.analyse(chains.get(el).analyser));
      el.dispatchEvent(new CustomEvent(AUDIO_REPLY, { detail: reply }));
    }
  }

  // New instance: null when no older instance holds the element, else its answer ({} if none).
  function askOwner(el, request = null) {
    let reply = null;
    const onReply = (e) => {
      if (typeof e.detail === "string") reply = e.detail;
    };
    el.addEventListener(AUDIO_REPLY, onReply);
    const ev = new CustomEvent(AUDIO_EVENT, { cancelable: true, detail: request && JSON.stringify(request) });
    el.dispatchEvent(ev);
    el.removeEventListener(AUDIO_REPLY, onReply);
    if (!ev.defaultPrevented) return null;
    try {
      return (reply && JSON.parse(reply)) || {};
    } catch {
      return {};
    }
  }

  // Web Audio carries the element's sound: our own chain or an older instance's.
  const routed = (el) => chains.has(el) || remote.has(el);

  function analyseOf(el) {
    if (chains.has(el)) return AVFX.analyse(chains.get(el).analyser);
    const data = remote.has(el) ? askOwner(el, { analyse: true }) : null;
    return Array.isArray(data?.bands) ? data : null;
  }

  // Sends the settings to the element's older owner; false if it is gone.
  function applyRemote(el, s) {
    if (askOwner(el, { settings: s, gain: mixFactor(el) })) return true;
    remote.delete(el);
    routedElsewhere.add(el);
    return false;
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
    routedElsewhere.delete(el); // e.g. a copy of a routed element made by the page
    try {
      el.setAttribute(ROUTED_ATTR, "");
    } catch {}
    el.addEventListener(AUDIO_EVENT, serveAudio);

    const delay = ac.createDelay(AVFX.LIMITS.audioDelay[1] / 1000);
    const highpass = biquad(ac, "highpass", 10); // voice mode raises it to cut rumble
    const bass = biquad(ac, "lowshelf", 200);
    const mid = biquad(ac, "peaking", 1000, 0.8);
    const treble = biquad(ac, "highshelf", 4000);
    const presence = biquad(ac, "peaking", 3000, 1); // voice mode lifts speech intelligibility

    // Always two channels: mono and surround sources are mixed to stereo here. It must
    // stay at 2, the splitter below would leave the right channel silent for mono input.
    const stereoMix = ac.createGain();
    stereoMix.channelCountMode = "explicit";
    stereoMix.channelInterpretation = "speakers";
    stereoMix.channelCount = 2;

    // Stereo width, channel swap and mono: a 2×2 matrix of gains, [from][to].
    const splitter = ac.createChannelSplitter(2);
    const merger = ac.createChannelMerger(2);
    const matrix = [0, 1].map((from) =>
      [0, 1].map((to) => {
        const g = ac.createGain();
        g.gain.value = from === to ? 1 : 0;
        splitter.connect(g, from);
        g.connect(merger, 0, to);
        return g;
      })
    );

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
    // Loudness leveling: the meter listens before the leveling gain, see autoGainTick().
    const autoGain = ac.createGain();
    const autoGainMeter = ac.createAnalyser();
    autoGainMeter.fftSize = 4096;

    presence.connect(stereoMix);
    stereoMix.connect(splitter);
    merger.connect(autoGain);
    merger.connect(autoGainMeter);
    autoGain.connect(panner);
    analyser.connect(ac.destination);

    const chain = {
      delay, highpass, bass, mid, treble, presence, stereoMix, matrix, autoGain, autoGainMeter, panner,
      compressor, gain, limiter, analyser,
      autoGainOn: false, autoGainState: { power: null, gain: 0 },
      reverb: null, // { convolver, wet }, created on first use
      dialog: null, // { node, set(amount) }, created on first use, see setDialog()
      dialogOn: false, dialogAmount: 0, dialogLoading: false,
      compressorOn: null, limiterOn: null, reverbOn: null,
    };
    setRouting(chain, false, false, false);
    return chain;
  }

  let reverbBuffer = null;

  // A generated room: 2.2 s of decaying noise, decorrelated between the channels.
  function reverbImpulse(ac) {
    if (reverbBuffer) return reverbBuffer;
    const length = Math.round(ac.sampleRate * 2.2);
    reverbBuffer = ac.createBuffer(2, length, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = reverbBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }
    return reverbBuffer;
  }

  function reverbNodes(chain) {
    if (!chain.reverb) {
      const ac = getAudioContext();
      const convolver = ac.createConvolver();
      convolver.buffer = reverbImpulse(ac);
      const wet = ac.createGain();
      wet.gain.value = 0;
      convolver.connect(wet);
      wet.connect(chain.gain);
      chain.reverb = { convolver, wet };
    }
    return chain.reverb;
  }

  // panner -> [compressor] -> gain -> [limiter] -> analyser, plus panner -> [reverb] -> gain.
  // The convolver only gets input while the reverb is on, it costs CPU otherwise.
  function setRouting(chain, compressorOn, limiterOn, reverbOn) {
    if (chain.compressorOn === compressorOn && chain.limiterOn === limiterOn && chain.reverbOn === reverbOn) return;
    for (const n of [chain.panner, chain.compressor, chain.gain, chain.limiter]) n.disconnect();

    if (reverbOn) chain.panner.connect(reverbNodes(chain).convolver);
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
    chain.reverbOn = reverbOn;
  }

  // mixGain: the mixer's factor; an old instance gets it from the new one, see serveAudio().
  function applyAudio(el, s, force = false, mixGain = mixFactor(el)) {
    if (remote.has(el) && applyRemote(el, s)) return;
    let chain = chains.get(el);
    if (!chain) {
      // Routing through Web Audio is permanent for an element, so only do it when needed.
      if (!force && !needsAudioGraph(s) && !mixActive(el)) return;
      // Wait for metadata: by then a DRM player has announced itself and is left alone.
      // The loadedmetadata listener calls us again.
      if (isProtected(el) || audioBlocked.has(el) || el.readyState < HTMLMediaElement.HAVE_METADATA) return;
      chain = buildChain(el);
      if (!chain) return;
      chains.set(el, chain);
    }

    const t = audioCtx.currentTime;
    chain.gain.gain.setTargetAtTime((s.volume / 100) * mixGain, t, RAMP);
    setDialog(chain, s.dialog);
    chain.delay.delayTime.setTargetAtTime(Math.max(0, s.audioDelay) / 1000, t, RAMP);
    chain.highpass.frequency.setTargetAtTime(s.voice ? 120 : 10, t, RAMP);
    chain.bass.gain.setTargetAtTime(s.bass, t, RAMP);
    chain.mid.gain.setTargetAtTime(s.mid, t, RAMP);
    chain.treble.gain.setTargetAtTime(s.treble, t, RAMP);
    chain.presence.gain.setTargetAtTime(s.voice ? 5 : 0, t, RAMP);
    chain.panner.pan.setTargetAtTime(s.pan / 100, t, RAMP);
    const gains = AVFX.stereoGains(s);
    for (const from of [0, 1]) {
      for (const to of [0, 1]) chain.matrix[from][to].gain.setTargetAtTime(gains[from][to], t, RAMP);
    }
    // Widening adds side signal to both channels and can push peaks above 0 dBFS
    // (up to +6 dB at 200 %), leveling boosts by up to 12 dB: the limiter is always in
    // the chain then.
    const widened = !s.mono && s.width > 100;
    setRouting(chain, s.compressor, s.limiter || widened || s.autoGain, s.reverb > 0);
    if (chain.reverb) chain.reverb.wet.gain.setTargetAtTime((s.reverb / 100) * 0.5, t, RAMP);

    if (s.autoGain !== chain.autoGainOn) {
      chain.autoGainOn = s.autoGain;
      chain.autoGainState = { power: null, gain: 0 };
      if (!s.autoGain) chain.autoGain.gain.setTargetAtTime(1, t, RAMP);
    }
    // Also restarts the timer for an element that comes back after being pruned.
    if (s.autoGain && !autoGainTimer) autoGainTimer = setInterval(autoGainTick, AUTO_GAIN_INTERVAL_MS);
  }

  // ---------- Voice ↔ background ----------

  // An AudioWorklet runs dialog.js off the main thread. Pages whose CSP blocks the
  // worklet module get a ScriptProcessor running the same code here instead.
  let dialogKind = null; // Promise<"worklet" | "script">

  function loadDialog(ac) {
    dialogKind ??= (async () => {
      try {
        await ac.audioWorklet.addModule(api.runtime.getURL("dialog.js"));
        await ac.audioWorklet.addModule(api.runtime.getURL("dialog-worklet.js"));
        return "worklet";
      } catch (e) {
        console.info("[Klangbild] AudioWorklet not available here, using a ScriptProcessor:", e);
        return "script";
      }
    })();
    return dialogKind;
  }

  function createDialog(ac, kind) {
    if (kind === "worklet") {
      try {
        const node = new AudioWorkletNode(ac, "klangbild-dialog", {
          outputChannelCount: [2],
          channelCount: 2,
          channelCountMode: "explicit",
          channelInterpretation: "speakers",
        });
        return { node, kind, set: (amount) => node.port.postMessage(amount) };
      } catch (e) {
        console.info("[Klangbild] AudioWorkletNode failed, using a ScriptProcessor:", e);
      }
    }
    const node = ac.createScriptProcessor(1024, 2, 2);
    node.channelCountMode = "explicit";
    node.channelInterpretation = "speakers";
    const dsp = AVFXDialog.createProcessor(ac.sampleRate);
    node.onaudioprocess = (e) => {
      const i = e.inputBuffer;
      const o = e.outputBuffer;
      dsp.process(i.getChannelData(0), i.getChannelData(1), o.getChannelData(0), o.getChannelData(1));
    };
    return { node, kind: "script", set: (amount) => dsp.setAmount(amount) };
  }

  // delay -> [dialog] -> highpass. At 0 the node is taken out of the chain, so it adds
  // neither latency nor CPU load.
  function setDialog(chain, amount) {
    chain.dialogAmount = amount;
    const on = amount !== 0;
    if (on && !chain.dialog) {
      if (!chain.dialogLoading) {
        chain.dialogLoading = true;
        loadDialog(audioCtx).then((kind) => {
          chain.dialog = createDialog(audioCtx, kind);
          chain.dialogLoading = false;
          setDialog(chain, chain.dialogAmount); // the slider may have moved meanwhile
        });
      }
      return;
    }
    if (chain.dialog) chain.dialog.set(amount);
    if (on === chain.dialogOn) return;
    chain.delay.disconnect();
    if (on) {
      chain.delay.connect(chain.dialog.node);
      chain.dialog.node.connect(chain.highpass);
    } else {
      chain.dialog.node.disconnect();
      chain.delay.connect(chain.highpass);
    }
    chain.dialogOn = on;
  }

  // ---------- Mixer ----------

  function mixActive(el) {
    const m = mixes.get(el);
    return Boolean(m) && !m.native && (m.muted || m.gain !== 100);
  }

  function mixFactor(el) {
    const m = mixes.get(el);
    return !m || m.native ? 1 : m.muted ? 0 : m.gain / 100;
  }

  // Media from another origin without CORS permission: Web Audio would only get silence.
  function crossOriginRisk(el) {
    try {
      const url = new URL(el.currentSrc || el.src, location.href);
      if (url.protocol !== "http:" && url.protocol !== "https:") return false; // blob: (MSE), data:
      return url.origin !== location.origin && el.crossOrigin === null;
    } catch {
      return false;
    }
  }

  function applyNativeMix(el, m) {
    if (m.base === undefined) m.base = el.volume;
    el.volume = m.muted ? 0 : AVFX.clamp(m.base * (m.gain / 100), 0, 1);
    if (!m.muted && m.gain === 100) {
      el.volume = m.base; // back to neutral: forget the override
      mixes.delete(el);
    }
  }

  function mediaId(el) {
    if (!mediaIds.has(el)) mediaIds.set(el, nextMediaId++);
    return mediaIds.get(el);
  }

  // A short name: the element's own title, else the file name of a real (non-blob) URL.
  function mediaLabel(el) {
    const own = el.title || el.getAttribute("aria-label");
    if (own) return own.trim().slice(0, 80);
    try {
      const url = new URL(el.currentSrc || el.src);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const file = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() ?? "");
        if (file) return file.slice(0, 80);
      }
    } catch {}
    return null;
  }

  // Elements of this frame for the sidebar's mixer, with their level in dBFS.
  function mediaList() {
    if (disabledHere) return { disabled: true };
    prune();
    const primary = primaryMedia()?.el;
    return [...media]
      .filter((el) => el.isConnected || !el.paused)
      .map((el) => {
        const chain = chains.get(el);
        const audio = routed(el);
        const mix = mixes.get(el) ?? { gain: 100, muted: false };
        return {
          id: mediaId(el),
          kind: el.localName,
          label: mediaLabel(el),
          paused: el.paused,
          time: el.currentTime,
          duration: el.duration,
          elementMuted: el.muted || el.volume === 0,
          level: audio && !el.paused ? (analyseOf(el)?.rms ?? null) : null,
          gain: mix.gain,
          muted: mix.muted,
          primary: el === primary,
          drm: isProtected(el),
          audioBlocked: audioLocked(el),
          hasAudioChain: audio,
          native: !audio && crossOriginRisk(el), // mixed through el.volume, up to 100 %
          dialog: chain?.dialogOn ? chain.dialog.kind : null, // "worklet" | "script"
        };
      });
  }
  globalThis.__avfxMediaList = mediaList;

  function mediaById(id) {
    for (const el of media) if (mediaIds.get(el) === id) return el;
    return null;
  }

  // Changes one element's mix; it needs Web Audio for that (not possible with DRM).
  async function mixMedia(msg) {
    const el = mediaById(msg.id);
    if (!el) return { ok: false, text: AVFX.t("noMedia") };
    if (msg.action === "play") {
      if (el.paused) await el.play().catch(() => {});
      else el.pause();
      return { ok: true };
    }
    if (isProtected(el)) return { ok: false, text: AVFX.t("drmProtected") };
    const old = mixes.get(el) ?? { gain: 100, muted: false };
    const native = old.native ?? (!routed(el) && crossOriginRisk(el));
    const max = native ? 100 : AVFX.LIMITS.volume[1];
    const gain = Number.isFinite(msg.gain) ? AVFX.clamp(msg.gain, 0, max) : old.gain;
    const muted = typeof msg.muted === "boolean" ? msg.muted : old.muted;
    if (native) {
      const m = { ...old, gain, muted, native: true };
      mixes.set(el, m);
      applyNativeMix(el, m);
      return { ok: true };
    }
    mixes.set(el, { gain, muted });
    applyAudio(el, effective(), true);
    if (!routed(el)) {
      mixes.set(el, old);
      return { ok: false, text: AVFX.t(audioLocked(el) ? "audioBlockedReload" : "noMediaData") };
    }
    return { ok: true };
  }

  // ---------- Loudness leveling ----------

  const AUTO_GAIN_INTERVAL_MS = 100;
  let autoGainTimer = 0;
  let autoGainLast = 0;

  function rmsDb(an) {
    const data = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return 10 * Math.log10(sum / data.length);
  }

  // Measures every leveled element and moves its gain smoothly; stops when none is left.
  // Background tabs run it less often, so the time step is measured, not assumed.
  function autoGainTick() {
    const now = performance.now();
    const dt = Math.min(1, autoGainLast ? (now - autoGainLast) / 1000 : AUTO_GAIN_INTERVAL_MS / 1000);
    autoGainLast = now;
    let active = false;
    for (const el of retired ? served : media) {
      const chain = chains.get(el);
      if (!chain?.autoGainOn) continue;
      active = true;
      if (el.paused) continue;
      chain.autoGainState = AVFX.autoGainStep(chain.autoGainState, rmsDb(chain.autoGainMeter), dt);
      chain.autoGain.gain.setTargetAtTime(10 ** (chain.autoGainState.gain / 20), audioCtx.currentTime, 0.3);
    }
    if (!active) {
      clearInterval(autoGainTimer);
      autoGainTimer = 0;
      autoGainLast = 0;
    }
  }

  // 48 log-spaced bands (30 Hz – 16 kHz, 0..1) plus RMS/peak level in dBFS.
  function spectrum() {
    const p = primaryMedia();
    if (p && isProtected(p.el) && !chains.has(p.el)) return { drm: true };
    // The primary element may be a muted video while a separate element carries the
    // sound, so audible elements win, then playing ones, then the primary one.
    const audible = (el) => !el.muted && el.volume > 0;
    const ranked = [...media]
      .filter((el) => chains.has(el) || remote.has(el))
      .sort((x, y) => audible(y) - audible(x) || x.paused - y.paused || (y === p?.el) - (x === p?.el));
    const el = ranked[0];
    if (!el) return null;
    const data = analyseOf(el);
    if (!data) return null;
    return { ...data, paused: p?.el.paused ?? true };
  }

  // ---------- Skipping silence ----------

  const SILENCE_INTERVAL_MS = 25; // short: speech after a pause should play fast only briefly
  const silence = new WeakMap(); // element -> { state, fast, saved (s of real time) }
  let silenceTimer = 0;
  let silenceLast = 0;

  // RMS of the newest samples before the volume (muting or turning down isn't silence).
  function tailRmsDb(an, n = 512) {
    const data = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = data.length - n; i < data.length; i++) sum += data[i] * data[i];
    return 10 * Math.log10(sum / n);
  }

  function setFast(el, st, fast) {
    if (st.fast === fast) return;
    st.fast = fast;
    applyPlayback(el, effective());
  }

  function silenceTick() {
    const now = performance.now();
    const dt = Math.min(0.2, silenceLast ? (now - silenceLast) / 1000 : SILENCE_INTERVAL_MS / 1000);
    silenceLast = now;
    const on = effective().skipSilence && !retired;
    let active = false;
    for (const el of media) {
      const st = silence.get(el);
      const chain = chains.get(el);
      if (!on || !chain) {
        if (st) setFast(el, st, false);
        continue;
      }
      active = true;
      if (!st) {
        silence.set(el, { state: { level: null, quiet: 0, silent: false }, fast: false, saved: 0 });
        continue;
      }
      // Buffering or seeking isn't a pause of the recording.
      if (el.paused || el.seeking || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        st.state = { ...st.state, quiet: 0, silent: false };
        setFast(el, st, false);
        continue;
      }
      st.state = AVFX.silenceStep(st.state, tailRmsDb(chain.autoGainMeter), dt);
      if (st.fast) st.saved += dt * (AVFX.SKIP_SILENCE.factor - 1);
      setFast(el, st, st.state.silent);
    }
    if (!active) {
      clearInterval(silenceTimer);
      silenceTimer = 0;
      silenceLast = 0;
    }
  }

  function startSilence() {
    if (effective().skipSilence && !silenceTimer && !retired) silenceTimer = setInterval(silenceTick, SILENCE_INTERVAL_MS);
  }

  // ---------- Playback ----------

  // The speed setting, faster while a pause is skipped.
  function rateOf(el, s) {
    const fast = silence.get(el)?.fast && s.skipSilence;
    return fast ? Math.min(s.speed * AVFX.SKIP_SILENCE.factor, AVFX.LIMITS.speed[1]) : s.speed;
  }

  function applyPlayback(el, s) {
    el.preservesPitch = s.preservePitch;
    const rate = rateOf(el, s);
    if (Math.abs(el.playbackRate - rate) > 0.001) {
      try {
        el.playbackRate = rate;
      } catch (e) {
        console.warn("[Klangbild] Cannot set speed:", e);
      }
    }
  }

  // Many players reset playbackRate on their own (e.g. when switching quality).
  // Some reset it on every change, so corrections are capped instead of ping-ponging forever.
  function onRateChange(e) {
    const el = e.target;
    const rate = rateOf(el, effective());
    if (retired || rate === 1 || Math.abs(el.playbackRate - rate) <= 0.001) return;

    const now = performance.now();
    const fight = rateFights.get(el);
    if (!fight || now - fight.since > 2000) rateFights.set(el, { count: 1, since: now });
    else if (++fight.count > 10) return;
    applyPlayback(el, effective());
  }

  // ---------- Video ----------

  const SVG_NS = "http://www.w3.org/2000/svg";
  let filterSvg = null;
  let filterKey = "";

  function svgNode(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children);
    return node;
  }

  // CSS has no sharpen, gamma, white balance or color blindness correction, so an SVG
  // filter is injected and referenced. Returns null when none of them is active.
  function svgFilter(s) {
    if (s.sharpen === 0 && s.gamma === 1 && s.temperature === 0 && s.colorVision === "none") return null;
    if (!filterSvg) {
      filterSvg = svgNode("svg", { "aria-hidden": "true" }, svgNode("filter", { id: "avfx-filter", "color-interpolation-filters": "sRGB" }));
      filterSvg.style.cssText = "position:absolute !important; width:0 !important; height:0 !important;";
    }
    if (!filterSvg.isConnected) document.documentElement.append(filterSvg);

    const key = `${s.sharpen}|${s.gamma}|${s.temperature}|${s.colorVision}`;
    if (key !== filterKey) {
      filterKey = key;
      const steps = [];
      if (s.gamma !== 1) {
        const exponent = String(1 / s.gamma);
        steps.push(svgNode("feComponentTransfer", {}, ...["R", "G", "B"].map((c) => svgNode(`feFunc${c}`, { type: "gamma", exponent }))));
      }
      if (s.temperature !== 0) {
        // Warm lifts red and lowers blue, cool the other way round.
        const k = s.temperature / 100;
        const r = 1 + 0.2 * k;
        const g = 1 + 0.04 * k;
        const b = 1 - 0.2 * k;
        steps.push(svgNode("feColorMatrix", { type: "matrix", values: `${r} 0 0 0 0  0 ${g} 0 0 0  0 0 ${b} 0 0  0 0 0 1 0` }));
      }
      if (s.colorVision !== "none") {
        steps.push(svgNode("feColorMatrix", { type: "matrix", values: AVFX.colorVisionMatrix(s.colorVision) }));
      }
      if (s.sharpen !== 0) {
        const a = s.sharpen / 100;
        steps.push(svgNode("feConvolveMatrix", { order: "3", preserveAlpha: "true", kernelMatrix: `0 ${-a} 0 ${-a} ${1 + 4 * a} ${-a} 0 ${-a} 0` }));
      }
      filterSvg.firstChild.replaceChildren(...steps);
    }
    return "url(#avfx-filter)";
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
    const svg = svgFilter(s);
    if (svg) filters.push(svg);
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
    // Translating first moves the picture in screen directions, whatever the rotation.
    if (s.offsetX || s.offsetY) transforms.push(`translate(${s.offsetX}%, ${s.offsetY}%)`);
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

  const ambilights = new WeakMap(); // element -> AVFXAmbilight

  function applyAmbilight(el, s) {
    if (!(el instanceof HTMLVideoElement)) return;
    let a = ambilights.get(el);
    if (!s.ambilight || isProtected(el)) {
      a?.destroy();
      ambilights.delete(el);
      return;
    }
    if (!a) {
      a = new AVFXAmbilight(el);
      ambilights.set(el, a);
    }
    a.strength = s.ambilight / 100;
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

  // Resolution and dropped frames of a video, null for audio or before the first frame.
  function videoInfo(el) {
    if (!(el instanceof HTMLVideoElement) || !el.videoWidth) return null;
    const q = el.getVideoPlaybackQuality?.();
    const frame = frameDurations.get(el);
    return {
      width: el.videoWidth,
      height: el.videoHeight,
      fps: frame ? Math.round(1000 / frame) / 1000 : null,
      dropped: q?.droppedVideoFrames ?? null,
      total: q?.totalVideoFrames ?? null,
    };
  }

  // ---------- Sleep timer ----------

  const SLEEP_FADE_MS = 10_000;
  let sleep = null; // { at, timer, volumes: Map(element -> volume before the fade) }

  function restoreSleepVolumes() {
    for (const [el, volume] of sleep?.volumes ?? []) el.volume = volume;
  }

  // Lowers the volume of everything playing during the last seconds, then pauses it.
  // Uses element.volume, so it works without Web Audio. Hidden tabs may run the
  // timer late, browsers throttle their timers.
  function sleepTick() {
    const left = sleep.at - Date.now();
    if (left <= 0) {
      for (const el of media) if (!el.paused) el.pause();
      setSleep(0);
      showOsd(AVFX.t("sleepDone"));
      return;
    }
    if (left > SLEEP_FADE_MS) return;
    for (const el of media) {
      if (el.paused) continue;
      if (!sleep.volumes.has(el)) sleep.volumes.set(el, el.volume);
      el.volume = sleep.volumes.get(el) * (left / SLEEP_FADE_MS);
    }
  }

  function setSleep(minutes) {
    if (sleep) {
      clearInterval(sleep.timer);
      restoreSleepVolumes();
      sleep = null;
    }
    if (minutes > 0) sleep = { at: Date.now() + minutes * 60_000, timer: setInterval(sleepTick, 500), volumes: new Map() };
  }

  // ---------- Frame rate ----------

  const FRAME_SAMPLES = 60;
  const frameDurations = new WeakMap(); // video -> measured seconds per frame
  const frameSamplers = new WeakMap(); // video -> { samples, last } while measuring

  // The frame rate isn't exposed, so the media times of the first frames presented
  // after playback starts are compared. Stops after FRAME_SAMPLES frames; frames
  // only arrive while the video plays visibly. Faster than normal speed the
  // compositor may skip frames, those differences are left out.
  function measureFrameRate(el) {
    if (!(el instanceof HTMLVideoElement) || !el.requestVideoFrameCallback) return;
    if (frameDurations.has(el) || frameSamplers.has(el) || retired) return;
    const sampler = { samples: [], last: null };
    frameSamplers.set(el, sampler);
    const onFrame = (now, meta) => {
      if (retired || frameSamplers.get(el) !== sampler) return;
      const last = sampler.last;
      if (last && meta.presentedFrames - last.presentedFrames === 1 && el.playbackRate <= 1) {
        sampler.samples.push(meta.mediaTime - last.mediaTime);
      }
      sampler.last = meta;
      if (sampler.samples.length < FRAME_SAMPLES) {
        el.requestVideoFrameCallback(onFrame);
        return;
      }
      frameSamplers.delete(el);
      const d = AVFX.frameDuration(sampler.samples);
      if (d) frameDurations.set(el, d);
    };
    el.requestVideoFrameCallback(onFrame);
  }

  // New source: measure again on the next play.
  function forgetFrameRate(el) {
    frameDurations.delete(el);
    frameSamplers.delete(el);
  }

  function toolState(el) {
    const loop = loops.get(el);
    return {
      video: videoInfo(el),
      loopAll: el.loop,
      sleepLeft: sleep ? Math.max(0, sleep.at - Date.now()) : null,
      kind: el.localName,
      time: el.currentTime,
      duration: el.duration,
      paused: el.paused,
      loopA: loop?.a ?? null,
      loopB: loop?.b ?? null,
      hasAudioChain: routed(el),
      drm: isProtected(el),
      audioBlocked: audioLocked(el),
      silenceSaved: silence.get(el)?.saved ?? 0,
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
        el.currentTime = AVFX.clamp(el.currentTime + msg.dir * (frameDurations.get(el) ?? FRAME_STEP), 0, el.duration || Infinity);
        text = AVFX.t("frameAt", formatTime(el.currentTime));
        break;
      case "seek":
        el.currentTime = AVFX.clamp(el.currentTime + msg.seconds, 0, el.duration || Infinity);
        text = AVFX.t("seekTo", formatTime(el.currentTime));
        break;
      case "remember-position": // the panel reloads the tab next, see applyResume()
        return { ok: saveResume(el) };
      case "seek-to": // the sidebar's timeline
        if (Number.isFinite(msg.time)) el.currentTime = AVFX.clamp(msg.time, 0, el.duration || Infinity);
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
      case "loop-all":
        el.loop = !el.loop;
        break;
      case "sleep":
        setSleep(msg.minutes);
        text = msg.minutes > 0 ? AVFX.t("sleepSet", msg.minutes) : AVFX.t("sleepOff");
        break;
      case "screenshot":
        return { ...(await screenshot(el)), state: toolState(el) };
      case "attach-audio":
        if (isProtected(el)) return { ok: false, text: AVFX.t("drmProtected"), state: toolState(el) };
        applyAudio(el, effective(), true);
        if (!routed(el)) {
          const text = AVFX.t(audioLocked(el) ? "audioBlockedReload" : "noMediaData");
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
    applyAmbilight(el, s);
    applyVideoDelay(el, s);
    startSilence();
  }

  function applyAll() {
    prune();
    for (const el of media) applyTo(el);
    startSilence();
    updateBadge();
  }

  // The toolbar badge shows the tab's speed; every frame has the same settings.
  // Also sent once per document, which clears a badge left over from the previous page.
  function updateBadge() {
    if (window !== window.top) return;
    browser.runtime.sendMessage({ type: "badge", speed: settings.speed, enabled: settings.enabled }).catch(() => {});
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
      hasAudioChain: routed(p.el),
      drm: isProtected(p.el),
      audioBlocked: audioLocked(p.el),
    };
  }
  globalThis.__avfxPrimary = primaryInfo;

  function resumeAudio() {
    if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
  }

  // ---------- Continue watching ----------

  // Longer media remember where they were left, per page address (the background script
  // stores it hashed, not in private windows). Each new source asks once, and only after
  // asking it saves, so a fresh start can't overwrite the position it is about to use.
  let continueOn = false; // the global preference, from "init"
  const RESUME_SAVE_MS = 5000;
  const watched = new WeakMap(); // element -> { src, url, asked, lastSave }

  function watchOf(el) {
    let w = watched.get(el);
    if (!w || w.src !== el.currentSrc) {
      // The address when this source started: single-page sites change it before the next video.
      w = { src: el.currentSrc, url: location.href, asked: false, lastSave: 0 };
      watched.set(el, w);
    }
    return w;
  }

  const longEnough = (el) => Number.isFinite(el.duration) && el.duration >= AVFX.RESUME.minDuration;

  function savePosition(el, now = false) {
    if (!continueOn || retired || !longEnough(el)) return;
    const w = watchOf(el);
    if (!w.asked || (!now && Date.now() - w.lastSave < RESUME_SAVE_MS)) return;
    w.lastSave = Date.now();
    const done = el.ended || el.currentTime > el.duration - AVFX.RESUME.endMargin;
    browser.runtime
      .sendMessage({ type: "resume-save", url: w.url, time: el.currentTime, duration: el.duration, done })
      .catch(() => {});
  }

  async function continueWatching(el) {
    if (!continueOn || retired || resume || !longEnough(el)) return; // a reload's own position wins
    const w = watchOf(el);
    if (w.asked) return;
    w.asked = true;
    const saved = await browser.runtime.sendMessage({ type: "resume-get", url: w.url }).catch(() => null);
    const at = AVFX.resumeTime(saved, el.duration, el.currentTime);
    if (at === null || watched.get(el) !== w) return;
    el.currentTime = at;
    if (el === primaryMedia()?.el) showOsd(AVFX.t("resumedAt", formatTime(at)));
  }

  window.addEventListener("pagehide", () => {
    for (const el of media) savePosition(el, true);
  });

  // ---------- Reload and resume ----------

  // Media held by an older instance only come back with a reload: the panel offers one
  // that continues where playback was. The position waits in this tab's sessionStorage,
  // which survives the reload and stays with the tab.
  const RESUME_KEY = "klangbild-resume";
  const RESUME_MAX_AGE_MS = 60_000; // a reload that takes longer was probably not ours
  const RESUME_WINDOW_MS = 30_000; // the page's player has this long to load the media
  let resume = takeResume();

  function takeResume() {
    try {
      const raw = sessionStorage.getItem(RESUME_KEY);
      if (raw === null) return null;
      sessionStorage.removeItem(RESUME_KEY);
      const r = JSON.parse(raw);
      const age = Date.now() - r?.at;
      if (!(age >= 0 && age < RESUME_MAX_AGE_MS) || r.url !== location.href) return null;
      if (!Number.isFinite(r.time) || r.time <= 0) return null;
      return { time: r.time, paused: r.paused === true, until: Date.now() + RESUME_WINDOW_MS, seen: 0 };
    } catch {
      return null; // storage blocked (sandboxed frame, privacy settings) or garbage
    }
  }

  function saveResume(el) {
    try {
      sessionStorage.setItem(RESUME_KEY, JSON.stringify({ url: location.href, time: el.currentTime, paused: el.paused, at: Date.now() }));
      return true;
    } catch {
      return false;
    }
  }

  // Called on loadedmetadata and on playing: players like YouTube's may seek to their own
  // start after we did, so the position is checked a second time once playback runs.
  // Elements whose duration doesn't fit (an ad before the video) are skipped.
  function applyResume(el) {
    if (!resume) return;
    if (Date.now() > resume.until || el.duration === Infinity) {
      resume = null; // timed out, or a live stream: the old position means nothing there
      return;
    }
    if (!(el.duration > resume.time)) return;
    if (Math.abs(el.currentTime - resume.time) > 1) el.currentTime = resume.time;
    if (resume.paused) el.pause();
    else if (el.paused) el.play().catch(() => {});
    if (++resume.seen >= 2) resume = null;
  }

  function register(el) {
    if (retired || media.has(el)) return;
    media.add(el);
    if (!chains.has(el) && !remote.has(el) && el.hasAttribute(ROUTED_ATTR)) {
      if (askOwner(el)) remote.add(el);
      else routedElsewhere.add(el);
    }
    if (!listened.has(el)) {
      listened.add(el);
      el.addEventListener("ratechange", onRateChange);
      el.addEventListener("loadedmetadata", () => {
        applyTo(el);
        applyResume(el);
        continueWatching(el);
      });
      el.addEventListener("durationchange", () => continueWatching(el));
      el.addEventListener("pause", () => savePosition(el, true));
      el.addEventListener("playing", () => applyResume(el));
      el.addEventListener("encrypted", () => {
        encrypted.add(el);
        applyVideoDelay(el, effective()); // drops a running delay overlay
      });
      el.addEventListener("play", () => {
        register(el); // may have been pruned while detached
        resumeAudio();
        measureFrameRate(el);
      });
      el.addEventListener("timeupdate", () => {
        checkLoop(el);
        savePosition(el);
      });
      // B at the very end: playback ends before B is reached.
      el.addEventListener("ended", () => {
        const loop = loops.get(el);
        if (loop?.b != null) {
          el.currentTime = loop.a;
          el.play().catch(() => {});
        }
      });
      // New source (e.g. next episode in the same element): the old loop is meaningless.
      el.addEventListener("emptied", () => {
        loops.delete(el);
        forgetFrameRate(el);
      });
    }
    applyTo(el);
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) {
      applyResume(el);
      continueWatching(el);
    }
    if (!el.paused) measureFrameRate(el); // already playing, no "play" event follows
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

  // Runs in the old instance when a new one takes over, or when Klangbild is disabled
  // for the site. Web Audio routing can't be undone, so it is made transparent; styles
  // and overlays are removed.
  function retire() {
    retired = true;
    silenceTick(); // back to the normal speed
    setSleep(0);
    clearInterval(rescanTimer);
    observer.disconnect();
    loops.clear();
    for (const el of media) {
      const mix = mixes.get(el);
      if (mix?.native && mix.base !== undefined) el.volume = mix.base;
      mixes.delete(el);
      if (chains.has(el)) applyAudio(el, DEFAULTS);
      applyVideo(el, DEFAULTS);
      applyAmbilight(el, DEFAULTS);
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

  // Saved settings and whether the site is disabled. Until this has arrived the popup
  // and keyboard shortcuts must not see the defaults, e.g. right after on-demand
  // injection into a tab opened before an extension update.
  const ready = browser.runtime
    .sendMessage({ type: "init" })
    .then((init) => {
      if (init?.disabled) {
        disabledHere = true;
        retire();
        updateBadge(); // clears a badge left over from the previous page
        return;
      }
      if (init?.settings && !receivedSet) {
        settings = sanitize(init.settings);
        applyAll();
      } else {
        updateBadge();
      }
      continueOn = init?.resume === true;
      for (const el of media) if (el.readyState >= HTMLMediaElement.HAVE_METADATA) continueWatching(el);
    })
    .catch(() => {});

  // Switched in the options while the page is open.
  browser.storage.onChanged.addListener((changes, area) => {
    const prefs = changes[AVFX.PREFS_KEY];
    if (area === "local" && prefs) continueOn = { ...AVFX.PREFS_DEFAULTS, ...prefs.newValue }.resume === true;
  });

  AVFX.onMessage((msg) => {
    if (retired && !disabledHere) return undefined;
    if (msg?.type === "get") {
      return ready.then(() =>
        // A disabled site still tells the popup why nothing happens.
        disabledHere ? { settings: { ...DEFAULTS }, mediaCount: 0, disabled: true } : { settings, mediaCount: media.size }
      );
    }
    if (retired) return undefined;
    switch (msg?.type) {
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
      case "media-list":
        return mediaList();
      case "media-mix":
        return mixMedia(msg);
      case "probe": {
        // Fallback for AVFX.findPrimaryFrame(): only frames with media answer.
        // Chrome has no getFrameId; the caller then broadcasts to all frames.
        const info = primaryInfo();
        return info ? { frameId: browser.runtime.getFrameId?.(window), ...info } : undefined;
      }
    }
    return undefined;
  });

  if (document.documentElement) startObserving();
  else document.addEventListener("DOMContentLoaded", startObserving, { once: true });
})();
