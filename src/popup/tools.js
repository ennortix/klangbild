// Tool modules: transport (position, jump, frame stepping, play/pause, video info), A-B
// loop and repeat, sleep timer, screenshot, and the keyboard shortcut overview.
// They share one state poll of the primary media, which runs while any of them is shown.

const SLEEP_MINUTES = [15, 30, 60, 90];

const toolViews = new Set(); // { node, show(state | null) }
let toolPollStarted = false;
let sleepChosen = null; // the page only knows the time left, so the chosen chip is kept here

async function toolAction(action, extra = {}) {
  const r = await sendToPrimary({ type: "action", action, ...extra });
  for (const view of toolViews) {
    if (view.node.isConnected) view.show(r?.state ?? null);
  }
  return r;
}

// Registers a node that shows the media state. Nodes that aren't on the page (a hidden
// item, or replaced by a re-render of the layout) are dropped after a moment.
function toolView(node, show) {
  toolViews.add({ node, show, born: performance.now() });
  if (toolPollStarted) return;
  toolPollStarted = true;
  const poll = async () => {
    const now = performance.now();
    for (const view of toolViews) if (!view.node.isConnected && now - view.born > 1000) toolViews.delete(view);
    if (tabId !== null && [...toolViews].some((v) => isShown(v.node))) await toolAction("state");
    setTimeout(poll, 400);
  };
  setTimeout(poll, 0);
}

// The answer to a tool button goes into its card's message line.
function showToolMessage(button, r) {
  const line = button.closest(".module")?.querySelector(".card-msg");
  if (!line) return;
  line.textContent = r?.text ?? (r ? "" : t("noMedia"));
  line.classList.toggle("error", !r?.ok);
  line.hidden = !line.textContent;
}

function toolButton(ic, label, action, extra) {
  const b = el("button", { type: "button", className: "chip" }, icon(ic), label);
  b.addEventListener("click", async () => showToolMessage(b, await toolAction(action, extra)));
  return b;
}

function buildTransport() {
  const { formatTime } = AVFX;
  const position = el("div", { className: "tool-status", textContent: "–" });
  const drmNote = el("div", { className: "notice", hidden: true, textContent: t("toolsDrmNote") });
  const info = el("div", { className: "hint", hidden: true });

  toolView(position, (st) => {
    drmNote.hidden = !st?.drm;
    position.textContent = st
      ? `${formatTime(st.time)} / ${formatTime(st.duration)} · ${t(st.paused ? "paused" : "playing")}`
      : t("noMediaPlaying");
  });
  toolView(info, (st) => {
    const v = st?.video;
    info.hidden = !v;
    if (v) {
      info.textContent =
        (v.total === null ? t("videoSize", v.width, v.height) : t("videoInfo", v.width, v.height, v.dropped, v.total)) +
        (v.fps ? ` · ${t("videoFps", AVFX.formatNumber(v.fps, 3))}` : "");
    }
  });

  // One row of equal buttons like the sidebar's timeline: the jumps show their seconds,
  // the others only their icon, the name is the tooltip.
  const compact = (ic, label, action, extra, text = "") => {
    const b = toolButton(ic, text, action, extra);
    b.title = label;
    b.setAttribute("aria-label", label);
    return b;
  };
  const buttons = el(
    "div",
    { className: "toggles segmented transport" },
    compact("seekBack", t("seekBack"), "seek", { seconds: -10 }, "−10"),
    compact("frameBack", t("frameBack"), "frame", { dir: -1 }),
    compact("playPause", t("playPause"), "play"),
    compact("frameFwd", t("frameFwd"), "frame", { dir: 1 }),
    compact("seekFwd", t("seekForward"), "seek", { seconds: 10 }, "+10")
  );

  return { position: () => [drmNote, position], buttons: () => [buttons], videoInfo: () => [info] };
}

function buildLoop() {
  const { formatTime } = AVFX;
  const loopInfo = el("div", { className: "hint" });
  const repeat = toolButton("repeat", t("repeatAll"), "loop-all");
  toolView(loopInfo, (st) => {
    repeat.setAttribute("aria-pressed", String(Boolean(st?.loopAll)));
    if (!st) loopInfo.textContent = "";
    else if (st.loopA === null) loopInfo.textContent = t("noLoop");
    else if (st.loopB === null) loopInfo.textContent = t("loopASet", formatTime(st.loopA));
    else loopInfo.textContent = t("loopRepeating", formatTime(st.loopA), formatTime(st.loopB));
  });
  return {
    setA: () => [toolButton("loop", t("setA"), "loop-a")],
    setB: () => [toolButton("loop", t("setB"), "loop-b")],
    loopOff: () => [toolButton("reset", t("off"), "loop-clear")],
    repeat: () => [repeat],
    loopInfo: () => [loopInfo],
  };
}

function buildSleep() {
  const sleepInfo = el("div", { className: "hint" });
  const chips = new Map(); // minutes -> chip
  for (const minutes of SLEEP_MINUTES) {
    const chip = el("button", { type: "button", className: "chip", textContent: t("minutes", minutes) });
    chip.addEventListener("click", async () => {
      sleepChosen = minutes;
      showToolMessage(chip, await toolAction("sleep", { minutes }));
    });
    chips.set(minutes, chip);
  }
  const row = el("div", { className: "toggles segmented", style: "--seg: 56px" }, ...chips.values(), toolButton("reset", t("off"), "sleep", { minutes: 0 }));
  toolView(row, (st) => {
    const left = st?.sleepLeft;
    sleepInfo.textContent = left == null ? t("sleepInactive") : t("sleepLeft", AVFX.formatTime(left / 1000).replace(/\.\d$/, ""));
    for (const [minutes, chip] of chips) chip.setAttribute("aria-pressed", String(left != null && sleepChosen === minutes));
  });
  return { sleepChips: () => [row], sleepInfo: () => [sleepInfo] };
}

function buildScreenshot() {
  return { saveFrame: () => [toolButton("camera", t("saveFrame"), "screenshot")] };
}

function buildShortcuts() {
  const list = el("div", { className: "shortcut-list" });
  browser.commands.getAll().then((cmds) => {
    list.replaceChildren(
      ...cmds.map((c) =>
        el(
          "div",
          { className: "shortcut" },
          el("span", { textContent: c.name === "_execute_action" ? t("openPanel") : c.description }),
          el("kbd", { textContent: c.shortcut || "–" })
        )
      )
    );
  });

  // Firefox has openShortcutSettings(); in Chrome extensions may open the settings page.
  const edit = el("button", { type: "button", className: "chip" }, icon("keyboard"), t("changeShortcuts"));
  edit.addEventListener("click", () =>
    AVFX.IS_FIREFOX
      ? browser.commands.openShortcutSettings()
      : browser.tabs.create({ url: "chrome://extensions/shortcuts" })
  );
  // The compact popup folds the list away.
  const shown = IN_SIDEBAR
    ? list
    : el("details", { className: "shortcut-details" }, el("summary", { textContent: t("showShortcuts") }), list);
  return { list: () => [shown], edit: () => [edit] };
}
