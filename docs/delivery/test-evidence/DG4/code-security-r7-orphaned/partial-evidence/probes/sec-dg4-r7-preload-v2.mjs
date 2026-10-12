// code-security-reviewer DG4 round 7: INDEPENDENT setInterval recorder (not the candidate's interval-probe.mjs).
// v2: also records the pg-boss source file:line that created each timer (src). Records every setInterval delay exactly as passed (typeof + value), whether pg-boss created it, and every process
// warning. Writes one line `SECR7 {...}` per event to stderr. Test support for a probe only; never in the candidate.
const orig = globalThis.setInterval;
globalThis.setInterval = function (cb, delay, ...a) {
  const st = new Error().stack ?? "";
  process.stderr.write(`SECR7 ${JSON.stringify({ kind: "interval", type: typeof delay, delay: String(delay), pgboss: /[\\/]pg-boss[\\/]/.test(st), src: ((st.split("\n").find((l) => /[\\/]pg-boss[\\/]src[\\/]/.test(l)) ?? "").match(/pg-boss[\\/]src[\\/]([a-z]+\.js):(\d+)/) ?? []).slice(1).join(":") })}\n`);
  return orig.call(this, cb, delay, ...a);
};
process.on("warning", (w) => process.stderr.write(`SECR7 ${JSON.stringify({ kind: "warning", name: w.name, message: w.message })}\n`));
