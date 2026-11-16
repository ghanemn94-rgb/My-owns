// qa-verifier DG7 round 5: F-DG7-922/941/970 probe. Read-only over the stages.json passed as argv[2] (default: the
// repository's). Checks (1) every DG7 history transition against the validator's own TRANSITIONS table, (2) timestamps
// strictly increase, (3) each review round's freeze has a REVIEWING entry at frozen_at, and each completed round is
// followed by FIXING before the next REVIEWING, (4) revert-to-fail: drops the late-inserted round-3 FIXING entry and
// shows that the validator's loadStages reports the illegal REVIEWING -> REVIEWING transition again.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync } from "node:fs";
import { join } from "node:path";
import { TRANSITIONS, loadStages } from "/home/user/My-owns/tools/gates/lib/rules.mjs";
const repo = "/home/user/My-owns";
const doc = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8"));
const s = doc.stages.find((x) => x.id === "DG7");
let bad = 0;
const h = s.history;
h.forEach((e, i) => console.log(`${i} ${e.at} ${e.state}${e.note ? "  | " + e.note.slice(0, 110) : ""}`));
for (let i = 1; i < h.length; i++) {
  const ok = TRANSITIONS[h[i - 1].state].includes(h[i].state);
  const mono = Date.parse(h[i].at) > Date.parse(h[i - 1].at);
  if (!ok || !mono) { bad++; console.log(`  BAD ${i}: ${h[i - 1].state}->${h[i].state} legal=${ok} monotonic=${mono}`); }
}
console.log(`(1)(2) transitions legal and timestamps strictly increasing: ${bad === 0 ? "PASS" : "FAIL"}`);
let bad3 = 0;
for (const r of s.review_rounds) {
  // nearest REVIEWING entry at or after frozen_at, within 5 minutes (rounds 1-2 recorded the state ~20 s after the freeze)
  const idx = h.findIndex((e) => e.state === "REVIEWING" && Date.parse(e.at) >= Date.parse(r.frozen_at) && Date.parse(e.at) - Date.parse(r.frozen_at) <= 300000);
  const next = h[idx + 1];
  const last = r.round === Math.max(...s.review_rounds.map((x) => x.round));
  const ok = idx >= 0 && (last ? next === undefined : next && next.state === "FIXING");
  if (!ok) bad3++;
  console.log(`  round ${r.round} frozen_at ${r.frozen_at}: REVIEWING entry #${idx} (+${idx >= 0 ? (Date.parse(h[idx].at) - Date.parse(r.frozen_at)) / 1000 : "?"} s); next ${next ? next.state + " " + next.at : "(none: current round)"} ${ok ? "ok" : "BAD"}`);
}
console.log(`(3) every round frozen at a REVIEWING entry, every finished round followed by FIXING: ${bad3 === 0 ? "PASS" : "FAIL"}`);
console.log(`stage state ${s.state}; last history state ${h[h.length - 1].state}: ${s.state === h[h.length - 1].state ? "PASS" : "FAIL"}`);
// (4) revert-to-fail on a scratch copy holding only stages.json and the schemas loadStages needs
const tmp = mkdtempSync(join(process.env.TMPDIR, "f970-"));
mkdirSync(join(tmp, "docs/delivery"), { recursive: true });
cpSync(join(repo, "tools"), join(tmp, "tools"), { recursive: true, filter: (p) => !p.includes("node_modules") && !p.includes("/tests/") });
const mutated = structuredClone(doc);
const ms = mutated.stages.find((x) => x.id === "DG7");
const before = ms.history.length;
ms.history = ms.history.filter((e) => !(e.state === "FIXING" && e.at === "2026-11-16T01:38:50Z"));
writeFileSync(join(tmp, "docs/delivery/stages.json"), JSON.stringify(mutated, null, 2));
const errs = []; loadStages(tmp, errs);
console.log(`(4) revert-to-fail: removed ${before - ms.history.length} entry; loadStages errors: ${JSON.stringify(errs)}`);
writeFileSync(join(tmp, "docs/delivery/stages.json"), JSON.stringify(doc, null, 2));
const errs2 = []; loadStages(tmp, errs2);
console.log(`(4) control (unmodified copy): loadStages errors: ${JSON.stringify(errs2)}`);
const fail4 = !(errs.some((e) => e.includes("DG7 illegal transition REVIEWING -> REVIEWING")) && errs2.length === 0);
console.log(`(4) ${fail4 ? "FAIL" : "PASS"}`);
process.exit(bad || bad3 || fail4 ? 1 : 0);
