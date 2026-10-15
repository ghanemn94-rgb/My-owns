// The demo seed transaction (ADR-0050 §4, §6; REQ-S18-001, REQ-PB-088; D-142 Q7, R7; T-DG5-BE-S). In ONE transaction
// on the demo database (owner role):
//   1. refuse unless allowed (guard.ts, ADR-0050 §3; exit 3, nothing changed);
//   2. write the demo marker (deployment_environment: demo, seed_demo, dataset, synthetic clock);
//   3. insert the dataset (the modules of demo/data/**, in a fixed order), one audit event per row (source cli or
//      worker), and register every row in demo_seed_record with its fixture key;
//   4. compute the record counts, the checksum (checksum.ts) and the coverage (coverage.ts);
//   5. insert the dataset run (demo_dataset_run; run 1 in a fresh database) and its audit event.
// The seed and reset take the session advisory lock 730271 (key "demo") on the cluster's maintenance database for
// their whole duration (ADR-0050 §10); a reset already holds it and passes `lockHeld`.
//
// Determinism (ADR-0050 §4, p5-work-split §J.8 item 2): every seeded id is a fixed literal UUID in `01995000-…`
// (enforced by `insert`), every seeded time derives from the synthetic clock (`ctx.at`), and nothing seeded reads
// now(), random() or a generated UUID. Columns left to a clock default (created_at …) are excluded from the checksum
// by rule. The audit events' ids and times are the audit path's own (the single insert path, audit.ts); they are not
// registered records, so they are outside the checksum, and their NUMBER is fixed (one per row), so the counts are
// identical.
//
// EVERYTHING here is SYNTHETIC: an illustrative example, not Mobily actual performance (M0339). A seeded approval is
// a synthetic decision by a demo user and approves nothing real (M0412); no real business, Finance or IT approval is
// granted. No demo credential is stored: demo users authenticate through the demo IdP of the demo deployment only.
import pg from "pg";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { insertAuditEvent, type AuditActor } from "../audit.ts";
import { createDb, createPool, type Tx } from "../pool.ts";
import { datasetChecksum, recordCounts } from "./checksum.ts";
import { DEMO_COVERAGE_CONDITIONS, runCoverage, type CoverageCondition } from "./coverage.ts";
import { DEMO_DATASET_MODULES } from "./data/index.ts";
import {
  assertSeedDemoAllowed,
  DEMO_DATASET_CODE,
  DEMO_DATASET_VERSION,
  DEMO_RESET_LOCK_CLASS,
  DEMO_RESET_LOCK_KEY,
  DEMO_SYNTHETIC_CLOCK,
} from "./guard.ts";

/** Every seeded id is a fixed literal UUID in this namespace (ADR-0050 §4). */
export const DEMO_ID_PATTERN = /^01995000-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TABLE = /^[a-z][a-z0-9_]{0,62}$/;
const COLUMN = /^[a-z][a-z0-9_]{0,62}$/;
const FIXTURE_KEY = /^[a-z0-9][a-z0-9_.-]{0,119}$/;

export interface DemoSeedContext {
  readonly tx: Tx;
  /** The synthetic clock (2026-09-01T06:00:00Z). */
  readonly clock: Date;
  /** A time relative to the synthetic clock (never the real clock). */
  at(offset: { readonly days?: number; readonly hours?: number; readonly minutes?: number }): Date;
  /** A calendar date (YYYY-MM-DD, UTC) relative to the synthetic clock. */
  date(offsetDays: number): string;
  /**
   * Inserts one row with a fixed `id`, writes its audit event (`<table>.create`, new version 1) and registers it in
   * demo_seed_record under `fixtureKey`. jsonb values must be passed as JSON text.
   */
  insert(
    table: string,
    fixtureKey: string,
    row: Readonly<Record<string, unknown>> & { readonly id: string },
    audit?: { readonly organizationId?: string | null; readonly transformationId?: string | null },
  ): Promise<void>;
}

