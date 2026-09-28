#!/usr/bin/env node
// Compute, freeze or diff a stage candidate.
//   node tools/gates/candidate.mjs --stage DG0                 print the working-tree candidate id
//   node tools/gates/candidate.mjs --stage DG0 --ref <commit>  candidate id of a committed tree
//   node tools/gates/candidate.mjs --stage DG0 --freeze        freeze HEAD (requires the candidate content to be committed)
//   node tools/gates/candidate.mjs --stage DG0 --diff          compare the frozen manifest with the working tree
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateId, diffManifests, manifestFromRef, manifestFromWorkingTree, specPolicyErrors, HASH_ALGORITHM } from "./lib/candidate.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const stageId = opt("--stage");
if (!/^DG[0-7]$/.test(stageId || "")) {
  console.error("usage: candidate.mjs --stage DGx [--ref <commit> | --freeze | --diff]");
  process.exit(64);
}
const stagesPath = join(repo, "docs/delivery/stages.json");
const stagesDoc = JSON.parse(readFileSync(stagesPath, "utf8"));
const stage = stagesDoc.stages.find((s) => s.id === stageId);
const spec = stage.candidate_spec;

if (args.includes("--diff")) {
  const rel = stage.candidate.manifest_path;
  if (!rel || !existsSync(join(repo, rel))) {
    console.error(`${stageId}: no frozen manifest`);
    process.exit(1);
  }
  const frozen = JSON.parse(readFileSync(join(repo, rel), "utf8"));
  const now = manifestFromWorkingTree(repo, frozen.spec);
  const d = diffManifests(frozen.entries, now);
  const id = candidateId(now);
  console.log(JSON.stringify({ frozen: frozen.candidate_id, working_tree: id, matches: id === frozen.candidate_id, ...d }, null, 2));
  process.exit(id === frozen.candidate_id ? 0 : 1);
}

if (args.includes("--freeze")) {
  const policy = specPolicyErrors(spec);
  if (policy.length) {
    console.error(`refusing to freeze: candidate_spec violates policy: ${policy.join("; ")}`);
    process.exit(1);
  }
  const head = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"]).toString().trim();
  const fromHead = manifestFromRef(repo, head, spec);
  const fromTree = manifestFromWorkingTree(repo, spec);
  const idHead = candidateId(fromHead);
  const idTree = candidateId(fromTree);
  if (idHead !== idTree) {
    const d = diffManifests(fromHead, fromTree);
    console.error(`refusing to freeze: uncommitted candidate changes (${JSON.stringify(d)})`);
    process.exit(1);
  }
  // One write-once manifest per freeze (D-021): rounds are cross-checked against these committed files.
  const rel = `docs/delivery/candidates/${stageId}/${idHead.slice(7, 23)}.manifest.json`;
  if (existsSync(join(repo, rel))) {
    console.error(`refusing to freeze: ${rel} already exists (this candidate was frozen before)`);
    process.exit(1);
  }
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  const frozenAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  writeFileSync(join(repo, rel), JSON.stringify({
    stage_id: stageId, candidate_id: idHead, hash_algorithm: HASH_ALGORITHM, source_commit: head, frozen_at: frozenAt, spec,
    meta_excluded: "see tools/gates/lib/candidate.mjs META_EXCLUDES", entries: fromHead,
  }, null, 1) + "\n");
  stage.candidate = { candidate_id: idHead, source_commit: head, frozen_at: frozenAt, manifest_path: rel };
  writeFileSync(stagesPath, JSON.stringify(stagesDoc, null, 2) + "\n");
  console.log(JSON.stringify({ stage: stageId, candidate_id: idHead, source_commit: head, files: fromHead.length, manifest: rel }));
  process.exit(0);
}

const ref = opt("--ref");
const entries = ref ? manifestFromRef(repo, ref, spec) : manifestFromWorkingTree(repo, spec);
console.log(JSON.stringify({ stage: stageId, source: ref || "working-tree", candidate_id: candidateId(entries), files: entries.length }));
