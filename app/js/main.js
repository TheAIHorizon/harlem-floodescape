/* main — boot, hash router, header controls, dialogs, toasts (PRD §6.2). */
import { store } from "./state.js";
import { loadKey, saveKey } from "./storage.js";
import { initI18n, setLang, getLang, t, applyLang } from "./i18n.js";
import { el } from "./dom.js";
import { startLiveFeeds } from "./live-feeds.js";
import { initHomeView } from "./home-view.js";
import { initScenarioUI } from "./scenario-player.js";
import { initMapView } from "./map-view.js";
import { initReportView } from "./report-view.js";
import { initPlanView } from "./plan-view.js";

const VIEWS = ["home", "map", "report", "plan"];

function currentRoute() {
  const h = location.hash.replace(/^#\//, "");
  return VIEWS.includes(h) ? h : "home";
}

function route() {
  const active = currentRoute();
  for (const v of VIEWS) {
    const section = document.getElementById(`view-${v}`);
    const tab = document.getElementById(`tab-${v}`);
    const on = v === active;
    section.hidden = !on;
    if (on) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  }
  store.set("route", active);
  // move focus to the view heading for screen-reader/keyboard users
  const h1 = document.querySelector(`#view-${active} h1`);
  if (h1) h1.focus({ preventScroll: false });
}

/* ---- toasts & announcements ---- */
export function toast(message) {
  const region = document.getElementById("toast-region");
  const node = el("div", { class: "toast", role: "status" }, message);
  region.append(node);
  setTimeout(() => node.remove(), 5000);
  announce(message, false);
}

export function announce(message, assertive = false) {
  const region = document.getElementById(assertive ? "live-assertive" : "live-polite");
  region.textContent = "";
  // brief delay so repeated identical messages still announce
  setTimeout(() => {
    region.textContent = message;
  }, 50);
}

/* ---- accessible confirm dialog (never window.confirm, PRD §8) ---- */
export function confirmDialog(title, body) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("confirm-dialog");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    const yes = document.getElementById("confirm-yes");
    const no = document.getElementById("confirm-no");
    const done = (val) => {
      dlg.close();
      yes.removeEventListener("click", onYes);
      no.removeEventListener("click", onNo);
      resolve(val);
    };
    const onYes = () => done(true);
    const onNo = () => done(false);
    yes.addEventListener("click", onYes);
    no.addEventListener("click", onNo);
    dlg.addEventListener("cancel", () => done(false), { once: true });
    dlg.showModal();
  });
}

/* ---- header controls ---- */
function initHeader() {
  const langBtn = document.getElementById("lang-toggle");
  const langLabel = document.getElementById("lang-toggle-label");
  const syncLangBtn = () => {
    // button shows the language you would switch TO
    langLabel.textContent = getLang() === "en" ? t("lang.es") : t("lang.en");
  };
  langBtn.addEventListener("click", () => {
    setLang(getLang() === "en" ? "es" : "en");
    syncLangBtn();
  });
  store.subscribe("lang", syncLangBtn);
  syncLangBtn();

  const themeBtn = document.getElementById("theme-toggle");
  const savedTheme = loadKey("theme", null);
  if (savedTheme) document.documentElement.dataset.theme = savedTheme;
  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    saveKey("theme", next);
  });

  const aboutDlg = document.getElementById("about-dialog");
  document.getElementById("about-open").addEventListener("click", () => aboutDlg.showModal());
  for (const btn of document.querySelectorAll(".dialog-close")) {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  }
}

function initFirstRun() {
  if (loadKey("firstRunDone", false)) return;
  const dlg = document.getElementById("firstrun-dialog");
  document.getElementById("firstrun-accept").addEventListener("click", () => {
    saveKey("firstRunDone", true);
    dlg.close();
  }, { once: true });
  dlg.showModal();
}

/* ---- boot ---- */
async function boot() {
  await initI18n();
  store.set("mode", "live");
  store.set("reports", loadKey("reports", []));
  store.set("sensorStates", {});

  initHeader();
  window.addEventListener("hashchange", route);

  await initScenarioUI();
  initHomeView(document.getElementById("view-home"));
  await initMapView(document.getElementById("view-map"));
  initReportView(document.getElementById("report-mount"));
  initPlanView(document.getElementById("plan-mount"));

  applyLang(); // re-translate everything views just rendered
  route();
  initFirstRun();
  startLiveFeeds();
}

boot().catch((e) => {
  console.error("boot failed", e);
  const main = document.getElementById("main");
  main.textContent = "";
  main.append(el("p", { class: "card", role: "alert" },
    "Failed to start. Please serve the app over http (see Start FloodEscape.bat) and reload."));
});
