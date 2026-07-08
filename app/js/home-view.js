/* home-view — status card, context strip, next action, demo entry (PRD F-1.*). */
import { store } from "./state.js";
import { t, fmtDate, fmtDepth, fmtNum } from "./i18n.js";
import { el, icon, clear } from "./dom.js";
import { computeStatus } from "./status-engine.js";
import { announce } from "./main.js";

const STATUS_ICON = { CALM: "i-check", WATCH: "i-eye", WARNING: "i-warn", DANGER: "i-warn" };

function reportsLast3h() {
  const cutoff = Date.now() - 3 * 3600_000;
  return (store.get("reports") || []).filter((r) => r.t >= cutoff).length;
}

function maxScenarioDepth() {
  const states = store.get("sensorStates") || {};
  let max = 0;
  for (const s of Object.values(states)) {
    if (s.depthIn > max) max = s.depthIn;
  }
  return max;
}

/** Recompute global status from feeds + sensors + reports + scenario. */
export function refreshStatus() {
  const feeds = store.get("feeds") || {};
  const scenario = store.get("scenario");
  const inScenario = store.get("mode") === "scenario";
  const inputs = inScenario
    ? {
        scenarioLevel: scenario?.alertLevel || null,
        maxSensorDepthIn: maxScenarioDepth(),
        reportsLast3h: 0,
      }
    : {
        nwsWarning: feeds.nws?.state === "ok" && feeds.nws.warning,
        nwsWatch: feeds.nws?.state === "ok" && feeds.nws.watch,
        maxSensorDepthIn: 0, // live depth not public (PRD §5.3)
        reportsLast3h: reportsLast3h(),
      };
  const { level, reasonKey } = computeStatus(inputs);
  const prev = store.get("status");
  const at = inScenario && scenario?.t ? scenario.t : Date.now();
  store.set("status", {
    level,
    reasonKey,
    source: inScenario ? "scenario" : feeds.nws?.state === "ok" ? "live" : "offline",
    at,
  });
  if (prev && prev.level !== level) {
    announce(`${t(`status.${level}.title`)} — ${t(`status.${level}.desc`)}`, true);
  }
}

export function initHomeView(root) {
  const cardMount = root.querySelector("#status-card-mount");
  const ctxMount = root.querySelector("#context-mount");
  const actionMount = root.querySelector("#home-action-mount");
  const demoMount = root.querySelector("#home-demo-mount");

  function renderCard() {
    const st = store.get("status") || { level: "CALM", reasonKey: "status.reason.calmDefault", source: "offline", at: Date.now() };
    clear(cardMount);
    const sourceKey = `status.source.${st.source}`;
    cardMount.append(
      el("div", { class: `status-card status-${st.level}`, role: "region", aria: { label: t("home.title") } },
        el("div", { class: "status-head" },
          el("span", { class: "status-icon" }, icon(STATUS_ICON[st.level], 34)),
          el("h2", { class: "status-title" }, t(`status.${st.level}.title`))
        ),
        el("p", { class: "status-desc" }, t(`status.${st.level}.desc`)),
        el("p", { class: "status-meta" },
          `${t(st.reasonKey)} · ${t(sourceKey)} · ${t("status.asOf")} ${fmtDate(new Date(st.at))}`)
      )
    );
  }

  function chip(state, kindKey) {
    const cls = { ok: "chip-live", loading: "chip-unavailable", unavailable: "chip-unavailable" }[state] || "chip-unavailable";
    const key = state === "ok" ? kindKey : "provenance.unavailable";
    return el("span", { class: `chip ${cls}` }, t(key));
  }

  function renderContext() {
    const feeds = store.get("feeds") || {};
    const inScenario = store.get("mode") === "scenario";
    clear(ctxMount);

    // rain
    const rain = feeds.rain || { state: "loading" };
    const rainVal = rain.state === "ok"
      ? rain.nextHourIn > 0.005
        ? `${fmtNum(Math.round(rain.nextHourIn * 100) / 100)} ${t("common.in")}`
        : t("home.context.rainNone")
      : t("common.unavailable");
    ctxMount.append(el("div", { class: "context-item" },
      el("span", { class: "label" }, t("home.context.rain"), " ", chip(rain.state, "provenance.live")),
      el("span", { class: "value" }, rainVal)));

    // nearest sensor / scenario max depth
    const depth = maxScenarioDepth();
    const sensorVal = inScenario
      ? depth > 0 ? fmtDepth(depth) : t("home.context.sensorDry")
      : feeds.floodnet?.state === "ok" ? t("home.context.sensorDry") : t("common.unavailable");
    ctxMount.append(el("div", { class: "context-item" },
      el("span", { class: "label" }, t("home.context.sensor"), " ",
        inScenario
          ? el("span", { class: "chip chip-recorded" }, t(store.get("scenario")?.kind === "simulated" ? "provenance.simulation" : "provenance.recorded"))
          : chip(feeds.floodnet?.state, "provenance.live")),
      el("span", { class: "value" }, sensorVal)));

    // reports
    ctxMount.append(el("div", { class: "context-item" },
      el("span", { class: "label" }, t("home.context.reports")),
      el("span", { class: "value" }, fmtNum(reportsLast3h()))));

    // NWS feed state
    const nws = feeds.nws || { state: "loading" };
    ctxMount.append(el("div", { class: "context-item" },
      el("span", { class: "label" }, t("home.context.alertFeed"), " ", chip(nws.state, "provenance.live")),
      el("span", { class: "value" },
        nws.state === "ok" ? (nws.headline || "OK") : t("common.unavailable"))));
  }

  function renderAction() {
    const st = store.get("status") || { level: "CALM" };
    clear(actionMount);
    const level = st.level;
    const [key, hash] = level === "CALM"
      ? ["home.action.calm", "#/plan"]
      : level === "WATCH"
        ? ["home.action.watch", "#/map"]
        : ["home.action.warning", "#/map"];
    actionMount.append(
      el("a", { class: "btn btn-primary btn-block", href: hash, style: null },
        icon(level === "CALM" ? "i-bag" : "i-map", 20),
        el("span", {}, t(key)))
    );
  }

  function renderDemo() {
    clear(demoMount);
    demoMount.append(
      el("button", {
        class: "btn btn-block", type: "button",
        aria: { label: t("home.demoButtonAria") },
        onClick: () => document.getElementById("demo-dialog").showModal(),
      }, icon("i-play", 20), el("span", {}, t("home.demoButton")))
    );
  }

  const renderAll = () => {
    renderCard();
    renderContext();
    renderAction();
    renderDemo();
  };

  store.subscribe("status", () => { renderCard(); renderAction(); });
  store.subscribe("feeds", () => { refreshStatus(); renderContext(); });
  store.subscribe("reports", () => { refreshStatus(); renderContext(); });
  store.subscribe("sensorStates", () => { refreshStatus(); renderContext(); });
  store.subscribe("mode", () => { refreshStatus(); renderAll(); });
  store.subscribe("lang", renderAll);

  refreshStatus();
  renderAll();
}
