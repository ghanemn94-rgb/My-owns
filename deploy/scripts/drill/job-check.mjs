#!/usr/bin/env node
// deploy/scripts/drill/job-check.mjs: the D9 job and approval checks of the transfer drill (ADR-0069 §4 D9;
// p7-work-split §B.6 DO-D2 "D9 jobs"; test T-B16; T-DG7-DO-D2).
//
//   node deploy/scripts/drill/job-check.mjs snapshot --database-url <target> --out <before.json>
//   node deploy/scripts/drill/job-check.mjs compare  --database-url <target> --before <before.json> --out <job-check.json>
//
// snapshot (after the worker is stopped and one export is queued, before the full restart), through psql:
//   - job_run: count, highest id, and a digest of every row;
//   - the enabled job_schedule rows: count and digest;
//   - the pg-boss job rows by queue and state, from the schema and table MEASURED on the target (a schema other than
//     public holding a table `job` with columns `name` and `state`); none found: BLOCKED, never PASS;
//   - the approval rows: gate_decision, approval, approval_decision, each by count and digest.
// compare (after PostgreSQL, the API and the worker are started again):
//   - every enabled job_schedule row is equal (count and digest);
//   - the earlier job_run rows (id <= the highest before) are unchanged; new rows are counted, never required to be 0;
//   - the approval rows are equal (count and digest), including those D8 added.
// The queued export reaching `succeeded` within 120 s and its download are checked by the journey (steps exportq and
// exportwait), not here.
// Digest: SHA-256 over the rows' PostgreSQL text form (`row::text`), joined by newlines in primary-key order. This is
// a stand-in for the §2.3 encoder of packages/db (T-DG7-DO-D2 handback, known gaps): equal rows give equal digests.
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL, 2 BLOCKED (usage, unreadable input, or no pg-boss job table),
// 3 BLOCKED (psql missing). Read-only; it writes no row. SYNTHETIC drill data; it approves nothing.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const APPROVAL_TABLES = ["gate_decision", "approval", "approval_decision"];

class Blocked extends Error {
  constructor(m, code = 2) {
    super(m);
    this.code = code;
  }
}

