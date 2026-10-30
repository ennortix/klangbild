// A-B loop, frame stepping, screenshot and the keyboard shortcut overview.

function renderTools() {
  const { formatTime } = AVFX;
  const position = el("div", { className: "tool-status", textContent: "–" });
  const loopInfo = el("div", { className: "hint" });
  const message = el("div", { className: "hint" });
  const drmNote = el("div", {
    className: "notice",
    hidden: true,
    textContent:
      "Copy-protected video (DRM): screenshot, analyzer, audio effects and picture delay aren't possible here. Speed, video filters, loop and frame stepping work.",
  });

  function showState(st) {
    drmNote.hidden = !st?.drm;
    if (!st) {
      position.textContent = "No video/audio found – is anything playing yet?";
      loopInfo.textContent = "";
      return;
    }
    position.textContent = `${formatTime(st.time)} / ${formatTime(st.duration)} · ${st.paused ? "paused" : "playing"}`;
    if (st.loopA === null) loopInfo.textContent = "No loop active.";
    else if (st.loopB === null) loopInfo.textContent = `A = ${formatTime(st.loopA)} – now set B.`;
    else loopInfo.textContent = `Repeating ${formatTime(st.loopA)} → ${formatTime(st.loopB)}`;
  }

  async function run(action, extra = {}) {
    const r = await sendToPrimary({ type: "action", action, ...extra });
    showState(r?.state);
    if (action === "state") return;
    message.textContent = r?.text ?? (r ? "" : "No video/audio found");
    message.classList.toggle("error", !r?.ok);
  }

  const btn = (ic, label, action, extra) => {
    const b = el("button", { type: "button", className: "chip" }, icon(ic), label);
    b.addEventListener("click", () => run(action, extra));
    return b;
  };

  async function poll() {
    if (activeSection === "extras" && tabId !== null && !document.hidden) await run("state");
    setTimeout(poll, 400);
  }
  poll();

  return [
    drmNote,
    position,
    el(
      "div",
      { className: "toggles" },
      btn("frameBack", "Back", "frame", { dir: -1 }),
      btn("playPause", "Play/Pause", "play"),
      btn("frameFwd", "Forward", "frame", { dir: 1 })
    ),
    el("div", { className: "group-title" }, icon("loop"), "A-B loop"),
    el(
      "div",
      { className: "toggles" },
      btn("loop", "Set A", "loop-a"),
      btn("loop", "Set B", "loop-b"),
      btn("reset", "Off", "loop-clear")
    ),
    loopInfo,
    el("div", { className: "group-title" }, icon("camera"), "Screenshot"),
    el("div", { className: "toggles" }, btn("camera", "Save frame (PNG)", "screenshot")),
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
          el("span", { textContent: c.name === "_execute_action" ? "Open panel" : c.description }),
          el("kbd", { textContent: c.shortcut || "–" })
        )
      )
    );
  });

  // Firefox has openShortcutSettings(); in Chrome extensions may open the settings page.
  const edit = el("button", { type: "button", className: "chip" }, icon("keyboard"), "Change shortcuts");
  edit.addEventListener("click", () =>
    AVFX.IS_FIREFOX
      ? browser.commands.openShortcutSettings()
      : browser.tabs.create({ url: "chrome://extensions/shortcuts" })
  );
  return [list, el("div", { className: "toggles" }, edit)];
}
