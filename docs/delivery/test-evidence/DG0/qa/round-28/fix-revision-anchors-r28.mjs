#!/usr/bin/env node
// qa-verifier, DG0 round 28 (T-DG0-REV-QA-R28; derived from the round-27 script, D-044 object-type census added): independent D-041 three-anchor census on a COMPLETE clone. Author: qa-verifier.
// For every finding in findings.json with a fix_revision: full lowercase 40-hex, a commit present in the clone, ancestor of
// HEAD and of the stage's frozen candidate commit (stages.json candidate.source_commit, the prospective gate candidate).
// For every CLOSED_VERIFIED finding, the three D-041 anchors, located independently of tools/gates:
//   A1 the verifying round's source_commit (round found through the REVIEWER RECORD whose invocation_reference.run_id equals
//      findings.json verification.invocation_reference.run_id); D-042: UNCONDITIONAL -- an absent round source_commit is a FAILURE for a closure;
//   A2 the verifying run's meta.head_commit_at_start (must be 40-hex and present);
//   A3 the prospective gate candidate commit.
// Reports per closure, counts closures where A1 could not run (absent round source_commit), and exits 1 on any failure.
// Usage: node fix-revision-anchors-r28.mjs <complete-clone>
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const ok = (...a) => { try { git(...a); return true; } catch { return false; } };
const present = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s) && ok("cat-file", "-e", `${s}^{commit}`);
const anc = (a, b) => ok("merge-base", "--is-ancestor", a, b);
const J = (p) => JSON.parse(readFileSync(join(repo, p), "utf8"));

const st = J("docs/delivery/stages.json").stages.find((s) => s.id === "DG0");
const gateCommit = st.candidate.source_commit;
console.log(`HEAD=${git("rev-parse", "HEAD")} shallow=${git("rev-parse", "--is-shallow-repository")} commits=${git("rev-list", "--count", "HEAD")} gate-candidate=${gateCommit}`);

const byRun = new Map();
const rdir = join(repo, "docs/delivery/reviews/DG0");
for (const d of readdirSync(rdir).filter((x) => /^round-\d+$/.test(x))) {
  for (const f of readdirSync(join(rdir, d)).filter((x) => /^[a-z-]+\.json$/.test(x))) {
    const rec = J(`docs/delivery/reviews/DG0/${d}/${f}`);
    if (rec.invocation_reference && rec.invocation_reference.run_id) byRun.set(rec.invocation_reference.run_id, { round: Number(d.slice(6)), role: f.slice(0, -5) });
  }
}