export function psql(url, sql) {
  const r = spawnSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", url], {
    input: sql,
    encoding: "utf8",
  });
  if (r.error) throw new Blocked("psql not found", 3);
  if (r.status !== 0) throw new Error(`psql: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

const digestOf = (table, where = "true") =>
  `SELECT count(*) || ',' || encode(sha256(convert_to(coalesce(string_agg(t::text, E'\\n' ORDER BY t.id::text), ''), 'UTF8')), 'hex')
     FROM ${table} t WHERE ${where};`;
const pair = (s) => {
  const [count, digest] = s.split(",");
  return { count: Number(count), digest };
};

/** The pg-boss job table, measured: { schema, table } or null. */
export function pgBossTable(url) {
  const r = psql(
    url,
    `SELECT c.table_schema FROM information_schema.columns c
      WHERE c.table_name = 'job' AND c.table_schema NOT IN ('public', 'pg_catalog', 'information_schema')
      GROUP BY c.table_schema HAVING bool_or(c.column_name = 'name') AND bool_or(c.column_name = 'state')
      ORDER BY 1 LIMIT 1;`,
  );
  return r ? { schema: r, table: "job" } : null;
}

export function snapshot(url) {
  const boss = pgBossTable(url);
  if (!boss) throw new Blocked("job-check: BLOCKED: no pg-boss job table found on the target (measured)");
  const jobRun = pair(psql(url, digestOf("job_run")));
  const maxId = psql(url, "SELECT coalesce(max(id::text), '') FROM job_run;");
  const schedules = pair(psql(url, digestOf("job_schedule", "t.enabled")));
  const bossRows = psql(
    url,
    `SELECT coalesce(json_agg(json_build_object('queue', name, 'state', state, 'count', n) ORDER BY name, state), '[]')
       FROM (SELECT name, state::text AS state, count(*) AS n FROM "${boss.schema}"."${boss.table}" GROUP BY 1, 2) q;`,
  );
  const approvals = Object.fromEntries(APPROVAL_TABLES.map((t) => [t, pair(psql(url, digestOf(t)))]));
  return {
    schemaVersion: "mth-drill-job-snapshot/1",
    takenAt: new Date().toISOString(),
    pgBoss: { schema: boss.schema, table: boss.table, rows: JSON.parse(bossRows) },
    jobRun: { ...jobRun, maxId },
    enabledSchedules: schedules,
    approvals,
  };
}

export function compare(url, before) {
  const after = snapshot(url);
  const failures = [];
  if (
    after.enabledSchedules.count !== before.enabledSchedules.count ||
    after.enabledSchedules.digest !== before.enabledSchedules.digest
  )
    failures.push(
      `job_schedule: the enabled schedules changed (${before.enabledSchedules.count} -> ${after.enabledSchedules.count} rows, digest differs)`,
    );
  const earlier = pair(psql(url, digestOf("job_run", `t.id::text <= '${before.jobRun.maxId.replace(/'/g, "''")}'`)));
  if (before.jobRun.count > 0 && (earlier.count !== before.jobRun.count || earlier.digest !== before.jobRun.digest))
    failures.push(
      `job_run: the earlier rows changed (${before.jobRun.count} before, ${earlier.count} with id <= the highest before)`,
    );
  for (const t of APPROVAL_TABLES) {
    const a = after.approvals[t];
    const b = before.approvals[t];
    if (a.count !== b.count || a.digest !== b.digest)
      failures.push(`${t}: ${b.count} -> ${a.count} rows${a.digest !== b.digest ? ", digest differs" : ""}`);
  }
  return {
    schemaVersion: "mth-drill-job-check/1",
    before,
    after,
    newJobRuns: after.jobRun.count - (before.jobRun.count > 0 ? earlier.count : 0),
    failures,
    result: failures.length === 0 ? "PASS" : "FAIL",
  };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  let v;
  try {
    ({ values: v } = parseArgs({
      args: rest,
      options: { "database-url": { type: "string" }, out: { type: "string" }, before: { type: "string" } },
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (!["snapshot", "compare"].includes(cmd) || !v["database-url"] || !v.out || (cmd === "compare" && !v.before)) {
    console.error(
      "BLOCKED: usage: job-check.mjs snapshot --database-url <url> --out <file> | compare --database-url <url> --before <file> --out <file>",
    );
    process.exit(2);
  }
  try {
    if (cmd === "snapshot") {
      const s = snapshot(v["database-url"]);
      writeFileSync(v.out, JSON.stringify(s, null, 2) + "\n");
      console.log(
        `job-check: snapshot: job_run ${s.jobRun.count}, enabled schedules ${s.enabledSchedules.count}, pg-boss ${s.pgBoss.schema}.${s.pgBoss.table}, approvals ${APPROVAL_TABLES.map((t) => `${t} ${s.approvals[t].count}`).join(", ")}`,
      );
      return;
    }
    let before;
    try {
      before = JSON.parse(readFileSync(v.before, "utf8"));
    } catch (e) {
      throw new Blocked(`job-check: BLOCKED: unreadable snapshot ${v.before}: ${e.message}`);
    }
    const r = compare(v["database-url"], before);
    writeFileSync(v.out, JSON.stringify(r, null, 2) + "\n");
    if (r.result === "PASS")
      console.log(
        `job-check: PASS: enabled schedules equal, earlier job_run rows unchanged (${r.newJobRuns} new), approval rows equal`,
      );
    else for (const f of r.failures) console.log(`job-check: FAIL: ${f}`);
    process.exitCode = r.result === "PASS" ? 0 : 1;
  } catch (e) {
    if (e instanceof Blocked) {
      console.error(e.message.startsWith("job-check:") ? e.message : `job-check: BLOCKED: ${e.message}`);
      process.exit(e.code);
    }
    console.error(`job-check: FAIL: ${e.message}`);
    process.exit(1);
  }
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
