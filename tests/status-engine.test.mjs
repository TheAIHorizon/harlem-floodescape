import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStatus, THRESHOLDS } from "../app/js/status-engine.js";

test("default is CALM", () => {
  const r = computeStatus({});
  assert.equal(r.level, "CALM");
  assert.equal(r.reasonKey, "status.reason.calmDefault");
});

test("NWS watch → WATCH", () => {
  assert.equal(computeStatus({ nwsWatch: true }).level, "WATCH");
});

test("minor sensor depth (2–6 in) → WATCH", () => {
  assert.equal(computeStatus({ maxSensorDepthIn: 2 }).level, "WATCH");
  assert.equal(computeStatus({ maxSensorDepthIn: 5.9 }).level, "WATCH");
});

test("2 reports in 3h → WATCH", () => {
  assert.equal(computeStatus({ reportsLast3h: 2 }).level, "WATCH");
  assert.equal(computeStatus({ reportsLast3h: 1 }).level, "CALM");
});

test("NWS warning → WARNING", () => {
  const r = computeStatus({ nwsWarning: true });
  assert.equal(r.level, "WARNING");
  assert.equal(r.reasonKey, "status.reason.nwsWarning");
});

test("curb-height depth (exactly 6 in) → WARNING", () => {
  assert.equal(computeStatus({ maxSensorDepthIn: THRESHOLDS.curbIn }).level, "WARNING");
});

test("car-door depth (exactly 12 in) → DANGER", () => {
  const r = computeStatus({ maxSensorDepthIn: THRESHOLDS.carDoorIn });
  assert.equal(r.level, "DANGER");
  assert.equal(r.reasonKey, "status.reason.sensorVeryDeep");
});

test("warning + 3 reports → DANGER", () => {
  assert.equal(computeStatus({ nwsWarning: true, reportsLast3h: 3 }).level, "DANGER");
  assert.equal(computeStatus({ nwsWarning: true, reportsLast3h: 2 }).level, "WARNING");
});

test("scenario override raises but never lowers", () => {
  assert.equal(computeStatus({ scenarioLevel: "DANGER" }).level, "DANGER");
  assert.equal(
    computeStatus({ maxSensorDepthIn: 12, scenarioLevel: "WATCH" }).level,
    "DANGER"
  );
});

test("scenario reason used when scenario wins", () => {
  const r = computeStatus({ scenarioLevel: "WARNING" });
  assert.equal(r.reasonKey, "status.reason.scenario");
});
