// `mth-db migrate --dry-run` against real PostgreSQL (ADR-0068 §1, §2, §5; REQ-S19-013; T-DG7-DO-G).
//
// The copy: a database at the DG6 level (0001–0130, applied by the real runner from a directory holding only those
// files), backed up with `pg_dump -Fc` and restored with `pg_restore --no-owner --role=mth_owner` into a fresh
// database. ADR-0066's backup.sh/restore.sh (DO-F, W8) are not merged when this test is written, so it uses
// pg_dump/pg_restore directly, as ADR-0068 §5 allows. The test then dry-runs the P7 migrations on the copy, proves the
// copy is unchanged and the throw-away database is gone, and finally upgrades the copy for real.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureSnapshot,
  defaultCataloguePath,
  DRY_RUN_LINES,
  loadCatalogue,
  runDryRun,
  runDryRunCommand,
  throwAwayName,
} from "../../src/dry-run.ts";
import { defaultMigrationsDir, listMigrationFiles, migrate, migrationStatus } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
/** The superuser on the maintenance database: has CREATEDB (DRY_RUN_ADMIN_DATABASE_URL). */
const dryRunAdmin = roleUrl(adminUrl, "postgres", null);
const DG6_LAST_ID = 130;
const ALL = listMigrationFiles();
const LATER = ALL.filter((f) => f.id > DG6_LAST_ID).map((f) => f.name);
const DG6_LEVEL = ALL.filter((f) => f.id <= DG6_LAST_ID).at(-1)!.name;
const catalogue = loadCatalogue(defaultCataloguePath());

const scratch: string[] = [];
const dirs: string[] = [];
let copy = "";
let copyOwner = "";
let dg6Dir = "";

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(process.env["TMPDIR"] ?? "/tmp", prefix));
  dirs.push(d);
  return d;
}

