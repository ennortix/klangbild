// A-B loop, repeat, frame stepping, seeking, sleep timer, screenshot, video info and
// the keyboard shortcut overview.

const SLEEP_MINUTES = [15, 30, 60, 90];

function renderTools() {
  const { formatTime } = AVFX;
  const position = el("div", { className: "tool-status", textContent: "–" });
  const info = el("div", { className: "hint", hidden: true });
  const loopInfo = el("div", { className: "hint" });
  const sleepInfo = el("div", { className: "hint" });
  const sleepChips = new Map(); // minutes -> chip
  const message = el("div", { className: "hint" });
  const drmNote = el("div", {
    className: "notice",
    hidden: true,
    textContent: t("toolsDrmNote"),
  });

  function showState(st) {
    drmNote.hidden = !st?.drm;
    repeat.setAttribute("aria-pressed", String(Boolean(st?.loopAll)));
    sleepInfo.textContent = st?.sleepLeft == null ? t("sleepInactive") : t("sleepLeft", formatTime(st.sleepLeft / 1000).replace(/\.\d$/, ""));
    for (const [minutes, chip] of sleepChips) chip.setAttribute("aria-pressed", String(st?.sleepLeft != null && sleepChosen === minutes));
    const v = st?.video;
    info.hidden = !v;
    if (v) {
      info.textContent =
        (v.total === null ? t("videoSize", v.width, v.height) : t("videoInfo", v.width, v.height, v.dropped, v.total)) +
        (v.fps ? ` · ${t("videoFps", AVFX.formatNumber(v.fps, 3))}` : "");
    }
    if (!st) {
      position.textContent = t("noMediaPlaying");
      loopInfo.textContent = "";
      return;
    }
    position.textContent = `${formatTime(st.time)} / ${formatTime(st.duration)} · ${t(st.paused ? "paused" : "playing")}`;
    if (st.loopA === null) loopInfo.textContent = t("noLoop");
    else if (st.loopB === null) loopInfo.textContent = t("loopASet", formatTime(st.loopA));
    else loopInfo.textContent = t("loopRepeating", formatTime(st.loopA), formatTime(st.loopB));
  }

  async function run(action, extra = {}) {
    const r = await sendToPrimary({ type: "action", action, ...extra });
    showState(r?.state);
    if (action === "state") return;
    message.textContent = r?.text ?? (r ? "" : t("noMedia"));
    message.classList.toggle("error", !r?.ok);
  }

  const btn = (ic, label, action, extra) => {
    const b = el("button", { type: "button", className: "chip" }, icon(ic), label);
    b.addEventListener("click", () => run(action, extra));
    return b;
  };

  const repeat = btn("repeat", t("repeatAll"), "loop-all");

  // The page only knows the time left, so the chosen chip is remembered here.
  let sleepChosen = null;
  for (const minutes of SLEEP_MINUTES) {
    const chip = el("button", { type: "button", className: "chip", textContent: t("minutes", minutes) });
    chip.addEventListener("click", () => {
      sleepChosen = minutes;
      run("sleep", { minutes });
    });
    sleepChips.set(minutes, chip);
  }
  const sleepOff = btn("reset", t("off"), "sleep", { minutes: 0 });

  async function poll() {
    if (activeSection === "extras" && tabId !== null && !document.hidden) await run("state");
    setTimeout(poll, 400);
  }
  poll();

  // In the sidebar the timeline above the tabs has the position and these buttons.
  const transport = el(
    "div",
    { className: "toggles" },
    btn("seekBack", t("seekBack"), "seek", { seconds: -10 }),
    btn("frameBack", t("frameBack"), "frame", { dir: -1 }),
    btn("playPause", t("playPause"), "play"),
    btn("frameFwd", t("frameFwd"), "frame", { dir: 1 }),
    btn("seekFwd", t("seekForward"), "seek", { seconds: 10 })
  );

  return [
    drmNote,
    ...(IN_SIDEBAR ? [info] : [position, info, transport]),
    el("div", { className: "group-title" }, icon("loop"), t("abLoop")),
    el(
      "div",
      { className: "toggles" },
      btn("loop", t("setA"), "loop-a"),
      btn("loop", t("setB"), "loop-b"),
      btn("reset", t("off"), "loop-clear"),
      repeat
    ),
    loopInfo,
    el("div", { className: "group-title" }, icon("sleep"), t("sleepTimer")),
    el("div", { className: "toggles" }, ...sleepChips.values(), sleepOff),
    sleepInfo,
    el("div", { className: "group-title" }, icon("camera"), t("screenshot")),
    el("div", { className: "toggles" }, btn("camera", t("saveFrame"), "screenshot")),
    message,
  ];
}

function renderShortcuts() {
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
  return [shown, el("div", { className: "toggles" }, edit)];
}
