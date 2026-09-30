// Forward-only SQL migration runner (ADR-0003). ~150 lines on purpose: no extra dependency, SQL a DBA can review.
//  - takes a session-level advisory lock so two runners never interleave;
//  - applies each pending file in lexical order, each in its own transaction, recording (id, name, sha256);
//  - REFUSES to run when an applied file's checksum changed, or when the database has a migration this build
//    does not ship (database newer than code);
//  - is idempotent on an up-to-date database.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { MIGRATION_FILE_PATTERN, MIGRATION_TABLE } from "./constants.ts";
import { connectionWithSessionOptions } from "./pool.ts";

export interface MigrationFile {
  readonly id: number;
  readonly name: string;
  readonly sha256: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly id: number;
  readonly name: string;
  readonly sha256: string;
}

export interface MigrationStatus {
  readonly applied: readonly AppliedMigration[];
  readonly pending: readonly string[];
  /** Applied files whose content changed since they were applied. */
  readonly checksumMismatches: readonly string[];
  /** Applied in the database but not shipped with this build. */
  readonly unknownApplied: readonly string[];
  readonly upToDate: boolean;
}

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

/** Arbitrary fixed key for pg_advisory_lock; unique to this runner. */
export const MIGRATION_LOCK_KEY = 7_302_190_001;

/** `packages/db/migrations/` (works from src/ in development and from dist/ in the built package). */
export function defaultMigrationsDir(): string {
  return fileURLToPath(new URL("../migrations/", import.meta.url));
}

export function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function listMigrationFiles(dir: string = defaultMigrationsDir()): MigrationFile[] {
  const names = readdirSync(dir)
    .filter((n) => n.endsWith(".sql"))
    .sort();
  const files: MigrationFile[] = [];
  for (const name of names) {
    const match = MIGRATION_FILE_PATTERN.exec(name);
    if (!match) throw new MigrationError(`migration file name ${name} does not match NNNN_snake_case.sql`);
    const id = Number(match[1]);
    const previous = files.at(-1);
    if (previous && id <= previous.id)
      throw new MigrationError(`duplicate or out-of-order migration id ${match[1]} (${name})`);
    const sql = readFileSync(`${dir}/${name}`, "utf8");
    files.push({ id, name, sha256: sha256Hex(sql), sql });
  }
  return files;
}

/** Anything with a node-postgres style `query`. */
interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
}

async function migrationTableExists(q: Queryable): Promise<boolean> {
  const { rows } = await q.query<{ exists: boolean }>(
    `SELECT to_regclass('public.${MIGRATION_TABLE}') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

export function compareStatus(files: readonly MigrationFile[], applied: readonly AppliedMigration[]): MigrationStatus {
  const byName = new Map(files.map((f) => [f.name, f]));
  const appliedNames = new Set(applied.map((a) => a.name));
  const checksumMismatches = applied
    .filter((a) => byName.has(a.name) && byName.get(a.name)!.sha256 !== a.sha256)
    .map((a) => a.name);
  const unknownApplied = applied.filter((a) => !byName.has(a.name)).map((a) => a.name);
  const pending = files.filter((f) => !appliedNames.has(f.name)).map((f) => f.name);
  return {
    applied,
    pending,
    checksumMismatches,
    unknownApplied,
    upToDate: pending.length === 0 && checksumMismatches.length === 0 && unknownApplied.length === 0,
  };
}

/** Read-only status. Works with the app role too (it has SELECT on schema_migration; used by /readyz). */
export async function migrationStatus(
  q: Queryable,
  files: readonly MigrationFile[] = listMigrationFiles(),
): Promise<MigrationStatus> {
  const applied = (await migrationTableExists(q))
    ? (
        await q.query<{ id: number; name: string; sha256: string }>(
          `SELECT id, name, sha256 FROM ${MIGRATION_TABLE} ORDER BY id`,
        )
      ).rows
    : [];
  return compareStatus(files, applied);
}

export interface MigrateOptions {
  readonly dir?: string;
  readonly log?: (line: string) => void;
}

/** Apply all pending migrations with the OWNER connection string. Returns the names applied in this run. */
export async function migrate(ownerUrl: string, options: MigrateOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const files = listMigrationFiles(options.dir);
  const client = new pg.Client({
    ...connectionWithSessionOptions(ownerUrl, "-c TimeZone=UTC"),
    application_name: "mth-db migrate",
  });
  await client.connect();
  const appliedNow: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
        id integer PRIMARY KEY,
        name text NOT NULL UNIQUE,
        sha256 char(64) NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now(),
        applied_by text NOT NULL DEFAULT current_user
      )`);
      const status = await migrationStatus(client, files);
      if (status.checksumMismatches.length > 0) {
        throw new MigrationError(
          `refusing to run: applied migration(s) changed on disk: ${status.checksumMismatches.join(", ")}`,
        );
      }
      if (status.unknownApplied.length > 0) {
        throw new MigrationError(
          `refusing to run: database has migration(s) this build does not ship: ${status.unknownApplied.join(", ")}`,
        );
      }
      for (const file of files.filter((f) => status.pending.includes(f.name))) {
        log(`applying ${file.name}`);
        await client.query("BEGIN");
        try {
          await client.query(file.sql);
          await client.query(`INSERT INTO ${MIGRATION_TABLE} (id, name, sha256) VALUES ($1, $2, $3)`, [
            file.id,
            file.name,
            file.sha256,
          ]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK");
          throw new MigrationError(`migration ${file.name} failed: ${(err as Error).message}`);
        }
        appliedNow.push(file.name);
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    await client.end();
  }
  return appliedNow;
}
