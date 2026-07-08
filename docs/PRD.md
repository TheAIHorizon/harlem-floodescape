# Harlem FloodEscape — Product Requirements Document (PRD)

| | |
|---|---|
| **Product** | Harlem FloodEscape — East Harlem Flood Resiliency Web App (demo prototype) |
| **Version** | 1.0 (PRD), targeting Prototype v0.1 |
| **Author** | Richard Rivera (PhD Student, Earth & Environmental Science, CUNY Graduate Center; NOAA CESSRST-II Fellow), with Claude |
| **Date** | July 7, 2026 |
| **Status** | Approved for implementation planning |
| **Audience of this document** | The implementing agent/developer. Read fully before writing code. |

---

## 1. Purpose & Background

### 1.1 Why this app exists

East Harlem (El Barrio, Manhattan Community District 11) is one of the most socially
vulnerable neighborhoods in New York City (CDC SVI = 1.0, the maximum), built on former
marshland and compressible glacial-lake sediments. Current flood-warning systems are
"one-size-fits-all": they ignore language barriers, aging infrastructure, mobility
constraints, and distrust of official channels.

Analysis of 2.5 years of raw data (Jan 2024 – Jun 2026) behind this dissertation
established four facts that this app answers directly:

1. **Flash floods are flash.** Median 38 minutes from onset to peak depth; 43% peak
   within 30 minutes. On May 20, 2026, sensors in Jamaica, Queens went from dry to
   32–46 inches within a 12-minute window. → *Warnings must be immediate and hyperlocal.*
2. **Flood burden is radically concentrated.** Oct 30, 2025 alone produced 10.4% of all
   311 street-flooding complaints in the record; the top 20 days hold ~30%.
   → *The app must have a quiet everyday mode and an emergency mode.*
3. **East Harlem is nearly invisible in official data** — 15 of 8,599 complaints
   (0.17%) despite maximal vulnerability. → *The app must make community reporting
   effortless, turning residents into the sensors the neighborhood lacks.*
4. **Independent data streams corroborate and complement each other** (monthly
   precipitation→complaints Spearman ρ = 0.72; sensors catch shallow floods people
   never report). → *The app fuses official alerts, sensor telemetry, and community
   reports — the dissertation's "quadrangulation."*

### 1.2 What this build is (and is not)

This is a **demo prototype**: good enough to show a dissertation committee, the
Community Review Board, WE ACT, Community Board 11, and CESSRST audiences how such a
tool saves lives, prevents injury, and protects property and pets. It is **not** a
production emergency service. It must *look and behave* credible, be robust in a live
demo (including offline at a poster session), and be honest about what is real data,
what is live data, and what is simulation.

### 1.3 Success criteria for the demo

- A viewer watching the May 20, 2026 replay says "I understand what residents would
  have seen that night."
- The full app can be switched to Spanish live, mid-demo, with complete parity.
- A flood report can be submitted in under 10 seconds and appears on the map.
- The app is operable with keyboard only and with a screen reader.
- The app opens and functions from a local folder with no internet connection
  (live-data panels degrade gracefully).

---

## 2. Users

| User | Context | Needs |
|---|---|---|
| **East Harlem resident (primary persona)** | On a phone, possibly Spanish-dominant, possibly older or with low vision, possibly with pets, during a rain emergency | Am I in danger *right now*? Where do I go? What route is safe? Can I bring my dog? |
| **Resident (blue-sky day)** | Curious, preparing after a community workshop | What's my block's risk? Make a household plan. Learn safe havens. |
| **Community scientist** | Trained via the dissertation's Phase 2 program | Report flooding fast; see their report matter. |
| **Demo audience** | Committee, CRB, CESSRST poster session, community partners | See the value proposition quickly; trust the data provenance. |

Accessibility personas are first-class: a low-vision user with 200% zoom and high
contrast, a screen-reader user, a keyboard-only user, and a user with limited English
proficiency are all expected demo cases.

