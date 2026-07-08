/* report-view — one-tap community flood report (PRD F-3.*).
 * Depth pictograms, optional geolocation/photo/note, all data on-device.
 * Photos are canvas re-encoded (EXIF/GPS stripped) and size-capped (§9.3).
 */
import { store } from "./state.js";
import { t, fmtDepth } from "./i18n.js";
import { el, icon, clear } from "./dom.js";
import { loadKey, saveKey } from "./storage.js";
import { toast, confirmDialog } from "./main.js";

const DEPTHS = [
  { key: "ankle", inches: 6, icon: "i-person-ankle" },
  { key: "knee", inches: 18, icon: "i-person-knee" },
  { key: "waist", inches: 36, icon: "i-person-waist" },
];
const NOTE_MAX = 280;
const PHOTO_BUDGET = 5 * 1024 * 1024; // total localStorage budget for photos
const EH_CENTER = [40.793, -73.944];

let chosenDepth = null;
let chosenLoc = null;
let photoDataUrl = null;
let miniMap = null;
let pinMarker = null;
let safetyShown = false;

/** Re-encode via canvas: strips EXIF (incl. GPS), caps dimensions. */
async function processPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const maxDim = 1280;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Evict oldest photos until the new one fits the budget. */
function enforcePhotoBudget(reports, incomingSize) {
  let total = incomingSize;
  for (const r of reports) total += r.photo ? r.photo.length : 0;
  let evicted = false;
  const byAge = [...reports].sort((a, b) => a.t - b.t);
  while (total > PHOTO_BUDGET && byAge.length) {
    const oldest = byAge.find((r) => r.photo);
    if (!oldest) break;
    total -= oldest.photo.length;
    oldest.photo = null;
    evicted = true;
  }
  return evicted;
}

