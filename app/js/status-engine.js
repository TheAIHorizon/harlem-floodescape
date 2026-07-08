/* status-engine — deterministic flood status (PRD §6.3).
 * Thresholds are grounded in the dissertation data analysis:
 *   6 in  ≈ curb height    — 26% of recorded FloodNet events exceed it
 *   12 in ≈ car-door height — 7% exceed it
 *   median onset→peak is 38 minutes, so escalation must be immediate.
 */
export const THRESHOLDS = {
  curbIn: 6,
  carDoorIn: 12,
  watchDepthIn: 2,
  watchReports: 2,
  dangerReports: 3,
};

export const LEVELS = ["CALM", "WATCH", "WARNING", "DANGER"];

const rank = (level) => LEVELS.indexOf(level);

/**
 * @param {object} inputs
 * @param {boolean} inputs.nwsWarning     active NWS Flash Flood Warning
 * @param {boolean} inputs.nwsWatch       active NWS Flood/Flash Flood Watch
 * @param {number}  inputs.maxSensorDepthIn  max depth across nearby sensors (in)
 * @param {number}  inputs.reportsLast3h  community reports in last 3 h
 * @param {string|null} inputs.scenarioLevel  replay alert level (upward override)
 * @returns {{level: string, reasonKey: string}}
 */
export function computeStatus({
  nwsWarning = false,
  nwsWatch = false,
  maxSensorDepthIn = 0,
  reportsLast3h = 0,
  scenarioLevel = null,
} = {}) {
  let level = "CALM";
  let reasonKey = "status.reason.calmDefault";

  const raise = (newLevel, newReasonKey) => {
    if (rank(newLevel) > rank(level)) {
      level = newLevel;
      reasonKey = newReasonKey;
    }
  };

  if (nwsWatch) raise("WATCH", "status.reason.nwsWatch");
  if (maxSensorDepthIn >= THRESHOLDS.watchDepthIn) raise("WATCH", "status.reason.sensorMinor");
  if (reportsLast3h >= THRESHOLDS.watchReports) raise("WATCH", "status.reason.reports");

  if (nwsWarning) raise("WARNING", "status.reason.nwsWarning");
  if (maxSensorDepthIn >= THRESHOLDS.curbIn) raise("WARNING", "status.reason.sensorDeep");

  if (maxSensorDepthIn >= THRESHOLDS.carDoorIn) raise("DANGER", "status.reason.sensorVeryDeep");
  if (nwsWarning && reportsLast3h >= THRESHOLDS.dangerReports) raise("DANGER", "status.reason.reports");

  if (scenarioLevel && rank(scenarioLevel) > rank(level)) {
    level = scenarioLevel;
    reasonKey = "status.reason.scenario";
  }

  return { level, reasonKey };
}
