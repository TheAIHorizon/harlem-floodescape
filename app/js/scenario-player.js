/* scenario-player — deterministic replay of recorded/simulated events (PRD F-5.*).
 * A scenario is a sorted event timeline; playback advances a virtual clock at
 * selectable speed and applies every event whose time has passed. Seeking
 * rebuilds state from t0, so replays are fully deterministic (F-5.4).
 */
import { store } from "./state.js";
import { t, fmtDate } from "./i18n.js";
import { el } from "./dom.js";
import { refreshStatus } from "./home-view.js";

const SCENARIOS = [
  { id: "oct30-2025", nameKey: "scenario.oct30.name", descKey: "scenario.oct30.desc", kind: "recorded" },
  { id: "may20-2026", nameKey: "scenario.may20.name", descKey: "scenario.may20.desc", kind: "recorded" },
  { id: "eh-simulation", nameKey: "scenario.ehsim.name", descKey: "scenario.ehsim.desc", kind: "simulated" },
];

let def = null;          // loaded scenario JSON
let virtualMs = 0;       // current scenario time (ms epoch)
let startMs = 0;
let endMs = 0;
let playing = false;
let speed = 60;
let rafId = null;
let lastWall = 0;
let appliedIdx = 0;      // events [0, appliedIdx) applied
let complaintsBuf = [];  // applied complaint events (map layer reads this)

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function publish() {
  store.set("scenario", {
    id: def.id,
    kind: def.kind,
    t: virtualMs,
    playing,
    speed,
    startMs,
    endMs,
    // label the replay with the first real event's (local) date, not the
    // GMT window start, which falls on the prior evening in New York
    labelMs: def.bookmarks?.length ? Date.parse(def.bookmarks[0].t) : startMs,
    alertLevel: currentAlertLevel,
    bounds: def.bounds,
    complaints: complaintsBuf,
  });
}

let currentAlertLevel = null;

function resetState() {
  appliedIdx = 0;
  complaintsBuf = [];
  currentAlertLevel = null;
  store.set("sensorStates", {});
}

/** Apply all events with time <= virtualMs (from appliedIdx forward). */
function applyUpTo() {
  const events = def.events;
  const sensorStates = { ...(store.get("sensorStates") || {}) };
  let sensorsChanged = false;
  while (appliedIdx < events.length) {
    const ev = events[appliedIdx];
    const evMs = Date.parse(ev.t);
    if (evMs > virtualMs) break;
    if (ev.type === "sensor") {
      sensorStates[ev.sensorId] = { depthIn: ev.depthIn, phase: ev.phase };
      sensorsChanged = true;
    } else if (ev.type === "alert") {
      currentAlertLevel = ev.level;
    } else if (ev.type === "complaint") {
      complaintsBuf.push(ev);
    }
    appliedIdx++;
  }
  if (sensorsChanged) store.set("sensorStates", sensorStates);
}

function tick(wallNow) {
  if (!playing) return;
  const dt = wallNow - lastWall;
  lastWall = wallNow;
  virtualMs += dt * speed;
  if (virtualMs >= endMs) {
    virtualMs = endMs;
    playing = false;
  }
  applyUpTo();
  publish();
  refreshStatus();
  if (playing) rafId = requestAnimationFrame(tick);
}

export async function loadScenario(id) {
  const res = await fetch(`data/scenario_${id}.json`);
  if (!res.ok) throw new Error(`scenario ${id}: HTTP ${res.status}`);
  def = await res.json();
  startMs = Date.parse(def.start);
  endMs = Date.parse(def.end);
  virtualMs = startMs;
  playing = false;
  resetState();
  applyUpTo();
  store.set("mode", "scenario");
  publish();
  refreshStatus();
}

export function play() {
  if (!def || playing) return;
  playing = true;
  lastWall = performance.now();
  if (reducedMotion()) {
    // discrete jumps: advance bookmark-to-bookmark instead of animating
    playing = false;
    const next = def.bookmarks.map((b) => Date.parse(b.t)).find((ms) => ms > virtualMs);
    seek(next ?? endMs);
    return;
  }
  rafId = requestAnimationFrame(tick);
  publish();
}

