// The deployment environment and the in-app demo reset (P5 slice J; ADR-0050 §1, §2, §6, §8, §9; REQ-S18-001,
// REQ-S18-003, REQ-PB-089, REQ-S21-001; p5-work-split §J.1; T-DG5-BE-S). Stub by T-DG5-BE-A, filled by T-DG5-BE-S:
//   GET  /environment                      getEnvironment            (session: every signed-in user)
//   GET  /admin/environment                getDemoEnvironmentStatus  (demo.reset; ADM_TECH)
//   POST /admin/environment/demo-resets    requestDemoReset          (demo.reset; ADM_TECH; If-Match = latest run)
//
// The flag is the environment (ADR-0050 §2): `synthetic` is true exactly in a database whose marker is `demo`; every
// record and number there is an illustrative example, not Mobily actual performance (M0339), and every approval there
// approves nothing real (M0412). A database without a marker reads as `production` (fail-safe: no synthetic label on
// data that might be real). `EnvironmentReadPort` is the read the report and export layout uses at generation time
// (ADR-0050 §2 (d)).
//
// The reset request (ADR-0050 §6, §8): one transaction re-checks demo.reset on grants reloaded in it (commit-time
// authorization), refuses outside a demo database (409 environment.not_demo) and when this deployment has no
// MTH_DEMO_ADMIN_DATABASE_URL (409 demo_reset.not_configured), takes the transaction lock of class demoReset (the registry's,
// key "demo"; it serializes two requests), compares If-Match with the latest run number (`"0"` when there is none;
// 428 missing, 409 stale), refuses a second request while one is queued (409 demo_reset.in_progress: the outbox event
// with the idempotency key `demo.reset_requested:<latest run id>` exists; the reset re-creates the database, so the key
// is gone once it ran), and writes the audit event and the internal outbox event `demo.reset_requested` together.
// Nothing is sent to pg-boss inside the transaction (no remote I/O): the relay delivers it after COMMIT and the worker's
// `demo.reset` job acknowledges it before it drops the database. `demo.reset` is a configure permission; a reset
// approves nothing, and nothing here reads or writes the engineering gates DG0-DG7.
import { readDeploymentEnvironment, sql, type DbOrTx } from "@mth/db";
import { PROBLEM_TYPES, type Permission } from "@mth/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
import type { ModuleDeps } from "../platform/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  etag,
  HttpProblem,
  iso,
  isoOrNull,
  parseQuery,
  problems,
  requireIfMatch,
} from "../platform/index.ts";

const ENVIRONMENT = "/api/v1/environment";
const STATUS = "/api/v1/admin/environment";
const RESETS = "/api/v1/admin/environment/demo-resets";
const DEMO_RESET: Permission = "demo.reset";
export const DEMO_RESET_REQUESTED_EVENT = "demo.reset_requested";

// ------------------------------------------------------------------------------------------------ contract shapes
// The response mirrors of the contract components (docs/api/openapi.yaml EnvironmentInfo, DemoDatasetRun,
// DemoEnvironmentStatus, DemoResetRequest). Every body is parsed through them before it is sent, so a drift from the
// contract fails loudly. (No @mth/shared mirror exists for slice J yet; see the BE-S handback.)
const uuid = z.uuid();
const timestamp = z.iso.datetime({ offset: true });

export const environmentInfo = z.strictObject({
  kind: z.enum(["production", "demo"]),
  synthetic: z.boolean(),
  datasetCode: z.string().nullable(),
  datasetVersion: z.string().nullable(),
  syntheticClockAt: timestamp.nullable(),
});
export type EnvironmentInfo = z.infer<typeof environmentInfo>;

export const demoDatasetRun = z.strictObject({
  runNo: z.number().int().min(1),
  runKind: z.enum(["seed", "reset"]),
  requestedVia: z.enum(["cli", "api"]),
  requestedBy: uuid.nullable(),
  datasetCode: z.string(),
  datasetVersion: z.string(),
  syntheticClockAt: timestamp,
  recordCounts: z.record(z.string(), z.number().int().min(0)),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  coverage: z.record(z.string(), z.number().int().min(0)),
  coverageComplete: z.boolean(),
  completedAt: timestamp,
});

