// code-security-reviewer DG5 r2 (re-run of the r1 probe on candidate 5df44203): the advisory-lock registry has no duplicate class id, and every 7302xx literal the
// worker or packages use (they import no API code) is a registered class of the same value. Run from the clone root.
import { execSync } from "node:child_process";
const { ADVISORY_LOCK_CLASSES } = await import(process.cwd() + "/apps/api/src/modules/platform/advisory-locks.ts");
const entries = Object.entries(ADVISORY_LOCK_CLASSES);
const byValue = new Map();
for (const [k, v] of entries) byValue.set(v, [...(byValue.get(v) ?? []), k]);
const dups = [...byValue].filter(([, ks]) => ks.length > 1);
console.log(`registry classes: ${entries.length}; P5 range (>=730250): ${entries.filter(([, v]) => v >= 730250).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log("duplicate class ids:", JSON.stringify(dups));
const lits = execSync(`grep -rhoE "\\b7302[0-9]{2}\\b|\\b730_2[0-9]{2}\\b" apps/worker/src packages/db/src packages/shared/src --include=*.ts --exclude=*.test.ts || true`, { encoding: "utf8" })
  .split("\n").filter(Boolean).map((s) => Number(s.replace("_", "")));
const unknown = [...new Set(lits)].filter((v) => !byValue.has(v));
console.log(`7302xx literals outside apps/api: ${[...new Set(lits)].sort().join(", ")}`);
console.log("literals not in the registry:", JSON.stringify(unknown));
process.exit(dups.length || unknown.length ? 1 : 0);
