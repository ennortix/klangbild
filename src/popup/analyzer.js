// Spectrum of the system's audio output, for media whose sound pages can't hand
// out (e.g. DRM streams). Sources:
// - Chrome on Windows/ChromeOS: screen sharing with "Also share system audio";
//   the video track is dropped right away.
// - Any browser: a loopback input device such as "Stereo Mix" or a virtual cable.
// The analyser isn't connected to the speakers, so nothing is played back twice.

const view = createSpectrumView();
$("view").append(...view.nodes);
view.canvas.classList.add("tall");

const message = el("span");
const note = el("small");
view.overlay.append(message, note);

let audioCtx = null;
let stream = null;
let raf = 0;

function idle(text, hint = "") {
  message.textContent = text;
  note.textContent = hint;
  view.overlay.hidden = false;
  view.draw(null);
}

function stop() {
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  stream = null;
  audioCtx = null;
  refreshButtons();
}

async function start(getStream) {
  stop();
  try {
    stream = await getStream();
  } catch (e) {
    idle("No source started.", e.name === "NotAllowedError" ? "Permission was denied or the dialog was closed." : e.message);
    return;
  }
  stream.getVideoTracks().forEach((t) => t.stop());
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stop();
    idle("The shared source has no audio.", 'Choose "Entire screen" and tick "Also share system audio".');
    return;
  }
  track.addEventListener("ended", () => {
    stop();
    idle("Source stopped.");
  });

  audioCtx = new AudioContext();
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.7;
  audioCtx.createMediaStreamSource(new MediaStream([track])).connect(analyser);

  view.overlay.hidden = true;
  const loop = () => {
    view.draw(AVFX.analyse(analyser));
    raf = requestAnimationFrame(loop);
  };
  loop();
  refreshButtons();
  refreshDevices(); // device names become available after the first permission
}

// ---------- Sources ----------

const sources = $("sources");
const stopBtn = el("button", { type: "button", className: "chip" }, icon("reset"), "Stop");
stopBtn.addEventListener("click", () => {
  stop();
  idle("Stopped.");
});

function refreshButtons() {
  stopBtn.hidden = !stream;
}

if (!AVFX.IS_FIREFOX && navigator.mediaDevices.getDisplayMedia) {
  const sys = el("button", { type: "button", className: "chip" }, icon("audio"), "Share system audio");
  sys.addEventListener("click", () =>
    start(() =>
      navigator.mediaDevices.getDisplayMedia({
        video: true, // required by the API, dropped immediately
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: "include",
      })
    )
  );
  sources.append(
    el("div", { className: "group-title" }, icon("audio"), "System audio (Chrome, Windows)"),
    el("div", { className: "toggles" }, sys),
    el("div", { className: "hint", textContent: 'In the dialog choose "Entire screen" and tick "Also share system audio".' })
  );
}

const deviceSelect = el("select", { className: "device-select" });
const listen = el("button", { type: "button", className: "chip" }, icon("voice"), "Listen");
listen.addEventListener("click", () =>
  start(() =>
    navigator.mediaDevices.getUserMedia({
      // Raw signal: voice processing would distort the spectrum.
      audio: {
        deviceId: deviceSelect.value ? { exact: deviceSelect.value } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })
  )
);

async function refreshDevices() {
  const selected = deviceSelect.value;
  const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  deviceSelect.replaceChildren(
    ...inputs.map((d, i) => el("option", { value: d.deviceId, textContent: d.label || `Input ${i + 1}` }))
  );
  // Preselect a loopback device when there is one.
  const loopback = inputs.find((d) => /stereo ?mix|stereomix|what u hear|cable output|loopback|voicemeeter/i.test(d.label));
  deviceSelect.value = selected || loopback?.deviceId || inputs[0]?.deviceId || "";
}

sources.append(
  el("div", { className: "group-title" }, icon("voice"), "Loopback input device"),
  el("div", { className: "preset-save" }, deviceSelect, listen),
  el("div", {
    className: "hint",
    textContent:
      'Needs a device that returns your speaker output, e.g. "Stereo Mix" (Sound settings → Recording → show disabled devices) or the free virtual cable VB-CABLE. Device names appear after the first start.',
  }),
  el("div", { className: "toggles" }, stopBtn)
);

refreshButtons();
refreshDevices();
idle("Choose a source below.");
window.addEventListener("pagehide", stop);