---

## 3. Goals and Non-Goals

### Goals (v0.1)

1. Four-screen mobile-first web app: **Home/Status, Map, Report, My Plan**.
2. **Live mode**: real-time NWS alerts and (if reachable) FloodNet sensor data.
3. **Replay mode**: three scenarios driven by the real datasets —
   Oct 30 2025, May 20 2026, and a clearly-labeled simulated East Harlem scenario.
4. **Full English/Spanish parity** with an always-visible toggle.
5. **WCAG 2.1 AA conformance** (see §8).
6. Runs as a static site: no server, no build step required to open, no accounts.
7. Honest data provenance labeling everywhere (LIVE / RECORDED / SIMULATION).

### Non-Goals (v0.1 — do not build)

- No backend, database, user accounts, or push notifications (browser notifications
  optional stretch, §12).
- No real-time routing engine (routes are pre-authored polylines, not turn-by-turn).
- No actual submission of reports to any authority (reports stay on-device; the demo
  narrative explains where they *would* go).
- No native app / app store presence.
- No analytics, telemetry, or tracking of any kind.

---

## 4. Feature Requirements

Every user-visible string in every feature exists in English and Spanish (§7).
Every feature must meet the accessibility requirements (§8).

### 4.1 Home / Status screen

The answer to "how worried should I be right now," readable in 3 seconds.

**F-1.1 Status card.** A large banner card showing one of four states. State is
computed by the Status Engine (§6.3):

| State | Color token | Meaning (EN) |
|---|---|---|
| CALM | green | No flood threat detected |
| WATCH | yellow | Conditions favor flooding — stay aware |
| WARNING | orange | Flooding likely or beginning — act now |
| DANGER | red | Flooding in progress — move to safety |

