#!/usr/bin/env node
// qa-verifier, DG0 round 24 (T-DG0-REV-QA-R24): independent fix_revision integrity on a COMPLETE clone. Author: qa-verifier.
// For every finding in findings.json carrying a fix_revision: full lowercase 40-hex, a commit present in the clone, and an
// ancestor of HEAD and of the frozen gate candidate commit (stages.json candidate.source_commit).
// For every CLOSED_VERIFIED finding (the D-040 binding): the verifying run is located through the REVIEWER RECORD whose
// invocation_reference.run_id equals findings.json verification.invocation_reference.run_id (not by parsing the run name);
// its meta.head_commit_at_start must be 40-hex, present, and have the fix as an ancestor. Additionally reported, to measure
// whether any genuine closure depends on D-040 having REPLACED (not added to) the pre-D-040 round.source_commit check:
// whether the fix is also an ancestor of the verifying round's source_commit (when present).
// Usage: node fix-revision-integrity.mjs <complete-clone>
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

// run_id -> { round, role, recordPath } from every review record on disk
const byRun = new Map();
const rdir = join(repo, "docs/delivery/reviews/DG0");
for (const d of readdirSync(rdir).filter((x) => /^round-\d+$/.test(x))) {
  for (const f of readdirSync(join(rdir, d)).filter((x) => /^[a-z-]+\.json$/.test(x))) {
    const rec = J(`docs/delivery/reviews/DG0/${d}/${f}`);
    if (rec.invocation_reference && rec.invocation_reference.run_id) byRun.set(rec.invocation_reference.run_id, { round: Number(d.slice(6)), role: f.slice(0, -5), rec: `${d}/${f}` });
  }
}

const findings = J("docs/delivery/findings.json").findings;
const bad = [], headBad = [], roundOnlyBad = [], rows = [];
let withFix = 0, closed = 0;
for (const f of findings) {
  if (f.fix_revision == null) continue;
  withFix++;
  const r = f.fix_revision;
  if (!/^[0-9a-f]{40}$/.test(r)) { bad.push(`${f.id}: not full lowercase 40-hex (${r})`); continue; }
  if (!present(r)) { bad.push(`${f.id}: ${r.slice(0, 10)} is not a commit present in the clone`); continue; }
  if (!anc(r, "HEAD")) bad.push(`${f.id}: ${r.slice(0, 10)} not an ancestor of HEAD`);
  if (!anc(r, gateCommit)) bad.push(`${f.id}: ${r.slice(0, 10)} not an ancestor of the gate candidate ${gateCommit.slice(0, 10)}`);
  if (f.status !== "CLOSED_VERIFIED") continue;
  closed++;
  const run = f.verification && f.verification.invocation_reference && f.verification.invocation_reference.run_id;
  const loc = run && byRun.get(run);
  const metaRel = run && `docs/delivery/runs/DG0/${run}/meta.json`;
  if (!loc) { headBad.push(`${f.id}: no reviewer record carries verifying run ${run}`); continue; }
  if (!existsSync(join(repo, metaRel))) { headBad.push(`${f.id}: no meta.json for ${run}`); continue; }
  const head = J(metaRel).head_commit_at_start;
  const round = st.review_rounds.find((x) => x.round === loc.round);
  const srcPresent = round ? present(round.source_commit) : false;
  const inHead = present(head) && anc(r, head);
  const inRound = srcPresent ? anc(r, round.source_commit) : null;
  if (!present(head)) headBad.push(`${f.id}: verifying head ${JSON.stringify(head)} not a present 40-hex commit`);
  else if (!inHead) headBad.push(`${f.id}: fix ${r.slice(0, 10)} NOT an ancestor of verifying head ${head.slice(0, 10)} (round ${loc.round}, ${loc.role})`);
  if (inHead && inRound === false) roundOnlyBad.push(`${f.id}: fix ${r.slice(0, 10)} in run head ${head.slice(0, 10)} but NOT in round-${loc.round} source_commit ${round.source_commit.slice(0, 10)}`);
  rows.push(`${f.id}\tround-${loc.round}\t${loc.role}\tfix=${r.slice(0, 10)}\thead=${String(head).slice(0, 10)}\tinHead=${inHead}\tround.src=${round ? round.source_commit.slice(0, 10) : "?"}(${srcPresent ? "present" : "ABSENT"})\tinRoundSrc=${inRound}`);
}
console.log(`findings: ${findings.length}; with fix_revision: ${withFix}; CLOSED_VERIFIED with fix: ${closed}`);
console.log(`\nper-closure table:\n${rows.join("\n")}`);
console.log(`\nfix_revision errors (40-hex / present / ancestor of HEAD and gate candidate) (${bad.length}):`); bad.forEach((x) => console.log(`  ${x}`));
console.log(`closures whose fix is NOT in the verifying run's head (D-040 errors) (${headBad.length}):`); headBad.forEach((x) => console.log(`  ${x}`));
console.log(`closures that pass D-040 but would have FAILED the pre-D-040 round.source_commit check (${roundOnlyBad.length}):`); roundOnlyBad.forEach((x) => console.log(`  ${x}`));
process.exit(bad.length || headBad.length ? 1 : 0);
