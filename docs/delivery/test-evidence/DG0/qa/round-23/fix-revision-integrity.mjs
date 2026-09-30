#!/usr/bin/env node
// qa-verifier, DG0 round 23: independent fix_revision integrity on a COMPLETE clone.
// For every finding in findings.json that carries a fix_revision: full lowercase 40-hex, present, ancestor of HEAD.
// For every CLOSED_VERIFIED finding: also an ancestor of the verifying run's head_commit_at_start (the bound proposed in
// F-DG0-249); reports the verifying round and whether that round's source_commit is present.
// Usage: node fix-revision-integrity.mjs <complete-clone>
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const ok = (...a) => { try { git(...a); return true; } catch { return false; } };
const present = (s) => typeof s === "string" && ok("cat-file", "-e", `${s}^{commit}`);
const anc = (a, b) => ok("merge-base", "--is-ancestor", a, b);

console.log(`HEAD=${git("rev-parse", "HEAD")} shallow=${git("rev-parse", "--is-shallow-repository")}`);
const fs = JSON.parse(readFileSync(join(repo, "docs/delivery/findings.json"), "utf8")).findings;
const stages = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages[0];
let n = 0, bad = [], closed = 0, headBad = [], absentRounds = new Set();
for (const f of fs) {
  if (f.fix_revision == null) continue;
  n++;
  const r = f.fix_revision;
  if (!/^[0-9a-f]{40}$/.test(r)) { bad.push(`${f.id}: not full 40-hex (${r})`); continue; }
  if (!present(r)) { bad.push(`${f.id}: ${r.slice(0, 10)} absent`); continue; }
  if (!anc(r, "HEAD")) bad.push(`${f.id}: ${r.slice(0, 10)} not an ancestor of HEAD`);
  if (f.status === "CLOSED_VERIFIED") {
    closed++;
    const ref = f.verification && f.verification.invocation_reference;
    const metaP = ref && join(repo, "docs/delivery/runs", f.stage_id, ref.run_id, "meta.json");
    if (!metaP || !existsSync(metaP)) { headBad.push(`${f.id}: no run meta for ${ref && ref.run_id}`); continue; }
    const head = JSON.parse(readFileSync(metaP, "utf8")).head_commit_at_start;
    const m = /-R(\d+)-/.exec(ref.run_id);
    const round = m && stages.review_rounds.find((x) => x.round === Number(m[1]));
    if (round && !present(round.source_commit)) absentRounds.add(round.round);
    if (!present(head)) headBad.push(`${f.id}: verifying head ${String(head).slice(0, 10)} absent`);
    else if (!anc(r, head)) headBad.push(`${f.id}: fix ${r.slice(0, 10)} not an ancestor of verifying head ${head.slice(0, 10)} (round ${m && m[1]})`);
  }
}
console.log(`findings: ${fs.length}; with fix_revision: ${n}; CLOSED_VERIFIED with fix: ${closed}`);
console.log(`fix_revision errors (${bad.length}):`); bad.forEach((x) => console.log(`  ${x}`));
console.log(`closures whose fix is NOT in the verifying run's head (${headBad.length}):`); headBad.forEach((x) => console.log(`  ${x}`));
console.log(`verifying rounds (of CLOSED_VERIFIED findings) whose source_commit is absent: ${JSON.stringify([...absentRounds])}`);
process.exit(bad.length ? 1 : 0);
