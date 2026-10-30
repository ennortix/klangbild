// DOM helpers shared by the popup and the analyzer window.

const $ = (id) => document.getElementById(id);

const t = AVFX.t;

// Fills static HTML from _locales/: data-i18n sets the text, data-i18n-title the tooltip.
function localizePage() {
  document.documentElement.lang = browser.i18n.getUILanguage();
  for (const node of document.querySelectorAll("[data-i18n]")) node.textContent = t(node.dataset.i18n);
  for (const node of document.querySelectorAll("[data-i18n-title]")) node.title = t(node.dataset.i18nTitle);
}

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
