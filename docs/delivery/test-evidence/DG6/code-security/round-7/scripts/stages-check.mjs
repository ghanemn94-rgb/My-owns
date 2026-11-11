// Independent stages.json consistency check + mutant (F-DG6-911/951). Read-only on the repo; the mutant runs on a copy under $TMPDIR.
// usage: node stages-check.mjs <repo>
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { TRANSITIONS, loadStages } from "../../../../../../../tools/gates/lib/rules.mjs";
const repo = process.argv[2];
const doc = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8"));
let problems = 0;
for (const s of doc.stages) {
  const h = s.history;
  const ill = [], ord = [];
  for (let i = 1; i < h.length; i++) {
    if (!TRANSITIONS[h[i - 1].state].includes(h[i].state)) ill.push(`${i}:${h[i - 1].state}->${h[i].state}`);
    if (Date.parse(h[i].at) < Date.parse(h[i - 1].at)) ord.push(`${i}:${h[i - 1].state}@${h[i - 1].at} > ${h[i].state}@${h[i].at}`);
  }
  const last = h[h.length - 1].state;
  console.log(`${s.id} state=${s.state} last=${last} entries=${h.length} illegal=[${ill.join(", ")}] time-order-violations=[${ord.join(" | ")}]`);
  if (ill.length || last !== s.state) problems++;
}
const dg6 = doc.stages.find((s) => s.id === "DG6");
console.log("--- DG6 history:");
dg6.history.forEach((e, i) => console.log(`${String(i).padStart(2)} ${e.state.padEnd(9)} ${e.at}  ${(e.note || "").slice(0, 150)}`));
console.log(`legal-transition/state problems: ${problems}`);
// Mutant: remove the late FIXING entry (the e7cb240e7 fix) on a copy and run the validator's own loadStages.
const idx = dg6.history.findIndex((e, i) => e.state === "FIXING" && i > 0 && dg6.history[i - 1].state === "VERIFYING" && /late/i.test(e.note || ""));
console.log(`--- MUTANT: late FIXING entry index=${idx} (${idx >= 0 ? dg6.history[idx].at : "not found"})`);
const m = JSON.parse(JSON.stringify(doc));
m.stages.find((s) => s.id === "DG6").history.splice(idx, 1);
const tmp = join(process.env.TMPDIR, "stages-mutant");
for (const [name, d] of [["original", doc], ["mutant", m]]) {
  const r = join(tmp, name);
  mkdirSync(join(r, "docs/delivery"), { recursive: true });
  writeFileSync(join(r, "docs/delivery/stages.json"), JSON.stringify(d, null, 2));
  const errors = [];
  loadStages(r, errors);
  console.log(`loadStages(${name}) errors: ${errors.length ? errors.join(" ; ") : "none"}`);
}