export function initReportView(mount) {
  clear(mount);

  // intro
  mount.append(el("p", { dataset: { i18n: "report.intro" } }, t("report.intro")));

  // depth radiogroup
  const depthLegend = el("p", { class: "field-label", id: "depth-legend" }, t("report.depthLegend"));
  depthLegend.dataset.i18n = "report.depthLegend";
  const group = el("div", { class: "depth-group", role: "radiogroup", aria: { labelledby: "depth-legend" } });
  const optionBtns = [];
  DEPTHS.forEach((d, idx) => {
    const btn = el("button", {
      class: "depth-option", type: "button", role: "radio",
      aria: { checked: "false" },
      onClick: () => {
        chosenDepth = d;
        optionBtns.forEach((b, i) => b.setAttribute("aria-checked", String(i === idx)));
      },
    },
      icon(d.icon, 56),
      el("span", { class: "d-label", dataset: { i18n: `report.depth.${d.key}` } }, t(`report.depth.${d.key}`)),
      el("span", { class: "d-desc", dataset: { i18n: `report.depth.${d.key}Desc` } }, t(`report.depth.${d.key}Desc`)));
    optionBtns.push(btn);
    group.append(btn);
  });

  // location
  const locStatus = el("p", { class: "hint", role: "status" }, t("report.location.none"));
  const miniMapDiv = el("div", { id: "report-minimap", hidden: true });
  const locField = el("div", { class: "field" },
    el("span", { class: "field-label", dataset: { i18n: "report.location.label" } }, t("report.location.label")),
    el("p", { class: "hint", dataset: { i18n: "report.location.why" } }, t("report.location.why")),
    el("div", { class: "btn-row" },
      el("button", {
        class: "btn", type: "button",
        onClick: () => {
          navigator.geolocation?.getCurrentPosition(
            (pos) => {
              chosenLoc = [pos.coords.latitude, pos.coords.longitude];
              locStatus.textContent = `${t("report.location.set")} ✓`;
            },
            () => {
              toast(t("map.locateDenied"));
              showPinMap();
            },
            { timeout: 6000 }
          );
        },
      }, icon("i-locate"), el("span", { dataset: { i18n: "report.location.use" } }, t("report.location.use"))),
      el("button", { class: "btn", type: "button", onClick: showPinMap },
        icon("i-pin"), el("span", { dataset: { i18n: "report.location.pin" } }, t("report.location.pin")))),
    miniMapDiv,
    locStatus);

  function showPinMap() {
    miniMapDiv.hidden = false;
    if (!miniMap) {
      miniMap = L.map(miniMapDiv, { keyboard: true }).setView(EH_CENTER, 14);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", maxZoom: 19,
      }).addTo(miniMap);
      miniMap.on("click", (e) => {
        chosenLoc = [e.latlng.lat, e.latlng.lng];
        if (pinMarker) pinMarker.remove();
        pinMarker = L.marker(chosenLoc).addTo(miniMap);
        locStatus.textContent = `${t("report.location.set")} ✓`;
      });
    }
    setTimeout(() => miniMap.invalidateSize(), 60);
  }

  // photo
  const photoInput = el("input", { type: "file", accept: "image/*", class: "visually-hidden", id: "photo-input" });
  const photoPreview = el("img", { class: "photo-preview", alt: "", hidden: true });
  const removeBtn = el("button", { class: "btn", type: "button", hidden: true, onClick: () => {
    photoDataUrl = null;
    photoPreview.hidden = true;
    removeBtn.hidden = true;
  } }, el("span", { dataset: { i18n: "report.photo.remove" } }, t("report.photo.remove")));
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      photoDataUrl = await processPhoto(file);
      photoPreview.src = photoDataUrl;
      photoPreview.hidden = false;
      removeBtn.hidden = false;
    } catch {
      toast(t("common.error"));
    }
    photoInput.value = "";
  });
  const photoField = el("div", { class: "field" },
    el("span", { class: "field-label", dataset: { i18n: "report.photo.label" } }, t("report.photo.label")),
    el("p", { class: "hint", dataset: { i18n: "report.photo.note" } }, t("report.photo.note")),
    el("div", { class: "btn-row" },
      el("label", { class: "btn", for: "photo-input" }, icon("i-camera"), el("span", { dataset: { i18n: "report.photo.add" } }, t("report.photo.add"))),
      removeBtn),
    photoInput,
    photoPreview);

  // note
  const noteCounter = el("p", { class: "hint", aria: { live: "polite" } }, t("report.note.count", { n: NOTE_MAX }));
  const noteInput = el("textarea", { id: "report-note", rows: 3, maxlength: String(NOTE_MAX) });
  noteInput.addEventListener("input", () => {
    noteCounter.textContent = t("report.note.count", { n: NOTE_MAX - noteInput.value.length });
  });
  const noteField = el("div", { class: "field" },
    el("label", { for: "report-note", dataset: { i18n: "report.note.label" } }, t("report.note.label")),
    noteInput, noteCounter);

  // safety note (always visible; PRD F-3.6 also gates first submit in WARNING+)
  const safety = el("p", { class: "safety-note", dataset: { i18n: "report.safety" } }, t("report.safety"));

  // submit
  const submitBtn = el("button", { class: "btn btn-primary btn-block", type: "button", onClick: submit },
    icon("i-report", 20), el("span", { dataset: { i18n: "report.submit" } }, t("report.submit")));

  async function submit() {
    if (!chosenDepth) {
      optionBtns[0].focus();
      return;
    }
    const status = store.get("status");
    if (!safetyShown && (status?.level === "WARNING" || status?.level === "DANGER")) {
      safetyShown = true;
      const ok = await confirmDialog(t("report.title"), t("report.safety"));
      if (!ok) return;
    }
    const reports = loadKey("reports", []);
    const photoSize = photoDataUrl ? photoDataUrl.length : 0;
    if (photoSize && enforcePhotoBudget(reports, photoSize)) {
      toast(t("report.photo.storageFull"));
    }
    const report = {
      id: `r${Date.now()}`,
      t: Date.now(),
      depthIn: chosenDepth.inches,
      lat: chosenLoc ? chosenLoc[0] : null,
      lon: chosenLoc ? chosenLoc[1] : null,
      note: noteInput.value.trim().slice(0, NOTE_MAX) || null,
      photo: photoDataUrl,
    };
    reports.push(report);
    if (!saveKey("reports", reports)) {
      // storage full even after eviction — drop the photo, retry
      report.photo = null;
      saveKey("reports", reports);
      toast(t("report.photo.storageFull"));
    }
    store.set("reports", reports);
    toast(`${t("report.confirmTitle")} — ${fmtDepth(report.depthIn)}`);
    // reset form
    chosenDepth = null;
    chosenLoc = null;
    photoDataUrl = null;
    optionBtns.forEach((b) => b.setAttribute("aria-checked", "false"));
    locStatus.textContent = t("report.location.none");
    photoPreview.hidden = true;
    removeBtn.hidden = true;
    noteInput.value = "";
    // explain the SCI pipeline (confirmation card)
    confirmCard.hidden = false;
    confirmCard.focus();
  }

  const confirmCard = el("div", { class: "card", hidden: true, tabindex: "-1", role: "status" },
    el("h2", { dataset: { i18n: "report.confirmTitle" } }, t("report.confirmTitle")),
    el("p", { dataset: { i18n: "report.confirmBody" } }, t("report.confirmBody")));

  // clear my reports
  const clearBtn = el("button", {
    class: "btn", type: "button",
    onClick: async () => {
      const ok = await confirmDialog(t("report.clear"), t("report.clearConfirm"));
      if (!ok) return;
      saveKey("reports", []);
      store.set("reports", []);
      toast(t("report.cleared"));
    },
  }, el("span", { dataset: { i18n: "report.clear" } }, t("report.clear")));

  mount.append(depthLegend, group, locField, photoField, noteField, safety, submitBtn, confirmCard,
    el("div", { class: "btn-row" }, clearBtn));
}
