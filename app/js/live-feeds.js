/* live-feeds — NWS alerts, Open-Meteo rain, FloodNet deployments (PRD §5.3).
 * Fetches never block the UI; failures mark the feed "unavailable".
 * Live FloodNet water depth is not public — sensor positions/status only;
 * depths animate during replays from recorded data.
 */
import { store } from "./state.js";

const EH_POINT = "40.79,-73.945";
const TIMEOUT_MS = 8000;
const RETRY_DELAYS = [15_000, 60_000, 300_000];
const REFRESH_MS = 5 * 60_000;

async function fetchJson(url, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function setFeed(name, value) {
  const feeds = { ...(store.get("feeds") || {}) };
  feeds[name] = value;
  store.set("feeds", feeds);
}

async function withRetries(name, fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (e) {
      if (attempt >= RETRY_DELAYS.length) {
        setFeed(name, { state: "unavailable" });
        return;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }
}

async function pollNws() {
  await withRetries("nws", async () => {
    const data = await fetchJson(
      `https://api.weather.gov/alerts/active?point=${EH_POINT}`,
      { Accept: "application/geo+json" }
    );
    const feats = data.features || [];
    const events = feats.map((f) => (f.properties?.event || "").toLowerCase());
    const warning = events.some((e) => e.includes("flash flood warning") || e.includes("flood warning"));
    const watch = events.some((e) => e.includes("flood watch") || e.includes("flash flood watch"));
    const headline = feats[0]?.properties?.headline || null;
    setFeed("nws", { state: "ok", warning, watch, headline, count: feats.length });
  });
}

async function pollRain() {
  await withRetries("rain", async () => {
    const data = await fetchJson(
      "https://api.open-meteo.com/v1/forecast?latitude=40.79&longitude=-73.945&minutely_15=precipitation&forecast_minutely_15=4&timezone=America%2FNew_York"
    );
    const vals = data.minutely_15?.precipitation || [];
    const nextHourMm = vals.slice(0, 4).reduce((a, b) => a + (b || 0), 0);
    setFeed("rain", { state: "ok", nextHourIn: nextHourMm / 25.4 });
  });
}

async function pollFloodnet() {
  await withRetries("floodnet", async () => {
    const data = await fetchJson("https://api.floodnet.nyc/api/rest/deployments/flood");
    const deployments = (data.deployments || [])
      .filter((d) => d.location?.coordinates?.length === 2)
      .map((d) => ({
        id: d.deployment_id,
        name: d.name,
        lat: d.location.coordinates[1],
        lon: d.location.coordinates[0],
        status: d.sensor_status || "unknown",
      }));
    setFeed("floodnet", { state: "ok", deployments });
  });
}

export function startLiveFeeds() {
  store.set("feeds", {
    nws: { state: "loading" },
    rain: { state: "loading" },
    floodnet: { state: "loading" },
  });
  const runAll = () => {
    pollNws();
    pollRain();
    pollFloodnet();
  };
  runAll();
  setInterval(runAll, REFRESH_MS);
}
