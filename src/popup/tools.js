// A-B loop, frame stepping, screenshot and the keyboard shortcut overview.

function renderTools() {
  const { formatTime } = AVFX;
  const position = el("div", { className: "tool-status", textContent: "–" });
  const loopInfo = el("div", { className: "hint" });
  const message = el("div", { className: "hint" });
  const drmNote = el("div", {
    className: "notice",
    hidden: true,
    textContent: t("toolsDrmNote"),
  });

  function showState(st) {
    drmNote.hidden = !st?.drm;
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
      btn("frameBack", t("frameBack"), "frame", { dir: -1 }),
      btn("playPause", t("playPause"), "play"),
      btn("frameFwd", t("frameFwd"), "frame", { dir: 1 })
    ),
    el("div", { className: "group-title" }, icon("loop"), t("abLoop")),
    el(
      "div",
      { className: "toggles" },
      btn("loop", t("setA"), "loop-a"),
      btn("loop", t("setB"), "loop-b"),
      btn("reset", t("off"), "loop-clear")
    ),
    loopInfo,
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
  return [list, el("div", { className: "toggles" }, edit)];
}