/** One dataset module of `demo/data/**` (BE-T, KBE-H). Modules run by ascending `order`, then `key`. */
export interface DemoDatasetModule {
  readonly key: string;
  readonly order: number;
  seed(ctx: DemoSeedContext): Promise<void>;
}

export interface DemoRunSummary {
  readonly runNo: number;
  readonly runKind: "seed" | "reset";
  readonly recordCounts: Record<string, number>;
  readonly checksumSha256: string;
  readonly coverage: Record<string, number>;
  readonly coverageNotImplemented: readonly string[];
  readonly coverageComplete: boolean;
  readonly seededRecords: number;
}

export interface DemoSeedOptions {
  /** The deployment's MTH_ENV (seeding is refused when production). */
  readonly mthEnv: string;
  readonly runKind: "seed" | "reset";
  readonly requestedVia: "cli" | "api";
  /** The requesting demo user (API resets only). */
  readonly requestedBy: string | null;
  /** Default: the dataset of demo/data/**. Tests pass their own. */
  readonly modules?: readonly DemoDatasetModule[];
  readonly conditions?: readonly CoverageCondition[];
  /** True when the caller (the reset) already holds the session lock 730271. */
  readonly lockHeld?: boolean;
  /** The audit source of the seeded rows: cli (the CLI) or worker (the in-app reset's job). */
  readonly source?: "cli" | "worker";
  readonly requestId?: string | null;
}

/** The maintenance database's URL on the same server and credentials ("postgres"). */
export function maintenanceUrl(url: string): string {
  const u = new URL(url);
  u.pathname = "/postgres";
  return u.toString();
}

/** Holds the demo session lock (730271, key "demo") on the maintenance database while `fn` runs. */
export async function withDemoLock<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: maintenanceUrl(url), application_name: "mth-db demo lock" });
  client.on("error", () => undefined);
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::int, hashtext($2))", [DEMO_RESET_LOCK_CLASS, DEMO_RESET_LOCK_KEY]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1::int, hashtext($2))", [
        DEMO_RESET_LOCK_CLASS,
        DEMO_RESET_LOCK_KEY,
      ]);
    }
  } finally {
    await client.end();
  }
}

function seedContext(tx: Tx, actor: AuditActor, registered: { n: number }): DemoSeedContext {
  const clock = new Date(DEMO_SYNTHETIC_CLOCK);
  const at = (o: { days?: number; hours?: number; minutes?: number }): Date =>
    new Date(clock.getTime() + (((o.days ?? 0) * 24 + (o.hours ?? 0)) * 60 + (o.minutes ?? 0)) * 60_000);
  return {
    tx,
    clock,
    at,
    date: (offsetDays) => at({ days: offsetDays }).toISOString().slice(0, 10),
    async insert(table, fixtureKey, row, audit) {
      if (!TABLE.test(table)) throw new Error(`demo seed: invalid table name ${table}`);
      if (!FIXTURE_KEY.test(fixtureKey)) throw new Error(`demo seed: invalid fixture key ${fixtureKey}`);
      if (!DEMO_ID_PATTERN.test(row.id)) throw new Error(`demo seed: ${fixtureKey} id is not a fixed 01995000-… UUID`);
      const columns = Object.keys(row);
      for (const c of columns) if (!COLUMN.test(c)) throw new Error(`demo seed: invalid column ${c}`);
      await sql`INSERT INTO ${sql.table(table)} (${sql.join(columns.map((c) => sql.ref(c)))})
                VALUES (${sql.join(columns.map((c) => sql.val(row[c])))})`.execute(tx);
      const organizationId =
        audit?.organizationId !== undefined
          ? audit.organizationId
          : typeof row["organization_id"] === "string"
            ? (row["organization_id"] as string)
            : table === "organization"
              ? row.id
              : null;
      await insertAuditEvent(tx, actor, {
        action: `${table}.create`,
        recordType: table,
        recordId: row.id,
        organizationId,
        transformationId:
          audit?.transformationId !== undefined
            ? audit.transformationId
            : typeof row["transformation_id"] === "string"
              ? (row["transformation_id"] as string)
              : null,
        newVersion: 1,
        reason: "Synthetic demonstration data (illustrative example; not Mobily actual performance)",
      });
      await tx
        .insertInto("demo_seed_record")
        .values({ record_type: table, record_id: row.id, fixture_key: fixtureKey })
        .execute();
      registered.n += 1;
    },
  };
}

