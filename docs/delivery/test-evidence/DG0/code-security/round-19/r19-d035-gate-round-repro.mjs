// Round-19 code-security reproduction for D-035 (findManifest tolerates a missing source_commit).
// Run from a DISPOSABLE clone of the candidate: node <this> <clone-dir>
// Shows: (a) for the round-19 (= gate) candidate manifest, a forged NON-EXISTENT source_commit passes findManifest
// with zero errors; (b) checkCandidate in CURRENT mode (the mode used when a gate is approved) never consults
// gate.source_commit, so it passes too; (c) only HISTORICAL mode (and, indirectly, fix_revision ancestry when a
// finding has one) rejects it. A reachable-but-wrong commit is still rejected by findManifest.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const repo = process.argv[2];
const { findManifest, checkCandidate } = await import(join(repo, "tools/gates/lib/rules.mjs"));
const stages = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8"));
const stage = stages.stages.find((s) => s.id === "DG0");
const cid = stage.candidate.candidate_id;
const rel = `docs/delivery/candidates/DG0/${cid.slice(7, 23)}.manifest.json`;
const m = JSON.parse(readFileSync(join(repo, rel), "utf8"));
const FAKE = "f".repeat(40);
const run = (label, fn) => { const e = []; fn(e); console.log(`${label}: ${e.length} error(s)`, e.map((x) => x.slice(0, 160))); };
run("A0 findManifest, real source_commit", (e) => findManifest(repo, "DG0", cid, e, "A0"));
writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: FAKE }, null, 1));
run("A1 findManifest, gate-round manifest with NON-EXISTENT source_commit", (e) => findManifest(repo, "DG0", cid, e, "A1"));
const wrong = "701870e913335957143b61fb200e01c4265802c4"; // reachable, different content
writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: wrong }, null, 1));
run("A2 findManifest, reachable but WRONG source_commit", (e) => findManifest(repo, "DG0", cid, e, "A2"));
writeFileSync(join(repo, rel), JSON.stringify({ ...m, source_commit: FAKE }, null, 1));
const gate = { candidate_id: cid, manifest_path: rel, source_commit: FAKE };
run("B  checkCandidate CURRENT mode, gate.source_commit NON-EXISTENT", (e) => checkCandidate(repo, stage, gate, "current", e));
run("C  checkCandidate HISTORICAL mode, gate.source_commit NON-EXISTENT", (e) => checkCandidate(repo, stage, gate, "historical", e));
writeFileSync(join(repo, rel), JSON.stringify(m, null, 1));
