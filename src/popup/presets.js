// Built-in presets (AVFX.PRESETS) and user presets stored in storage.local "presets".

let userPresets = []; // [{ name, settings }]

function renderPresets() {
  const builtins = el(
    "div",
    { className: "toggles" },
    ...AVFX.PRESETS.map((p) => {
      const chip = el("button", { type: "button", className: "chip" }, icon(p.icon), t(`preset_${p.id}`));
      chip.addEventListener("click", () => applyPreset(p.patch, { keepPlayback: true }));
      return chip;
    })
  );

  const list = el("div", { className: "preset-list" });
  const name = el("input", { type: "text", placeholder: t("presetNamePlaceholder"), maxLength: 40 });
  const save = el("button", { type: "button", className: "chip" }, icon("save"), t("save"));

  const persist = () => browser.storage.local.set({ presets: userPresets });

  function renderList() {
    if (!userPresets.length) {
      list.replaceChildren(el("div", { className: "hint", textContent: t("noCustomPresets") }));
      return;
    }
    list.replaceChildren(
      ...userPresets.map((p) => {
        const apply = el("button", { type: "button", className: "preset-apply" }, icon("preset"), p.name);
        const del = el("button", { type: "button", className: "icon-btn", title: t("delete") }, icon("trash"));
        apply.addEventListener("click", () => applyPreset(p.settings, { keepPlayback: false }));
        del.addEventListener("click", () => {
          userPresets = userPresets.filter((x) => x !== p);
          persist();
          renderList();
        });
        return el("div", { className: "preset-item" }, apply, del);
      })
    );
  }

  function saveCurrent() {
    const label = name.value.trim() || t("presetDefaultName", userPresets.length + 1);
    const { enabled, ...values } = settings;
    userPresets = [...userPresets.filter((p) => p.name !== label), { name: label, settings: values }];
    persist();
    renderList();
    name.value = "";
  }

  save.addEventListener("click", saveCurrent);
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveCurrent();
  });

  browser.storage.local.get("presets").then((r) => {
    userPresets = r.presets ?? [];
    renderList();
  });

  return [
    builtins,
    el("div", { className: "group-title" }, icon("save"), t("customPresets")),
    list,
    el("div", { className: "preset-save" }, name, save),
  ];
}
