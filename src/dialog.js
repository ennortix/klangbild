// "Voice ↔ background": separates what is mixed to the center (dialog in films, videos
// and podcasts) from the rest (music, effects, ambience) and changes their balance.
//
// Short-time Fourier transform, per frequency bin: the inter-channel similarity
// 2|Φ_LR| / (Φ_LL + Φ_RR) is 1 for a signal that is equal in both channels and drops
// for panned or decorrelated ones (Avendano & Jot). Bins in the speech band that are
// similar in both channels count as voice; everything else, including centered bass and
// cymbals outside that band, as background. Mono sources are entirely "center", so
// there only the frequency band separates.
//
// Runs in the content script (fallback) and in an AudioWorklet, so it only touches
// globalThis. Latency: SIZE samples (21 ms at 48 kHz).
(() => {
  const SIZE = 1024; // FFT size
  const HOP = SIZE / 4;
  // Time smoothing of the per-bin statistics (time constant ≈ 35 ms): shorter averages
  // make even unrelated left/right noise look similar now and then.
  const SMOOTH = 0.85;
  const MAX_DB = 24; // range of the slider's ends
  const VOICE_LOW = 150; // Hz, the speech band; fades out over an octave on both sides
  const VOICE_HIGH = 6000;

  // In-place iterative radix-2 FFT on separate real/imaginary arrays.
  function makeFft(n) {
    const levels = Math.log2(n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
      rev[i] = r;
    }
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      cos[i] = Math.cos((2 * Math.PI * i) / n);
      sin[i] = Math.sin((2 * Math.PI * i) / n);
    }
    // inverse: conjugated twiddles, no scaling
    return (re, im, inverse) => {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          let t = re[i];
          re[i] = re[j];
          re[j] = t;
          t = im[i];
          im[i] = im[j];
          im[j] = t;
        }
      }
      const sign = inverse ? 1 : -1;
      for (let size = 2; size <= n; size *= 2) {
        const half = size / 2;
        const step = n / size;
        for (let start = 0; start < n; start += size) {
          for (let k = 0; k < half; k++) {
            const wr = cos[k * step];
            const wi = sign * sin[k * step];
            const a = start + k;
            const b = a + half;
            const tr = re[b] * wr - im[b] * wi;
            const ti = re[b] * wi + im[b] * wr;
            re[b] = re[a] - tr;
            im[b] = im[a] - ti;
            re[a] += tr;
            im[a] += ti;
          }
        }
      }
    };
  }

  // Linear gains [voice, background] for a slider value of -100..100:
  // positive lowers the background, negative lowers the voice, up to MAX_DB.
  function gains(amount) {
    const a = Math.max(-100, Math.min(100, amount)) / 100;
    const cut = (x) => 10 ** ((-MAX_DB * x) / 20);
    return a >= 0 ? [1, cut(a)] : [cut(-a), 1];
  }

  // Weight 0..1 of a frequency for "voice": 1 inside the speech band, fading out over
  // one octave below and above it.
  function bandWeight(hz) {
    if (hz <= 0) return 0;
    const below = Math.log2(hz / VOICE_LOW);
    const above = Math.log2(VOICE_HIGH / hz);
    return Math.max(0, Math.min(1, below + 1, above + 1));
  }

  // A streaming stereo processor; process() takes blocks of any length.
  function createProcessor(sampleRate) {
    const fft = makeFft(SIZE);
    const bins = SIZE / 2 + 1;
    // sqrt-Hann for analysis and synthesis; with 75 % overlap the squared windows add
    // up to a constant, which `norm` removes.
    const win = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) win[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / SIZE));
    let sum = 0;
    for (let i = 0; i < SIZE; i += HOP) sum += win[i] ** 2;
    const norm = 1 / sum;
    const band = new Float64Array(bins);
    for (let k = 0; k < bins; k++) band[k] = bandWeight((k * sampleRate) / SIZE);

    const inL = new Float64Array(SIZE);
    const inR = new Float64Array(SIZE);
    const outL = new Float64Array(SIZE);
    const outR = new Float64Array(SIZE);
    const re = new Float64Array(SIZE);
    const im = new Float64Array(SIZE);
    const pLL = new Float64Array(bins);
    const pRR = new Float64Array(bins);
    const pRe = new Float64Array(bins); // Φ_LR, complex
    const pIm = new Float64Array(bins);
    let pos = 0;
    let gVoice = 1;
    let gBack = 1;
    let target = [1, 1];

    function frame() {
      // Both channels in one complex FFT: x = l + i·r.
      for (let i = 0; i < SIZE; i++) {
        re[i] = inL[i] * win[i];
        im[i] = inR[i] * win[i];
      }
      fft(re, im, false);

      // Gains move to the target per frame, so slider moves don't click.
      gVoice += (target[0] - gVoice) * 0.3;
      gBack += (target[1] - gBack) * 0.3;

      for (let k = 0; k < bins; k++) {
        const m = (SIZE - k) % SIZE;
        // L_k = (X_k + conj X_m) / 2, R_k = (X_k − conj X_m) / 2i
        const lr = (re[k] + re[m]) / 2;
        const li = (im[k] - im[m]) / 2;
        const rr = (im[k] + im[m]) / 2;
        const ri = (re[m] - re[k]) / 2;

        pLL[k] = SMOOTH * pLL[k] + (1 - SMOOTH) * (lr * lr + li * li);
        pRR[k] = SMOOTH * pRR[k] + (1 - SMOOTH) * (rr * rr + ri * ri);
        pRe[k] = SMOOTH * pRe[k] + (1 - SMOOTH) * (lr * rr + li * ri); // L · conj R
        pIm[k] = SMOOTH * pIm[k] + (1 - SMOOTH) * (li * rr - lr * ri);
        const total = pLL[k] + pRR[k];
        const similarity = total > 1e-12 ? (2 * Math.hypot(pRe[k], pIm[k])) / total : 0;
        const mask = similarity * similarity * band[k];

        // voice C = mask · (L + R) / 2, background = L − C and R − C
        const cr = (mask * (lr + rr)) / 2;
        const ci = (mask * (li + ri)) / 2;
        const yLr = gVoice * cr + gBack * (lr - cr);
        const yLi = gVoice * ci + gBack * (li - ci);
        const yRr = gVoice * cr + gBack * (rr - cr);
        const yRi = gVoice * ci + gBack * (ri - ci);

        // Back into one spectrum Y = L' + i·R' (Hermitian parts recombined).
        re[k] = yLr - yRi;
        im[k] = yLi + yRr;
        if (m !== k) {
          re[m] = yLr + yRi;
          im[m] = yRr - yLi;
        }
      }

      fft(re, im, true);
      outL.copyWithin(0, HOP);
      outR.copyWithin(0, HOP);
      outL.fill(0, SIZE - HOP);
      outR.fill(0, SIZE - HOP);
      for (let i = 0; i < SIZE; i++) {
        const w = (win[i] * norm) / SIZE;
        outL[i] += re[i] * w;
        outR[i] += im[i] * w;
      }
      inL.copyWithin(0, HOP);
      inR.copyWithin(0, HOP);
    }

    return {
      latency: SIZE,
      setAmount(amount) {
        target = gains(amount);
      },
      // Blocks of mono input pass the same array for both channels.
      process(xL, xR, yL, yR) {
        for (let i = 0; i < xL.length; i++) {
          // A single NaN/Infinity would stick in the smoothed statistics for good.
          const l = xL[i];
          const r = xR[i];
          inL[SIZE - HOP + pos] = Number.isFinite(l) ? l : 0;
          inR[SIZE - HOP + pos] = Number.isFinite(r) ? r : 0;
          yL[i] = outL[pos];
          yR[i] = outR[pos];
          if (++pos === HOP) {
            frame();
            pos = 0;
          }
        }
      },
    };
  }

  globalThis.AVFXDialog = { SIZE, HOP, MAX_DB, gains, bandWeight, createProcessor, makeFft };
})();
