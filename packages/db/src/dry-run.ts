// `mth-db migrate --dry-run` (ADR-0068 §1–§2; REQ-S19-013 "a dry-run migration on a restored copy reports its changes").
//
// Runs on a RESTORED COPY (ADR-0066 §7) of the installation to upgrade, never on the live database:
//  1. reads the copy's migration status with the same refusals as `migrate` (changed or unknown applied files,
//     out-of-order ids → exit 2, nothing created), and refuses a production-marked copy without
//     --i-confirm-this-is-a-restored-copy (D-248 O9; a copy with no deployment_environment row counts as production,
//     the product's fail-safe reading of ADR-0050 §3);
//  2. captures the catalogue snapshot (§2) and the row count of every table of the copy;
//  3. with DRY_RUN_ADMIN_DATABASE_URL (a role with CREATEDB on the copy's cluster) creates
//     `<copy>_dryrun_<utc>` FROM the copy as a TEMPLATE, OWNER mth_owner;
//  4. applies the pending migrations there with the real `migrate()` (same files, one transaction each), timing each;
//  5. captures the snapshot and row counts again and diffs them;
//  6. ALWAYS drops the throw-away database (finally), and checks that the copy's schema_migration is unchanged.
// Exit 0: every pending migration applied; 1: one failed (named, with the PostgreSQL error; the rest not attempted),
// or the throw-away database could not be dropped; 2: a refusal or missing input.
// An upgrade of a Mobily installation is an IT change that Mobily IT authorizes; this report authorizes nothing.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MIGRATION_TABLE } from "./constants.ts";
import { assertUtf8Database } from "./encoding.ts";
import { listMigrationFiles, migrate, MigrationError, migrationStatus, type MigrationFile } from "./migrate.ts";
import { connectionWithSessionOptions } from "./pool.ts";

export const DRY_RUN_REPORT_SCHEMA = "mth-migrate-dry-run/1";
export const CONFIRM_FLAG = "--i-confirm-this-is-a-restored-copy";
const PREFIX = "mth-db migrate --dry-run";

/** p7-work-split E.5, verbatim. */
export const DRY_RUN_LINES = {
  ok: (n: number, s: string) =>
    `${PREFIX}: ${n} pending migration(s) applied to a throw-away copy in ${s} s; the source is unchanged`,
  failed: (name: string, error: string, k: number) =>
    `${PREFIX}: ${name} failed: ${error}; ${k} not attempted; the source is unchanged`,
  production: `${PREFIX}: refused: this database is marked production; run it on a restored copy and pass ${CONFIRM_FLAG}`,
} as const;

/** The catalogue classes of ADR-0068 §3, plus `unknown` when the catalogue is absent or names another file version. */
export type CatalogueClass = "additive" | "data_rewrite" | "destructive" | "unknown";

export interface CatalogueEntry {
  readonly class: Exclude<CatalogueClass, "unknown">;
  readonly sha256: string;
}

/** Reads docs/handover/migration-catalogue.json (`mth-migration-catalogue/1`) into name → entry. */
export function loadCatalogue(path: string): Map<string, CatalogueEntry> {
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    schemaVersion?: unknown;
    entries?: { name: string; class: CatalogueEntry["class"]; sha256: string }[];
  };
  if (doc.schemaVersion !== "mth-migration-catalogue/1" || !Array.isArray(doc.entries))
    throw new DryRunRefused(`${path} is not a migration catalogue (mth-migration-catalogue/1)`);
  return new Map(doc.entries.map((e) => [e.name, { class: e.class, sha256: e.sha256 }]));
}

/** The catalogue of the source tree, when this runs from it (the runtime image ships no docs/). */
export function defaultCataloguePath(): string {
  return fileURLToPath(new URL("../../../docs/handover/migration-catalogue.json", import.meta.url));
}

export class DryRunRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DryRunRefused";
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// §2 the catalogue snapshot

export const SNAPSHOT_SCHEMAS = ["public", "pgboss"] as const;

/** Category → key → value. Keys are unique within a category; values compare as strings. */
export type CatalogueSnapshot = Record<SnapshotCategory, Record<string, string>>;
export type SnapshotCategory =
  | "tables"
  | "columns"
  | "constraints"
  | "indexes"
  | "triggers"
  | "functions"
  | "grants"
  | "migrations";

interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