export const demoEnvironmentStatus = z.strictObject({
  kind: z.enum(["production", "demo"]),
  latestRun: demoDatasetRun.nullable(),
  resetConfigured: z.boolean(),
  version: z.number().int().min(0),
});
export type DemoEnvironmentStatus = z.infer<typeof demoEnvironmentStatus>;

export const demoResetRequest = z.strictObject({
  status: z.literal("queued"),
  requestedAt: timestamp,
  requestedBy: uuid,
});

// ------------------------------------------------------------------------------------------------ refusals
/** ADR-0050 §9 (exact English texts). */
const conflict = (code: string, detail: string): HttpProblem =>
  new HttpProblem({ status: 409, type: PROBLEM_TYPES.versionConflict, code, title: "Conflict", detail });
export const environmentRefusals = {
  notDemo: () => conflict("environment.not_demo", "This is available only in the demo environment."),
  inProgress: () => conflict("demo_reset.in_progress", "A demo reset is already running."),
  notConfigured: () => conflict("demo_reset.not_configured", "Demo reset is not configured for this deployment."),
} as const;

// ------------------------------------------------------------------------------------------------ the read port
/** The environment as the contract shows it (ADR-0050 §2). The report/export layout reads it at generation time. */
export interface EnvironmentReadPort {
  read(db: DbOrTx): Promise<EnvironmentInfo>;
}

export const environmentReadPort: EnvironmentReadPort = {
  async read(db) {
    const env = await readDeploymentEnvironment(db);
    return environmentInfo.parse({
      kind: env.kind,
      synthetic: env.synthetic,
      datasetCode: env.datasetCode,
      datasetVersion: env.datasetVersion,
      syntheticClockAt: isoOrNull(env.syntheticClockAt),
    });
  },
};

// ------------------------------------------------------------------------------------------------ helpers
function holdsInOwnOrganization(principal: Principal, permission: Permission): boolean {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  return org !== null && principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org);
}

