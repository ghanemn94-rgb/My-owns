// F-DG0-241 real-repo probe: checkCandidate's source_commit object-type + reachability rule (current mode).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const base = mkdtempSync(join(process.env.TMPDIR, "p241-")); const repo = join(base, "c");
try {
  execFileSync("git", ["clone", "-q", "--no-local", process.argv[2], repo]);
  const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=p", "-c", "user.email=p@example.invalid", "-c", "tag.gpgsign=false", ...a]).toString().trim();
  const rules = await import(pathToFileURL(join(repo, "tools/gates/lib/rules.mjs")).href);
  const st = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8")).stages[0];
  git("tag", "-a", "probe-tag", "-m", "probe", st.candidate.source_commit);
  const tagObj = git("rev-parse", "probe-tag");
  const tree = git("rev-parse", `${st.candidate.source_commit}^{tree}`);
  const cases = { "on-branch frozen commit": st.candidate.source_commit, "off-branch 450c756 (backup branch)": "450c756f679a911b4c736e856fc9dd5e9b2c89a8",
    "annotated tag peeling to frozen commit": tagObj, "tree object": tree, "absent 40-hex": "0123456789abcdef0123456789abcdef01234567" };
  for (const [k, sha] of Object.entries(cases)) {
    const errs = [];
    const gate = { stage_id: "DG0", candidate_id: st.candidate.candidate_id, source_commit: sha, manifest_path: st.candidate.manifest_path };
    rules.checkCandidate(repo, st, gate, "current", errs);
    const sc = errs.filter((e) => /gate source_commit|source_commit differs/.test(e));
    console.log(`${k.padEnd(42)} ${sha.slice(0, 10)} -> ${sc.length ? sc.join(" | ") : "accepted"}`);
  }
} finally { rmSync(base, { recursive: true, force: true }); }
