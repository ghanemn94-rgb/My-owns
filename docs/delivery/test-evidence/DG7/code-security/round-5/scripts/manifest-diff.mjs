// DG7 round 5 (code-security-reviewer): compare two committed candidate manifests with the gate library.
// usage: node manifest-diff.mjs <old.manifest.json> <new.manifest.json>
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const lib = await import(resolve(process.cwd(), "tools/gates/lib/candidate.mjs"));
const a = JSON.parse(readFileSync(process.argv[2], "utf8"));
const b = JSON.parse(readFileSync(process.argv[3], "utf8"));
const out = {
  old: a.candidate_id,
  new: b.candidate_id,
  old_recomputed_matches: lib.candidateId(a.entries) === a.candidate_id,
  new_recomputed_matches: lib.candidateId(b.entries) === b.candidate_id,
  spec_equal: JSON.stringify(a.spec) === JSON.stringify(b.spec),
  ...lib.diffManifests(a.entries, b.entries),
};
console.log(JSON.stringify(out, null, 2));
process.exit(out.old_recomputed_matches && out.new_recomputed_matches ? 0 : 1);