/** The deployment is platform-wide: demo.reset is required in the caller's own organization (the jobs-view rule). */
function requireInOwnOrganization(principal: Principal): { userId: string; organizationId: string } {
  const org = principal.organizationId;
  if (holdsInOwnOrganization(principal, DEMO_RESET) && org !== null && principal.userId !== null)
    return { userId: principal.userId, organizationId: org };
  const denied = problems.forbidden();
  throw org === null
    ? denied
    : denied.withDenial(
        denialOf(DEMO_RESET, {
          level: "organization",
          organizationId: org,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

/** If-Match of the latest run number; `"0"` names "no run yet" (the IfMatchOrZero rule). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function stale(current: number): HttpProblem {
  if (current >= 1) return problems.versionConflict(current);
  // No run yet: the Problem schema's currentVersion starts at 1, so it is left out.
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

interface RunRow {
  readonly id: string;
  readonly run_no: number;
  readonly run_kind: string;
  readonly requested_via: string;
  readonly requested_by: string | null;
  readonly dataset_code: string;
  readonly dataset_version: string;
  readonly synthetic_clock_at: Date;
  readonly record_counts: unknown;
  readonly checksum_sha256: string;
  readonly coverage: unknown;
  readonly coverage_complete: boolean;
  readonly completed_at: Date;
}

async function latestRun(db: DbOrTx): Promise<RunRow | undefined> {
  return (await db.selectFrom("demo_dataset_run").selectAll().orderBy("run_no", "desc").limit(1).executeTakeFirst()) as
    | RunRow
    | undefined;
}

const asObject = (v: unknown): Record<string, number> =>
  (typeof v === "string" ? JSON.parse(v) : v) as Record<string, number>;

function presentRun(r: RunRow): z.infer<typeof demoDatasetRun> {
  return {
    runNo: r.run_no,
    runKind: r.run_kind === "reset" ? "reset" : "seed",
    requestedVia: r.requested_via === "api" ? "api" : "cli",
    requestedBy: r.requested_by,
    datasetCode: r.dataset_code,
    datasetVersion: r.dataset_version,
    syntheticClockAt: iso(r.synthetic_clock_at),
    recordCounts: asObject(r.record_counts),
    checksumSha256: r.checksum_sha256,
    coverage: asObject(r.coverage),
    coverageComplete: r.coverage_complete,
    completedAt: iso(r.completed_at),
  };
}

const noQuery = z.strictObject({});

// ------------------------------------------------------------------------------------------------ routes
/** Registers this file's routes and returns them as "METHOD /path". */
export function registerEnvironmentRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db, config } = deps;
  // ADR-0050 §6: the API only knows whether this deployment is configured for the in-app reset; it never connects
  // with the admin URL (the worker does).
  const resetConfigured = config.demoAdminDatabaseUrl !== null;

  app.get(ENVIRONMENT, { config: { access: { permission: "authenticated" } } }, async (request) => {
    parseQuery(noQuery, request.query);
    principalOf(request);
    return environmentReadPort.read(db);
  });

  app.get(STATUS, { config: { access: { permission: DEMO_RESET } } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    requireInOwnOrganization(principalOf(request));
    const env = await readDeploymentEnvironment(db);
    const run = env.kind === "demo" ? await latestRun(db) : undefined;
    const body = demoEnvironmentStatus.parse({
      kind: env.kind,
      latestRun: run === undefined ? null : presentRun(run),
      resetConfigured: env.kind === "demo" && resetConfigured,
      version: run?.run_no ?? 0,
    });
    // ETag = the latest run number, "0" when there is none (the operation's own summary; the ARCH-R1 ETagOrZero rule
    // that requestDemoReset's IfMatchOrZero pairs with). The 200 response still declares `ETag` (pattern >= 1): the
    // one-line ETagOrZero patch is proposed to the orchestrator in the BE-S handback (the D-153/D-156 precedent).
    reply.header("ETag", body.version >= 1 ? etag(body.version) : '"0"');
    return body;
  });

  app.post(RESETS, { config: { access: { permission: DEMO_RESET } } }, async (request, reply) => {
    parseQuery(noQuery, request.query);
    requireInOwnOrganization(principalOf(request));
    const expected = ifMatchOrZero(request);
    const result = await db.transaction().execute(async (tx) => {
      const actor = requireInOwnOrganization(await refreshPrincipal(tx, request));
      const env = await readDeploymentEnvironment(tx);
      if (env.kind !== "demo") throw environmentRefusals.notDemo();
      if (!resetConfigured) throw environmentRefusals.notConfigured();
      await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.demoReset}::int, hashtext('demo'))`.execute(tx);
      const run = await latestRun(tx);
      const current = run?.run_no ?? 0;
      if (expected !== current) throw stale(current);
      const key = `${DEMO_RESET_REQUESTED_EVENT}:${run?.id ?? "none"}`;
      const queued = await tx
        .selectFrom("outbox_event")
        .select("id")
        .where("idempotency_key", "=", key)
        .executeTakeFirst();
      if (queued !== undefined) throw environmentRefusals.inProgress();
      const eventId = await enqueueOutboxEvent(tx, {
        organizationId: actor.organizationId,
        aggregateType: run ? "demo_dataset_run" : "organization",
        aggregateId: run?.id ?? actor.organizationId,
        eventType: DEMO_RESET_REQUESTED_EVENT,
        schemaVersion: 1,
        payload: { requestedBy: actor.userId, latestRunNo: current },
        idempotencyKey: key,
      });
      await record(tx, auditContextOf(request), {
        action: "demo_environment.reset_requested",
        recordType: run ? "demo_dataset_run" : "organization",
        recordId: run?.id ?? actor.organizationId,
        organizationId: actor.organizationId,
        priorVersion: current,
        reason: "In-app reset of the synthetic demonstration environment requested",
        changes: { reset_requested: { from: null, to: key } },
      });
      const at = await tx
        .selectFrom("outbox_event")
        .select("created_at")
        .where("id", "=", eventId)
        .executeTakeFirstOrThrow();
      return demoResetRequest.parse({ status: "queued", requestedAt: iso(at.created_at), requestedBy: actor.userId });
    });
    return reply.code(202).send(result);
  });

  return [`GET ${ENVIRONMENT}`, `GET ${STATUS}`, `POST ${RESETS}`];
}
