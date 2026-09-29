#!/usr/bin/env node
// Merge reviewer-authored finding and verification sidecars into docs/delivery/findings.json (orchestrator-run).
// Reviewers cannot write findings.json (write guard), so they write, next to their review record:
//   <role>.findings.json       {"findings": [ <finding objects, status OPEN> ]}
//   <role>.verifications.json  {"verifications": [ {finding_id, result: PASS|FAIL, status_after, note, evidence[]} ]}
// Verification provenance (by_role, invocation_reference) is taken from that reviewer's own review record.
// Fix progress is recorded with:  --fix F-DG0-001 --revision <commit> --summary "<text>"
//   node tools/gates/import-findings.mjs --stage DG0 --round 1
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "./lib/schema.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const path = join(repo, "docs/delivery/findings.json");
const doc = JSON.parse(readFileSync(path, "utf8"));
const byId = new Map(doc.findings.map((f) => [f.id, f]));
const log = [];

if (opt("--fix")) {
  const f = byId.get(opt("--fix"));
  if (!f) throw new Error(`unknown finding ${opt("--fix")}`);
  if (!opt("--revision") || !opt("--summary")) throw new Error("--fix needs --revision and --summary");
  f.fix_revision = opt("--revision");
  f.fix_summary = opt("--summary");
  f.status = "FIXED_PENDING_VERIFICATION";
  f.history.push({ at: now, status: f.status, note: `fix at ${f.fix_revision}` });
  log.push(`${f.id} -> FIXED_PENDING_VERIFICATION`);
} else {
  const stage = opt("--stage");
  const round = opt("--round");
  if (!/^DG[0-7]$/.test(stage || "") || !/^\d+$/.test(round || "")) throw new Error("usage: --stage DGx --round N | --fix ID --revision SHA --summary TEXT");
  const dir = join(repo, "docs/delivery/reviews", stage, `round-${round}`);
  for (const role of ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"]) {
    const recPath = join(dir, `${role}.json`);
    const rec = existsSync(recPath) ? JSON.parse(readFileSync(recPath, "utf8")) : null;
    const fPath = join(dir, `${role}.findings.json`);
    if (existsSync(fPath)) {
      for (const f of JSON.parse(readFileSync(fPath, "utf8")).findings) {
        if (byId.has(f.id)) {
          log.push(`skip ${f.id} (already imported)`);
          continue;
        }
        if (f.reported_by !== role) throw new Error(`${fPath}: ${f.id} reported_by ${f.reported_by} != ${role}`);
        if (f.stage_id !== stage || !f.id.startsWith(`F-${stage}-`)) throw new Error(`${fPath}: ${f.id} (stage_id ${f.stage_id}) does not belong to ${stage}`);
        f.history = f.history && f.history.length ? f.history : [{ at: now, status: f.status, note: `imported from ${role} round ${round}` }];
        doc.findings.push(f);
        byId.set(f.id, f);
        log.push(`+ ${f.id} ${f.severity} ${f.title}`);
      }
    }
    const vPath = join(dir, `${role}.verifications.json`);
    if (existsSync(vPath)) {
      if (!rec) {
        // An interrupted run (e.g. the CLI hits the account session limit before writing its verdict) can leave a
        // verifications sidecar with no review record. Its verifications cannot be attributed without the record's
        // provenance (invocation_reference, reviewed_at), so they are NOT imported: the findings they targeted stay
        // pending and are re-verified in a later round. The sidecar is left in place as honest evidence of the
        // interrupted run and never deleted -- deleting committed review evidence violates the write-once invariant
        // (tools/gates/lib/rules.mjs checkWriteOnce), which is what forced the round-17 mishap that this guard prevents.
        log.push(`skip ${role} verifications: no review record ${role}.json (interrupted run); its findings stay pending`);
      } else {
        for (const v of JSON.parse(readFileSync(vPath, "utf8")).verifications) {
          const f = byId.get(v.finding_id);
          if (!f) throw new Error(`${vPath}: unknown finding ${v.finding_id}`);
          f.verification = {
            by_role: role, invocation_reference: rec.invocation_reference, at: rec.reviewed_at,
            result: v.result, evidence: v.evidence || [], note: v.note || "",
          };
          f.status = v.status_after;
          f.history.push({ at: rec.reviewed_at, status: f.status, note: `verified by ${role} round ${round}: ${v.result}` });
          log.push(`~ ${f.id} -> ${f.status} (${role})`);
        }
      }
    }
  }
}
const schema = JSON.parse(readFileSync(join(repo, "tools/gates/schemas/findings.schema.json"), "utf8"));
const errors = validate(schema, doc);
if (errors.length) {
  console.error("refusing to write findings.json:\n  " + errors.join("\n  "));
  process.exit(1);
}
writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
console.log(log.join("\n") || "nothing to import");
