// Preload for test/integration/supervise-cadence.test.ts (F-DG4-128, D-131). Loaded with `node --import` into the
// REAL worker entry point (src/main.ts), it wraps the global setInterval and reports every interval created, without
// changing it: one stderr line `MTH_INTERVAL_PROBE {"ms":<delay as passed>,"pgBossSupervise":<bool>}` per call.
// pg-boss's supervision timer is the one created from pg-boss/src/boss.js (Boss.start). A delay that is not a number
// is reported as the string "NaN"/"undefined", so the test sees exactly what pg-boss passed. Test support only.
const original = globalThis.setInterval;

globalThis.setInterval = function probedSetInterval(callback, delay, ...args) {
  const stack = new Error().stack ?? "";
  const ms = typeof delay === "number" && Number.isFinite(delay) ? delay : String(delay);
  const pgBossSupervise = /pg-boss[\\/]src[\\/]boss\.js/.test(stack);
  process.stderr.write(`MTH_INTERVAL_PROBE ${JSON.stringify({ ms, pgBossSupervise })}\n`);
  return original.call(this, callback, delay, ...args);
};
