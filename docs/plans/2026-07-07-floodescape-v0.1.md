# Harlem FloodEscape v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Harlem FloodEscape demo prototype exactly as specified in `../PRD.md` — a static, bilingual, WCAG-AA, four-screen flood-resiliency web app with live NWS/FloodNet data and deterministic replays of real flood events.

**Architecture:** Vanilla ES-module SPA (hash router) over a tiny pub/sub store. A Python script converts the researcher's raw CSVs into compact JSON scenario/data files at build time. Leaflet is vendored; no runtime CDN. All personal data in namespaced localStorage.

**Tech Stack:** HTML/CSS/vanilla JS (ES modules), Leaflet 1.9.4 (vendored), Python 3 + pandas (offline data tooling), `node --test` for unit tests.

## Global Constraints (from PRD — binding for every task)

- No frameworks, no bundler, no runtime CDN; app must open from `file://` and degrade gracefully offline (PRD §3, §6.1).
- CSP meta tag per PRD §9.2; **no inline scripts or styles**; no `innerHTML` with any dynamic value — DOM built via `createElement`/`textContent` (PRD §9.3).
- Every user-visible string via `i18n.t(key)` with EN + ES entries; missing key = loud console error (PRD §7).
- Real `<button>`/`<a>`/`<label>` only; focus visible; `aria-live` for status; targets ≥44px; works at 320px width; `prefers-reduced-motion` respected (PRD §8).
- Provenance tags (LIVE/RECORDED/SIMULATION/SAMPLE/UNAVAILABLE) on all data surfaces (PRD §5.1).
- No git in this project per user instruction — skip commit steps; keep tasks otherwise verifiable.
- localStorage keys namespaced `hfe.v1.*` (PRD §5.4).
- Data payload ≤ 2 MB excluding tiles (PRD §10.3).

