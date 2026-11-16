// GET /api/v1/admin/deployment (getDeploymentStatus; ADR-0069 §3; p7-work-split §B.1; REQ-S19-010, REQ-S01-006;
// T-DG7-BE-B). The deployment status of this installation, for its technical operators and for the transfer drill:
// the configured base URL with its origin and path, the release and contract versions, the migration level, the full
// readiness evaluation shared with /readyz (one rule, one storage cache, one log state), the evidence storage and
// worker detail, and the deployment_environment marker (0090).
//  - Access: the P6 code `operations.read` (ADM_TECH, TO, KDS, TD, AUD; D-250 O1), decided as getWorkerHeartbeat
//    decides it (an organization-level holder in some organization). The platform imports no domain module (ADR-0002),
//    so server.ts passes the check in (`requireAccess`), built on the access module's policy function.
//  - Read-only: no audit event (a read of non-business metadata, like getWorkerHeartbeat; ADR-0069 §3).
//  - No secret leaves: no secret value, SecretRef name, storage endpoint, bucket, path, connection string or error text.
//    The storage part is the probe's status, effective driver and source only.
//  - Nothing here is a business, Finance or IT approval, and nothing reads or writes DG0-DG7.
import { readFileSync } from "node:fs";
import { createDb, sql, type MigrationFile } from "@mth/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type pg from "pg";
import { z } from "zod";
import type { Readiness } from "./health.ts";
import { iso } from "./http.ts";
import { parseQuery } from "./validation.ts";

export const DEPLOYMENT_PATH = "/api/v1/admin/deployment";

/**
 * `info.version` of the OpenAPI document this build serves (docs/api/openapi.yaml). The document is not read at run
 * time (it is not part of the runtime tree), so the version is pinned here; `deployment.test.ts` fails when the two
 * differ, so a contract release cannot ship with a stale value.
 */
export const CONTRACT_VERSION = "1.6.0-p7";

/** The API's package version, `unknown` when unreadable (the worker heartbeat's rule, apps/worker/src/main.ts). */
export function apiAppVersion(packageJson: URL = new URL("../../../package.json", import.meta.url)): string {
  try {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8")) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version !== "" && pkg.version.length <= 50 ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

// docs/api/openapi.yaml Readiness and DeploymentStatus (the response mirror; every body is parsed before it is sent).
const timestamp = z.iso.datetime({ offset: true });
export const readinessView = z.strictObject({
  status: z.enum(["ready", "not_ready"]),
  checks: z.strictObject({
    database: z.enum(["ok", "fail"]),
    migrations: z.enum(["ok", "pending", "fail"]),
    storage: z.enum(["ok", "fail", "unknown"]).optional(),
    worker: z.enum(["alive", "stale", "unknown"]).optional(),
  }),
});
export const deploymentStatusView = z.strictObject({
  baseUrl: z.url().max(2048),
  origin: z.string().max(2048),
  basePath: z.string().max(2048),
  release: z.strictObject({ appVersion: z.string().max(50), contractVersion: z.string().max(50) }),
  schema: z.strictObject({
    status: z.enum(["ok", "pending", "fail"]),
    shippedCount: z.number().int().min(0),
    appliedCount: z.number().int().min(0),
    pendingCount: z.number().int().min(0),
    latestApplied: z
      .string()
      .regex(/^[0-9]{4}_[a-z0-9_]+$/)
      .nullable(),
  }),
  readiness: readinessView,
  storage: z.strictObject({
    status: z.enum(["ok", "fail", "unknown"]),
    driver: z.enum(["filesystem", "s3"]).nullable(),
    source: z.enum(["environment", "setting"]).nullable(),
  }),
  worker: z.strictObject({
    status: z.enum(["alive", "stale", "unknown"]),
    newestBeatAt: timestamp.nullable(),
    staleAfterSeconds: z.number().int().min(1),
  }),
  environmentKind: z.enum(["production", "demo"]).nullable(),
  checkedAt: timestamp,
});
export type DeploymentStatus = z.infer<typeof deploymentStatusView>;

export interface DeploymentRouteOptions {
  /** The readiness evaluator registerHealthRoutes returned (shared with /readyz). */
  readonly readiness: Readiness;
  /** config.appBaseUrl (required by the API; server.ts refuses to build without it). */
  readonly appBaseUrl: URL;
  /** The operations.read check (server.ts, on the access module's policy function); throws 401/403. */
  readonly requireAccess: (request: FastifyRequest) => Promise<void>;
  /** The heartbeat's stale threshold (operations/heartbeat.ts), reported when no beat could be read. */
  readonly workerStaleAfterSeconds: number;
  /** The API's package version (default: apiAppVersion()). */
  readonly appVersion?: string;
}

/** The stem of a migration file name (`0148_p7_retention_job.sql` -> `0148_p7_retention_job`). */
const stem = (name: string): string => name.replace(/\.sql$/, "");

const noQuery = z.strictObject({});

/** Registers getDeploymentStatus and returns it as "METHOD /path". */
export function registerDeploymentRoutes(
  app: FastifyInstance,
  pool: pg.Pool,
  files: readonly MigrationFile[],
  options: DeploymentRouteOptions,
): string[] {
  const db = createDb(pool);
  const appVersion = options.appVersion ?? apiAppVersion();
  const base = options.appBaseUrl;

  app.get(DEPLOYMENT_PATH, { config: { access: { permission: "operations.read" } } }, async (request) => {
    parseQuery(noQuery, request.query);
    await options.requireAccess(request);
    const evaluation = await options.readiness.evaluate(request.log);
    const environment = await sql<{ environment_kind: string; now: Date }>`
      SELECT (SELECT environment_kind FROM deployment_environment) AS environment_kind, now() AS now`.execute(db);
    const row = environment.rows[0]!;
    const migration = evaluation.migration;
    // The highest applied migration by id (applied rows come ordered by id).
    const latest = migration && migration.applied.length > 0 ? migration.applied[migration.applied.length - 1]! : null;
    const body: DeploymentStatus = {
      baseUrl: base.href,
      origin: base.origin,
      basePath: base.pathname,
      release: { appVersion, contractVersion: CONTRACT_VERSION },
      schema: {
        status: evaluation.body.checks.migrations,
        shippedCount: files.length,
        // Not evaluated (database check failed): the applied side is unknown; nothing is counted as applied or pending.
        appliedCount: migration?.applied.length ?? 0,
        pendingCount: migration?.pending.length ?? 0,
        latestApplied: latest === null ? null : stem(latest.name),
      },
      readiness: evaluation.body,
      storage: {
        status: evaluation.body.checks.storage,
        driver: evaluation.storage?.driver ?? null,
        source: evaluation.storage?.source ?? null,
      },
      worker: {
        status: evaluation.body.checks.worker,
        newestBeatAt: evaluation.worker?.newestBeatAt ?? null,
        staleAfterSeconds: evaluation.worker?.staleAfterSeconds ?? options.workerStaleAfterSeconds,
      },
      environmentKind:
        row.environment_kind === "production" || row.environment_kind === "demo" ? row.environment_kind : null,
      checkedAt: iso(row.now),
    };
    return deploymentStatusView.parse(body);
  });
  return [`GET ${DEPLOYMENT_PATH}`];
}

/** The start-time line of p7-work-split §B.5 when APP_BASE_URL has a path; null when it is the origin root. */
export function subPathWarning(appBaseUrl: URL): string | null {
  return appBaseUrl.pathname === "/"
    ? null
    : `config: APP_BASE_URL has the path '${appBaseUrl.pathname}'; serving under a sub-path is not supported, so the hub is served from the origin root (see the deployment guide)`;
}
