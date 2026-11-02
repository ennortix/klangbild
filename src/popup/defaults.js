// "Default for all sites" (storage.local AVFX.DEFAULTS_KEY): what sites without
// their own remembered settings start with. Also opens the options page.

function renderDefaults() {
  const status = el("div", { className: "hint" });
  const use = el("button", { type: "button", className: "chip" }, icon("save"), t("useAsDefault"));
  const clear = el("button", { type: "button", className: "chip" }, icon("trash"), t("removeDefault"));
  const manage = el("button", { type: "button", className: "chip" }, icon("tools"), t("manageData"));

  function show(stored) {
    status.textContent = t(stored ? "defaultActive" : "defaultNone");
    clear.hidden = !stored;
  }

  use.addEventListener("click", async () => {
    const { enabled, ...values } = settings;
    await browser.storage.local.set({ [AVFX.DEFAULTS_KEY]: values });
    show(true);
  });
  clear.addEventListener("click", async () => {
    await browser.storage.local.remove(AVFX.DEFAULTS_KEY);
    show(false);
  });
  manage.addEventListener("click", () => browser.runtime.openOptionsPage());

  browser.storage.local.get(AVFX.DEFAULTS_KEY).then((r) => show(Boolean(r[AVFX.DEFAULTS_KEY])));

  return [status, el("div", { className: "toggles" }, use, clear, manage)];
}