Requirements: state is conveyed by **color + icon + text** (never color alone);
state changes are announced via an `aria-live="assertive"` region; the card includes
the timestamp and source of the determination (e.g., "NWS Flash Flood Warning,
7:02 PM" or "REPLAY: May 20, 2026").

**F-1.2 Context strip.** Under the card: current/most-recent rainfall figure, nearest
sensor status (name + depth), and count of community reports in the last 3 hours.
Each item labels its provenance (LIVE / RECORDED / SIMULATION / UNAVAILABLE).

**F-1.3 One next action.** A single prominent button whose label depends on state:
CALM → "Review my plan" (→ My Plan); WATCH → "Check my route" (→ Map with user's
saved route); WARNING/DANGER → "Go to my safe haven" (→ Map, route highlighted,
nearest safe haven popup open).

**F-1.4 Demo control.** A visibly-labeled "Demo scenarios" button (not hidden — the
demo is a feature, not a cheat) opening the scenario picker (§4.5).

### 4.2 Map screen

An upgraded, accessible successor to the existing `HARLEM.EVAC.MAP.html` prototype.
Reuse its content; rebuild its implementation.

**F-2.1 Base map.** Leaflet with three switchable bases (streets default, topo,
satellite). Leaflet JS/CSS are **vendored locally** (no CDN at runtime, §9.2).
Tiles come from the network; when offline, show cached tiles if present and a
non-blocking "map tiles unavailable offline" notice; all layer data still renders.

**F-2.2 Resource layers** (toggleable, all keyboard-operable, state persisted):
hospitals (5), FDNY (4), NYPD (2), shelters (3), subway (5), high-ground points (4),
flood-hazard polygons, evacuation routes (8). Seed content: the arrays in
`HARLEM.EVAC.MAP.html` (names, addresses, phones, risk ratings, elevations,
route classifications), migrated into `data/pois.json` with EN/ES fields.
Each POI popup: name, address, tap-to-call phone, flood-risk badge (icon+text),
"Directions" link (opens device's map app via geo/Google URL), and **pet flag** (§4.4).

**F-2.3 Sensor layer.** FloodNet sensor markers with state (dry / minor / flooded,
depth in inches AND cm). In live mode: fetched from the FloodNet public API (§6.2);
in replay: driven by the scenario timeline. Sensor positions come from
`data/sensors.json` (built from FloodNet metadata; §5.2).

**F-2.4 Community report layer.** Reports (from this device plus scenario-seeded
ones) as distinct pins with depth pictogram, relative time, and photo thumbnail if
attached.

**F-2.5 Route classification.** Keep the three-class route styling (safe-elevated /
standard / flood-prone) with a visible legend; class conveyed by color + line pattern
+ label.

**F-2.6 Quick actions.** Nearest hospital / shelter / high ground (straight-line
route drawn, distance shown, flood-risk of destination surfaced), "Show evac routes,"
"Locate me" (geolocation with graceful denial handling — falls back to neighborhood
center with a notice).

**F-2.7 Replay visualization.** During a replay, the map animates: sensor markers
escalate, 311 complaint pins appear (from real coordinates in the 311 dataset),
depth labels update, and a time scrubber shows scenario progress. Citywide scenarios
auto-fit the affected bounds; the EH scenario stays on East Harlem. A persistent
watermark states the scenario name and RECORDED or SIMULATION.

### 4.3 Report screen

The "resident becomes a sensor" feature. Target: complete in <10 seconds.

**F-3.1 Depth selector.** Three oversized pictogram buttons: ankle-deep (~6 in),
knee-deep (~18 in), waist-deep (~36 in) — pictures + bilingual labels, no numeric
input required.

**F-3.2 Location.** Auto-filled via geolocation (with manual map-pin fallback and a
plain-language explanation of why location is asked). Never required to proceed.

**F-3.3 Photo (optional).** Camera/file input. Client-side only: image is downscaled
(max 1280px), **EXIF metadata stripped** by re-encoding through canvas, stored as a
data URL in localStorage with a total storage budget (≤5 MB; oldest photos evicted
with notice).

**F-3.4 Optional note.** Free-text field (≤280 chars). Rendered anywhere only via
`textContent` (never innerHTML) — user text is untrusted (§9.3).

**F-3.5 Submission.** One tap → confirmation with the report pinned on the map.
Copy explains: "In the full program, this report would be calibrated and shared with
emergency managers (SCI protocol)." Reports persist in localStorage with a
"Clear my reports" control.

**F-3.6 Safety interstitial.** Before first report in WARNING/DANGER state, a
one-line safety notice: "Never enter floodwater to take a photo. / Nunca entre en
el agua para tomar una foto."

### 4.4 My Plan screen (blue-sky mode)

**F-4.1 Address risk lookup.** User enters address or picks a point; app returns a
block-level risk indicator (LOW/MODERATE/HIGH) computed from the elevation grid
(§5.2) + proximity to mapped flood-hazard polygons. Shown with plain-language
explanation ("Your block sits ~9 ft above sea level, near a mapped flood-prone
area"). Include the disclaimer (§9.5).

**F-4.2 Safe haven assignment.** Based on location: nearest + backup safe haven
(from high-ground/shelter POIs), each with walking distance, flood-risk badge, and
pet policy flag.

**F-4.3 Pet plan.** Pet-friendly locations flagged on POIs (`petFriendly:
true/false/unknown`); a pet go-bag checklist (carrier, leash, 3-day food/water, meds,
vaccine records, photo of pet, litter). **v0.1 pet-policy values are demo
placeholders and must be marked "sample — verify with facility"** until confirmed
through community partners.

**F-4.4 Go-bag & household checklist.** Interactive checkboxes (persisted):
documents, medications, water, flashlight, charger, cash, contacts card. Separate
short list of "before the storm" home actions (move valuables up, charge phone,
know your shutoffs).

**F-4.5 Household contacts.** Up to 5 name+phone entries, stored locally only.

**F-4.6 Print view.** A print stylesheet renders the whole plan (risk, havens,
routes summary, checklists, contacts) as a clean 1–2 page document, bilingual per
current language. Paper is an accessibility and equity feature.

### 4.5 Scenario / Replay engine

**F-5.1 Scenario picker.** Three scenarios + "Return to live":

| ID | Name | Basis | Coverage |
|---|---|---|---|
| `oct30-2025` | "The October Surge" | 896 complaints + 128 sensor events, real coordinates/timestamps | Citywide |
| `may20-2026` | "The Jamaica Flash Flood" | 105 sensor events incl. 46.1 in max; five sensors peaking in a 12-min window | Citywide |
| `eh-simulation` | "What If It Happened Here" | May 20 depth/timing pattern transposed onto East Harlem low-elevation blocks (from elevation grid + existing flood polygons) | East Harlem |

**F-5.2 Timeline playback.** Each scenario is a pre-generated JSON timeline of
events (sensor readings, 311 reports, alert transitions) with wall-clock timestamps.
Controls: play/pause, speed (1×/10×/60×), scrub bar, "jump to key moment" bookmarks
(e.g., "7:08 PM — first sensor triggers"). All app surfaces (status card, map,
context strip) subscribe to scenario time.

**F-5.3 Provenance watermark.** While any scenario is active, a persistent,
non-dismissable banner: "REPLAY — recorded data from [date]" or "SIMULATION — not a
real event," in the current language, plus a one-tap exit back to live mode.

**F-5.4 Determinism.** Replays are fully deterministic (same input JSON → same
playback) so the demo never surprises the presenter.

---

## 5. Data

### 5.1 Principles

- All demo data derives from the researcher's real datasets wherever possible.
- Every displayed datum is labeled LIVE / RECORDED / SIMULATION / SAMPLE.
- Raw CSVs are **not** shipped to the browser; a one-time extraction script produces
  compact JSON (total data payload target ≤ 2 MB excluding map tiles).

### 5.2 Build-time extraction (script: `tools/build_data.py`)

Reads from `d:\coderepo\demo4\Data\` and writes to `app/data/`:

| Output | Source | Contents |
|---|---|---|
| `scenario_oct30-2025.json` | FloodNet CSV + 311 CSV filtered to 2025-10-29→31 | Timestamped sensor events (name, id, depth series simplified to ≤20 points/event), 311 complaints (lat/lon, created time, borough) |
| `scenario_may20-2026.json` | Same, filtered to 2026-05-20→21 | Same structure |
| `scenario_eh-simulation.json` | May 20 pattern + elevation grid + flood polygons | Synthetic sensor/report events at real EH low-lying locations; `"simulated": true` on every record |
| `eh_elevation.json` | Elevation NYC CSV (clipped to East Harlem bbox ~40.777–40.812, −73.960–−73.925; malformed rows dropped) | Downsampled grid for address risk lookup |
| `sensors.json` | FloodNet public metadata API (fetched once at build time), fallback: hand-mapped coordinates for the ~40 sensors appearing in the two replay days | id, name, lat, lon, borough; `"approx": true` where geocoded from cross-streets |
| `pois.json` | Migrated from `HARLEM.EVAC.MAP.html` arrays | POIs with EN/ES name/notes, risk, petFriendly, phone, elevation |

Known data-quality rules the script must enforce (from the data analysis):
CoCoRaHS zeros before Mar 2026 are missing data, not measurements — CoCoRaHS is
**excluded** from v0.1; FloodNet numeric columns require `to_numeric(errors=coerce)`;
311 dates parse as `"%Y %b %d %I:%M:%S %p"`.

### 5.3 Live data (runtime, §9.2 allowlist)

| Source | Endpoint | Use | Failure behavior |
|---|---|---|---|
| NWS alerts | `https://api.weather.gov/alerts/active?point=40.79,-73.945` (no key) | Status engine input; alert text shown on Home | Show "alert feed unreachable," status falls back to sensor/rain inputs |
| FloodNet | Public API (implementer must verify current endpoint & terms at build time; the project is public/open) | Live sensor states | Sensor layer shows last-known/none + UNAVAILABLE tag |
| Open-Meteo (optional) | `https://api.open-meteo.com/v1/forecast?...&minutely_15=precipitation` (no key) | Rain context on Home | Hide rain tile |

All fetches: 8 s timeout, exponential backoff, never block UI, HTTPS only.

### 5.4 Client-side storage (localStorage, no cookies)

Namespaced keys `hfe.v1.*`: language, saved address/point (opt-in), plan checklists,
contacts, reports (with photos, ≤5 MB budget), layer toggles. A Settings section in
My Plan provides "Erase all my data" (full wipe + confirmation). No data leaves the
device. No third-party requests beyond §5.3 + map tiles.

---

## 6. Architecture

### 6.1 Stack

- **Vanilla JavaScript (ES modules), HTML, CSS.** No framework, no build step
  required to run (the data-extraction script is offline tooling, not a bundler).
- **Leaflet 1.9.x, vendored** into `app/vendor/leaflet/`.
- No other runtime dependencies. No CDN requests at runtime.

### 6.2 Module layout

```
FloodEscape-App/
├── docs/PRD.md                  (this document)
├── tools/build_data.py          (CSV → JSON extraction, §5.2)
├── app/
│   ├── index.html               (single page, 4 views + landmarks)
│   ├── css/  (tokens.css, base.css, components.css, print.css)
│   ├── js/
│   │   ├── main.js              (boot, router: hash-based #/home #/map #/report #/plan)
│   │   ├── state.js             (app store: pub/sub, single source of truth)
│   │   ├── status-engine.js     (§6.3)
│   │   ├── live-feeds.js        (NWS/FloodNet/Open-Meteo fetchers)
│   │   ├── scenario-player.js   (timeline playback, §4.5)
│   │   ├── map-view.js          (Leaflet init, layers, a11y wiring)
│   │   ├── report-view.js       (form, photo pipeline)
│   │   ├── plan-view.js         (risk lookup, checklists, print)
│   │   ├── i18n.js              (§7)
│   │   └── storage.js           (namespaced localStorage wrapper + quota handling)
│   ├── data/                    (generated JSON, §5.2)
│   ├── i18n/ (en.json, es.json)
│   └── vendor/leaflet/
```

Each module has one purpose, communicates through `state.js` events, and is
independently testable. No module reaches into another's DOM.

### 6.3 Status engine (deterministic, testable)

Inputs: active NWS alerts, sensor max depth (live or scenario), community reports
count (3 h), scenario override. "Nearby sensor" means within the East Harlem
bounding box (§5.2) in live mode, or any scenario-active sensor during replay.
Highest applicable state wins:

| Condition | State |
|---|---|
| NWS Flash Flood **Warning** for the area, OR any nearby sensor ≥ 6 in, OR scenario says so | DANGER if sensor ≥ 12 in or Warning + reports ≥ 3; else WARNING |
| NWS Flash Flood **Watch**, OR sensor 2–6 in, OR reports ≥ 2 in 3 h | WATCH |
| None of the above | CALM |

Thresholds live in one config object (`status-engine.js` top) with citations to the
data analysis (6 in ≈ curb height; 26% of recorded events exceed it; 12 in ≈ car-door
height; 7% exceed it). Unit-test this module (§10).

---

## 7. Internationalization (bilingual EN/ES)

- **Full parity**: every string, label, alert, aria-label, checklist item, scenario
  description, and disclaimer exists in `i18n/en.json` and `i18n/es.json`. A missing
  key fails loudly in console and falls back to English visibly (`⚠︎` marker in dev).
- Language toggle (EN | ES) is persistent, visible on every screen (header), operable
  by keyboard, and switches the **entire live DOM immediately** — no reload. `<html
  lang>` updates accordingly (screen readers switch voices).
- Spanish is written for the community, not machine-glossed: use "El Barrio,"
  plain-language weather terms (e.g., "inundación repentina" for flash flood).
  Translation review by a native speaker is a pre-demo checklist item.
- Numbers/dates localize (`Intl.DateTimeFormat`, `Intl.NumberFormat`); depths show
  inches with cm secondary.

---

## 8. Accessibility (WCAG 2.1 AA — non-negotiable)

- **Structure:** semantic landmarks (`header/nav/main`), one `h1` per view, real
  `<button>`/`<a>`/`<label>` elements (the old map's clickable `div`s are explicitly
  forbidden), logical tab order, visible focus indicators (≥3:1 contrast, never
  `outline: none` without replacement).
- **Status changes** announced via `aria-live` (assertive for state escalation,
  polite for context updates). The four states are distinguishable by icon + text +
  color (SC 1.4.1).
- **Contrast:** text ≥ 4.5:1 (≥3:1 for large text), UI components ≥ 3:1, in both a
  light and dark theme (`prefers-color-scheme` + manual toggle).
- **Touch targets** ≥ 44×44 px; layout works at 200% zoom and 320 px width without
  horizontal scroll (SC 1.4.10); `prefers-reduced-motion` disables replay animations
  (map jumps to states instead of animating).
- **Map accessibility:** the map itself is exempt-ish canvas, but every capability
  reachable on the map is also reachable without it: a **"List view"** twin of each
  layer (accessible table: name, distance, risk, phone) and text descriptions of the
  active scenario state. Marker popups are keyboard-openable (Leaflet
  `keyboard: true`, focus management on popup open/close).
- **Forms:** labels always visible (no placeholder-as-label), errors as text near
  the field + `aria-describedby`, no time limits on anything.
- **No `alert()`/`confirm()`** — accessible modal/toast components only.
- **Verification:** axe-core scan (0 critical/serious), keyboard-only walkthrough of
  all four screens + a replay, screen-reader smoke test (NVDA or VoiceOver) of Home
  status change and Report submission. These are acceptance gates (§10).

---

## 9. Security, Privacy & Safety

### 9.1 Threat model (static demo app)

No server = no server-side attack surface. Remaining risks: supply chain (vendored
libs), XSS via user-entered text/data files, privacy of stored personal data
(address, contacts, photos), misleading users about emergency reality.

### 9.2 Content Security Policy & network

- CSP via `<meta http-equiv="Content-Security-Policy">`:
  `default-src 'self'; img-src 'self' data: https://*.tile.openstreetmap.org
  https://server.arcgisonline.com https://*.basemaps.cartocdn.com
  https://*.tile.opentopomap.org; connect-src 'self' https://api.weather.gov
  https://api.open-meteo.com <floodnet-api-origin>; style-src 'self';
  script-src 'self'; object-src 'none'; base-uri 'none'`.
  (Adjust tile hosts to those actually used; keep the allowlist minimal.)
- No inline scripts/styles (CSP-enforced). No third-party JS. Leaflet vendored at a
  pinned version with its integrity recorded in `vendor/README.md`.
- All external requests HTTPS. No cookies. No analytics.

### 9.3 Input handling

- All user text (notes, contact names, addresses) and all names arriving from data
  files/APIs are inserted via `textContent`/`createTextNode` — **never** string-built
  HTML. Leaflet popups built with DOM nodes, not HTML strings.
- Photos: re-encoded via canvas (strips EXIF/GPS), size-capped, `data:` URLs only.
- localStorage values are JSON-parsed inside try/catch with schema defaults
  (corrupted storage must never brick the app).

### 9.4 Privacy

- Everything personal stays on-device; state this plainly in the About screen.
- Geolocation is requested only on user action, with a pre-permission explanation,
  and every feature has a no-location fallback.
- "Erase all my data" control (§5.4).

### 9.5 Safety disclaimers (legal/ethical, load-bearing)

- Persistent About-screen text + first-run notice (dismissable, re-viewable):
  **"Harlem FloodEscape is a research prototype from CUNY, not an official emergency
  service. In an emergency call 911. For official alerts use Notify NYC."** (EN/ES.)
- Risk lookups carry: "Estimate for research demonstration — not a flood insurance
  or safety determination."
- Simulation scenario is watermarked at all times (F-5.3).
- Never instruct users to *enter* floodwater; report flow includes the §F-3.6 notice.

### 9.6 Attribution

About screen and footer: Richard Rivera, CUNY Graduate Center; supported by NOAA
CESSRST-II Cooperative Agreement **#NA22SEC4810016** (EPP/MSI), with the standard
disclaimer that findings are the author's and not necessarily NOAA's. Data credits:
NYC FloodNet, NYC OpenData (311), NOAA/NWS, OpenStreetMap contributors, and the
East Harlem community partners (CB11, WE ACT, Maggie's Magic Garden).

---

## 10. Quality & Acceptance

### 10.1 Automated (lightweight, no heavy toolchain)

- Unit tests for `status-engine.js`, `i18n.js` (key parity check EN↔ES — build fails
  if either file is missing a key), `storage.js` (corruption handling), and the
  scenario timeline reducer. Plain JS test runner (e.g., `node --test`).
- `tools/build_data.py` validates its outputs (row counts, coordinate bounds, no
  NaNs) and prints a summary; failures are fatal.

### 10.2 Manual acceptance script (the demo IS the test)

1. Open `app/index.html` from disk, offline → app loads, CALM state, "live data
   unavailable" tags visible, map renders layer data (tiles may be absent).
2. Online → NWS fetch succeeds (or fails gracefully); language toggle EN→ES flips
   every visible string incl. status card; `<html lang="es">`.
3. Run **May 20, 2026** replay at 60×: status escalates CALM→WATCH→WARNING→DANGER;
   sensor markers animate; watermark persists; pause/scrub works;
   `prefers-reduced-motion` disables animation.
4. Run **EH simulation**: SIMULATION watermark; East Harlem framing; routes light up.
5. Submit a report (knee-deep, photo, note with `<script>alert(1)</script>` as text)
   → appears as pin, note rendered inert as text, photo EXIF-free, < 10 s end-to-end.
6. My Plan: enter an EH address → risk + safe haven + pet flag + disclaimer; print
   view produces a clean bilingual page.
7. Keyboard-only pass of all of the above; axe scan 0 critical/serious; NVDA hears
   the status escalation announced.

### 10.3 Performance

First load ≤ 2 MB app payload (excl. tiles); interactive < 3 s on a mid-range phone;
replay playback smooth at 10× (throttle timeline ticks, not rAF).

---

## 11. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| FloodNet API endpoint/terms unclear or changed | Verify at build start; the app is fully demo-capable without it (replay uses local JSON) |
| Sensor coordinates unavailable for some replay sensors | `"approx": true` geocoding from cross-street names; label as approximate |
| Spanish quality | Native-speaker review before any community-facing demo |
| Pet-policy accuracy | Ship as "sample — verify" until partners confirm (F-4.3) |
| Demo venue has no internet | Offline-first acceptance test #1; consider pre-cached tile pack for EH bbox as stretch |
| Scope creep | Non-goals list (§3) is binding for v0.1 |

## 12. Stretch (only after v0.1 acceptance passes)

Browser notifications on state escalation; EH tile pre-cache for full offline maps;
service worker/PWA install; simple report clustering; a "workshop mode" that blanks
seeded data for co-design sessions.

---

*End of PRD. Implementation should proceed via a written plan (superpowers
writing-plans) referencing section numbers (F-x.x) as requirement IDs.*
