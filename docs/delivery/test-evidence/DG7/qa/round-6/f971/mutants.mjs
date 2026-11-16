#!/usr/bin/env node
// qa-verifier DG7 round 6 (T-DG7-REV-QA-R6): mutation check of the F-DG7-971 repair. Each mutant removes or loosens ONE
// condition of the ADR-0064 A5.2 rule in a scratch COPY of deploy/ ($M/deploy, $M = a symlink farm of the frozen clone,
// never the clone itself), then runs (a) DO-D9's own tests T-S1..T-S8 (node --test --test-name-pattern) and (b) my
// probe-rule.mjs. A mutant is killed when (a) or (b) fails; the report says which. The original file is restored after
// each mutant. SYNTHETIC; approves nothing.
//   node mutants.mjs <mutant workspace $M> <probe-rule.mjs>
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [M, PROBE] = process.argv.slice(2);
const F = join(M, "deploy/scripts/drill/schedule-explained.mjs");
const ORIG = readFileSync(F, "utf8");
const mutants = [
  ["M1 S2 initiating user check removed", `if (x.initiating_user_id !== null || x.run_as !== "service") return "has an initiating user";`, ``],
  ["M2 S3 schedule-kind check removed", `if (rows.triggers?.[x.trigger_code] !== "schedule") return`, `if (false) return`],
  ["M3 S7 slot-in-window check removed", `if (!(s > W0 - MINUTE && s <= W1))`, `if (false)`],
  ["M4 S8 created-in-window check removed", `if (!(c >= W0 && c <= W1)) return`, `if (false) return`],
  ["M5 S9 own service event check removed", `if (own.length === 0 || !own.some((e) => Number(e.new_version) === Number(x.version)))`, `if (false)`],
  ["M6 uniqueness check removed", "if (n !== 1) return", "if (false) return"],
  ["M7 Gate 0 table check removed", "if (table !== EXEC && table !== RESULT) return no(", "if (false) return no("],
  ["M8 S1 package (changed row) check removed", `if (!x || inPkgX.has(id)) return "not added";`, `if (!x) return "not added";`],
  ["M9 S' result event check removed", `if (!ok) return "no worker audit event of the execution's job";`, ``],
  ["M10 Gate 0 accepts 'unexplained changed' keys", "^ {4}unexplained added \\\\[", "^ {4}unexplained (?:added|changed) \\\\["],
  ["M11 S6 accepts a key two minutes after a slot", "if (cronMatches(cron, timezone, ms - MINUTE)) return ms - MINUTE;", "if (cronMatches(cron, timezone, ms - MINUTE)) return ms - MINUTE;\n  if (cronMatches(cron, timezone, ms - 2 * MINUTE)) return ms - 2 * MINUTE;"],
  ["M12 S7 lower bound widened to W0 - 120 s", "if (!(s > W0 - MINUTE && s <= W1))", "if (!(s > W0 - 2 * MINUTE && s <= W1))"],
];
let survived = 0;
for (const [name, from, to] of mutants) {
  if (!ORIG.includes(from)) {
    console.log(`${name}: NOT APPLIED (pattern not found)`);
    survived++;
    continue;
  }
  writeFileSync(F, ORIG.replace(from, to));
  const a = spawnSync(process.execPath, ["--test", "--test-name-pattern=T-S[1-8] ", "deploy/scripts/tests/transfer-drill.test.mjs"], { cwd: M, encoding: "utf8", timeout: 300_000 });
  const fails = (a.stdout.match(/^ℹ fail (\d+)/m) ?? [])[1];
  const failed = [...a.stdout.matchAll(/^\s*✖ (T-S\d)/gm)].map((m) => m[1]);
  const b = spawnSync(process.execPath, [PROBE, M], { encoding: "utf8", timeout: 120_000 });
  const notOk = b.stdout.split("\n").filter((l) => l.startsWith("NOT OK")).map((l) => l.split(/\s+/)[2]);
  const killed = a.status !== 0 || b.status !== 0;
  if (!killed) survived++;
  console.log(`${name}: ${killed ? "KILLED" : "SURVIVED"} | DO-D9 T-S1..8 exit ${a.status} fail ${fails ?? "?"} [${[...new Set(failed)].join(",")}] | probe-rule exit ${b.status} not-ok [${notOk.join(",")}]`);
}
writeFileSync(F, ORIG);
console.log(`${mutants.length} mutants, ${mutants.length - survived} killed, ${survived} survived or not applied; original restored`);
process.exit(survived === 0 ? 0 : 1);
