# -*- coding: utf-8 -*-
"""Harlem FloodEscape data pipeline (PRD section 5.2).

Reads the researcher's raw CSVs and the cached FloodNet deployments file,
writes compact JSON into app/data/. Fatal on validation failure.

Usage: python tools/build_data.py
"""
import json
import math
import sys
import hashlib
from pathlib import Path

import pandas as pd
import numpy as np

ROOT = Path(__file__).resolve().parent.parent          # FloodEscape-App/
DATA_SRC = ROOT.parent / "Data"                        # demo4/Data/
OUT = ROOT / "app" / "data"
DEPLOYMENTS_CACHE = ROOT / "tools" / "floodnet_deployments.json"

EH_BBOX = (40.777, -73.960, 40.812, -73.925)           # s, w, n, e
CURB_IN = 6.0
CAR_DOOR_IN = 12.0

BORO_ANCHORS = {  # fallback placement for sensors with no matched coordinates
    "BX": (40.8448, -73.8648), "BK": (40.6782, -73.9442), "Q": (40.7282, -73.7949),
    "M": (40.7900, -73.9470), "SI": (40.5795, -74.1502),
}


def fail(msg):
    print(f"FATAL: {msg}", file=sys.stderr)
    sys.exit(1)


def load_floodnet():
    fn = pd.read_csv(DATA_SRC / "FloodNet Data 2024-2026.csv")
    for col in fn.columns:
        if "(minutes)" in col or "(inches)" in col:
            fn[col] = pd.to_numeric(fn[col], errors="coerce")
    fn["start"] = pd.to_datetime(fn["Flood Start Datetime (GMT)"],
                                 format="%m/%d/%y %H:%M", errors="coerce")
    fn["end"] = pd.to_datetime(fn["Flood End Datetime (GMT)"],
                               format="%m/%d/%y %H:%M", errors="coerce")
    fn = fn.dropna(subset=["start", "Maximum Flood Depth (inches)"])
    return fn


def load_311():
    c = pd.read_csv(DATA_SRC / "311 Street Flooding Complaints 2024-2026.csv",
                    low_memory=False)
    c["created"] = pd.to_datetime(c["Created Date"],
                                  format="%Y %b %d %I:%M:%S %p", errors="coerce")
    c = c.dropna(subset=["created", "Latitude", "Longitude"])
    return c


def load_deployments():
    if not DEPLOYMENTS_CACHE.exists():
        print("WARN: no deployments cache; all sensor coords will be approximate")
        return {}
    raw = json.loads(DEPLOYMENTS_CACHE.read_text(encoding="utf8"))
    by_name = {}
    for d in raw.get("deployments", []):
        loc = d.get("location") or {}
        coords = loc.get("coordinates")
        if coords and len(coords) == 2:
            by_name[d["name"].strip()] = (coords[1], coords[0])  # lat, lon
    return by_name


def approx_coord(sensor_name, sensor_id):
    """Deterministic borough-anchored placement for unmatched sensors."""
    prefix = sensor_name.split(" - ")[0].strip()
    base = BORO_ANCHORS.get(prefix, BORO_ANCHORS["Q"])
    h = hashlib.sha256(sensor_id.encode()).digest()
    dlat = (h[0] / 255 - 0.5) * 0.06
    dlon = (h[1] / 255 - 0.5) * 0.06
    return (round(base[0] + dlat, 6), round(base[1] + dlon, 6))


def sensor_timeline_events(row, sensor_id):
    """Expand one FloodNet event row into rise/peak/drain/end timeline entries."""
    start = row["start"]
    max_depth = float(row["Maximum Flood Depth (inches)"])
    t_to_peak = row.get("Time to Maximum Flood Depth (minutes)")
    total = row.get("Total Duration (minutes)")
    t_to_peak = float(t_to_peak) if pd.notna(t_to_peak) else 30.0
    total = float(total) if pd.notna(total) else t_to_peak * 2
    total = max(total, t_to_peak + 5)
    peak_t = start + pd.Timedelta(minutes=t_to_peak)
    end_t = start + pd.Timedelta(minutes=total)
    drain_t = peak_t + (end_t - peak_t) / 2
    return [
        {"t": start.isoformat() + "Z", "type": "sensor", "sensorId": sensor_id,
         "depthIn": round(max_depth * 0.3, 1), "phase": "rise"},
        {"t": peak_t.isoformat() + "Z", "type": "sensor", "sensorId": sensor_id,
         "depthIn": round(max_depth, 1), "phase": "peak"},
        {"t": drain_t.isoformat() + "Z", "type": "sensor", "sensorId": sensor_id,
         "depthIn": round(max_depth * 0.5, 1), "phase": "drain"},
        {"t": end_t.isoformat() + "Z", "type": "sensor", "sensorId": sensor_id,
         "depthIn": 0.0, "phase": "end"},
    ]