/** The seed transaction on `ownerUrl` (ADR-0050 §6). Throws DemoRefused (exit 3) when refused; nothing changes then. */
export async function seedDemo(ownerUrl: string, options: DemoSeedOptions): Promise<DemoRunSummary> {
  const run = async (): Promise<DemoRunSummary> => {
    const pool = createPool(ownerUrl, { max: 1, applicationName: `mth-db demo ${options.runKind}` });
    const db = createDb(pool);
    try {
      return await db.transaction().execute(async (tx) => {
        await assertSeedDemoAllowed(tx, options.mthEnv);
        const clock = new Date(DEMO_SYNTHETIC_CLOCK);
        await tx
          .insertInto("deployment_environment")
          .values({
            environment_kind: "demo",
            initialized_via: "seed_demo",
            dataset_code: DEMO_DATASET_CODE,
            dataset_version: DEMO_DATASET_VERSION,
            synthetic_clock_at: clock,
          })
          .execute();
        const source = options.source ?? "cli";
        const actor: AuditActor =
          source === "cli"
            ? { actorType: "system", actorUserId: null, source: "cli", requestId: options.requestId ?? null }
            : { actorType: "service", actorUserId: null, source: "worker", requestId: options.requestId ?? null };
        const registered = { n: 0 };
        const ctx = seedContext(tx, actor, registered);
        const modules = [...(options.modules ?? DEMO_DATASET_MODULES)].sort(
          (a, b) => a.order - b.order || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
        );
        for (const m of modules) await m.seed(ctx);

        const counts = await recordCounts(tx);
        const checksum = await datasetChecksum(tx);
        const coverage = await runCoverage(tx, undefined, options.conditions ?? DEMO_COVERAGE_CONDITIONS);
        const last = await tx
          .selectFrom("demo_dataset_run")
          .select((eb) => eb.fn.max("run_no").as("n"))
          .executeTakeFirst();
        const runNo = Number(last?.n ?? 0) + 1;
        const runId = uuidv7();
        await tx
          .insertInto("demo_dataset_run")
          .values({
            id: runId,
            run_no: runNo,
            run_kind: options.runKind,
            requested_via: options.requestedVia,
            requested_by: options.requestedBy,
            dataset_code: DEMO_DATASET_CODE,
            dataset_version: DEMO_DATASET_VERSION,
            synthetic_clock_at: clock,
            record_counts: JSON.stringify(counts),
            checksum_sha256: checksum,
            coverage: JSON.stringify(coverage.counts),
            coverage_complete: coverage.complete,
          })
          .execute();
        await insertAuditEvent(tx, actor, {
          action: `demo_dataset_run.${options.runKind}`,
          recordType: "demo_dataset_run",
          recordId: runId,
          organizationId: null,
          newVersion: runNo,
          reason: `mth-db demo ${options.runKind}: synthetic demonstration dataset ${DEMO_DATASET_CODE} ${DEMO_DATASET_VERSION}`,
          changes: {
            checksum_sha256: { from: null, to: checksum },
            requested_via: { from: null, to: options.requestedVia },
          },
        });
        return {
          runNo,
          runKind: options.runKind,
          recordCounts: counts,
          checksumSha256: checksum,
          coverage: coverage.counts,
          coverageNotImplemented: coverage.notImplemented,
          coverageComplete: coverage.complete,
          seededRecords: registered.n,
        };
      });
    } finally {
      await db.destroy();
    }
  };
  return options.lockHeld === true ? run() : withDemoLock(ownerUrl, run);
}
