/* map-view — Leaflet map, resource layers, sensors, reports, replay (PRD F-2.*).
 * All popup content is DOM-built (never HTML strings with dynamic data, §9.3).
 * Every map capability has a non-map twin: the list views below the map (§8).
 */
import { store } from "./state.js";
import { t, getLang, fmtDepth, fmtNum, fmtDate } from "./i18n.js";
import { el, icon, clear } from "./dom.js";
import { loadKey, saveKey } from "./storage.js";
import { toast } from "./main.js";

const EH_CENTER = [40.793, -73.944];
const TYPE_ICON = {
  hospital: "i-hospital", fire: "i-fire", police: "i-shield",
  shelter: "i-house", subway: "i-train", highground: "i-mountain",
};
const ROUTE_STYLE = {
  safe: { color: "#0e7a37", weight: 5 },
  standard: { color: "#8a6d00", weight: 4, dashArray: "8,6" },
  atRisk: { color: "#b45309", weight: 4, dashArray: "2,7" },
};

let map, poisData, sensorsData;
const groups = {};
let userMarker = null;
let actionLine = null;
let renderedComplaints = 0;
let tileErrorShown = false;
let fittedScenarioId = null;

function haversineMi(a, b) {
  const R = 3958.8;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function divIcon(cls, iconName, size) {
  const wrap = document.createElement("div");
  wrap.className = cls;
  if (iconName) wrap.append(icon(iconName, 16));
  return L.divIcon({ html: wrap, className: "", iconSize: [size, size], popupAnchor: [0, -size / 2] });
}

function riskBadge(risk) {
  return el("span", { class: `risk-badge risk-badge-${risk}` },
    `${t("map.popup.riskLabel")}: ${t(`map.risk.${risk}`)}`);
}

function petFlag(p) {
  const kind = p.petFriendly === true ? "yes" : p.petFriendly === false ? "no" : "unknown";
  const label = t(`map.pet.${kind}`) + (p.petSample ? ` (${t("map.pet.sample")})` : "");
  return el("span", { class: `pet-flag pet-${kind}` }, icon("i-paw", 14), label);
}

function poiPopup(p) {
  const name = p.name[getLang()] || p.name.en;
  const box = el("div", {},
    el("p", { class: "popup-name" }, name),
    el("p", { class: "popup-line" }, p.address),
    el("p", { class: "popup-line" }, riskBadge(p.risk)),
    el("p", { class: "popup-line" }, petFlag(p)),
    p.elevationFt ? el("p", { class: "popup-line" }, `${t("map.popup.elevation")}: ~${p.elevationFt} ft`) : null,
    el("p", { class: "popup-line" },
      el("a", { class: "btn", href: `tel:${p.phone.replace(/[^\d+]/g, "")}` }, `${t("map.popup.call")} ${p.phone}`),
      " ",
      el("a", {
        class: "btn", target: "_blank", rel: "noopener",
        href: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`,
      }, t("map.popup.directions")))
  );
  return box;
}

function sensorPopup(s, stateEntry) {
  const depth = stateEntry?.depthIn ?? 0;
  const status = depth >= 6 ? "flooded" : depth > 0.5 ? "minor" : "dry";
  return el("div", {},
    el("p", { class: "popup-name" }, s.name),
    el("p", { class: "popup-line" }, `${t("map.list.status")}: ${t(`map.sensor.${status}`)}`),
    depth > 0 ? el("p", { class: "popup-line" }, `${t("map.sensor.depthLabel")}: ${fmtDepth(depth)}`) : null,
    s.approx ? el("p", { class: "popup-line disclaimer" }, t("map.sensor.approx")) : null
  );
}

function sensorClass(depthIn) {
  return depthIn >= 6 ? "sensor-flooded" : depthIn > 0.5 ? "sensor-minor" : "sensor-dry";
}

/* ---- layer construction ---- */
function buildPoiLayers() {
  for (const type of Object.keys(TYPE_ICON)) {
    groups[type] = L.layerGroup();
  }
  const poiCls = { hospital: "poi-hospital", fire: "poi-fire", police: "poi-police",
    shelter: "poi-shelter", subway: "poi-subway", highground: "poi-highground" };
  for (const p of poisData.pois) {
    const m = L.marker([p.lat, p.lon], {
      icon: divIcon(`poi-marker ${poiCls[p.type]}`, TYPE_ICON[p.type], 30),
      keyboard: true,
      alt: p.name.en,
    });
    m.bindPopup(() => poiPopup(p));
    m.addTo(groups[p.type]);
  }
  groups.floodZones = L.layerGroup();
  for (const z of poisData.floodZones) {
    const poly = L.polygon(z.coords, { color: "#b91c1c", fillColor: "#b91c1c", fillOpacity: 0.3, weight: 2 });
    poly.bindPopup(() => el("p", { class: "popup-name" }, z.name[getLang()] || z.name.en));
    poly.addTo(groups.floodZones);
  }
  groups.routes = L.layerGroup();
  for (const r of poisData.routes) {
    const line = L.polyline(r.coords, ROUTE_STYLE[r.cls]);
    line.bindPopup(() => el("div", {},
      el("p", { class: "popup-name" }, r.name[getLang()] || r.name.en),
      el("p", { class: "popup-line" }, t(`map.legend.${r.cls}`))));
    line.addTo(groups.routes);
  }
  groups.sensors = L.layerGroup();
  groups.reports = L.layerGroup();
  groups.complaints = L.layerGroup();
}

/* ---- sensors (live deployments vs scenario sensors) ---- */
const sensorMarkers = new Map(); // id -> marker

function rebuildSensors() {
  groups.sensors.clearLayers();
  sensorMarkers.clear();
  const mode = store.get("mode");
  if (mode === "scenario") {
    const states = store.get("sensorStates") || {};
    const activeIds = new Set(Object.keys(states));
    for (const s of sensorsData) {
      if (!activeIds.has(s.id) && !s.simulated) continue; // only scenario-relevant sensors
      const st = states[s.id];
      const depth = st?.depthIn ?? 0;
      const m = L.marker([s.lat, s.lon], {
        icon: divIcon(`sensor-marker ${sensorClass(depth)}`, null, depth >= 6 ? 28 : 22),
        keyboard: true,
        alt: s.name,
      });
      m.bindPopup(() => sensorPopup(s, store.get("sensorStates")?.[s.id]));
      m.addTo(groups.sensors);
      sensorMarkers.set(s.id, m);
    }
  } else {
    const fn = (store.get("feeds") || {}).floodnet;
    if (fn?.state === "ok") {
      for (const d of fn.deployments) {
        const m = L.marker([d.lat, d.lon], {
          icon: divIcon("sensor-marker sensor-dry", null, 22),
          keyboard: true,
          alt: d.name,
        });
        m.bindPopup(() => el("div", {},
          el("p", { class: "popup-name" }, d.name),
          el("p", { class: "popup-line" }, `${t("map.list.status")}: ${d.status}`),
          el("p", { class: "popup-line disclaimer" }, t("map.sensor.liveNote"))));
        m.addTo(groups.sensors);
      }
    }
  }
}

function updateSensorStates() {
  if (store.get("mode") !== "scenario") return;
  const states = store.get("sensorStates") || {};
  for (const [id, st] of Object.entries(states)) {
    let m = sensorMarkers.get(id);
    if (!m) {
      const s = sensorsData.find((x) => x.id === id);
      if (!s) continue;
      m = L.marker([s.lat, s.lon], { keyboard: true, alt: s.name });
      m.bindPopup(() => sensorPopup(s, store.get("sensorStates")?.[id]));
      m.addTo(groups.sensors);
      sensorMarkers.set(id, m);
    }
    m.setIcon(divIcon(`sensor-marker ${sensorClass(st.depthIn)}`, null, st.depthIn >= 6 ? 28 : 22));
  }
}

/* ---- community reports ---- */
function rebuildReports() {
  groups.reports.clearLayers();
  for (const r of store.get("reports") || []) {
    if (r.lat == null) continue;
    const m = L.marker([r.lat, r.lon], {
      icon: divIcon("report-marker", "i-report", 26),
      keyboard: true,
      alt: t("report.pinLabel"),
    });
    m.bindPopup(() => {
      const ago = Date.now() - r.t;
      const agoStr = ago < 90_000 ? t("report.justNow")
        : ago < 3600_000 ? t("report.minAgo", { n: Math.round(ago / 60_000) })
          : t("report.hoursAgo", { n: Math.round(ago / 3600_000) });
      const box = el("div", {},
        el("p", { class: "popup-name" }, t("report.pinLabel")),
        el("p", { class: "popup-line" }, `${t("map.sensor.depthLabel")}: ${fmtDepth(r.depthIn)}`),
        el("p", { class: "popup-line" }, agoStr),
        r.note ? el("p", { class: "popup-line" }, r.note) : null);
      if (r.photo) {
        const img = el("img", { class: "photo-preview", alt: "" });
        img.src = r.photo;
        box.append(img);
      }
      return box;
    });
    m.addTo(groups.reports);
  }
}

/* ---- replay complaints ---- */
function updateComplaints() {
  const sc = store.get("scenario");
  const list = sc?.complaints || [];
  if (list.length < renderedComplaints) {
    groups.complaints.clearLayers();
    renderedComplaints = 0;
  }
  for (let i = renderedComplaints; i < list.length; i++) {
    const c = list[i];
    const m = L.marker([c.lat, c.lon], {
      icon: divIcon("complaint-marker", null, 12),
      keyboard: false,
      interactive: true,
      alt: "311",
    });
    m.bindPopup(() => el("div", {},
      el("p", { class: "popup-name" }, "311 — " + t("map.layers.complaints")),
      el("p", { class: "popup-line" }, `${c.borough} · ${fmtDate(new Date(Date.parse(c.t)))}`)));
    m.addTo(groups.complaints);
  }
  renderedComplaints = list.length;
}

/* ---- quick actions ---- */
function getUserLatLng() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => resolve(null),
      { timeout: 6000 }
    );
  });
}

async function nearestAction(types) {
  let from = await getUserLatLng();
  if (!from) {
    toast(t("map.locateDenied"));
    from = EH_CENTER;
  }
  const candidates = poisData.pois.filter((p) => types.includes(p.type));
  let best = null, bestD = Infinity;
  for (const p of candidates) {
    const d = haversineMi(from, [p.lat, p.lon]);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) return;
  if (actionLine) actionLine.remove();
  actionLine = L.polyline([from, [best.lat, best.lon]], { color: "#0b5d8a", weight: 5, dashArray: "10,8" }).addTo(map);
  map.fitBounds(actionLine.getBounds().pad(0.3));
  const marker = [...groups[best.type].getLayers()].find(
    (m) => m.getLatLng && m.getLatLng().lat === best.lat && m.getLatLng().lng === best.lon
  );
  if (marker) marker.openPopup();
  if (best.risk !== "low") toast(t("map.destinationRisk", { risk: t(`map.risk.${best.risk}`) }));
  else toast(`${best.name[getLang()] || best.name.en} — ${t("map.distanceAway", { dist: fmtNum(Math.round(bestD * 10) / 10) })}`);
}

async function locateMe() {
  const loc = await getUserLatLng();
  if (!loc) {
    toast(t("map.locateDenied"));
    map.setView(EH_CENTER, 14);
    return;
  }
  if (userMarker) userMarker.remove();
  userMarker = L.marker(loc, { icon: divIcon("poi-marker poi-user", "i-locate", 30), keyboard: true, alt: t("map.youAreHere") });
  userMarker.bindPopup(() => el("p", { class: "popup-name" }, t("map.youAreHere")));
  userMarker.addTo(map);
  map.setView(loc, 16);
  userMarker.openPopup();
}

/* ---- side panel: toggles, quick actions, legend, list views ---- */
const LAYER_ORDER = ["hospital", "fire", "police", "shelter", "subway", "highground", "floodZones", "routes", "sensors", "reports", "complaints"];

function renderPanel(mount) {
  clear(mount);
  const toggles = loadKey("layerToggles", {});

  // base map switch
  const baseWrap = el("div", { class: "base-switch", role: "group", aria: { label: t("map.base.title") } });
  for (const [key, label] of [["streets", t("map.base.streets")], ["topo", t("map.base.topo")], ["satellite", t("map.base.satellite")]]) {
    baseWrap.append(el("button", {
      class: "btn", type: "button",
      aria: { pressed: String((store.get("baseLayer") || "streets") === key) },
      onClick: () => {
        store.set("baseLayer", key);
        renderPanel(mount);
      },
    }, label));
  }

  // quick actions
  const quick = el("div", { class: "quick-grid" },
    el("button", { class: "btn", type: "button", onClick: () => nearestAction(["hospital"]) }, icon("i-hospital"), t("map.quick.hospital")),
    el("button", { class: "btn", type: "button", onClick: () => nearestAction(["shelter"]) }, icon("i-house"), t("map.quick.shelter")),
    el("button", { class: "btn", type: "button", onClick: () => nearestAction(["highground"]) }, icon("i-mountain"), t("map.quick.highground")),
    el("button", {
      class: "btn", type: "button",
      onClick: () => {
        toggles.routes = true;
        saveKey("layerToggles", toggles);
        groups.routes.addTo(map);
        map.fitBounds(L.featureGroup(groups.routes.getLayers()).getBounds().pad(0.1));
        renderPanel(mount);
      },
    }, icon("i-map"), t("map.quick.routes")),
    el("button", { class: "btn", type: "button", onClick: locateMe }, icon("i-locate"), t("map.quick.locate")),
  );

  // layer toggles
  const togglesWrap = el("div", { class: "layer-toggles" });
  for (const key of LAYER_ORDER) {
    const on = toggles[key] !== false;
    const input = el("input", { type: "checkbox" });
    input.checked = on;
    input.addEventListener("change", () => {
      toggles[key] = input.checked;
      saveKey("layerToggles", toggles);
      if (input.checked) groups[key].addTo(map);
      else map.removeLayer(groups[key]);
    });
    togglesWrap.append(el("label", {}, input, el("span", {}, t(`map.layers.${key}`))));
  }

  // legend
  const legend = el("ul", { class: "legend-list", aria: { label: t("map.legend.title") } },
    el("li", {}, el("span", { class: "legend-swatch legend-safe" }), t("map.legend.safe")),
    el("li", {}, el("span", { class: "legend-swatch legend-standard" }), t("map.legend.standard")),
    el("li", {}, el("span", { class: "legend-swatch legend-atRisk" }), t("map.legend.atRisk")));

  // list views (accessible twins, PRD §8)
  const lists = el("div", {});
  const catGroups = [
    ["hospital", "fire", "police"],
    ["shelter", "highground"],
    ["subway"],
  ];
  for (const cats of catGroups) {
    const rows = poisData.pois.filter((p) => cats.includes(p.type));
    const tbl = el("table", { class: "data-table" },
      el("thead", {}, el("tr", {},
        el("th", { scope: "col" }, t("map.list.name")),
        el("th", { scope: "col" }, t("map.list.distance")),
        el("th", { scope: "col" }, t("map.list.risk")),
        el("th", { scope: "col" }, t("map.list.phone")))),
      el("tbody", {}, rows.map((p) => el("tr", {},
        el("td", {}, p.name[getLang()] || p.name.en),
        el("td", {}, `${fmtNum(Math.round(haversineMi(EH_CENTER, [p.lat, p.lon]) * 10) / 10)} ${t("common.miles")}`),
        el("td", {}, t(`map.risk.${p.risk}`)),
        el("td", {}, el("a", { href: `tel:${p.phone.replace(/[^\d+]/g, "")}` }, p.phone))))));
    lists.append(el("details", { class: "listview" },
      el("summary", {}, `${t("map.list.show")} — ${cats.map((c) => t(`map.layers.${c}`)).join(", ")}`),
      tbl));
  }

  mount.append(
    el("h2", {}, t("map.base.title")), baseWrap,
    el("h2", {}, t("map.quick.title")), quick,
    el("h2", {}, t("map.layersTitle")), togglesWrap,
    el("h2", {}, t("map.legend.title")), legend,
    lists
  );
}

/* ---- init ---- */
export async function initMapView(root) {
  const [pois, sensors] = await Promise.all([
    fetch("data/pois.json").then((r) => r.json()),
    fetch("data/sensors.json").then((r) => r.json()),
  ]);
  poisData = pois;
  sensorsData = sensors;

  map = L.map("leaflet-map", { keyboard: true, zoomControl: true }).setView(EH_CENTER, 14);

  const bases = {
    streets: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 19,
    }),
    topo: L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors, SRTM · © OpenTopoMap", maxZoom: 17,
    }),
    satellite: L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "© Esri, Maxar, Earthstar Geographics", maxZoom: 19,
    }),
  };
  let activeBase = bases.streets.addTo(map);
  store.set("baseLayer", "streets");
  store.subscribe("baseLayer", (key) => {
    if (bases[key] && bases[key] !== activeBase) {
      map.removeLayer(activeBase);
      activeBase = bases[key].addTo(map);
    }
  });
  bases.streets.on("tileerror", () => {
    if (!tileErrorShown) {
      tileErrorShown = true;
      toast(t("map.offlineTiles"));
    }
  });

  buildPoiLayers();
  const toggles = loadKey("layerToggles", {});
  for (const key of LAYER_ORDER) {
    if (toggles[key] !== false) groups[key].addTo(map);
  }

  const panelMount = root.querySelector("#map-panel-mount");
  renderPanel(panelMount);

  rebuildSensors();
  rebuildReports();

  store.subscribe("mode", () => {
    fittedScenarioId = null;
    renderedComplaints = 0;
    groups.complaints.clearLayers();
    rebuildSensors();
  });
  store.subscribe("feeds", () => {
    if (store.get("mode") !== "scenario") rebuildSensors();
  });
  store.subscribe("sensorStates", updateSensorStates);
  store.subscribe("reports", rebuildReports);
  store.subscribe("scenario", (sc) => {
    if (!sc) return;
    if (sc.id !== fittedScenarioId) {
      fittedScenarioId = sc.id;
      map.fitBounds(sc.bounds);
    }
    updateComplaints();
  });
  store.subscribe("lang", () => renderPanel(panelMount));

  // Leaflet needs a size refresh when its container becomes visible; a
  // fitBounds done while hidden lands at zoom 0, so re-fit the scenario too
  store.subscribe("route", (r) => {
    if (r !== "map") return;
    setTimeout(() => {
      map.invalidateSize();
      const sc = store.get("scenario");
      if (sc && store.get("mode") === "scenario") map.fitBounds(sc.bounds);
    }, 80);
  });
}