def synthesize_alerts(events):
    """Emit WATCH/WARNING/DANGER alert transitions from the event stream."""
    level_rank = {"CALM": 0, "WATCH": 1, "WARNING": 2, "DANGER": 3}
    depth_now = {}
    complaints = []
    out = []
    current = "CALM"
    for ev in events:
        t = ev["t"]
        if ev["type"] == "sensor":
            depth_now[ev["sensorId"]] = ev["depthIn"]
        elif ev["type"] == "complaint":
            complaints.append(pd.Timestamp(ev["t"].replace("Z", "")))
        max_depth = max(depth_now.values(), default=0.0)
        t_ts = pd.Timestamp(t.replace("Z", ""))
        recent = sum(1 for c in complaints if (t_ts - c) <= pd.Timedelta(hours=1))
        if max_depth >= CAR_DOOR_IN:
            level = "DANGER"
        elif max_depth >= CURB_IN or recent >= 20:
            level = "WARNING"
        elif max_depth >= 2 or recent >= 5:
            level = "WATCH"
        else:
            level = "CALM"
        # never de-escalate below WATCH mid-scenario (keeps demo legible)
        if level_rank[level] < level_rank[current] and level == "CALM":
            level = "WATCH"
        if level != current:
            out.append({"t": t, "type": "alert", "level": level})
            current = level
    return out


def build_scenario(sid, name_key, kind, fn, c311, t0, t1, deploy_coords,
                   sensors_registry):
    fw = fn[(fn["start"] >= t0) & (fn["start"] <= t1)]
    cw = c311[(c311["created"] >= t0) & (c311["created"] <= t1)]
    events = []
    for _, row in fw.iterrows():
        name = str(row["Sensor Name"]).strip()
        sensor_id = str(row["Sensor ID"]).strip()
        if sensor_id not in sensors_registry:
            if name in deploy_coords:
                lat, lon = deploy_coords[name]
                approx = False
            else:
                lat, lon = approx_coord(name, sensor_id)
                approx = True
            boro = name.split(" - ")[0].strip()
            sensors_registry[sensor_id] = {
                "id": sensor_id, "name": name, "lat": lat, "lon": lon,
                "borough": boro, "approx": approx,
            }
        events.extend(sensor_timeline_events(row, sensor_id))
    for _, row in cw.iterrows():
        events.append({
            "t": row["created"].isoformat() + "Z", "type": "complaint",
            "lat": round(float(row["Latitude"]), 5),
            "lon": round(float(row["Longitude"]), 5),
            "borough": str(row["Borough"]).title(),
        })
    events.sort(key=lambda e: e["t"])
    events = synthesize_alerts(events) + events
    events.sort(key=lambda e: e["t"])
    lats = [sensors_registry[e["sensorId"]]["lat"] for e in events if e["type"] == "sensor"]
    lons = [sensors_registry[e["sensorId"]]["lon"] for e in events if e["type"] == "sensor"]
    lats += [e["lat"] for e in events if e["type"] == "complaint"]
    lons += [e["lon"] for e in events if e["type"] == "complaint"]
    if not lats:
        fail(f"scenario {sid}: no events in window")
    bounds = [[round(min(lats) - 0.01, 4), round(min(lons) - 0.01, 4)],
              [round(max(lats) + 0.01, 4), round(max(lons) + 0.01, 4)]]
    first_sensor = next(e for e in events if e["type"] == "sensor")
    peak_ev = max((e for e in events if e["type"] == "sensor"), key=lambda e: e["depthIn"])
    first_danger = next((e for e in events if e["type"] == "alert" and e["level"] == "DANGER"), None)
    bookmarks = [{"t": first_sensor["t"], "labelKey": "scenario.bm.firstSensor"},
                 {"t": peak_ev["t"], "labelKey": "scenario.bm.deepest"}]
    if first_danger:
        bookmarks.insert(1, {"t": first_danger["t"], "labelKey": "scenario.bm.danger"})
    return {
        "id": sid, "nameKey": name_key, "kind": kind,
        "start": events[0]["t"], "end": events[-1]["t"],
        "bounds": bounds, "bookmarks": bookmarks, "events": events,
        "stats": {"sensorEvents": int(len(fw)), "complaints": int(len(cw)),
                  "maxDepthIn": float(fw["Maximum Flood Depth (inches)"].max())},
    }