export function pause() {
  playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  publish();
}

export function setSpeed(x) {
  speed = Number(x) || 60;
  publish();
}

export function seek(ms) {
  if (!def) return;
  ms = Math.min(Math.max(ms, startMs), endMs);
  if (ms < virtualMs) {
    // rewind: rebuild deterministically from the start
    resetState();
    virtualMs = ms;
    applyUpTo();
  } else {
    virtualMs = ms;
    applyUpTo();
  }
  publish();
  refreshStatus();
}

export function exitScenario() {
  pause();
  def = null;
  resetState();
  store.set("scenario", null);
  store.set("mode", "live");
  refreshStatus();
}

/* ---- UI: picker options + watermark transport bar ---- */
export async function initScenarioUI() {
  const optionsMount = document.getElementById("scenario-options");
  const dlg = document.getElementById("demo-dialog");

  function renderOptions() {
    optionsMount.textContent = "";
    for (const sc of SCENARIOS) {
      optionsMount.append(
        el("button", {
          class: "btn scenario-option", type: "button",
          onClick: async () => {
            dlg.close();
            await loadScenario(sc.id);
            play();
          },
        },
          el("span", { class: "scen-name" },
            t(sc.nameKey), " ",
            el("span", { class: `chip ${sc.kind === "simulated" ? "chip-simulation" : "chip-recorded"}` },
              t(sc.kind === "simulated" ? "provenance.simulation" : "provenance.recorded"))),
          el("span", { class: "scen-desc" }, t(sc.descKey)))
      );
    }
  }
  renderOptions();
  store.subscribe("lang", renderOptions);

  // watermark + transport
  const wm = document.getElementById("watermark");
  const wmText = document.getElementById("watermark-text");
  const wmTime = document.getElementById("scen-time");
  const playBtn = document.getElementById("scen-playpause");
  const speedSel = document.getElementById("scen-speed");
  const scrub = document.getElementById("scen-scrub");
  const exitBtn = document.getElementById("scen-exit");

  playBtn.addEventListener("click", () => {
    const sc = store.get("scenario");
    if (sc?.playing) pause();
    else play();
  });
  speedSel.addEventListener("change", () => setSpeed(speedSel.value));
  scrub.addEventListener("input", () => {
    const sc = store.get("scenario");
    if (!sc) return;
    const ms = sc.startMs + (Number(scrub.value) / 1000) * (sc.endMs - sc.startMs);
    seek(ms);
  });
  exitBtn.addEventListener("click", exitScenario);

  function syncTransport() {
    const sc = store.get("scenario");
    const inScenario = store.get("mode") === "scenario" && sc;
    wm.hidden = !inScenario;
    if (!inScenario) return;
    const dateStr = fmtDate(new Date(sc.labelMs || sc.startMs), { year: "numeric", month: "short", day: "numeric" });
    wmText.textContent = sc.kind === "simulated"
      ? t("demo.watermarkSimulation")
      : t("demo.watermarkRecorded", { date: dateStr });
    wmTime.textContent = fmtDate(new Date(sc.t), { hour: "numeric", minute: "2-digit" });
    // play/pause icon swap
    playBtn.textContent = "";
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", sc.playing ? "#i-pause" : "#i-play");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.append(use);
    playBtn.append(svg);
    playBtn.setAttribute("aria-label", t(sc.playing ? "demo.pause" : "demo.play"));
    if (document.activeElement !== scrub) {
      scrub.value = Math.round(((sc.t - sc.startMs) / Math.max(sc.endMs - sc.startMs, 1)) * 1000);
    }
    speedSel.value = String(sc.speed);
  }
  store.subscribe("scenario", syncTransport);
  store.subscribe("mode", syncTransport);
  store.subscribe("lang", syncTransport);
}