const findings = J("docs/delivery/findings.json").findings;
const bad = [], anchorBad = [], rows = [];
let withFix = 0, closed = 0, a1Skipped = 0;
for (const f of findings) {
  if (f.fix_revision == null) continue;
  withFix++;
  const r = f.fix_revision;
  if (!/^[0-9a-f]{40}$/.test(r)) { bad.push(`${f.id}: not full lowercase 40-hex (${r})`); continue; }
  if (!present(r)) { bad.push(`${f.id}: ${r.slice(0, 10)} is not a commit present in the clone`); continue; }
  if (git("cat-file", "-t", r) !== "commit") { bad.push(`${f.id}: ${r.slice(0, 10)} is a ${git("cat-file", "-t", r)} object, not a commit (QA27-N3)`); continue; }
  if (!anc(r, "HEAD")) bad.push(`${f.id}: ${r.slice(0, 10)} not an ancestor of HEAD`);
  if (!anc(r, gateCommit)) bad.push(`${f.id}: ${r.slice(0, 10)} not an ancestor of the gate candidate ${gateCommit.slice(0, 10)}`);
  if (f.status !== "CLOSED_VERIFIED") continue;
  closed++;
  const run = f.verification && f.verification.invocation_reference && f.verification.invocation_reference.run_id;
  const loc = run && byRun.get(run);
  const metaRel = run && `docs/delivery/runs/DG0/${run}/meta.json`;
  if (!loc) { anchorBad.push(`${f.id}: no reviewer record carries verifying run ${run}`); continue; }
  if (!existsSync(join(repo, metaRel))) { anchorBad.push(`${f.id}: no meta.json for ${run}`); continue; }
  const head = J(metaRel).head_commit_at_start;
  const round = st.review_rounds.find((x) => x.round === loc.round);
  if (!round) { anchorBad.push(`${f.id}: round ${loc.round} not in stages.json`); continue; }
  const srcPresent = present(round.source_commit);
  const a1 = srcPresent ? anc(r, round.source_commit) : null;
  if (!srcPresent) a1Skipped++;
  const a2 = present(head) ? anc(r, head) : false;
  const a3 = anc(r, gateCommit);
  if (a1 === null) anchorBad.push(`${f.id}: A1 round-${loc.round} source_commit ${String(round.source_commit).slice(0, 10)} is ABSENT (D-042: closure must be verified against a retained candidate)`);
  if (a1 === false) anchorBad.push(`${f.id}: A1 fix ${r.slice(0, 10)} NOT in round-${loc.round} source_commit ${round.source_commit.slice(0, 10)}`);
  if (!present(head)) anchorBad.push(`${f.id}: A2 verifying head ${JSON.stringify(head)} not a present 40-hex commit`);
  else if (!a2) anchorBad.push(`${f.id}: A2 fix ${r.slice(0, 10)} NOT in verifying head ${head.slice(0, 10)}`);
  if (!a3) anchorBad.push(`${f.id}: A3 fix ${r.slice(0, 10)} NOT in the gate candidate`);
  rows.push(`${f.id}\tround-${loc.round}\t${loc.role}\tfix=${r.slice(0, 10)}\tA1=${a1 === null ? "skipped(src ABSENT)" : a1}\tA2=${a2}(head=${String(head).slice(0, 10)})\tA3=${a3}`);
}
console.log(`findings: ${findings.length}; with fix_revision: ${withFix}; CLOSED_VERIFIED with fix: ${closed}; A1 skipped (round source_commit absent): ${a1Skipped}`);
console.log(`\nper-closure table:\n${rows.join("\n")}`);
console.log(`\nfix_revision errors (40-hex / present / ancestor of HEAD and gate candidate) (${bad.length}):`); bad.forEach((x) => console.log(`  ${x}`));
console.log(`three-anchor closure errors (${anchorBad.length}):`); anchorBad.forEach((x) => console.log(`  ${x}`));
// ---- D-044 census: every run meta head_commit_at_start (all stages' runs present), every review round source_commit and the
// gate candidate commit must be a COMMIT object (git cat-file -t == commit), not a tag/tree/blob.
const typeBad = [];
const typ = (s) => { try { return git("cat-file", "-t", s); } catch { return "ABSENT"; } };
let heads = 0, headTypes = {};
const runsRoot = join(repo, "docs/delivery/runs");
for (const stg of existsSync(runsRoot) ? readdirSync(runsRoot) : []) for (const run of readdirSync(join(runsRoot, stg))) {
  const mp = join(runsRoot, stg, run, "meta.json");
  if (!existsSync(mp)) continue;
  const h = JSON.parse(readFileSync(mp, "utf8")).head_commit_at_start;
  heads++;
  const t = /^[0-9a-f]{40}$/.test(String(h)) ? typ(h) : `NOT-40-HEX(${JSON.stringify(h)})`;
  headTypes[t] = (headTypes[t] || 0) + 1;
  if (t !== "commit") typeBad.push(`run ${stg}/${run}: head_commit_at_start ${JSON.stringify(h)} -> ${t}`);
}
const srcTypes = {};
for (const r of st.review_rounds) { const t = typ(r.source_commit); srcTypes[t] = (srcTypes[t] || 0) + 1; if (t !== "commit") typeBad.push(`round ${r.round}: source_commit ${String(r.source_commit).slice(0, 10)} -> ${t} (D-035 tolerance applies only to the round-18 manifest; not a closure anchor unless a closure was verified in it)`); }
const fixTypes = {};
for (const f of findings) if (f.fix_revision != null) { const t = typ(f.fix_revision); fixTypes[t] = (fixTypes[t] || 0) + 1; }
console.log(`\nD-044 object-type census: run meta files=${heads} head types=${JSON.stringify(headTypes)}; review_rounds source_commit types=${JSON.stringify(srcTypes)}; fix_revision types=${JSON.stringify(fixTypes)}; gate candidate commit type=${typ(gateCommit)}`);
console.log(`non-commit ids (${typeBad.length}):`); typeBad.forEach((x) => console.log(`  ${x}`));
console.log(`RESULT: ${bad.length || anchorBad.length ? "FAIL" : "PASS"} (fix_revision + three-anchor); object-type census non-commit=${typeBad.length}`);
process.exit(bad.length || anchorBad.length ? 1 : 0);