/** A directory with the shipped files up to `lastId`, plus `extra` files. */
function migrationsUpTo(lastId: number, extra: Record<string, string> = {}): string {
  const d = tempDir("mig-dg6-");
  for (const f of ALL.filter((x) => x.id <= lastId)) cpSync(join(defaultMigrationsDir(), f.name), join(d, f.name));
  for (const [name, sql] of Object.entries(extra)) writeFileSync(join(d, name), sql);
  return d;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

const appliedNames = (url: string) =>
  withClient(url, async (c) =>
    (await c.query<{ name: string }>("SELECT name FROM schema_migration ORDER BY id")).rows.map((r) => r.name),
  );

const dryRunDatabases = () =>
  withClient(dryRunAdmin, async (c) =>
    (
      await c.query<{ datname: string }>("SELECT datname FROM pg_database WHERE datname LIKE '%\\_dryrun\\_%'")
    ).rows.map((r) => r.datname),
  );

const databaseCount = () =>
  withClient(dryRunAdmin, async (c) =>
    Number((await c.query<{ n: string }>("SELECT count(*) AS n FROM pg_database")).rows[0]!.n),
  );

/** CREATE DATABASE … TEMPLATE `from` (the copy has no session between tests). */
async function cloneOf(from: string, prefix: string): Promise<string> {
  const name = `${prefix}_${Date.now().toString(36)}`;
  await withClient(dryRunAdmin, (c) => c.query(`CREATE DATABASE ${name} TEMPLATE ${from} OWNER mth_owner`));
  scratch.push(name);
  return name;
}

beforeAll(async () => {
  dg6Dir = migrationsUpTo(DG6_LAST_ID);
  const source = await createScratchDatabase(adminUrl, "mth_dg6src");
  scratch.push(source);
  await migrate(roleUrl(adminUrl, source, "mth_owner"), { dir: dg6Dir });
  const dump = join(tempDir("dg6-dump-"), "dg6.dump");
  execFileSync("pg_dump", ["--format=custom", "--file", dump, "--dbname", roleUrl(adminUrl, source, null)]);
  copy = await createScratchDatabase(adminUrl, "mth_dg6copy");
  scratch.push(copy);
  // Observed (T-DG7-DO-G handback, open question 1): a plain pg_restore of this dump fails, because the CHECK
  // constraint forum_template_participant_parties_check calls p4_parties_known(), which reads governance_party, and
  // pg_dump orders table data by name (forum_template before governance_party). The restore list therefore loads
  // governance_party's data first; nothing else is changed.
  const list = execFileSync("pg_restore", ["--list", dump]).toString().split("\n");
  const first = list.findIndex((l) => / TABLE DATA public /.test(l));
  const party = list.filter((l) => / TABLE DATA public governance_party /.test(l));
  expect(first).toBeGreaterThan(-1);
  expect(party).toHaveLength(1);
  const ordered = list.filter((l) => !party.includes(l));
  ordered.splice(
    ordered.findIndex((l) => / TABLE DATA public /.test(l)),
    0,
    ...party,
  );
  const listFile = join(dirname(dump), "restore.list");
  writeFileSync(listFile, ordered.join("\n"));
  execFileSync("pg_restore", [
    "--no-owner",
    "--role=mth_owner",
    "--single-transaction",
    "--exit-on-error",
    "--use-list",
    listFile,
    "--dbname",
    roleUrl(adminUrl, copy, null),
    dump,
  ]);
  copyOwner = roleUrl(adminUrl, copy, "mth_owner");
}, 240_000);

afterAll(async () => {
  for (const name of scratch.reverse()) await dropScratchDatabase(adminUrl, name);
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}, 60_000);

describe("mth-db migrate --dry-run on a restored DG6-level copy (ADR-0068 §1, §5)", () => {
  it("the restored copy is at the DG6 level (0001–0130) with the P7 files pending", async () => {
    expect(await appliedNames(copyOwner)).toEqual(ALL.filter((f) => f.id <= DG6_LAST_ID).map((f) => f.name));
    expect(LATER.length).toBeGreaterThan(0);
    expect(LATER.every((n) => /_p7_/.test(n))).toBe(true);
  });

  it("T-E30/T-E31/T-E32: reports exactly the later files with their catalogue class and seconds, the P7 tables and grants; the copy is unchanged and the throw-away database is dropped", async () => {
    const before = await appliedNames(copyOwner);
    const logged: string[] = [];
    const outcome = await runDryRun({
      sourceUrl: copyOwner,
      adminUrl: dryRunAdmin,
      confirmRestoredCopy: true,
      catalogue,
      catalogueSource: defaultCataloguePath(),
      log: (l) => logged.push(l),
    });
    const r = outcome.report;
    // T-E30
    expect(outcome.exitCode).toBe(0);
    expect(outcome.line).toMatch(
      new RegExp(
        `^mth-db migrate --dry-run: ${LATER.length} pending migration\\(s\\) applied to a throw-away copy in \\d+\\.\\d s; the source is unchanged$`,
      ),
    );
    expect(r.result).toBe("succeeded");
    expect(r.pending.map((p) => p.name)).toEqual(LATER);
    for (const p of r.pending) {
      expect(p.status).toBe("applied");
      expect(p.class).toBe(catalogue.get(p.name)!.class);
      expect(["additive", "data_rewrite", "destructive"]).toContain(p.class);
      expect(typeof p.seconds).toBe("number");
      expect(p.seconds!).toBeGreaterThanOrEqual(0);
    }
    expect(r.source.level).toBe(DG6_LEVEL);
    expect(r.source.environment).toBe("unmarked (treated as production)");
    expect(r.target.level).toBe(ALL.at(-1)!.name);
    // T-E31
    const diff = r.diff!;
    for (const t of ["retention_class", "retention_table_class", "retention_run", "backup_set"])
      expect(diff.tables.added).toContain(`public.${t}`);
    expect(diff.tables.removed).toEqual([]);
    expect(diff.grants.added).toContain("public.retention_class:SELECT");
    expect(diff.columns.added).toContain("public.backup_set.id");
    expect(diff.functions.added.some((f) => f.startsWith("public.retention_purge_record("))).toBe(true);
    expect(diff.migrations.added).toEqual(LATER);
    const rc = r.rowCounts.find((x) => x.table === "public.retention_class");
    expect(rc).toEqual({ table: "public.retention_class", before: null, after: "12" });
    // T-E32
    expect(r.throwAwayDatabase.name).toMatch(new RegExp(`^${copy}_dryrun_\\d{8}t\\d{6}$`));
    expect(r.throwAwayDatabase.dropped).toBe(true);
    expect(r.source.unchanged).toBe(true);
    expect(await appliedNames(copyOwner)).toEqual(before);
    expect(await dryRunDatabases()).toEqual([]);
    expect(logged.filter((l) => l.startsWith("applying "))).toEqual(LATER.map((n) => `applying ${n}`));
  }, 240_000);

  it("T-E32: a failing migration names the file and the PostgreSQL error, lists the rest as not attempted, leaves the copy unchanged and drops the throw-away database", async () => {
    const dir = migrationsUpTo(DG6_LAST_ID, {
      "0131_zz_dry_run_fails.sql": "CREATE TABLE dry_run_probe (id integer PRIMARY KEY);\nSELECT 1 / 0;\n",
      "0132_zz_dry_run_never.sql": "CREATE TABLE dry_run_never (id integer PRIMARY KEY);\n",
    });
    const before = await appliedNames(copyOwner);
    const count = await databaseCount();
    const outcome = await runDryRun({
      sourceUrl: copyOwner,
      adminUrl: dryRunAdmin,
      confirmRestoredCopy: true,
      dir,
      catalogue,
    });
    expect(outcome.exitCode).toBe(1);
    expect(outcome.line).toBe(
      "mth-db migrate --dry-run: 0131_zz_dry_run_fails.sql failed: division by zero; 1 not attempted; the source is unchanged",
    );
    expect(outcome.report.result).toBe("failed");
    expect(outcome.report.pending.map((p) => [p.name, p.status, p.class])).toEqual([
      ["0131_zz_dry_run_fails.sql", "failed", "unknown"],
      ["0132_zz_dry_run_never.sql", "not_attempted", "unknown"],
    ]);
    expect(outcome.report.pending[0]!.error).toBe("division by zero");
    expect(outcome.report.diff!.tables.added).toEqual([]);
    expect(outcome.report.throwAwayDatabase.dropped).toBe(true);
    expect(await appliedNames(copyOwner)).toEqual(before);
    expect(await dryRunDatabases()).toEqual([]);
    expect(await databaseCount()).toBe(count);
  }, 120_000);

  it("T-E33: a production-marked copy without the confirmation flag → exit 2, the E.5 line, nothing created", async () => {
    const marked = await cloneOf(copy, "mth_dg6prod");
    const markedOwner = roleUrl(adminUrl, marked, "mth_owner");
    await withClient(markedOwner, (c) =>
      c.query(
        "INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('production', 'bootstrap')",
      ),
    );
    const count = await databaseCount();
    for (const sourceUrl of [markedOwner, copyOwner]) {
      const outcome = await runDryRun({ sourceUrl, adminUrl: dryRunAdmin, confirmRestoredCopy: false, catalogue });
      expect(outcome.exitCode).toBe(2);
      expect(outcome.line).toBe(DRY_RUN_LINES.production);
      expect(outcome.line).toBe(
        "mth-db migrate --dry-run: refused: this database is marked production; run it on a restored copy and pass --i-confirm-this-is-a-restored-copy",
      );
      expect(outcome.report.throwAwayDatabase.name).toBeNull();
      expect(outcome.report.pending).toEqual([]);
    }
    expect(await databaseCount()).toBe(count);
    expect(await dryRunDatabases()).toEqual([]);
    expect(await appliedNames(markedOwner)).toHaveLength(ALL.filter((f) => f.id <= DG6_LAST_ID).length);
  }, 120_000);

  it("refuses (exit 2, nothing created) a copy whose applied file changed, and a run without DRY_RUN_ADMIN_DATABASE_URL", async () => {
    const changed = migrationsUpTo(DG6_LAST_ID);
    writeFileSync(join(changed, DG6_LEVEL), `${readFileSync(join(changed, DG6_LEVEL), "utf8")}\n-- edited\n`);
    const count = await databaseCount();
    const drift = await runDryRun({
      sourceUrl: copyOwner,
      adminUrl: dryRunAdmin,
      confirmRestoredCopy: true,
      dir: changed,
    });
    expect(drift.exitCode).toBe(2);
    expect(drift.line).toBe(`mth-db migrate --dry-run: refused: applied migration(s) changed on disk: ${DG6_LEVEL}`);
    const noAdmin = await runDryRun({ sourceUrl: copyOwner, adminUrl: undefined, confirmRestoredCopy: true });
    expect(noAdmin.exitCode).toBe(2);
    expect(noAdmin.line).toMatch(/refused: DRY_RUN_ADMIN_DATABASE_URL is not set/);
    expect(await databaseCount()).toBe(count);
  }, 60_000);

  it("refuses (exit 2) when the copy has another session, which CREATE DATABASE … TEMPLATE forbids; nothing is left behind", async () => {
    const holder = new pg.Client({ connectionString: copyOwner, application_name: "dry-run-test-holder" });
    await holder.connect();
    try {
      const outcome = await runDryRun({ sourceUrl: copyOwner, adminUrl: dryRunAdmin, confirmRestoredCopy: true });
      expect(outcome.exitCode).toBe(2);
      expect(outcome.line).toBe(
        `mth-db migrate --dry-run: refused: the copy ${copy} has other sessions; stop every client of the restored copy first`,
      );
    } finally {
      await holder.end();
    }
    expect(await dryRunDatabases()).toEqual([]);
  }, 60_000);

  it("ADR-0068 §5: the real migrate upgrades the restored copy to the same schema as a fresh database; a dry run then has nothing pending", async () => {
    const applied = await migrate(copyOwner);
    expect(applied).toEqual(LATER);
    const status = await withClient(copyOwner, (c) => migrationStatus(c));
    expect(status.upToDate).toBe(true);
    const fresh = await createScratchDatabase(adminUrl, "mth_fresh");
    scratch.push(fresh);
    await migrate(roleUrl(adminUrl, fresh, "mth_owner"));
    const upgraded = await withClient(copyOwner, (c) => captureSnapshot(c));
    const clean = await withClient(roleUrl(adminUrl, fresh, "mth_owner"), (c) => captureSnapshot(c));
    // Same keys in every category, and same values once parentheses are removed: pg_dump re-prints the expressions
    // of the objects restored from the dump (CHECK constraints, trigger WHEN clauses) with flattened parentheses
    // ((a AND b) AND c → a AND b AND c). Everything that has no expression (grants, migrations) is equal exactly.
    const flat = (m: Record<string, string>) =>
      Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.replace(/[()]/g, "").replace(/\s+/g, " ")]));
    for (const category of Object.keys(clean) as (keyof typeof clean)[]) {
      expect(Object.keys(upgraded[category]), category).toEqual(Object.keys(clean[category]));
      expect(flat(upgraded[category]), category).toEqual(flat(clean[category]));
    }
    expect(upgraded.grants).toEqual(clean.grants);
    expect(upgraded.migrations).toEqual(clean.migrations);
    expect(upgraded.tables).toEqual(clean.tables);

    const reportFile = join(tempDir("dry-run-report-"), "report.json");
    const out: string[] = [];
    const err: string[] = [];
    const code = await runDryRunCommand(
      ["--dry-run", "--report", reportFile, "--i-confirm-this-is-a-restored-copy"],
      copyOwner,
      { out: (l) => out.push(l), err: (l) => err.push(l) },
      { DRY_RUN_ADMIN_DATABASE_URL: dryRunAdmin },
    );
    expect(code).toBe(0);
    expect(out.at(-1)).toMatch(
      /^mth-db migrate --dry-run: 0 pending migration\(s\) applied to a throw-away copy in \d+\.\d s; the source is unchanged$/,
    );
    const report = JSON.parse(readFileSync(reportFile, "utf8")) as { schemaVersion: string; pending: unknown[] };
    expect(report.schemaVersion).toBe("mth-migrate-dry-run/1");
    expect(report.pending).toEqual([]);
    expect(await dryRunDatabases()).toEqual([]);
  }, 240_000);

  it("the CLI refuses an unknown option with exit 2 and its usage line", async () => {
    const err: string[] = [];
    const code = await runDryRunCommand(
      ["--dry-run", "--force"],
      copyOwner,
      { out: () => undefined, err: (l) => err.push(l) },
      {},
    );
    expect(code).toBe(2);
    expect(err.at(-1)).toBe(
      "usage: mth-db migrate --dry-run [--report FILE] [--catalogue FILE] [--i-confirm-this-is-a-restored-copy]",
    );
  });

  it("throw-away names stay within PostgreSQL's 63-byte identifier limit", () => {
    const at = new Date("2026-11-13T02:30:45.123Z");
    expect(throwAwayName("mth", at)).toBe("mth_dryrun_20261113t023045");
    expect(Buffer.byteLength(throwAwayName("x".repeat(63), at))).toBe(63);
  });
});
