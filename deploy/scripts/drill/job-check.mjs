#!/usr/bin/env node
// deploy/scripts/drill/job-check.mjs: the D9 job and approval checks of the transfer drill (ADR-0069 §4 D9;
// p7-work-split §B.6 DO-D2 "D9 jobs", §B.7 DO-D3; test T-B16; T-DG7-DO-D2, T-DG7-DO-D3).
//
//   node deploy/scripts/drill/job-check.mjs snapshot --database-url <target> --out <before.json> [--mth-db <cli>]
//   node deploy/scripts/drill/job-check.mjs compare  --database-url <target> --before <before.json> --out <file>
//        [--mth-db <cli>]
//
// The digests are the §2.3 encoder's, through `mth-db table-digest` (ADR-0064 A2; p7-work-split §C.13), run with
// DATABASE_URL=<target>, never `row::text`:
//   - the approval tables gate_decision, approval and approval_decision: `digest` (and `rows`);
//   - job_run: the `--rows` line hashes by key (count, highest key);
//   - the enabled job_schedule rows: the `--rows` line hashes of their keys (enabled keys read through psql).
// The pg-boss job rows keep their measured form: by queue and state, from the schema and table MEASURED on the target
// (a schema other than public holding a table `job` with columns `name` and `state`); none found: BLOCKED, never PASS.
// They are outside the export plan, so the encoder does not cover them.
// compare (after PostgreSQL, the API and the worker are started again):
//   - every enabled job_schedule row is equal (same keys, same line hashes);
//   - the earlier job_run rows (the keys of the snapshot) are present and unchanged; new rows are counted, never
//     required to be 0;
//   - the approval rows are equal (rows and encoder digest), including those D8 added.
// The queued export reaching `succeeded` within 120 s and its download are checked by the journey (steps exportq and
// exportwait), not here.
// `mth-db` is `--mth-db <cli.js|cli.ts>` (default: packages/db/src/cli.ts of this repository under the `@mth/source`
// condition, else packages/db/dist/cli.js). Its stdout goes to a temporary FILE, not a pipe: `mth-db` exits with
// process.exit() right after printing, which cuts a piped line at 64 KiB (T-DG7-DO-D3 handback, defect 1).
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL, 2 BLOCKED (usage, unreadable input, a table-digest refusal, or
// no pg-boss job table), 3 BLOCKED (psql or mth-db missing). Read-only; it writes no row. SYNTHETIC; approves nothing.
import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
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

/** The mth-db command line: [node args...]. */
export function mthDbArgv(cli) {
  const path = cli ?? [join(REPO, "packages/db/src/cli.ts"), join(REPO, "packages/db/dist/cli.js")].find(existsSync);
  if (!path || !existsSync(path)) throw new Blocked(`mth-db not found${cli ? ` at ${cli}` : ""}`, 3);
  return path.endsWith(".ts") ? ["--conditions=@mth/source", path] : [path];
}

/**
 * `mth-db table-digest --table … [--rows]` against `url` (as DATABASE_URL); returns the parsed mth-table-digest/1
 * object, its tables by name. Stdout goes to a temporary file (see the header).
 */
export function tableDigest(url, tables, { rows = false, cli } = {}) {
  const argv = mthDbArgv(cli);
  const dir = mkdtempSync(join(tmpdir(), "mth-table-digest-"));
  const outFile = join(dir, "out.json");
  const fd = openSync(outFile, "w");
  let r;
  try {
    r = spawnSync(
      process.execPath,
      [...argv, "table-digest", ...(rows ? ["--rows"] : []), ...tables.flatMap((t) => ["--table", t])],
      {
        cwd: dirname(dirname(argv.at(-1))),
        env: { ...process.env, DATABASE_URL: url, NODE_ENV: process.env.NODE_ENV || "production" },
        stdio: ["ignore", fd, "pipe"],
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  } finally {
    closeSync(fd);
  }
  try {
    if (r.error) throw new Blocked(`mth-db could not be started: ${r.error.message}`, 3);
    if (r.status === 2) throw new Blocked(`table-digest: ${r.stderr.trim()}`);
    if (r.status !== 0) throw new Error(`table-digest exit ${r.status}: ${r.stderr.trim()}`);
    const out = JSON.parse(readFileSync(outFile, "utf8"));
    if (out.schemaVersion !== "mth-table-digest/1") throw new Error(`table-digest: schema ${out.schemaVersion}`);
    return new Map(out.tables.map((t) => [t.name, t]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lineMap = (t) => Object.fromEntries((t.lines ?? []).map((l) => [l.key, l.sha256]));

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

/** The encoder's key text of the enabled job_schedule rows (the key tuple as table-digest prints it). */
function enabledScheduleKeys(url) {
  const ids = psql(url, "SELECT id::text FROM job_schedule WHERE enabled ORDER BY id::text;");
  return ids ? ids.split("\n").map((id) => JSON.stringify([id])) : [];
}

export function snapshot(url, { cli } = {}) {
  const boss = pgBossTable(url);
  if (!boss) throw new Blocked("job-check: BLOCKED: no pg-boss job table found on the target (measured)");
  const d = tableDigest(url, ["job_run", "job_schedule", ...APPROVAL_TABLES], { rows: true, cli });
  const runs = lineMap(d.get("job_run"));
  const schedAll = lineMap(d.get("job_schedule"));
  const enabled = Object.fromEntries(enabledScheduleKeys(url).map((k) => [k, schedAll[k] ?? null]));
  const bossRows = psql(
    url,
    `SELECT coalesce(json_agg(json_build_object('queue', name, 'state', state, 'count', n) ORDER BY name, state), '[]')
       FROM (SELECT name, state::text AS state, count(*) AS n FROM "${boss.schema}"."${boss.table}" GROUP BY 1, 2) q;`,
  );
  const keys = Object.keys(runs).sort();
  return {
    schemaVersion: "mth-drill-job-snapshot/2",
    encoder: "mth-db table-digest (mth-table-digest/1, the §2.3 encoder)",
    takenAt: new Date().toISOString(),
    pgBoss: { schema: boss.schema, table: boss.table, rows: JSON.parse(bossRows) },
    jobRun: { count: keys.length, maxKey: keys.at(-1) ?? "", lines: runs },
    enabledSchedules: { count: Object.keys(enabled).length, lines: enabled },
    approvals: Object.fromEntries(
      APPROVAL_TABLES.map((t) => [t, { rows: Number(d.get(t).rows), digest: d.get(t).digest }]),
    ),
  };
}

export function compare(url, before, { cli } = {}) {
  const after = snapshot(url, { cli });
  const failures = [];
  const b = before.enabledSchedules.lines;
  const a = after.enabledSchedules.lines;
  const schedDiff = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => b[k] !== a[k]);
  if (schedDiff.length > 0)
    failures.push(
      `job_schedule: the enabled schedules changed (${before.enabledSchedules.count} -> ${after.enabledSchedules.count} rows, ${schedDiff.length} differ)`,
    );
  const earlier = Object.entries(before.jobRun.lines);
  const changedRuns = earlier.filter(([k, h]) => after.jobRun.lines[k] !== h);
  if (changedRuns.length > 0)
    failures.push(
      `job_run: the earlier rows changed (${before.jobRun.count} before, ${changedRuns.length} missing or different)`,
    );
  for (const t of APPROVAL_TABLES) {
    const x = after.approvals[t];
    const y = before.approvals[t];
    if (x.rows !== y.rows || x.digest !== y.digest)
      failures.push(`${t}: ${y.rows} -> ${x.rows} rows${x.digest !== y.digest ? ", digest differs" : ""}`);
  }
  return {
    schemaVersion: "mth-drill-job-check/2",
    before,
    after,
    newJobRuns: Object.keys(after.jobRun.lines).filter((k) => !(k in before.jobRun.lines)).length,
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
      options: {
        "database-url": { type: "string" },
        out: { type: "string" },
        before: { type: "string" },
        "mth-db": { type: "string" },
      },
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (!["snapshot", "compare"].includes(cmd) || !v["database-url"] || !v.out || (cmd === "compare" && !v.before)) {
    console.error(
      "BLOCKED: usage: job-check.mjs snapshot --database-url <url> --out <file> [--mth-db <cli>] | compare --database-url <url> --before <file> --out <file> [--mth-db <cli>]",
    );
    process.exit(2);
  }
  try {
    if (cmd === "snapshot") {
      const s = snapshot(v["database-url"], { cli: v["mth-db"] });
      writeFileSync(v.out, JSON.stringify(s, null, 2) + "\n");
      console.log(
        `job-check: snapshot: job_run ${s.jobRun.count}, enabled schedules ${s.enabledSchedules.count}, pg-boss ${s.pgBoss.schema}.${s.pgBoss.table}, approvals ${APPROVAL_TABLES.map((t) => `${t} ${s.approvals[t].rows}`).join(", ")}`,
      );
      return;
    }
    let before;
    try {
      before = JSON.parse(readFileSync(v.before, "utf8"));
    } catch (e) {
      throw new Blocked(`job-check: BLOCKED: unreadable snapshot ${v.before}: ${e.message}`);
    }
    if (before?.schemaVersion !== "mth-drill-job-snapshot/2")
      throw new Blocked(`job-check: BLOCKED: ${v.before} is not a mth-drill-job-snapshot/2 snapshot`);
    const r = compare(v["database-url"], before, { cli: v["mth-db"] });
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
