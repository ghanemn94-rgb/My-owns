// Round-8 check (code-security-reviewer): apply the candidate's checkInvocation, with the binding the validator uses for
// verifications/closures (rules.mjs:572-577), to every real round-N review record at a HEAD worktree. Read-only.
// Run: node 05-real-runs-check.mjs <tools-worktree> <repo-worktree>
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [tools, repo] = process.argv.slice(2);
const { checkInvocation, manifestPathFor } = await import(pathToFileURL(join(tools, "tools/gates/lib/rules.mjs")).href);
const stage = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages.find((s) => s.id === "DG0");
let bad = 0, total = 0;
for (const rnd of stage.review_rounds || []) {
  const dir = `docs/delivery/reviews/DG0/round-${rnd.round}`;
  if (!existsSync(join(repo, dir))) continue;
  for (const f of readdirSync(join(repo, dir)).filter((f) => /^[a-z-]+\.json$/.test(f)).sort()) {
    const rel = `${dir}/${f}`;
    const rec = JSON.parse(readFileSync(join(repo, rel), "utf8"));
    const outs = [rel, ...["findings", "verifications"].map((k) => rel.replace(/\.json$/, `.${k}.json`)).filter((p) => existsSync(join(repo, p)))];
    const errors = [];
    checkInvocation(repo, "DG0", rec.invocation_reference, rec.reviewer_role, errors, rel, {
      assignment: rec.assignment, notBefore: rnd.frozen_at, manifestPath: manifestPathFor("DG0", rnd.candidate_id), outputs: outs,
    });
    total++;
    if (errors.length) bad++;
    console.log(`${errors.length ? "FAIL" : "ok  "} round-${rnd.round} ${rec.reviewer_role} ${rec.invocation_reference && rec.invocation_reference.run_id}`);
    errors.forEach((e) => console.log("     - " + e));
  }
}
console.log(`records checked: ${total}; with invocation errors: ${bad}`);
process.exit(bad ? 1 : 0);