**Paths:** project root = `d:\coderepo\demo4\FloodEscape-App\`. App = `app/`. Data source CSVs = `d:\coderepo\demo4\Data\`.

---

### Task 1: Scaffold + vendor Leaflet

**Files:** Create folder tree per PRD §6.2; download Leaflet 1.9.4 `leaflet.js`, `leaflet.css`, `images/*` into `app/vendor/leaflet/`; write `app/vendor/README.md` recording version + source URL + SHA-256 of both files.

- [x] Create directories: `app/{css,js,data,i18n,vendor/leaflet/images}`, `tools`, `tests`
- [x] Download from `https://unpkg.com/leaflet@1.9.4/dist/` (leaflet.js, leaflet.css, images/marker-icon.png, marker-icon-2x.png, marker-shadow.png, layers.png, layers-2x.png)
- [x] Record SHA-256 hashes in `app/vendor/README.md`
- [x] Verify: `ls app/vendor/leaflet` shows all files, sizes > 0

### Task 2: Data pipeline (`tools/build_data.py`)

**Files:** Create `tools/build_data.py`. Outputs to `app/data/`: `scenario_oct30-2025.json`, `scenario_may20-2026.json`, `scenario_eh-simulation.json`, `eh_elevation.json`, `sensors.json`, `pois.json`.

**Interfaces (consumed by Tasks 7–11):**
- Scenario JSON: `{ "id", "nameKey", "kind": "recorded"|"simulated", "start": iso, "end": iso, "bounds": [[s,w],[n,e]], "bookmarks": [{"t": iso, "labelKey"}], "events": [ {"t": iso, "type": "sensor", "sensorId", "depthIn", "phase": "rise"|"peak"|"drain"|"end"} | {"t", "type": "complaint", "lat", "lon", "borough"} | {"t", "type": "alert", "level": "WATCH"|"WARNING"|"DANGER"} ] }` — events sorted by `t`.
- `sensors.json`: `[ {"id","name","lat","lon","borough","approx": bool} ]`
- `eh_elevation.json`: `{ "bbox": [s,w,n,e], "cell": 0.0005, "rows": int, "cols": int, "elev": [int|null,...] }` (row-major, feet, downsampled median)
- `pois.json`: `[ {"id","type":"hospital|fire|police|shelter|subway|highground","name":{"en","es"},"lat","lon","address","phone","risk":"low|moderate|high","petFriendly":true|false|"unknown","petSample":true,"elevationFt"?} ]` plus `"routes"` and `"floodZones"` arrays migrated from HARLEM.EVAC.MAP.html.

Rules (PRD §5.2): 311 date format `%Y %b %d %I:%M:%S %p`; FloodNet numerics via `to_numeric(errors="coerce")`; sensor coords from FloodNet metadata API if reachable, else borough-anchored deterministic placement flagged `approx: true`; CoCoRaHS excluded; alert events synthesized per status-engine thresholds so replays escalate; EH simulation transposes the top May-20 depth/timing patterns onto hand-chosen EH low-lying coordinates (96th St underpass, 116th/FDR, 125th/Willis, Thomas Jefferson Park edge, 110th/Park, 103rd/Lex) with every record `"simulated": true`.

- [x] Write script with validation (counts, bounds, no NaN; fatal on failure) and summary print
- [x] Run: `python tools/build_data.py` → all six JSONs exist, total < 2 MB, summary sane

### Task 3: i18n

**Files:** Create `app/i18n/en.json`, `app/i18n/es.json`, `app/js/i18n.js`, `tests/i18n.test.mjs`.

**Interfaces:** `initI18n(): Promise<void>` (loads JSON, applies saved lang); `t(key: string): string`; `setLang("en"|"es"): void` (re-applies `[data-i18n]`, `[data-i18n-aria-label]`, `[data-i18n-placeholder]`, `[data-i18n-content]` nodes, sets `document.documentElement.lang`, persists, emits `store` event `lang`); `getLang(): string`; `fmtDate(d)`, `fmtNum(n)` via `Intl`.

- [x] Write `tests/i18n.test.mjs`: loads both JSON files with `fs`, asserts identical key sets (recursive), asserts no empty strings
- [x] Run `node --test tests/` → fails (files missing)
- [x] Write both locale files (all keys for every screen, states, scenarios, disclaimers, aria labels) and `i18n.js`
- [x] Run `node --test tests/` → i18n tests pass

### Task 4: store + storage

**Files:** Create `app/js/state.js`, `app/js/storage.js`, `tests/storage.test.mjs`.

**Interfaces:**
- `state.js`: `store.get(key)`, `store.set(key, value)` (emits), `store.subscribe(key, fn): unsubscribe`. Keys used app-wide: `mode` (`"live"|"scenario"`), `status` (`{level,reasonKey,source,at}`), `scenario` (`{id,t,playing,speed}`), `feeds` (`{nws,rain,floodnet}` each `{state:"ok"|"unavailable", ...payload}`), `reports` (array), `lang`, `sensorStates` (Map id→`{depthIn,phase}`).
- `storage.js`: `loadKey(name, fallback)`, `saveKey(name, value)`, `wipeAll()` — JSON + try/catch, prefix `hfe.v1.`; quota errors surface as return `false`.

- [x] Write `tests/storage.test.mjs` incl. corrupted-JSON case (mock `globalThis.localStorage`)
- [x] Run → fail; implement; run → pass

### Task 5: status engine

**Files:** Create `app/js/status-engine.js`, `tests/status-engine.test.mjs`.

**Interfaces:** `computeStatus({nwsWarning, nwsWatch, maxSensorDepthIn, reportsLast3h, scenarioLevel}) → {level, reasonKey}`; `THRESHOLDS = {curbIn: 6, carDoorIn: 12, watchDepthIn: 2, watchReports: 2, dangerReports: 3}` exported. Logic per PRD §6.3; `scenarioLevel` (from replay alert events) overrides upward only.

- [x] Tests: calm default; watch via watch-alert / 2–6 in / 2 reports; warning via warning-alert or ≥6 in; danger via ≥12 in or warning+3 reports; scenario override; boundary values (6, 12 exactly)
- [x] Run → fail; implement; run → all pass

### Task 6: app shell (HTML/CSS/router)

**Files:** Create `app/index.html`, `app/css/tokens.css`, `app/css/base.css`, `app/css/components.css`, `app/css/print.css`, `app/js/main.js`.

Shell contains: CSP meta (PRD §9.2 allowlist incl. verified FloodNet origin), `<header>` (app name, lang toggle EN|ES, About button), `<nav>` bottom tab bar (4 real links `#/home #/map #/report #/plan`, aria-current), `<main>` with four `<section role="tabpanel-like view">` (hidden attr toggled by router), first-run disclaimer dialog (`<dialog>`, PRD §9.5), About dialog with attribution (PRD §9.6), global `aria-live` regions (assertive + polite), demo watermark strip (hidden in live mode), toast container. Tokens: light+dark (media + manual `data-theme`), status colors w/ AA-checked text pairs, focus ring, 44px targets, reduced-motion.

- [x] Write all files; router shows/hides views, moves focus to view `h1`, updates `aria-current`
- [x] Verify: open in headless browser → screenshot shows shell, nav works via hash change, no console errors, axe-style manual checks (landmarks, labels)

### Task 7: live feeds + Home view

**Files:** Create `app/js/live-feeds.js`, `app/js/home-view.js`; modify `app/js/main.js` (boot wiring).

**Interfaces:** `startLiveFeeds()` — NWS `GET https://api.weather.gov/alerts/active?point=40.79,-73.945` (8s timeout, backoff ×3, updates `feeds.nws`: `{state, warning:bool, watch:bool, headline}`), Open-Meteo 15-min precip (`feeds.rain`), FloodNet live if endpoint verified reachable else mark unavailable (`feeds.floodnet`). `initHomeView(root)` renders status card (F-1.1: icon+text+color+timestamp+source), context strip (F-1.2 with provenance tags), next-action button (F-1.3 state-dependent), demo button (F-1.4). Subscribes to `status`, `feeds`, `scenario`, `lang`. Status recomputed on any input change via Task 5 engine; escalations announced in assertive region.

- [x] Implement; verify online (NWS reachable → CALM w/ live tag) and offline (UNAVAILABLE tags, no errors)

### Task 8: scenario player + demo picker

**Files:** Create `app/js/scenario-player.js`; modify `home-view.js` (picker dialog).

**Interfaces:** `loadScenario(id): Promise` (fetch `data/scenario_<id>.json`), `play()`, `pause()`, `setSpeed(1|10|60)`, `seek(isoOrMs)`, `exitScenario()`, `onTick` → updates `store: scenario, sensorStates, status(scenarioLevel), mode`. Timeline advances by scaled wall clock; reduced-motion = discrete jumps at bookmarks. Picker dialog lists 3 scenarios + descriptions + RECORDED/SIMULATION badges; transport bar (play/pause/speed/scrub/bookmarks/exit) rendered into watermark strip; watermark always visible while `mode==="scenario"` (F-5.3).

- [x] Implement; verify: play may20 at 60× — status escalates per alert events, scrub and bookmarks work, exit returns to live, deterministic on replay

### Task 9: Map view

**Files:** Create `app/js/map-view.js`; modify `main.js`.

**Interfaces:** `initMapView(root)` — Leaflet map (`keyboard:true`), 3 base layers (OSM streets default / OpenTopoMap / Esri satellite), layer groups: pois (6 types), floodZones, routes, sensors, reports; popups DOM-built (name, address, tel: link, risk badge icon+text, pet flag, directions link `https://www.google.com/maps/dir/?api=1&destination=lat,lng`); toggle panel = real checkboxes, persisted; quick actions (nearest hospital/shelter/highground from geoloc or center, straight polyline + distance, destination risk surfaced; show-routes; locate-me w/ denial fallback toast); **List view** `<details>` per layer: accessible table name/distance/risk/phone (F-2.2, §8); sensor markers restyle from `sensorStates` (dry/minor/flooded = icon+color+depth label in/cm); report pins from `reports`; complaint pins during replay; auto-fit scenario bounds; legend for route classes.

- [x] Implement; verify: layers toggle, popups keyboard-openable, replay animates markers, list views populated, offline shows data w/o tiles + notice

### Task 10: Report view

**Files:** Create `app/js/report-view.js`.

**Interfaces:** `initReportView(root)` — three depth pictogram buttons (SVG figures: ankle/knee/waist + bilingual labels, `role=radiogroup`); location auto via geolocation on user tap w/ explanation + map-pin fallback + skip; photo input → canvas re-encode (max 1280px, JPEG 0.8, strips EXIF) → dataURL, 5 MB total budget w/ oldest-evict + notice; note ≤280 chars (textContent only); safety interstitial before first report while status ≥ WARNING (F-3.6); submit → `reports` store + storage, confirmation toast + SCI-protocol explainer, "Clear my reports" control. Target <10 s flow.

- [x] Implement; verify: submit incl. `<script>` note renders inert; photo re-encoded (no EXIF: check bytes for "Exif" marker absent); appears on map instantly

### Task 11: My Plan view + print

**Files:** Create `app/js/plan-view.js`; modify `app/css/print.css`.

**Interfaces:** `initPlanView(root)` — address/point risk lookup: geocode-free (user drops pin on mini-map or picks saved location) → nearest `eh_elevation` cell + point-in-polygon vs floodZones → LOW/MODERATE/HIGH w/ plain-language explanation + disclaimer (F-4.1, §9.5); safe haven assignment: nearest + backup from shelters+highground w/ walking distance @ 3 mph, risk badge, pet flag (F-4.2); pet plan checklist + pet-friendly list w/ "sample — verify" tags (F-4.3); go-bag & before-storm checklists (F-4.4, persisted); contacts ≤5 name+phone (F-4.5); Settings: theme toggle, erase-all-data (confirm dialog); Print button → `window.print()`, print.css renders full plan 1–2 pages, bilingual per current lang (F-4.6).

- [x] Implement; verify: EH point returns sane risk; print preview clean; erase-all wipes and reloads

### Task 12: Acceptance pass (PRD §10.2)

- [x] `node --test tests/` all pass
- [x] Offline open from disk: loads, CALM, UNAVAILABLE tags, layers render
- [x] Online: NWS ok or graceful; EN→ES flips everything incl. `<html lang>`
- [x] Replay may20 60×: escalation, watermark, scrub, reduced-motion jumps
- [x] EH simulation: SIMULATION watermark, EH framing
- [x] Report with XSS note + photo: <10 s, inert, EXIF-free, pinned
- [x] Plan: risk + haven + pet + disclaimer; print clean
- [x] Keyboard-only walkthrough; headless screenshots light/dark/mobile reviewed; contrast spot-check
- [x] Payload check: `app/` non-tile payload ≤ 2 MB (excl. vendor images ok)

## Self-review

- Spec coverage: F-1.*→Task 7; F-2.*→Task 9; F-3.*→Task 10; F-4.*→Task 11; F-5.*→Task 8; §5→Task 2; §6.3→Task 5; §7→Task 3; §8→Tasks 6–12; §9→Tasks 2,6,10; §10→Tasks 3–5,12. Gaps: none found.
- Types/interfaces consistent (store keys, scenario JSON shape, sensors/pois schemas quoted identically in consuming tasks).
- No placeholder steps; code-level detail intentionally lives at interface level because a single agent executes end-to-end in-session.
