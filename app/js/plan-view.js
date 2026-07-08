/* plan-view — blue-sky preparedness: risk lookup, safe havens, pets, checklists,
 * contacts, print, settings (PRD F-4.*). Everything persists on-device only.
 */
import { store } from "./state.js";
import { t, getLang, fmtNum } from "./i18n.js";
import { el, icon, clear } from "./dom.js";
import { loadKey, saveKey, wipeAll } from "./storage.js";
import { toast, confirmDialog } from "./main.js";

const EH_CENTER = [40.793, -73.944];
const WALK_MPH = 3;

let elevGrid = null;
let poisData = null;
let miniMap = null;
let pinMarker = null;

function haversineMi(a, b) {
  const R = 3958.8;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function elevationAt(lat, lon) {
  if (!elevGrid) return null;
  const [s, w, n, e] = elevGrid.bbox;
  if (lat < s || lat > n || lon < w || lon > e) return null;
  const r = Math.min(elevGrid.rows - 1, Math.floor((lat - s) / elevGrid.cell));
  const c = Math.min(elevGrid.cols - 1, Math.floor((lon - w) / elevGrid.cell));
  // search the cell then a small neighborhood for a non-null value
  for (let radius = 0; radius <= 3; radius++) {
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= elevGrid.rows || cc >= elevGrid.cols) continue;
        const v = elevGrid.elev[rr * elevGrid.cols + cc];
        if (v !== null && v !== undefined) return v;
      }
    }
  }
  return null;
}

function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((xi > pt[1]) !== (xj > pt[1]) &&
        pt[0] < ((yj - yi) * (pt[1] - xi)) / (xj - xi) + yi) {
      inside = !inside;
    }
  }
  return inside;
}

function nearFloodZone(lat, lon) {
  for (const z of poisData.floodZones) {
    if (pointInPolygon([lat, lon], z.coords)) return true;
    for (const c of z.coords) {
      if (haversineMi([lat, lon], c) < 0.12) return true;
    }
  }
  return false;
}

function assessRisk(lat, lon) {
  const elev = elevationAt(lat, lon);
  const nearZone = nearFloodZone(lat, lon);
  if (elev === null) return { level: nearZone ? "high" : "moderate", ft: null, nearZone };
  if (nearZone || elev < 15) return { level: "high", ft: elev, nearZone };
  if (elev < 40) return { level: "moderate", ft: elev, nearZone };
  return { level: "low", ft: elev, nearZone };
}

function checklist(sectionKey, itemsObj, storageName) {
  const state = loadKey(storageName, {});
  const list = el("ul", { class: "check-list" });
  for (const itemKey of Object.keys(itemsObj)) {
    const full = `${sectionKey}.${itemKey}`;
    const input = el("input", { type: "checkbox" });
    input.checked = !!state[itemKey];
    input.addEventListener("change", () => {
      state[itemKey] = input.checked;
      saveKey(storageName, state);
    });
    list.append(el("li", {}, el("label", {}, input,
      el("span", { dataset: { i18n: full } }, t(full)))));
  }
  return list;
}

export function initPlanView(mount) {
  Promise.all([
    fetch("data/eh_elevation.json").then((r) => r.json()),
    fetch("data/pois.json").then((r) => r.json()),
  ]).then(([elev, pois]) => {
    elevGrid = elev;
    poisData = pois;
    render(mount);
    store.subscribe("lang", () => render(mount));
  });
}