# ---- EH simulation: transpose May 20 patterns onto East Harlem ----
EH_SIM_SITES = [
    # (id-suffix, name EN (used as-is), lat, lon) — real EH low-lying locations
    ("fdr-96", "SIM · E 96th St / FDR underpass", 40.7838, -73.9435),
    ("fdr-116", "SIM · E 116th St / FDR Drive", 40.7972, -73.9330),
    ("willis-125", "SIM · E 125th St / Willis Ave Bridge", 40.8037, -73.9310),
    ("tjpark", "SIM · Thomas Jefferson Park (1st Ave edge)", 40.7930, -73.9345),
    ("park-110", "SIM · E 110th St / Park Ave viaduct", 40.7947, -73.9440),
    ("lex-103", "SIM · E 103rd St / Lexington Ave", 40.7902, -73.9457),
]


def build_eh_simulation(fn, sensors_registry):
    t0 = pd.Timestamp("2026-05-20 00:00")
    t1 = pd.Timestamp("2026-05-21 12:00")
    fw = fn[(fn["start"] >= t0) & (fn["start"] <= t1)]
    top = fw.nlargest(len(EH_SIM_SITES), "Maximum Flood Depth (inches)")
    base = pd.Timestamp("2026-07-15 23:00")  # generic evening, 7 PM local (GMT-4)
    origin = top["start"].min()
    events = []
    for (site, (_, row)) in zip(EH_SIM_SITES, top.iterrows()):
        suffix, name, lat, lon = site
        sensor_id = f"sim-eh-{suffix}"
        sensors_registry[sensor_id] = {
            "id": sensor_id, "name": name, "lat": lat, "lon": lon,
            "borough": "M", "approx": False, "simulated": True,
        }
        shifted = row.copy()
        shifted["start"] = base + (row["start"] - origin)
        for ev in sensor_timeline_events(shifted, sensor_id):
            ev["simulated"] = True
            events.append(ev)
    events.sort(key=lambda e: e["t"])
    alerts = synthesize_alerts(events)
    for a in alerts:
        a["simulated"] = True
    events = sorted(alerts + events, key=lambda e: e["t"])
    peak_ev = max((e for e in events if e["type"] == "sensor"), key=lambda e: e["depthIn"])
    first_danger = next((e for e in events if e["type"] == "alert" and e["level"] == "DANGER"), None)
    bookmarks = [{"t": events[0]["t"], "labelKey": "scenario.bm.firstSensor"},
                 {"t": peak_ev["t"], "labelKey": "scenario.bm.deepest"}]
    if first_danger:
        bookmarks.insert(1, {"t": first_danger["t"], "labelKey": "scenario.bm.danger"})
    return {
        "id": "eh-simulation", "nameKey": "scenario.ehsim.name", "kind": "simulated",
        "start": events[0]["t"], "end": events[-1]["t"],
        "bounds": [[EH_BBOX[0], EH_BBOX[1]], [EH_BBOX[2], EH_BBOX[3]]],
        "bookmarks": bookmarks, "events": events,
        "stats": {"sensorEvents": len(EH_SIM_SITES), "complaints": 0,
                  "maxDepthIn": float(top["Maximum Flood Depth (inches)"].max())},
    }


def build_elevation():
    e = pd.read_csv(DATA_SRC / "Elevation NYC.csv", header=0)
    parts = e[e.columns[0]].str.split(",", expand=True)
    parts = parts.iloc[:, :3].apply(pd.to_numeric, errors="coerce")
    parts.columns = ["lon", "lat", "elev"]
    parts = parts.dropna()
    s, w, n, ee = EH_BBOX
    m = parts[(parts.lat >= s) & (parts.lat <= n) & (parts.lon >= w) & (parts.lon <= ee)]
    if len(m) < 1000:
        fail(f"elevation: only {len(m)} points in EH bbox")
    cell = 0.0005
    rows = int(math.ceil((n - s) / cell))
    cols = int(math.ceil((ee - w) / cell))
    ri = np.clip(((m.lat - s) / cell).astype(int), 0, rows - 1)
    ci = np.clip(((m.lon - w) / cell).astype(int), 0, cols - 1)
    grid = pd.DataFrame({"r": ri, "c": ci, "elev": m.elev.values})
    med = grid.groupby(["r", "c"])["elev"].median()
    flat = [None] * (rows * cols)
    for (r, c), v in med.items():
        flat[r * cols + c] = round(float(v), 1)
    return {"bbox": list(EH_BBOX), "cell": cell, "rows": rows, "cols": cols,
            "elev": flat, "units": "feet",
            "pointsUsed": int(len(m))}


