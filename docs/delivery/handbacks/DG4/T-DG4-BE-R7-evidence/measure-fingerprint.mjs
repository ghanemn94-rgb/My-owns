// T-DG4-BE-R7 (D-138): measures the cost of the a08 G6 delivery fingerprint, the old whole-tree form and the narrowed
// DELIVERY_RECORDS form, on the tree it is run from. Each form is a faithful copy of the test's function (old: as of
// 0e34307; new: as of this task). It reports the file count, bytes read and wall time of one pass (the test runs two).
// Usage: node docs/delivery/handbacks/DG4/T-DG4-BE-R7-evidence/measure-fingerprint.mjs [repo-root]
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const DELIVERY = join(resolve(process.argv[2] ?? "."), "docs/delivery");

/** Old form: every file under docs/delivery/ except the top-level test-evidence/ and runs/. */
function oldFingerprint(stats) {
  const LIVE_EVIDENCE = new Set(["test-evidence", "runs"]);
  const out = {};
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      if (dir === DELIVERY && LIVE_EVIDENCE.has(name)) continue;
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const buf = readFileSync(p);
        stats.files += 1;
        stats.bytes += buf.length;
        out[relative(DELIVERY, p)] = createHash("sha256").update(buf).digest("hex");
      }
    }
  };
  walk(DELIVERY);
  return out;
}

/** New form: only DELIVERY_RECORDS; a missing path is listed as missing, never skipped. */
const DELIVERY_RECORDS = ["gates", "stages.json", "findings.json", "reviews", "decisions.md", "requirements.csv"];
function newFingerprint(stats) {
  const out = {};
  const add = (p) => {
    if (statSync(p).isDirectory()) for (const name of readdirSync(p).sort()) add(join(p, name));
    else {
      const buf = readFileSync(p);
      stats.files += 1;
      stats.bytes += buf.length;
      out[relative(DELIVERY, p)] = createHash("sha256").update(buf).digest("hex");
    }
  };
  for (const entry of DELIVERY_RECORDS) {
    const p = join(DELIVERY, entry);
    if (existsSync(p)) add(p);
    else out[entry] = "missing";
  }
  return out;
}

const MB = (b) => (b / 1024 / 1024).toFixed(1);
for (const [label, fn] of [
  ["old (whole docs/delivery/ minus runs/, test-evidence/)", oldFingerprint],
  ["new (DELIVERY_RECORDS)", newFingerprint],
]) {
  const stats = { files: 0, bytes: 0 };
  const t0 = performance.now();
  const fp = fn(stats);
  const ms = performance.now() - t0;
  const keys = Object.keys(fp);
  const covers = ["stages.json", "findings.json", "requirements.csv", "decisions.md"].every((k) => keys.includes(k));
  const gates = keys.filter((k) => /^gates\/DG\d\.json$/.test(k)).length;
  console.log(
    `${label}: ${stats.files} files, ${stats.bytes} bytes (${MB(stats.bytes)} MiB), one pass ${ms.toFixed(0)} ms; ` +
      `covers stages/findings/requirements/decisions=${covers}, gates/DGx.json=${gates}`,
  );
}