const SNAPSHOT_QUERIES: Record<Exclude<SnapshotCategory, "migrations">, string> = {
  tables: `SELECT n.nspname || '.' || c.relname AS k, c.relkind::text AS v
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm')`,
  columns: `SELECT n.nspname || '.' || c.relname || '.' || a.attname AS k,
                   format_type(a.atttypid, a.atttypmod) || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
                   || coalesce(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') AS v
              FROM pg_attribute a
              JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p', 'v', 'm') AND a.attnum > 0 AND NOT a.attisdropped`,
  constraints: `SELECT n.nspname || '.' || c.relname || '.' || k.conname AS k, pg_get_constraintdef(k.oid) AS v
                  FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname = ANY($1)`,
  indexes: `SELECT schemaname || '.' || indexname AS k, indexdef AS v FROM pg_indexes WHERE schemaname = ANY($1)`,
  triggers: `SELECT n.nspname || '.' || c.relname || '.' || t.tgname AS k,
                    pg_get_triggerdef(t.oid) || ' [enabled=' || t.tgenabled::text || ', deferrable=' || t.tgdeferrable::text || ']' AS v
               FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = ANY($1) AND NOT t.tgisinternal`,
  functions: `SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS k,
                     'security ' || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END
                     || ', returns ' || pg_get_function_result(p.oid)
                     || ', body sha256 ' || encode(sha256(convert_to(coalesce(p.prosrc, ''), 'UTF8')), 'hex') AS v
                FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = ANY($1)`,
  // Table, column and function privileges held by the runtime role mth_app (ADR-0004).
  grants: `SELECT n.nspname || '.' || c.relname || ':' || x.privilege_type AS k, 'mth_app' AS v
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, aclexplode(c.relacl) x
            WHERE n.nspname = ANY($1) AND x.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'mth_app')
           UNION ALL
           SELECT n.nspname || '.' || c.relname || '.' || a.attname || ':' || x.privilege_type, 'mth_app'
             FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace,
                  aclexplode(a.attacl) x
            WHERE n.nspname = ANY($1) AND x.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'mth_app')
           UNION ALL
           SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):'
                  || x.privilege_type, 'mth_app'
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(p.proacl) x
            WHERE n.nspname = ANY($1) AND x.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'mth_app')`,
};

/** Reads the catalogue snapshot of ADR-0068 §2, ordered with COLLATE "C" (equal schemas give equal snapshots). */
export async function captureSnapshot(q: Queryable): Promise<CatalogueSnapshot> {
  const out = {} as CatalogueSnapshot;
  for (const [category, sql] of Object.entries(SNAPSHOT_QUERIES) as [keyof typeof SNAPSHOT_QUERIES, string][]) {
    const { rows } = await q.query<{ k: string; v: string }>(
      `SELECT k, v FROM (${sql}) s ORDER BY k COLLATE "C", v COLLATE "C"`,
      [SNAPSHOT_SCHEMAS],
    );
    const map: Record<string, string> = {};
    // Overloaded functions with one identity are impossible; a duplicate key would be a query defect: keep both.
    for (const r of rows) map[r.k] = map[r.k] === undefined ? r.v : `${map[r.k]} | ${r.v}`;
    out[category] = map;
  }
  const exists = await q.query<{ t: string | null }>(`SELECT to_regclass('public.${MIGRATION_TABLE}')::text AS t`);
  out.migrations = {};
  if (exists.rows[0]?.t !== null && exists.rows[0]?.t !== undefined) {
    const { rows } = await q.query<{ name: string; sha256: string }>(
      `SELECT name, sha256 FROM ${MIGRATION_TABLE} ORDER BY id`,
    );
    for (const r of rows) out.migrations[r.name] = r.sha256;
  }
  return out;
}

export interface CategoryDiff {
  readonly added: string[];
  readonly removed: string[];
  readonly changed: { key: string; before: string; after: string }[];
}

export function diffSnapshots(
  before: CatalogueSnapshot,
  after: CatalogueSnapshot,
): Record<SnapshotCategory, CategoryDiff> {
  const out = {} as Record<SnapshotCategory, CategoryDiff>;
  for (const category of Object.keys(after) as SnapshotCategory[]) {
    const a = before[category] ?? {};
    const b = after[category];
    const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    out[category] = {
      added: Object.keys(b)
        .filter((k) => !(k in a))
        .sort(cmp),
      removed: Object.keys(a)
        .filter((k) => !(k in b))
        .sort(cmp),
      changed: Object.keys(b)
        .filter((k) => k in a && a[k] !== b[k])
        .sort(cmp)
        .map((key) => ({ key, before: a[key]!, after: b[key]! })),
    };
  }
  return out;
}

