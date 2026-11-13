// GET /healthz (liveness: no dependency checks) and GET /readyz (database reachable AND UTF8 AND every migration
// shipped with this build applied with the same checksum AND the evidence storage answering). ADR-0007 §1,
// REQ-S19-010; encoding: ADR-0003, T-DG2-BE9; storage and worker: ADR-0069 §2 (P7, T-DG7-BE-B; D-243 Q6, D-250 O2).
// `migrations: fail` is drift the runner refuses (a changed checksum, an applied file this build does not ship, or a
// pending file whose id is not above the highest applied id: F-DG5-100); `pending` is a forward migration to apply.
//
// Encoding: a non-UTF8 database (e.g. SQL_ASCII, where char_length counts bytes) reports `database: fail`, since the
// contract's Readiness schema has no separate encoding check. The encoding of a database is fixed at CREATE DATABASE,
// so a UTF8 answer is cached for the life of the route (one `SHOW server_encoding` per process); a non-UTF8 answer is
// not cached, so a corrected database is picked up without a restart.
//
// P7 (ADR-0069 §2): `checks` always carries `storage` (ok|fail|unknown) and `worker` (alive|stale|unknown).
//  - Both are evaluated only when `database` is `ok` (the effective store depends on the saved storage setting, and the
//    heartbeat is a table); otherwise both are `unknown` and neither probe is called.
//  - The probes run AFTER the pool client of the database check is released (no remote I/O while a client is held).
//  - Ready means database, migrations AND storage `ok`. The worker never gates readiness (D-243 Q6): an API is not
//    withdrawn from a load balancer because the worker is down. `unknown` is never reported as `ok` or `alive`.
//  - The platform imports no domain module (ADR-0002): server.ts passes the evidence module's storage probe and the
//    operations module's heartbeat reader in as `probes`.
//  - /readyz is public: the body holds only the enums, never a path, endpoint, bucket, error text or SecretRef name.
//    A storage failure is logged once per state change at warn, a recovery once at info (p7-work-split §B.5).
import {
  createDb,
  listMigrationFiles,
  migrationStatus,
  readServerEncoding,
  REQUIRED_SERVER_ENCODING,
  type Db,
  type MigrationFile,
  type MigrationStatus,
} from "@mth/db";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import type pg from "pg";

export type DatabaseCheck = "ok" | "fail";
export type MigrationsCheck = "ok" | "pending" | "fail";
export type StorageCheck = "ok" | "fail" | "unknown";
export type WorkerCheck = "alive" | "stale" | "unknown";

/** What the evidence module's probe returns (evidence/readiness.ts); `errorCode` is for the log line only. */
export interface StorageProbeOutcome {
  readonly status: "ok" | "fail";
  readonly driver: "filesystem" | "s3";
  readonly source: "environment" | "setting";
  readonly errorCode: string | null;
}

/** What the operations module's heartbeat reader gives (operations/heartbeat.ts readWorkerHeartbeat). */
export interface WorkerProbeOutcome {
  readonly status: WorkerCheck;
  readonly newestBeatAt: string | null;
  readonly staleAfterSeconds: number;
}

/** The two P7 probes, passed in by server.ts (ADR-0002: platform imports no domain module). */
export interface ReadinessProbes {
  storage(db: Db): Promise<StorageProbeOutcome>;
  worker(db: Db): Promise<WorkerProbeOutcome>;
}

export interface ReadinessBody {
  readonly status: "ready" | "not_ready";
  readonly checks: {
    readonly database: DatabaseCheck;
    readonly migrations: MigrationsCheck;
    readonly storage: StorageCheck;
    readonly worker: WorkerCheck;
  };
}

/** One evaluation: the public body plus the detail getDeploymentStatus reports (null when not evaluated). */
export interface ReadinessEvaluation {
  readonly ready: boolean;
  readonly body: ReadinessBody;
  readonly migration: MigrationStatus | null;
  readonly storage: StorageProbeOutcome | null;
  readonly worker: WorkerProbeOutcome | null;
}

