// code-security-reviewer DG4 round 7: INDEPENDENT setInterval recorder (not the candidate's interval-probe.mjs).
// Records every setInterval delay exactly as passed (typeof + value), whether pg-boss created it, and every process
// warning. Writes one line `SECR7 {...}` per event to stderr. Test support for a probe only; never in the candidate.
const orig = globalThis.setInterval;
globalThis.setInterval = function (cb, delay, ...a) {
  const st = new Error().stack ?? "";
  process.stderr.write(`SECR7 ${JSON.stringify({ kind: "interval", type: typeof delay, delay: String(delay), pgboss: /node_modules[\\/](\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?pg-boss[\\/]/.test(st) })}\n`);
  return orig.call(this, cb, delay, ...a);
};
process.on("warning", (w) => process.stderr.write(`SECR7 ${JSON.stringify({ kind: "warning", name: w.name, message: w.message })}\n`));