# ---- POIs migrated from HARLEM.EVAC.MAP.html (PRD F-2.2), with ES + pet flags ----
POIS = [
    # hospitals
    dict(id="h1", type="hospital", en="Metropolitan Hospital Center", es="Hospital Metropolitano",
         lat=40.7847, lon=-73.9442, address="1901 1st Ave, New York, NY 10029",
         phone="(212) 423-6262", risk="low", petFriendly="unknown"),
    dict(id="h2", type="hospital", en="Mount Sinai Hospital", es="Hospital Mount Sinai",
         lat=40.7900, lon=-73.9530, address="1 Gustave L Levy Pl, New York, NY 10029",
         phone="(212) 241-6500", risk="moderate", petFriendly="unknown"),
    dict(id="h3", type="hospital", en="Harlem Hospital Center", es="Hospital de Harlem",
         lat=40.8125, lon=-73.9405, address="506 Lenox Ave, New York, NY 10037",
         phone="(212) 939-1000", risk="low", petFriendly="unknown"),
    dict(id="h4", type="hospital", en="CityMD Urgent Care (E 95th St)", es="CityMD Atención Urgente (E 95th St)",
         lat=40.7830, lon=-73.9465, address="235 E 95th St, New York, NY 10128",
         phone="(212) 369-6000", risk="moderate", petFriendly="unknown"),
    dict(id="h5", type="hospital", en="NYC Health + Hospitals / Gotham Health", es="NYC Health + Hospitals / Gotham Health",
         lat=40.7982, lon=-73.9387, address="158 E 115th St, New York, NY 10029",
         phone="(844) 692-4692", risk="low", petFriendly="unknown"),
    # fire
    dict(id="f1", type="fire", en="FDNY Engine 53 / Ladder 43", es="FDNY Compañía 53 / Escalera 43",
         lat=40.7855, lon=-73.9470, address="1836 3rd Ave, New York, NY 10029",
         phone="(212) 570-4253", risk="moderate", petFriendly=False),
    dict(id="f2", type="fire", en="FDNY Engine 91", es="FDNY Compañía 91",
         lat=40.7960, lon=-73.9418, address="242 E 111th St, New York, NY 10029",
         phone="(212) 860-8191", risk="low", petFriendly=False),
    dict(id="f3", type="fire", en="FDNY Engine 58 / Ladder 26", es="FDNY Compañía 58 / Escalera 26",
         lat=40.8012, lon=-73.9490, address="1367 5th Ave, New York, NY 10026",
         phone="(212) 722-1758", risk="low", petFriendly=False),
    dict(id="f4", type="fire", en="FDNY Engine 35 / Ladder 14", es="FDNY Compañía 35 / Escalera 14",
         lat=40.7919, lon=-73.9362, address="2282 3rd Ave, New York, NY 10035",
         phone="(212) 996-2535", risk="high", petFriendly=False),
    # police
    dict(id="p1", type="police", en="NYPD 23rd Precinct", es="NYPD Comisaría 23",
         lat=40.7875, lon=-73.9433, address="162 E 102nd St, New York, NY 10029",
         phone="(212) 860-6411", risk="moderate", petFriendly=False),
    dict(id="p2", type="police", en="NYPD 25th Precinct", es="NYPD Comisaría 25",
         lat=40.7999, lon=-73.9385, address="120 E 119th St, New York, NY 10035",
         phone="(212) 860-6511", risk="high", petFriendly=False),
    # shelters
    dict(id="s1", type="shelter", en="P.S. 146 — Ann M. Short (emergency shelter)", es="P.S. 146 — Ann M. Short (refugio de emergencia)",
         lat=40.7860, lon=-73.9402, address="421 E 106th St, New York, NY 10029",
         phone="(212) 860-5831", risk="low", petFriendly=True, petSample=True),
    dict(id="s2", type="shelter", en="East Harlem Community Center", es="Centro Comunitario de East Harlem",
         lat=40.7965, lon=-73.9355, address="413 E 120th St, New York, NY 10035",
         phone="(212) 996-1716", risk="high", petFriendly="unknown", petSample=True),
    dict(id="s3", type="shelter", en="Taino Towers Community Room", es="Salón Comunitario Taino Towers",
         lat=40.7935, lon=-73.9388, address="225 E 105th St, New York, NY 10029",
         phone="(212) 369-1400", risk="moderate", petFriendly=True, petSample=True),
    # subway
    dict(id="m1", type="subway", en="96th St station (4/6)", es="Estación 96th St (4/6)",
         lat=40.7850, lon=-73.9471, address="Lexington Ave & 96th St", phone="511", risk="low", petFriendly="unknown"),
    dict(id="m2", type="subway", en="103rd St station (4/6)", es="Estación 103rd St (4/6)",
         lat=40.7906, lon=-73.9455, address="Lexington Ave & 103rd St", phone="511", risk="low", petFriendly="unknown"),
    dict(id="m3", type="subway", en="110th St station (4/6)", es="Estación 110th St (4/6)",
         lat=40.7958, lon=-73.9438, address="Lexington Ave & 110th St", phone="511", risk="low", petFriendly="unknown"),
    dict(id="m4", type="subway", en="116th St station (4/6)", es="Estación 116th St (4/6)",
         lat=40.8003, lon=-73.9418, address="Lexington Ave & 116th St", phone="511", risk="moderate", petFriendly="unknown"),
    dict(id="m5", type="subway", en="125th St station (4/5/6)", es="Estación 125th St (4/5/6)",
         lat=40.8042, lon=-73.9397, address="Lexington Ave & 125th St", phone="511", risk="low", petFriendly="unknown"),
    # high ground
    dict(id="g1", type="highground", en="Thomas Jefferson Park", es="Parque Thomas Jefferson",
         lat=40.7922, lon=-73.9355, address="2180 1st Ave, New York, NY 10029",
         phone="311", risk="low", petFriendly=True, petSample=True, elevationFt=25),
    dict(id="g2", type="highground", en="Central Park — E 102nd St entrance", es="Central Park — entrada E 102nd St",
         lat=40.7907, lon=-73.9530, address="Central Park N & E 102nd St",
         phone="311", risk="low", petFriendly=True, petSample=True, elevationFt=45),
    dict(id="g3", type="highground", en="Morningside Park (upper level)", es="Parque Morningside (nivel alto)",
         lat=40.8060, lon=-73.9575, address="Morningside Ave & 116th St",
         phone="311", risk="low", petFriendly=True, petSample=True, elevationFt=80),
    dict(id="g4", type="highground", en="Jackie Robinson Park", es="Parque Jackie Robinson",
         lat=40.8180, lon=-73.9470, address="Bradhurst Ave & 145th St",
         phone="311", risk="low", petFriendly=True, petSample=True, elevationFt=95),
]

