# Harlem FloodEscape (v0.1 demo prototype)

East Harlem flood resiliency web app — research prototype.
Richard Rivera, CUNY Graduate Center · NOAA CESSRST-II #NA22SEC4810016.

**Not an official emergency service. In an emergency call 911. For official alerts use Notify NYC.**

## Run it

Double-click **`Start FloodEscape.bat`** (Windows). It serves the `app/` folder at
http://localhost:8123 and opens your browser. Works with no internet connection —
live feeds show "unavailable" and map tiles may be blank, but every feature,
scenario replay, and dataset works offline.

(Any static server works: `cd app && python -m http.server 8123`.)

## What's inside

- `app/` — the entire application (static: HTML/CSS/JS + vendored Leaflet + JSON data)
- `tools/build_data.py` — regenerates `app/data/*.json` from the raw research CSVs
  in `../Data/` (`python tools/build_data.py`; needs pandas)
- `tests/` — unit tests: `node --test tests/`
- `docs/PRD.md` — full product requirements document
- `docs/plans/` — implementation plan

## Demo script (suggested)

1. Open the app — Home shows the live status (CALM on a dry day) with data
   provenance chips.
2. Toggle **ES** — the entire app switches to Spanish, including warnings.
3. **Demo scenarios → The Jamaica Flash Flood (May 20, 2026)** — watch status
   escalate CALM → WATCH → WARNING → DANGER as recorded sensors flood; open the
   Map to see it happen; scrub the timeline.
4. **What if it happened here?** — the same storm pattern on East Harlem streets
   (watermarked SIMULATION).
5. **Report** — submit an ankle-deep report with a photo; it appears on the map.
6. **My Plan** — drop a pin, get block risk + safe havens + pet plan; print it.

## Data honesty

Every surface is labeled LIVE / RECORDED / SIMULATION / SAMPLE. The two replay
scenarios use real FloodNet sensor events and real 311 complaints (coordinates and
timestamps as recorded). The East Harlem scenario is a simulation and says so at
all times. Pet policies are demo placeholders pending community verification.
