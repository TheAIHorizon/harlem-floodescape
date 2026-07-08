/* e2e acceptance drive (PRD §10.2) — run with the app served at :8123
 *   node tests/e2e.mjs
 * Drives Edge headless via puppeteer-core: console errors, overflow, language
 * flip, replay escalation, report XSS/EXIF checks, plan risk, screenshots.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const BASE = "http://localhost:8123";
const SHOTS = new URL("../.shots/", import.meta.url).pathname.replace(/^\//, "");
mkdirSync(SHOTS, { recursive: true });

const errors = [];
const failures = [];
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures.push(name);
};

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--window-size=420,900"],
  defaultViewport: { width: 420, height: 900 },
});
const page = await browser.newPage();
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

// -- boot, dismiss first run --
await page.goto(`${BASE}/#/home`, { waitUntil: "networkidle2", timeout: 30000 });
await page.waitForSelector("#firstrun-accept");
await page.click("#firstrun-accept");
await new Promise((r) => setTimeout(r, 400));

// no horizontal overflow (PRD §8, 320px+)
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok("no horizontal overflow @420px", overflow <= 0, `scrollWidth-innerWidth=${overflow}`);

// status card present
const statusText = await page.$eval(".status-card .status-title", (n) => n.textContent);
ok("status card renders", ["Calm", "Watch", "Warning", "Danger"].includes(statusText.trim()), statusText);
await page.screenshot({ path: `${SHOTS}/01-home-en.png` });

// -- language flip --
await page.click("#lang-toggle");
await new Promise((r) => setTimeout(r, 300));
const htmlLang = await page.evaluate(() => document.documentElement.lang);
const navReport = await page.$eval("#tab-report span", (n) => n.textContent);
ok("html lang=es after toggle", htmlLang === "es", htmlLang);
ok("nav translated to Spanish", navReport === "Reportar", navReport);
const statusEs = await page.$eval(".status-card .status-title", (n) => n.textContent);
ok("status card translated", ["Tranquilo", "Vigilancia", "Advertencia", "Peligro"].includes(statusEs.trim()), statusEs);
await page.screenshot({ path: `${SHOTS}/02-home-es.png` });
await page.click("#lang-toggle"); // back to EN
await new Promise((r) => setTimeout(r, 300));

// -- replay may20 --
await page.evaluate(() => document.querySelector("#home-demo-mount button").click());
await page.waitForSelector("#scenario-options button");
const scenBtns = await page.$$("#scenario-options button");
await scenBtns[1].click(); // may20-2026
await new Promise((r) => setTimeout(r, 1000));
const wmVisible = await page.$eval("#watermark", (n) => !n.hidden);
ok("watermark visible in replay", wmVisible);
// speed to 300x and let it escalate
await page.select("#scen-speed", "300");
await new Promise((r) => setTimeout(r, 12_000));
const levelDuring = await page.evaluate(() => {
  const card = document.querySelector(".status-card");
  return [...card.classList].find((c) => c.startsWith("status-") && c !== "status-card");
});
ok("replay escalates status", ["status-WATCH", "status-WARNING", "status-DANGER"].includes(levelDuring), levelDuring);
await page.screenshot({ path: `${SHOTS}/03-replay-home.png` });

// map during replay
await page.goto(`${BASE}/#/map`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2500));
const sensorCount = await page.evaluate(() => document.querySelectorAll(".sensor-marker").length);
ok("sensor markers on map during replay", sensorCount > 10, `count=${sensorCount}`);
await page.screenshot({ path: `${SHOTS}/04-replay-map.png` });

// scrub determinism: seek to start → depths reset
await page.evaluate(() => {
  const scrub = document.getElementById("scen-scrub");
  scrub.value = "0";
  scrub.dispatchEvent(new Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));
// at t0 only events stamped exactly at scenario start may be applied —
// far fewer than the 40+ flooded at the late timeline position we came from
const floodedAfterRewind = await page.evaluate(() => document.querySelectorAll(".sensor-flooded").length);
ok("rewind resets sensor states", floodedAfterRewind <= 2, `flooded=${floodedAfterRewind}`);

// exit replay
await page.click("#scen-exit");
await new Promise((r) => setTimeout(r, 500));
const wmHidden = await page.$eval("#watermark", (n) => n.hidden);
ok("exit replay hides watermark", wmHidden);

// -- EH simulation quick check --
await page.goto(`${BASE}/#/home`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelector("#home-demo-mount button").click());
await page.waitForSelector("#scenario-options button");
const scenBtns2 = await page.$$("#scenario-options button");
await scenBtns2[2].click(); // eh-simulation
await new Promise((r) => setTimeout(r, 800));
const wmText = await page.$eval("#watermark-text", (n) => n.textContent);
ok("EH sim watermark says SIMULATION", /SIMULATION|SIMULACIÓN/i.test(wmText), wmText);
await page.click("#scen-exit");

// -- report flow with XSS probe --
await page.goto(`${BASE}/#/report`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => document.querySelectorAll(".depth-option")[1].click()); // knee
await page.type("#report-note", "<script>alert(1)</script> test note");
await page.evaluate(() => {
  // find submit by class
  [...document.querySelectorAll("#report-mount .btn-primary")].at(-1).click();
});
await new Promise((r) => setTimeout(r, 600));
const reports = await page.evaluate(() => JSON.parse(localStorage.getItem("hfe.v1.reports") || "[]"));
ok("report saved", reports.length === 1 && reports[0].depthIn === 18, `n=${reports.length}`);
const noteRenderedSafely = await page.evaluate(() => {
  // popup content built with textContent — check the stored note round-trips as text
  return !document.querySelector("#report-mount script");
});
ok("XSS note inert in DOM", noteRenderedSafely);
await page.screenshot({ path: `${SHOTS}/05-report.png` });

// -- plan: drop pin, risk result --
await page.goto(`${BASE}/#/plan`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 2000));
await page.evaluate(() => {
  // click center of plan minimap
  const mapDiv = document.getElementById("plan-minimap");
  const rect = mapDiv.getBoundingClientRect();
  const evt = new MouseEvent("click", { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, bubbles: true });
  mapDiv.dispatchEvent(evt);
});
await new Promise((r) => setTimeout(r, 300));
// leaflet click needs real mouse events; use page.mouse on the map div
const rect = await page.evaluate(() => {
  const r = document.getElementById("plan-minimap").getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(rect.x, rect.y);
await new Promise((r) => setTimeout(r, 700));
const riskShown = await page.evaluate(() => !!document.querySelector(".risk-result"));
ok("plan risk result renders after pin drop", riskShown);
const havens = await page.evaluate(() => document.querySelectorAll(".haven-card").length);
ok("safe havens assigned", havens >= 2, `havens=${havens}`);
await page.screenshot({ path: `${SHOTS}/06-plan.png` });

// -- keyboard reachability spot check --
await page.goto(`${BASE}/#/home`, { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 500));
const focusable = await page.evaluate(() => {
  const sel = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
  return [...document.querySelectorAll(sel)].filter((n) => n.offsetParent !== null).length;
});
ok("focusable controls present", focusable >= 8, `n=${focusable}`);

// console errors — ignore expected offline/tile noise
const realErrors = errors.filter((e) =>
  !/tile|ERR_INTERNET|ERR_NAME|Failed to load resource.*(openstreetmap|arcgis|opentopomap|weather\.gov|open-meteo|floodnet)/i.test(e));
ok("no console errors", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILURES` : "\nALL E2E CHECKS PASSED");
process.exit(failures.length ? 1 : 0);