ROUTES = [
    dict(id="r1", cls="safe", en="Elevated: 96th St Transverse (Central Park)", es="Elevada: 96th St Transverse (Central Park)",
         coords=[[40.790, -73.953], [40.792, -73.956], [40.795, -73.955]]),
    dict(id="r2", cls="safe", en="St. Nicholas Ave ridge (higher elevation)", es="Cresta de St. Nicholas Ave (mayor elevación)",
         coords=[[40.807, -73.945], [40.812, -73.940], [40.815, -73.935]]),
    dict(id="r3", cls="standard", en="FDR access at E 96th St (moderate risk)", es="Acceso FDR en E 96th St (riesgo moderado)",
         coords=[[40.7820, -73.9390], [40.7840, -73.9320]]),
    dict(id="r4", cls="standard", en="FDR access at E 116th St", es="Acceso FDR en E 116th St",
         coords=[[40.7985, -73.9385], [40.7990, -73.9310]]),
    dict(id="r5", cls="atRisk", en="Willis Ave Bridge (low approach — flood-prone)", es="Puente Willis Ave (acceso bajo — propenso a inundación)",
         coords=[[40.8035, -73.9300], [40.8050, -73.9250]]),
    dict(id="r6", cls="atRisk", en="3rd Ave Bridge (flood-prone)", es="Puente 3rd Ave (propenso a inundación)",
         coords=[[40.8070, -73.9320], [40.8110, -73.9280]]),
    dict(id="r7", cls="standard", en="125th St crosstown", es="125th St de este a oeste",
         coords=[[40.8040, -73.9550], [40.8040, -73.9300]]),
    dict(id="r8", cls="standard", en="96th St crosstown", es="96th St de este a oeste",
         coords=[[40.7850, -73.9600], [40.7850, -73.9350]]),
]

