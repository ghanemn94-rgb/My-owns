// code-security-reviewer DG7 r7: recompute the scanner's raw hits (no allow-list) on the two files whose values
// were allow-listed in 19a82f6c2, print rule, line, the full value (these are expected to be grep regexes, not
// secrets) and its sha256, and compare to tools/release/secret-allowlist.json.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { scanContent } from "../../../../../../../tools/release/secret-scan.mjs";
const repo = process.argv[2];
const al = JSON.parse(readFileSync(`${repo}/tools/release/secret-allowlist.json`, "utf8")).entries ?? JSON.parse(readFileSync(`${repo}/tools/release/secret-allowlist.json`, "utf8"));
const files = ["docs/delivery/reviews/DG7/round-6/qa-verifier.json", "docs/delivery/test-evidence/DG7/qa/round-6/98-evidence-hygiene.log"];
for (const f of files) {
  const hits = scanContent(f, readFileSync(`${repo}/${f}`));
  for (const h of hits) {
    const sha = createHash("sha256").update(Buffer.from(h.value, "utf8")).digest("hex");
    const entries = (Array.isArray(al) ? al : al.entries ?? []).filter((e) => e.valueSha256 === sha);
    console.log(JSON.stringify({ file: f, rule: h.rule, line: h.line, value: h.value, sha256: sha, allowEntries: entries.map((e) => ({ rule: e.rule, path: e.path, scopes: e.scopes })) }));
  }
}
