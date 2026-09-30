#!/usr/bin/env node
// code-security-reviewer, DG0 round 21. Probes of the D-037 commitPresent() tolerances (tools/gates/lib/rules.mjs).
// Runs in a fresh --no-local clone of <repo> under $TMPDIR (removed afterwards).
//  P1  census: for every CLOSED_VERIFIED finding, is fix_revision present? is its verifying round's source_commit present?
//      (an absent fix whose verifying round source_commit IS present cannot be an ancestor of it in a complete clone)
//  P2  census: runs whose head_commit_at_start is absent, grouped by round of the record that cites them
//  P3  checkInvocation on the real round-20 qa record's run, with meta.head_commit_at_start mutated to:
//        a) the real value (control)            b) a present commit that lacks the round-20 manifest (must fail)
//        c) a non-existent 40-hex sha           d) the field removed           e) a non-hex string "not-a-sha"
//      under the D-037 rules and under the pre-D-037 rules (a23c4d4).
//  P4  checkClosure: a CLOSED_VERIFIED finding verified in the gate round with fix_revision = present off-candidate commit
//      (must fail) vs a non-existent 40-hex sha (tolerated?) -- via the unit fixture logic is covered by validator tests;
//      here we only show the real-repo census numbers that bound the exposure.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = mkdtempSync(join(tmpdir(), "sec21-cp-"));
try {
  const repo = join(base, "c");
  execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], repo]);
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const present = (s) => { try { git("cat-file", "-e", `${s}^{commit}`); return true; } catch { return false; } };
  const anc = (a, b) => { try { git("merge-base", "--is-ancestor", a, b); return true; } catch { return false; } };
  console.log(`clone HEAD=${git("rev-parse", "HEAD")} commits=${git("rev-list", "--count", "HEAD")} shallow=${git("rev-parse", "--is-shallow-repository")}`);
  const st = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages[0];
  const rounds = new Map(st.review_rounds.map((r) => [r.round, r]));
  const fj = JSON.parse(readFileSync(join(repo, "docs/delivery/findings.json"), "utf8")).findings;

  // P1
  const cv = fj.filter((f) => f.status === "CLOSED_VERIFIED");
  let absentFix = 0, absentFixPresentRound = [], presentNotAnc = [];
  for (const f of cv) {
    const m = (f.history || []).map((h) => h.note && h.note.match(/verified by .* round (\d+): PASS/)).filter(Boolean).pop();
    const rnd = m ? rounds.get(Number(m[1])) : null;
    const fp = present(f.fix_revision);
    if (!fp) {
      absentFix++;
      if (rnd && present(rnd.source_commit)) absentFixPresentRound.push(`${f.id}(round ${rnd.round})`);
    } else if (!anc(f.fix_revision, "HEAD")) presentNotAnc.push(f.id);
  }
  console.log(`\nP1 CLOSED_VERIFIED=${cv.length}; fix_revision absent=${absentFix}; absent fix whose verifying round's source_commit is PRESENT=${absentFixPresentRound.length} ${absentFixPresentRound.join(" ")}; present fix not an ancestor of HEAD=${presentNotAnc.length} ${presentNotAnc.join(" ")}`);
  const gateRound = rounds.get(Math.max(...rounds.keys()));
  console.log(`   gate-candidate source_commit ${gateRound.source_commit.slice(0, 10)} present=${present(gateRound.source_commit)}; every ancestor of a present commit is present in a complete (non-shallow) clone, so an ABSENT fix_revision is provably NOT in the gate candidate`);

  // P2
  const byRound = {};
  for (const r of st.review_rounds) for (const rel of Object.values(r.records)) {
    let rec; try { rec = JSON.parse(readFileSync(join(repo, rel), "utf8")); } catch { continue; }
    let meta; try { meta = JSON.parse(readFileSync(join(repo, `docs/delivery/runs/DG0/${rec.invocation_reference.run_id}/meta.json`), "utf8")); } catch { continue; }
    const k = `round ${r.round}`;
    byRound[k] = byRound[k] || { runs: 0, absentHead: 0 };
    byRound[k].runs++;
    if (!present(meta.head_commit_at_start)) byRound[k].absentHead++;
  }
  console.log(`\nP2 record runs with absent head_commit_at_start, by round: ${Object.entries(byRound).filter(([, v]) => v.absentHead).map(([k, v]) => `${k}:${v.absentHead}/${v.runs}`).join(" ")}`);
  console.log(`   rounds >= 19 with an absent head: ${Object.entries(byRound).filter(([k, v]) => Number(k.split(" ")[1]) >= 19 && v.absentHead).length}`);

  // P3
  const r20 = rounds.get(20);
  const rec = JSON.parse(readFileSync(join(repo, r20.records["qa-verifier"]), "utf8"));
  const metaRel = `docs/delivery/runs/DG0/${rec.invocation_reference.run_id}/meta.json`;
  const orig = readFileSync(join(repo, metaRel), "utf8");
  const manifestPath = `docs/delivery/candidates/DG0/${r20.candidate_id.slice(7, 23)}.manifest.json`;
  const noManifest = git("rev-list", "--max-parents=0", "HEAD").split("\n")[0]; // the root: present, predates every manifest
  const variants = {
    "a-real": (m) => m,
    "b-present-lacks-manifest": (m) => ({ ...m, head_commit_at_start: noManifest }),
    "c-nonexistent-40hex": (m) => ({ ...m, head_commit_at_start: "0123456789abcdef0123456789abcdef01234567" }),
    "d-field-removed": (m) => { const x = { ...m }; delete x.head_commit_at_start; return x; },
    "e-non-hex": (m) => ({ ...m, head_commit_at_start: "not-a-sha" }),
  };
  for (const [rulesLabel, ref] of [["D-037", null], ["pre-D-037(a23c4d4)", "a23c4d411cd4185e56a3f12cf7c1973f7964440b"]]) {
    const rulesFile = join(base, `rules-${ref ? "old" : "new"}.mjs`);
    writeFileSync(rulesFile, ref ? git("show", `${ref}:tools/gates/lib/rules.mjs`) : readFileSync(join(repo, "tools/gates/lib/rules.mjs"), "utf8"));
    // keep relative imports working: place the copy next to the real one
    const placed = join(repo, "tools/gates/lib", `__probe_${ref ? "old" : "new"}.mjs`);
    writeFileSync(placed, readFileSync(rulesFile, "utf8"));
    const rules = await import(pathToFileURL(placed).href);
    console.log(`\nP3 checkInvocation, rules ${rulesLabel}, round-20 qa run, binding.manifestPath=${manifestPath}`);
    for (const [v, fn] of Object.entries(variants)) {
      writeFileSync(join(repo, metaRel), JSON.stringify(fn(JSON.parse(orig)), null, 2) + "\n");
      const errs = [];
      rules.checkInvocation(repo, "DG0", rec.invocation_reference, "qa-verifier", errs, "probe", { manifestPath });
      const rel = errs.filter((e) => /started from|contain/.test(e));
      console.log(`   ${v.padEnd(26)} errors=${errs.length} head-check=${rel.length ? "REJECTED: " + rel[0] : "accepted"}`);
    }
    writeFileSync(join(repo, metaRel), orig);
  }
} finally {
  rmSync(base, { recursive: true, force: true });
}
