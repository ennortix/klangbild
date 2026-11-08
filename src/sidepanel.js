// Chrome only, left out of the Firefox build (scripts/build.mjs): the "sidebar" shortcut
// opens the side panel. Firefox opens its sidebar itself (_execute_sidebar_action).
chrome.commands.onCommand.addListener((command, tab) => {
  // only within the shortcut's user gesture, so before anything is awaited
  if (command === "sidebar" && tab) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch((e) => console.warn("[Klangbild] Side panel:", e));
  }
});
