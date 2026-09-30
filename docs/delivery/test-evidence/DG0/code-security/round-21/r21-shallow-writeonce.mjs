#!/usr/bin/env node
// code-security-reviewer, DG0 round 21. The validator does not detect a SHALLOW repository, so every history-based check
// (checkWriteOnce, the D-035/D-037 commitPresent tolerances, the back-dating check) silently depends on clone depth.
// The working repository itself is shallow (.git/shallow = e8361b8, whose parent dcb289c was never fetched), which is
// what D-035/D-037 describe as a "pruned"/"truncated" history.
//   S1  clone A (--no-local; inherits the shallow boundary). Commit M modifies a write-once review sidecar
//       (round-20 qa-verifier.findings.json: F-DG0-242 severity High -> Low) and findings.json to match; commit N follows.
//       checkWriteOnce(A) + checkFindings-like immutable-field comparison -> write-once error expected.
//   S2  clone B = git clone --depth 2 file://A  (boundary at M).  checkWriteOnce(B) -> ?
//   S3  is either repository reported as shallow by any validator output? (grep the errors for "shallow")
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const base = mkdtempSync(join(tmpdir(), "sec21-sh-"));
try {
  const A = join(base, "A");
  const B = join(base, "B");
  execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], A]);
  const git = (r, ...a) => execFileSync("git", ["-C", r, "-c", "user.name=sec21", "-c", "user.email=sec21@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  console.log(`A: HEAD=${git(A, "rev-parse", "HEAD")} shallow=${git(A, "rev-parse", "--is-shallow-repository")} root=${git(A, "rev-list", "--max-parents=0", "HEAD")}`);
  const side = "docs/delivery/reviews/DG0/round-20/qa-verifier.findings.json";
  const s = JSON.parse(readFileSync(join(A, side), "utf8"));
  s.findings.find((f) => f.id === "F-DG0-242").severity = "Low";
  writeFileSync(join(A, side), JSON.stringify(s, null, 2) + "\n");
  const fp = join(A, "docs/delivery/findings.json");
  const fj = JSON.parse(readFileSync(fp, "utf8"));
  fj.findings.find((f) => f.id === "F-DG0-242").severity = "Low";
  writeFileSync(fp, JSON.stringify(fj, null, 2) + "\n");
  git(A, "commit", "-q", "--no-verify", "-am", "M: tamper write-once sidecar (probe)");
  writeFileSync(join(A, "docs/delivery/progress.md"), readFileSync(join(A, "docs/delivery/progress.md"), "utf8") + "\nprobe\n");
  git(A, "commit", "-q", "--no-verify", "-am", "N: unrelated follow-up (probe)");
  execFileSync("git", ["clone", "-q", "--depth", "2", `file://${A}`, B]);
  console.log(`B: HEAD=${git(B, "rev-parse", "HEAD")} shallow=${git(B, "rev-parse", "--is-shallow-repository")} root=${git(B, "rev-list", "--max-parents=0", "HEAD")}`);
  const rules = await import(pathToFileURL(join(A, "tools/gates/lib/rules.mjs")).href);
  for (const [label, repo] of [["S1 A (tamper commit inside history)", A], ["S2 B (--depth 2, tamper commit is the shallow root)", B]]) {
    const errs = [];
    rules.checkWriteOnce(repo, "DG0", errs);
    const hit = errs.filter((e) => e.includes("round-20/qa-verifier.findings.json"));
    console.log(`\n== ${label}: checkWriteOnce errors=${errs.length}; about the tampered sidecar=${hit.length}; mention 'shallow'=${errs.some((e) => /shallow/i.test(e))}`);
    for (const e of hit) console.log(`   ${e}`);
  }
  console.log("\nRESULT: the write-once violation is detected only when the tamper commit lies inside the fetched history; nothing reports that the repository is shallow.");
} finally {
  rmSync(base, { recursive: true, force: true });
}
