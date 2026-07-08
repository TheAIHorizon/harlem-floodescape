/* i18n — bilingual EN/ES with full parity (PRD §7).
 * Strings live in i18n/en.json and i18n/es.json; the test suite enforces
 * identical key sets. Missing keys fail loudly and fall back to English.
 */
import { store } from "./state.js";
import { loadKey, saveKey } from "./storage.js";

const dicts = { en: null, es: null };
let lang = "en";

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export async function initI18n() {
  const [en, es] = await Promise.all([
    fetch("i18n/en.json").then((r) => r.json()),
    fetch("i18n/es.json").then((r) => r.json()),
  ]);
  dicts.en = flatten(en);
  dicts.es = flatten(es);
  const saved = loadKey("lang", null);
  if (saved === "en" || saved === "es") {
    lang = saved;
  } else {
    lang = (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
  }
  applyLang();
}

export function getLang() {
  return lang;
}

/** Translate a key; {placeholders} filled from params. */
export function t(key, params) {
  let s = dicts[lang]?.[key];
  if (s === undefined) {
    console.error(`i18n: missing key "${key}" in ${lang}`);
    s = dicts.en?.[key] ?? `⚠︎${key}`;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

export function setLang(next) {
  if (next !== "en" && next !== "es") return;
  lang = next;
  saveKey("lang", lang);
  applyLang();
}

/** Re-translate every tagged node in the live DOM and update <html lang>. */
export function applyLang() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of document.querySelectorAll("[data-i18n-aria-label]")) {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  }
  for (const node of document.querySelectorAll("[data-i18n-placeholder]")) {
    node.setAttribute("placeholder", t(node.dataset.i18nPlaceholder));
  }
  for (const node of document.querySelectorAll("[data-i18n-title]")) {
    node.setAttribute("title", t(node.dataset.i18nTitle));
  }
  store.set("lang", lang);
}

export function fmtDate(d, opts) {
  const locale = lang === "es" ? "es-US" : "en-US";
  return new Intl.DateTimeFormat(locale, opts || {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(d);
}

export function fmtNum(n, opts) {
  const locale = lang === "es" ? "es-US" : "en-US";
  return new Intl.NumberFormat(locale, opts).format(n);
}

/** inches → "18 in (45 cm)" bilingual-safe depth string */
export function fmtDepth(inches) {
  const cm = Math.round(inches * 2.54);
  return `${fmtNum(Math.round(inches * 10) / 10)} ${t("common.in")} (${fmtNum(cm)} ${t("common.cm")})`;
}
