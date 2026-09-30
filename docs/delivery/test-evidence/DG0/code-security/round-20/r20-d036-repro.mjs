// Round-20 code-security reproduction for D-036 (F-DG0-155 / F-DG0-240).
// Run from a DISPOSABLE clone of the candidate: node <this> <clone-dir>
// (1) Replays the round-19 repro: a NON-EXISTENT gate source_commit must now be rejected by checkCandidate in CURRENT mode.
// (2) A reachable-but-wrong gate/manifest source_commit is still rejected (findManifest recompute).
// (3) D-035 tolerance for genuinely pruned NON-gate rounds still holds: findManifest on every stages.json round.
// (4) Argument-injection style source_commit values are rejected (schema pattern + cat-file).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const repo = process.argv[2];
const { findManifest, checkCandidate } = await import(join(repo, "tools/gates/lib/rules.mjs"));
const stages = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8"));
const stage = stages.stages.find((s) => s.id === "DG0");
const cid = stage.candidate.candidate_id;
const rel = `docs/delivery/candidates/DG0/${cid.slice(7, 23)}.manifest.json`;
const orig = readFileSync(join(repo, rel), "utf8");
const m = JSON.parse(orig);
const run = (label, fn) => { const e = []; fn(e); console.log(`${label}: ${e.length} error(s)`, e.map((x) => x.slice(0, 170))); return e; };
const FAKE = "f".repeat(40);
run("B0 checkCandidate CURRENT, real source_commit (control)", (e) => checkCandidate(repo, stage, { candidate_id: cid, manifest_path: rel, source_commit: m.source_commit }, "current", e));
writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: FAKE }, null, 1));
run("B1 checkCandidate CURRENT, gate+manifest source_commit NON-EXISTENT", (e) => checkCandidate(repo, stage, { candidate_id: cid, manifest_path: rel, source_commit: FAKE }, "current", e));
run("C1 checkCandidate HISTORICAL, NON-EXISTENT", (e) => checkCandidate(repo, stage, { candidate_id: cid, manifest_path: rel, source_commit: FAKE }, "historical", e));
const wrong = execFileSync("git", ["-C", repo, "rev-list", "--max-parents=0", "HEAD"]).toString().trim().split("\n")[0];
writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: wrong }, null, 1));
run(`B2 findManifest, reachable but WRONG source_commit (${wrong.slice(0,10)})`, (e) => findManifest(repo, "DG0", cid, e, "B2"));
for (const inj of ["--batch", "HEAD", "HEAD~1"]) {
  writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: inj }, null, 1));
  run(`B3 checkCandidate CURRENT, source_commit=${JSON.stringify(inj)} (schema pattern ^[0-9a-f]{40}$ also rejects)`, (e) => checkCandidate(repo, stage, { candidate_id: cid, manifest_path: rel, source_commit: inj }, "current", e));
}
writeFileSync(join(repo, rel), orig);
console.log("--- D-035 tolerance on existing rounds (manifest per round; commit present?) ---");
for (const r of stage.review_rounds) {
  let present = true;
  try { execFileSync("git", ["-C", repo, "cat-file", "-e", `${r.source_commit}^{commit}`], { stdio: "ignore" }); } catch { present = false; }
  const e = []; findManifest(repo, "DG0", r.candidate_id, e, `round ${r.round}`);
  console.log(`round ${r.round} cid ${r.candidate_id.slice(7,19)} commit ${r.source_commit.slice(0,10)} present=${present} findManifest errors=${e.length}${e.length ? " " + e.join(" | ").slice(0, 200) : ""}`);
}