function render(mount) {
  clear(mount);
  const savedLoc = loadKey("homeLocation", null);

  mount.append(el("p", {}, t("plan.intro")));

  /* ---- risk lookup ---- */
  const riskResult = el("div", {});
  const miniMapDiv = el("div", { id: "plan-minimap" });
  const riskCard = el("div", { class: "card" },
    el("h2", {}, t("plan.risk.title")),
    el("p", { class: "hint" }, t("plan.risk.explain")),
    miniMapDiv,
    riskResult,
    el("p", { class: "disclaimer" }, t("plan.risk.disclaimer")));

  function showRisk(lat, lon) {
    const { level, ft } = assessRisk(lat, lon);
    clear(riskResult);
    const key = level === "low" ? "plan.risk.resultLow" : level === "moderate" ? "plan.risk.resultModerate" : "plan.risk.resultHigh";
    riskResult.append(el("div", { class: `risk-result risk-result-${level}`, role: "status" },
      t(key, { ft: ft === null ? "?" : fmtNum(Math.round(ft)) })));
    renderHavens(lat, lon);
  }

  setTimeout(() => {
    if (miniMap) { miniMap.remove(); miniMap = null; }
    miniMap = L.map(miniMapDiv, { keyboard: true }).setView(savedLoc || EH_CENTER, 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: 19,
    }).addTo(miniMap);
    if (savedLoc) {
      pinMarker = L.marker(savedLoc).addTo(miniMap);
      showRisk(savedLoc[0], savedLoc[1]);
    }
    miniMap.on("click", (e) => {
      const loc = [e.latlng.lat, e.latlng.lng];
      saveKey("homeLocation", loc);
      if (pinMarker) pinMarker.remove();
      pinMarker = L.marker(loc).addTo(miniMap);
      showRisk(loc[0], loc[1]);
    });
    setTimeout(() => miniMap.invalidateSize(), 80);
  }, 0);

  /* ---- safe havens ---- */
  const havensMount = el("div", {});
  const havenCard = el("div", { class: "card" },
    el("h2", {}, t("plan.haven.title")),
    havensMount);

  function renderHavens(lat, lon) {
    clear(havensMount);
    const candidates = poisData.pois
      .filter((p) => p.type === "shelter" || p.type === "highground")
      .map((p) => ({ p, d: haversineMi([lat, lon], [p.lat, p.lon]) }))
      .sort((a, b) => a.d - b.d);
    const picks = [candidates[0], candidates.find((c) => c.p.id !== candidates[0].p.id && c.p.type !== candidates[0].p.type) || candidates[1]];
    picks.forEach((pick, i) => {
      if (!pick) return;
      const { p, d } = pick;
      const mins = Math.round((d / WALK_MPH) * 60);
      const petKind = p.petFriendly === true ? "yes" : p.petFriendly === false ? "no" : "unknown";
      havensMount.append(el("div", { class: "haven-card" },
        icon(p.type === "shelter" ? "i-house" : "i-mountain", 28),
        el("div", { class: "haven-body" },
          el("strong", {}, `${t(i === 0 ? "plan.haven.primary" : "plan.haven.backup")}: ${p.name[getLang()] || p.name.en}`),
          el("p", { class: "popup-line" }, p.address),
          el("p", { class: "popup-line" },
            t("plan.haven.walk", { min: fmtNum(mins), dist: fmtNum(Math.round(d * 10) / 10) }),
            " · ",
            el("span", { class: `risk-badge risk-badge-${p.risk}` }, t(`map.risk.${p.risk}`)),
            " · ",
            el("span", { class: `pet-flag pet-${petKind}` }, icon("i-paw", 14),
              t(`map.pet.${petKind}`) + (p.petSample ? ` (${t("map.pet.sample")})` : ""))))));
    });
  }
  if (!savedLoc) havensMount.append(el("p", { class: "hint" }, t("plan.haven.needLocation")));

  /* ---- pet plan ---- */
  const petListMount = el("ul", { class: "check-list" });
  for (const p of poisData.pois.filter((x) => x.petFriendly === true)) {
    petListMount.append(el("li", {}, el("span", { class: "pet-flag pet-yes" },
      icon("i-paw", 14),
      `${p.name[getLang()] || p.name.en} — ${p.address} (${t("map.pet.sample")})`)));
  }
  const petCard = el("div", { class: "card" },
    el("h2", {}, t("plan.pet.title")),
    el("p", { class: "hint" }, t("plan.pet.intro")),
    el("h3", {}, t("plan.pet.friendly")),
    petListMount,
    el("h3", {}, t("plan.pet.checklist")),
    checklist("plan.pet.items", { carrier: 1, leash: 1, food: 1, meds: 1, records: 1, photo: 1, litter: 1 }, "petChecklist"));

  /* ---- go-bag + before-storm ---- */
  const gobagCard = el("div", { class: "card" },
    el("h2", {}, t("plan.gobag.title")),
    checklist("plan.gobag.items", { documents: 1, meds: 1, water: 1, flashlight: 1, charger: 1, cash: 1, contacts: 1, clothes: 1 }, "gobagChecklist"));
  const beforeCard = el("div", { class: "card" },
    el("h2", {}, t("plan.before.title")),
    checklist("plan.before.items", { valuables: 1, charge: 1, shutoffs: 1, neighbors: 1, drains: 1 }, "beforeChecklist"));

  /* ---- contacts ---- */
  const contactsMount = el("div", {});
  const contactsCard = el("div", { class: "card" },
    el("h2", {}, t("plan.contacts.title")),
    el("p", { class: "hint" }, t("plan.contacts.max")),
    contactsMount);

  function renderContacts() {
    clear(contactsMount);
    const contacts = loadKey("contacts", []);
    contacts.forEach((c, i) => {
      const nameIn = el("input", { type: "text", value: c.name, aria: { label: t("plan.contacts.name") } });
      const phoneIn = el("input", { type: "tel", value: c.phone, aria: { label: t("plan.contacts.phone") } });
      const persist = () => {
        contacts[i] = { name: nameIn.value, phone: phoneIn.value };
        saveKey("contacts", contacts);
      };
      nameIn.addEventListener("change", persist);
      phoneIn.addEventListener("change", persist);
      contactsMount.append(el("div", { class: "contact-row" }, nameIn, phoneIn,
        el("button", {
          class: "btn", type: "button", aria: { label: t("plan.contacts.remove") },
          onClick: () => {
            contacts.splice(i, 1);
            saveKey("contacts", contacts);
            renderContacts();
          },
        }, icon("i-x", 14))));
    });
    if (contacts.length < 5) {
      contactsMount.append(el("button", {
        class: "btn", type: "button",
        onClick: () => {
          contacts.push({ name: "", phone: "" });
          saveKey("contacts", contacts);
          renderContacts();
        },
      }, el("span", {}, t("plan.contacts.add"))));
    }
  }
  renderContacts();

  /* ---- print + settings ---- */
  const printBtn = el("button", { class: "btn btn-primary no-print", type: "button", onClick: () => window.print() },
    icon("i-print", 18), el("span", {}, t("plan.print")));

  const settingsCard = el("div", { class: "card no-print" },
    el("h2", {}, t("plan.settings.title")),
    el("button", {
      class: "btn btn-danger", type: "button",
      onClick: async () => {
        const ok = await confirmDialog(t("plan.settings.erase"), t("plan.settings.eraseConfirm"));
        if (!ok) return;
        wipeAll();
        toast(t("plan.settings.erased"));
        setTimeout(() => location.reload(), 800);
      },
    }, el("span", {}, t("plan.settings.erase"))));

  mount.append(riskCard, havenCard, petCard, gobagCard, beforeCard, contactsCard, printBtn, settingsCard);
}