FLOOD_ZONES = [
    dict(id="z1", en="East River floodplain (FDR / E 116th St)", es="Llanura de inundación del East River (FDR / E 116th St)",
         coords=[[40.780, -73.932], [40.790, -73.932], [40.795, -73.925], [40.785, -73.922]]),
    dict(id="z2", en="Harlem River shoreline (3rd Ave Bridge)", es="Orilla del río Harlem (Puente 3rd Ave)",
         coords=[[40.800, -73.928], [40.808, -73.928], [40.812, -73.935], [40.805, -73.937]]),
    dict(id="z3", en="E 96th St underpass (FDR)", es="Paso inferior de E 96th St (FDR)",
         coords=[[40.783, -73.939], [40.786, -73.937], [40.785, -73.933], [40.782, -73.935]]),
    dict(id="z4", en="E 125th St / Willis Ave low area", es="Zona baja de E 125th St / Willis Ave",
         coords=[[40.802, -73.940], [40.806, -73.938], [40.805, -73.932], [40.800, -73.934]]),
]


def build_pois():
    pois = []
    for p in POIS:
        q = dict(p)
        q["name"] = {"en": q.pop("en"), "es": q.pop("es")}
        pois.append(q)
    routes = []
    for r in ROUTES:
        q = dict(r)
        q["name"] = {"en": q.pop("en"), "es": q.pop("es")}
        routes.append(q)
    zones = []
    for z in FLOOD_ZONES:
        q = dict(z)
        q["name"] = {"en": q.pop("en"), "es": q.pop("es")}
        zones.append(q)
    return {"pois": pois, "routes": routes, "floodZones": zones}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    fn = load_floodnet()
    c311 = load_311()
    deploy_coords = load_deployments()
    print(f"FloodNet rows: {len(fn)} | 311 rows: {len(c311)} | deployments matched pool: {len(deploy_coords)}")

    sensors_registry = {}
    sc1 = build_scenario("oct30-2025", "scenario.oct30.name", "recorded", fn, c311,
                         pd.Timestamp("2025-10-30 00:00"), pd.Timestamp("2025-10-31 12:00"),
                         deploy_coords, sensors_registry)
    sc2 = build_scenario("may20-2026", "scenario.may20.name", "recorded", fn, c311,
                         pd.Timestamp("2026-05-20 00:00"), pd.Timestamp("2026-05-21 12:00"),
                         deploy_coords, sensors_registry)
    sc3 = build_eh_simulation(fn, sensors_registry)
    elev = build_elevation()
    pois = build_pois()

    matched = sum(1 for s in sensors_registry.values() if not s.get("approx"))
    print(f"sensors: {len(sensors_registry)} ({matched} exact, {len(sensors_registry)-matched} approx)")

    outputs = {
        "scenario_oct30-2025.json": sc1,
        "scenario_may20-2026.json": sc2,
        "scenario_eh-simulation.json": sc3,
        "eh_elevation.json": elev,
        "sensors.json": sorted(sensors_registry.values(), key=lambda s: s["id"]),
        "pois.json": pois,
    }
    total = 0
    for fname, obj in outputs.items():
        path = OUT / fname
        blob = json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
        path.write_text(blob, encoding="utf8")
        total += len(blob.encode("utf8"))
        print(f"  {fname}: {len(blob)//1024} KB")
    print(f"total data payload: {total/1024:.0f} KB")
    if total > 2 * 1024 * 1024:
        fail("data payload exceeds 2 MB budget (PRD 10.3)")

    # validation
    for sc in (sc1, sc2, sc3):
        assert sc["events"], sc["id"]
        assert sc["events"] == sorted(sc["events"], key=lambda e: e["t"]), "events unsorted"
        assert any(e["type"] == "alert" for e in sc["events"]), f"{sc['id']}: no alerts"
    for s in sensors_registry.values():
        assert -75 < s["lon"] < -73 and 40 < s["lat"] < 41.2, f"bad coord {s}"
    assert elev["rows"] * elev["cols"] == len(elev["elev"])
    print("validation OK")
    print(f"scenario stats: oct30 {sc1['stats']} | may20 {sc2['stats']} | ehsim {sc3['stats']}")


if __name__ == "__main__":
    main()
