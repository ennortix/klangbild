// Spectrum of the system's audio output, for media whose sound pages can't hand
// out (e.g. DRM streams). Sources:
// - Chrome on Windows/ChromeOS: screen sharing with "Also share system audio";
//   the video track is dropped right away.
// - Any browser: a loopback input device such as "Stereo Mix" or a virtual cable.
// The analyser isn't connected to the speakers, so nothing is played back twice.

localizePage();

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
    idle(t("noSourceStarted"), e.name === "NotAllowedError" ? t("permissionDenied") : e.message);
    return;
  }
  stream.getVideoTracks().forEach((t) => t.stop());
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stop();
    idle(t("sourceNoAudio"), t("shareDialogHint"));
    return;
  }
  track.addEventListener("ended", () => {
    stop();
    idle(t("sourceStopped"));
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
const stopBtn = el("button", { type: "button", className: "chip" }, icon("reset"), t("stop"));
stopBtn.addEventListener("click", () => {
  stop();
  idle(t("stopped"));
});

function refreshButtons() {
  stopBtn.hidden = !stream;
}

if (!AVFX.IS_FIREFOX && navigator.mediaDevices.getDisplayMedia) {
  const sys = el("button", { type: "button", className: "chip" }, icon("audio"), t("shareSystemAudio"));
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
    el("div", { className: "group-title" }, icon("audio"), t("systemAudioChrome")),
    el("div", { className: "toggles" }, sys),
    el("div", { className: "hint", textContent: t("shareDialogHint") })
  );
}

const deviceSelect = el("select", { className: "device-select" });
const listen = el("button", { type: "button", className: "chip" }, icon("voice"), t("listen"));
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
    ...inputs.map((d, i) => el("option", { value: d.deviceId, textContent: d.label || t("inputN", i + 1) }))
  );
  // Preselect a loopback device when there is one.
  const loopback = inputs.find((d) => /stereo ?mix|stereomix|what u hear|cable output|loopback|voicemeeter/i.test(d.label));
  deviceSelect.value = selected || loopback?.deviceId || inputs[0]?.deviceId || "";
}

sources.append(
  el("div", { className: "group-title" }, icon("voice"), t("loopbackDevice")),
  el("div", { className: "preset-save" }, deviceSelect, listen),
  el("div", {
    className: "hint",
    textContent: t("loopbackHint"),
  }),
  el("div", { className: "toggles" }, stopBtn)
);

refreshButtons();
refreshDevices();
idle(t("chooseSource"));
window.addEventListener("pagehide", stop);
