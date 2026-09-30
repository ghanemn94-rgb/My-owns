// release-auditor round 29: real-repository probes on a disposable `git clone --no-local` at the live HEAD.
// usage: node 03-real-repo-probes.mjs <clone-dir>
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const repo = process.argv[2];
const R = await import(join(repo, "tools/gates/lib/rules.mjs"));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
const type = (s) => { try { return git("cat-file", "-t", s); } catch { return null; } };
const stages = JSON.parse(readFileSync(join(repo, "docs/delivery/stages.json"), "utf8"));
const st = stages.stages.find((s) => s.id === "DG0");
console.log(`HEAD ${git("rev-parse", "HEAD")} shallow=${git("rev-parse", "--is-shallow-repository")}`);
// 1. object-type census of the four commit-id fields
const rt = {}; for (const r of st.review_rounds) { const t = type(r.source_commit) || "absent"; (rt[t] ||= []).push(r.round); }
console.log("review_rounds[].source_commit types:", JSON.stringify(rt));
const f = JSON.parse(readFileSync(join(repo, "docs/delivery/findings.json"), "utf8")).findings.filter((x) => x.stage_id === "DG0");
const ft = {}; for (const x of f) if (x.fix_revision) { const t = type(x.fix_revision) || "absent"; ft[t] = (ft[t] || 0) + 1; }
console.log("fix_revision types:", JSON.stringify(ft), "zero-sha:", f.filter((x) => /^0+$/.test(x.fix_revision || "x")).length);
const ht = {}; const rd = join(repo, "docs/delivery/runs/DG0");
for (const d of readdirSync(rd)) { const m = join(rd, d, "meta.json"); if (!existsSync(m)) continue; const h = JSON.parse(readFileSync(m, "utf8")).head_commit_at_start; const t = h ? (type(h) || "absent") : "missing-field"; ht[t] = (ht[t] || 0) + 1; }
console.log("runs head_commit_at_start types:", JSON.stringify(ht));
// 2. checkWriteOnce on the complete history
let e = []; R.checkWriteOnce(repo, "DG0", e); console.log(`checkWriteOnce errors: ${e.length}`); e.forEach((x) => console.log("  ", x));
// 3. checkReviewRounds on the genuine stages.json
e = []; R.checkReviewRounds(repo, st, e); console.log(`checkReviewRounds (genuine) errors: ${e.length}`); e.forEach((x) => console.log("  ", x));
// 4. forge: round 28 source_commit replaced by an annotated tag object of the same commit (manifest updated consistently in-memory is not needed: type check fires first)
const r28 = st.review_rounds.find((r) => r.round === 28);
git("-c", "user.name=aud", "-c", "user.email=aud@example.invalid", "tag", "-a", "-m", "forge", "aud-forge-r28", r28.source_commit);
const tagObj = git("rev-parse", "aud-forge-r28"); console.log(`forged tag object ${tagObj} (type ${type(tagObj)}) -> peels to ${git("rev-parse", "aud-forge-r28^{commit}")}`);
const forged = JSON.parse(JSON.stringify(st)); forged.review_rounds.find((r) => r.round === 28).source_commit = tagObj;
e = []; R.checkReviewRounds(repo, forged, e); console.log(`checkReviewRounds (round-28 tag forge) errors: ${e.length}`); e.forEach((x) => console.log("  ", x));
// 5. absent round source_commit (round 18) is tolerated by the type check
const r18 = st.review_rounds.find((r) => r.round === 18); console.log(`round 18 source_commit ${r18.source_commit} type=${type(r18.source_commit) || "absent"}`);