export interface Readiness {
  evaluate(log: FastifyBaseLogger): Promise<ReadinessEvaluation>;
}

/** The exact operator lines of p7-work-split §B.5. */
export const storageFailedLine = (driver: string, code: string): string =>
  `readiness: evidence storage (${driver}) did not answer the probe: ${code}`;
export const storageRecoveredLine = (driver: string): string => `readiness: evidence storage (${driver}) answers again`;

/** The readiness rule shared by /readyz and getDeploymentStatus (one encoding cache and one log state per process). */
export function createReadiness(pool: pg.Pool, files: readonly MigrationFile[], probes: ReadinessProbes): Readiness {
  const db = createDb(pool);
  let encodingVerified = false;
  let lastStorage: "ok" | "fail" | null = null;

  const logStorageChange = (log: FastifyBaseLogger, outcome: StorageProbeOutcome) => {
    if (outcome.status === lastStorage) return;
    if (outcome.status === "fail") log.warn(storageFailedLine(outcome.driver, outcome.errorCode ?? "Error"));
    else if (lastStorage === "fail") log.info(storageRecoveredLine(outcome.driver));
    lastStorage = outcome.status;
  };

  return {
    async evaluate(log) {
      let database: DatabaseCheck = "fail";
      let migrations: MigrationsCheck = "fail";
      let migration: MigrationStatus | null = null;
      try {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
          if (!encodingVerified) {
            const found = await readServerEncoding(client);
            if (found === REQUIRED_SERVER_ENCODING) encodingVerified = true;
            else
              log.error(
                { serverEncoding: found },
                `readiness: the database must use ${REQUIRED_SERVER_ENCODING} encoding (found ${found})`,
              );
          }
          // A non-UTF8 database stays `database: fail` (and migrations unchecked, i.e. fail).
          if (encodingVerified) {
            database = "ok";
            migration = await migrationStatus(client, files);
            migrations = migration.upToDate
              ? "ok"
              : migration.checksumMismatches.length > 0 ||
                  migration.unknownApplied.length > 0 ||
                  migration.outOfOrderPending.length > 0
                ? "fail"
                : "pending";
          }
        } finally {
          client.release();
        }
      } catch (err) {
        log.warn({ err }, "readiness check failed");
      }

      // ADR-0069 §2: storage and worker only when the database answered; the client above is already released.
      let storage: StorageProbeOutcome | null = null;
      let worker: WorkerProbeOutcome | null = null;
      if (database === "ok") {
        const [s, w] = await Promise.allSettled([probes.storage(db), probes.worker(db)]);
        storage =
          s.status === "fulfilled"
            ? s.value
            : { status: "fail", driver: "filesystem", source: "environment", errorCode: "ProbeError" };
        // A failed heartbeat read is `unknown`, never alive.
        worker = w.status === "fulfilled" ? w.value : null;
        logStorageChange(log, storage);
      }
      const storageCheck: StorageCheck = storage?.status ?? "unknown";
      const workerCheck: WorkerCheck = worker?.status ?? "unknown";
      const ready = database === "ok" && migrations === "ok" && storageCheck === "ok";
      return {
        ready,
        body: {
          status: ready ? "ready" : "not_ready",
          checks: { database, migrations, storage: storageCheck, worker: workerCheck },
        },
        migration,
        storage,
        worker,
      };
    },
  };
}

export function registerHealthRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  files: readonly MigrationFile[] = listMigrationFiles(),
  probes: ReadinessProbes,
): Readiness {
  app.get("/healthz", { config: { access: { public: true } } }, async () => ({ status: "ok" as const }));

  const readiness = createReadiness(pool, files, probes);
  app.get("/readyz", { config: { access: { public: true } } }, async (request, reply) => {
    const { ready, body } = await readiness.evaluate(request.log);
    return reply.code(ready ? 200 : 503).send(body);
  });
  return readiness;
}