/** Exact row count of every base table (decimal strings; null when the table cannot be read: Unknown, never 0). */
export async function countRows(q: Queryable): Promise<Map<string, string | null>> {
  const { rows } = await q.query<{ s: string; t: string }>(
    `SELECT n.nspname AS s, c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r', 'p') ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"`,
    [SNAPSHOT_SCHEMAS],
  );
  const out = new Map<string, string | null>();
  for (const r of rows) {
    try {
      const c = await q.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${quoteIdent(r.s)}.${quoteIdent(r.t)}`);
      out.set(`${r.s}.${r.t}`, c.rows[0]!.n);
    } catch {
      out.set(`${r.s}.${r.t}`, null);
    }
  }
  return out;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------------------------------------------------
// §1 the dry run

export interface PendingResult {
  readonly id: number;
  readonly name: string;
  readonly sha256: string;
  readonly class: CatalogueClass;
  readonly status: "applied" | "failed" | "not_attempted";
  readonly seconds: number | null;
  readonly error?: string;
}

export interface DryRunReport {
  readonly schemaVersion: typeof DRY_RUN_REPORT_SCHEMA;
  readonly result: "succeeded" | "failed" | "refused";
  readonly refusal?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly seconds: number;
  readonly source: {
    readonly database: string;
    readonly environment: "production" | "demo" | "unmarked (treated as production)";
    readonly confirmedRestoredCopy: boolean;
    readonly level: string | null;
    readonly appliedCount: number;
    readonly unchanged: boolean | null;
  };
  readonly target: { readonly level: string | null };
  readonly throwAwayDatabase: {
    readonly name: string | null;
    readonly dropped: boolean | null;
    readonly error?: string;
  };
  readonly pending: readonly PendingResult[];
  readonly catalogueSource: string | null;
  readonly diff: Record<SnapshotCategory, CategoryDiff> | null;
  readonly rowCounts: readonly { table: string; before: string | null; after: string | null }[];
}

export interface DryRunOptions {
  /** Owner-role URL of the restored copy (DATABASE_OWNER_URL). */
  readonly sourceUrl: string;
  /** A role with CREATEDB on the copy's cluster (DRY_RUN_ADMIN_DATABASE_URL). */
  readonly adminUrl: string | undefined;
  readonly confirmRestoredCopy: boolean;
  readonly dir?: string;
  readonly catalogue?: ReadonlyMap<string, CatalogueEntry> | null;
  readonly catalogueSource?: string | null;
  readonly now?: () => Date;
  readonly log?: (line: string) => void;
}

export interface DryRunOutcome {
  readonly exitCode: 0 | 1 | 2;
  readonly line: string;
  readonly report: DryRunReport;
}

const seconds = (ms: number) => Math.round(ms) / 1000;
const levelOf = (names: readonly string[]) => (names.length === 0 ? null : names[names.length - 1]!);

/** `<copy>_dryrun_<yyyymmddThhmmss>`, at most 63 bytes (PostgreSQL's identifier limit). */
export function throwAwayName(source: string, at: Date): string {
  const stamp = at
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "")
    .toLowerCase();
  const suffix = `_dryrun_${stamp}`;
  return `${Buffer.from(source, "utf8")
    .subarray(0, 63 - suffix.length)
    .toString("utf8")
    .replace(/�$/, "")}${suffix}`;
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(database)}`;
  return u.toString();
}

async function connect(url: string, name: string): Promise<pg.Client> {
  const c = new pg.Client({ ...connectionWithSessionOptions(url, "-c TimeZone=UTC"), application_name: name });
  c.on("error", () => undefined);
  await c.connect();
  return c;
}

export async function runDryRun(options: DryRunOptions): Promise<DryRunOutcome> {
  const now = options.now ?? (() => new Date());
  const log = options.log ?? (() => undefined);
  const started = now();
  const t0 = performance.now();
  const files = listMigrationFiles(options.dir);
  const database = decodeURIComponent(new URL(options.sourceUrl).pathname.replace(/^\//, ""));
  const classOf = (f: MigrationFile): CatalogueClass => {
    const e = options.catalogue?.get(f.name);
    return e !== undefined && e.sha256 === f.sha256 ? e.class : "unknown";
  };

  let environment: DryRunReport["source"]["environment"] = "unmarked (treated as production)";
  let appliedBefore: string[] = [];
  let pending: PendingResult[] = [];
  let throwAway: string | null = null;
  let dropped: boolean | null = null;
  let dropError: string | undefined;
  let unchanged: boolean | null = null;
  let diff: DryRunReport["diff"] = null;
  let targetLevel: string | null = null;
  let rowCounts: { table: string; before: string | null; after: string | null }[] = [];

  const finish = (
    exitCode: 0 | 1 | 2,
    line: string,
    result: DryRunReport["result"],
    refusal?: string,
  ): DryRunOutcome => ({
    exitCode,
    line,
    report: {
      schemaVersion: DRY_RUN_REPORT_SCHEMA,
      result,
      ...(refusal === undefined ? {} : { refusal }),
      startedAt: started.toISOString(),
      finishedAt: now().toISOString(),
      seconds: seconds(performance.now() - t0),
      source: {
        database,
        environment,
        confirmedRestoredCopy: options.confirmRestoredCopy,
        level: levelOf(appliedBefore),
        appliedCount: appliedBefore.length,
        unchanged,
      },
      target: { level: targetLevel },
      throwAwayDatabase: { name: throwAway, dropped, ...(dropError === undefined ? {} : { error: dropError }) },
      pending,
      catalogueSource: options.catalogueSource ?? null,
      diff,
      rowCounts,
    },
  });
  const refuse = (reason: string) => finish(2, `${PREFIX}: refused: ${reason}`, "refused", reason);

  // 1. Status and refusals, on the copy itself (read-only).
  let snapshotBefore: CatalogueSnapshot;
  let countsBefore: Map<string, string | null>;
  const source = await connect(options.sourceUrl, "mth-db migrate --dry-run (source)");
  try {
    await assertUtf8Database(source);
    const status = await migrationStatus(source, files);
    appliedBefore = status.applied.map((a) => a.name);
    const marker = await source.query<{ t: string | null }>(
      "SELECT to_regclass('public.deployment_environment')::text AS t",
    );
    if (marker.rows[0]?.t !== null && marker.rows[0]?.t !== undefined) {
      const kind = await source.query<{ environment_kind: "production" | "demo" }>(
        "SELECT environment_kind FROM deployment_environment",
      );
      if (kind.rows[0] !== undefined) environment = kind.rows[0].environment_kind;
    }
    if (environment !== "demo" && !options.confirmRestoredCopy) {
      return finish(2, DRY_RUN_LINES.production, "refused", "production-marked database without the confirmation flag");
    }
    if (status.checksumMismatches.length > 0)
      return refuse(`applied migration(s) changed on disk: ${status.checksumMismatches.join(", ")}`);
    if (status.unknownApplied.length > 0)
      return refuse(`the copy has migration(s) this build does not ship: ${status.unknownApplied.join(", ")}`);
    if (status.outOfOrderPending.length > 0)
      return refuse(
        `pending migration(s) ${status.outOfOrderPending.join(", ")} have an id not above the highest applied one`,
      );
    pending = files
      .filter((f) => status.pending.includes(f.name))
      .map((f) => ({
        id: f.id,
        name: f.name,
        sha256: f.sha256,
        class: classOf(f),
        status: "not_attempted",
        seconds: null,
      }));
    if (pending.length === 0) {
      unchanged = true;
      targetLevel = levelOf(appliedBefore);
      return finish(0, DRY_RUN_LINES.ok(0, seconds(performance.now() - t0).toFixed(1)), "succeeded");
    }
    if (options.adminUrl === undefined || options.adminUrl === "")
      return refuse("DRY_RUN_ADMIN_DATABASE_URL is not set (a role with CREATEDB on the copy's cluster)");
    // 2. Snapshot and counts of the copy.
    snapshotBefore = await captureSnapshot(source);
    countsBefore = await countRows(source);
  } finally {
    // A template database must have no other session, including this one.
    await source.end().catch(() => undefined);
  }

  // 3. The throw-away database.
  const name = throwAwayName(database, started);
  const admin = await connect(options.adminUrl, "mth-db migrate --dry-run (admin)");
  try {
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE ${quoteIdent(database)} OWNER mth_owner`);
    } catch (e) {
      const err = e as { code?: string; message: string };
      if (err.code === "55006")
        return refuse(`the copy ${database} has other sessions; stop every client of the restored copy first`);
      return refuse(`cannot create the throw-away database: ${err.message}`);
    }
    throwAway = name;
    log(`created throw-away database ${name} from ${database}`);

    // 4. Apply with the real runner, timing each file from its "applying" line.
    const targetUrl = withDatabase(options.sourceUrl, name);
    let current: { index: number; at: number } | null = null;
    const close = (status: PendingResult["status"], error?: string) => {
      if (current === null) return;
      const p = pending[current.index]!;
      pending[current.index] = {
        ...p,
        status,
        seconds: seconds(performance.now() - current.at),
        ...(error === undefined ? {} : { error }),
      };
      current = null;
    };
    let failure: { name: string; error: string } | null = null;
    try {
      await migrate(targetUrl, {
        ...(options.dir === undefined ? {} : { dir: options.dir }),
        log: (line) => {
          const m = /^applying (\S+)$/.exec(line);
          if (m === null) return;
          close("applied");
          current = { index: pending.findIndex((p) => p.name === m[1]), at: performance.now() };
          log(line);
        },
      });
      close("applied");
    } catch (e) {
      const message = (e as Error).message;
      const failed = current === null ? null : pending[(current as { index: number }).index]!.name;
      const error =
        failed !== null && message.startsWith(`migration ${failed} failed: `)
          ? message.slice(`migration ${failed} failed: `.length)
          : message;
      close("failed", error);
      failure = { name: failed ?? "(before the first migration)", error };
      if (!(e instanceof MigrationError)) log(`unexpected error: ${message}`);
    }

    // 5. Snapshot, counts and diff of the throw-away database.
    const target = await connect(targetUrl, "mth-db migrate --dry-run (throw-away)");
    try {
      const snapshotAfter = await captureSnapshot(target);
      const countsAfter = await countRows(target);
      diff = diffSnapshots(snapshotBefore, snapshotAfter);
      targetLevel = levelOf(Object.keys(snapshotAfter.migrations));
      const tables = [...new Set([...countsBefore.keys(), ...countsAfter.keys()])].sort();
      rowCounts = tables
        .map((table) => ({ table, before: countsBefore.get(table) ?? null, after: countsAfter.get(table) ?? null }))
        .filter((r) => r.before !== r.after);
    } finally {
      await target.end().catch(() => undefined);
    }

    if (failure !== null) {
      const k = pending.filter((p) => p.status === "not_attempted").length;
      return await afterDrop(1, DRY_RUN_LINES.failed(failure.name, failure.error, k), "failed");
    }
    return await afterDrop(
      0,
      DRY_RUN_LINES.ok(pending.length, seconds(performance.now() - t0).toFixed(1)),
      "succeeded",
    );
  } finally {
    if (throwAway !== null && dropped === null) await drop();
    await admin.end().catch(() => undefined);
  }

  async function drop(): Promise<void> {
    try {
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(throwAway!)} WITH (FORCE)`);
      dropped = true;
      log(`dropped throw-away database ${throwAway!}`);
    } catch (e) {
      dropped = false;
      dropError = (e as Error).message;
    }
  }

  /** 6. Drop, then prove the copy is unchanged; a failed drop or a changed copy is exit 1. */
  async function afterDrop(code: 0 | 1, line: string, result: DryRunReport["result"]): Promise<DryRunOutcome> {
    await drop();
    const again = await connect(options.sourceUrl, "mth-db migrate --dry-run (source check)");
    try {
      const status = await migrationStatus(again, files);
      const now = status.applied.map((a) => a.name);
      unchanged = now.length === appliedBefore.length && now.every((n, i) => n === appliedBefore[i]);
    } finally {
      await again.end().catch(() => undefined);
    }
    if (!unchanged) return finish(1, `${PREFIX}: the source's schema_migration changed during the dry run`, "failed");
    if (dropped !== true)
      return finish(
        1,
        `${line} (warning: the throw-away database ${throwAway!} could not be dropped: ${dropError ?? "unknown"}; drop it by hand)`,
        "failed",
      );
    return finish(code, line, result);
  }
}

/** A short text summary of a report for stdout (the JSON goes to --report). */
export function summaryLines(r: DryRunReport): string[] {
  const out = [
    `source ${r.source.database}: ${r.source.environment}, level ${r.source.level ?? "(none)"} (${r.source.appliedCount} applied)`,
  ];
  for (const p of r.pending)
    out.push(
      `  ${p.status.padEnd(13)} ${p.name}  class ${p.class}${p.seconds === null ? "" : `  ${p.seconds.toFixed(3)} s`}`,
    );
  if (r.diff !== null) {
    const parts = (Object.entries(r.diff) as [string, CategoryDiff][]).map(
      ([k, d]) => `${k} +${d.added.length} -${d.removed.length} ~${d.changed.length}`,
    );
    out.push(`catalogue diff: ${parts.join(", ")}`);
    out.push(`row counts changed in ${r.rowCounts.length} table(s)`);
  }
  if (r.throwAwayDatabase.name !== null)
    out.push(
      `throw-away database ${r.throwAwayDatabase.name}: ${r.throwAwayDatabase.dropped ? "dropped" : "NOT dropped"}`,
    );
  return out;
}

/** `mth-db migrate --dry-run [--report FILE] [--catalogue FILE] [--i-confirm-this-is-a-restored-copy]`. */
export async function runDryRunCommand(
  args: readonly string[],
  ownerUrl: string,
  io: { out: (l: string) => void; err: (l: string) => void },
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  let values: { report?: string; catalogue?: string; confirm?: boolean };
  try {
    const parsed = parseArgs({
      args: [...args],
      options: {
        "dry-run": { type: "boolean" },
        report: { type: "string" },
        catalogue: { type: "string" },
        "i-confirm-this-is-a-restored-copy": { type: "boolean" },
      },
      strict: true,
    });
    values = {
      ...(parsed.values.report === undefined ? {} : { report: parsed.values.report }),
      ...(parsed.values.catalogue === undefined ? {} : { catalogue: parsed.values.catalogue }),
      confirm: parsed.values["i-confirm-this-is-a-restored-copy"] === true,
    };
  } catch (e) {
    io.err(`${PREFIX}: refused: ${(e as Error).message}`);
    io.err(`usage: mth-db migrate --dry-run [--report FILE] [--catalogue FILE] [${CONFIRM_FLAG}]`);
    return 2;
  }
  let adminUrl = env["DRY_RUN_ADMIN_DATABASE_URL"];
  const adminFile = env["DRY_RUN_ADMIN_DATABASE_URL_FILE"];
  if ((adminUrl === undefined || adminUrl === "") && adminFile !== undefined && adminFile !== "") {
    try {
      adminUrl = readFileSync(adminFile, "utf8").trim();
    } catch (e) {
      io.err(`${PREFIX}: refused: cannot read DRY_RUN_ADMIN_DATABASE_URL_FILE: ${(e as Error).message}`);
      return 2;
    }
  }
  const cataloguePath = values.catalogue ?? defaultCataloguePath();
  let catalogue: Map<string, CatalogueEntry> | null = null;
  try {
    if (values.catalogue !== undefined || existsSync(cataloguePath)) catalogue = loadCatalogue(cataloguePath);
  } catch (e) {
    io.err(`${PREFIX}: refused: cannot read the migration catalogue ${cataloguePath}: ${(e as Error).message}`);
    return 2;
  }
  if (catalogue === null)
    io.err(
      `${PREFIX}: no migration catalogue found; every class is reported as unknown (pass --catalogue ` +
        "docs/handover/migration-catalogue.json from the release archive)",
    );
  const outcome = await runDryRun({
    sourceUrl: ownerUrl,
    adminUrl,
    confirmRestoredCopy: values.confirm === true,
    catalogue,
    catalogueSource: catalogue === null ? null : cataloguePath,
    log: (l) => io.out(`${PREFIX}: ${l}`),
  });
  for (const l of summaryLines(outcome.report)) io.out(l);
  if (values.report !== undefined) {
    writeFileSync(values.report, `${JSON.stringify(outcome.report, null, 2)}\n`);
    io.out(`${PREFIX}: report written to ${values.report} (sha256 ${sha256File(values.report)})`);
  }
  (outcome.exitCode === 0 ? io.out : io.err)(outcome.line);
  return outcome.exitCode;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
