// Integration harness for the API: a real Fastify app (inject, no network) on the per-run disposable PostgreSQL,
// connected as the runtime app role mth_app. Every request made through `Client` is validated against the OpenAPI
// contract (see contract.ts), so all integration tests double as contract tests.
//
// Reusable by qa-verifier suites (tests/qa/integration/**): import { startApi, seedWorld, signIn } from here.
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type AppConfig } from "@mth/config";
import { createDb, createPool, DEV_ISSUER, type Db, type PoolOptions } from "@mth/db";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import pg from "pg";
import { v7 as uuidv7 } from "uuid";
import { inject } from "vitest";
import { buildServer, type RouteRecord, type ServerOptions } from "../../src/server.ts";
import type { OidcService } from "../../src/modules/identity/index.ts";
import { assertAcceptedRequest, assertContract } from "./contract.ts";
import type {} from "../../../../packages/db/test/global-setup.ts";
import { roleUrl } from "../../../../packages/db/test/helpers.ts";

export const APP_ORIGIN = "http://localhost:3000";

export interface TestApi {
  readonly app: FastifyInstance;
  readonly routes: readonly RouteRecord[];
  /** Kysely handle as mth_app (same role as the server). */
  readonly db: Db;
  /** Owner-role pool for test-only manipulation (e.g. expiring a session); never used by the server. */
  readonly owner: pg.Pool;
  readonly config: AppConfig;
  close(): Promise<void>;
}

/** A private, per-process evidence store directory (ADR-0010 filesystem adapter; never the default /var/lib path). */
let evidenceDir: string | null = null;
export function testEvidenceDir(): string {
  evidenceDir ??= mkdtempSync(join(tmpdir(), "mth-evidence-it-"));
  return evidenceDir;
}

export function testConfig(env: Record<string, string> = {}): AppConfig {
  const { appUrl } = inject("mthDb");
  return loadConfig("api", {
    NODE_ENV: "test",
    APP_BASE_URL: APP_ORIGIN,
    DATABASE_URL: appUrl,
    AUTH_MODE: "dev",
    RATE_LIMIT_PER_MINUTE: "100000",
    AUTH_RATE_LIMIT_PER_MINUTE: "100000",
    EVIDENCE_STORAGE_PATH: testEvidenceDir(),
    ...env,
  });
}

export async function startApi(
  options: {
    env?: Record<string, string>;
    oidc?: OidcService | null;
    migrationFiles?: ServerOptions["migrationFiles"];
    /**
     * Run against this (already migrated) scratch database of the run's cluster instead of the shared per-run
     * database - for suites that must change shared data (e.g. the role catalogue) or add timing hooks, because the
     * integration files of one run may execute concurrently.
     */
    database?: string;
    /** Capture the server's log lines (JSON, one per write) instead of disabling the logger. */
    logStream?: ServerOptions["logStream"];
    /** T-DG2-BE16: connection and shutdown settings, and the SPA directory (default: none). */
    server?: Pick<ServerOptions, "shutdownGraceMs" | "requestTimeoutMs" | "connectionsCheckingIntervalMs" | "webRoot">;
    /** T-DG2-BE17: pool bounds of this instance (default: createPool's defaults, max 5). */
    pool?: Pick<PoolOptions, "max" | "connectionTimeoutMs" | "idleInTransactionTimeoutMs" | "applicationName">;
  } = {},
): Promise<TestApi> {
  const { adminUrl } = inject("mthDb");
  const config = testConfig(
    options.database ? { DATABASE_URL: roleUrl(adminUrl, options.database, "mth_app"), ...options.env } : options.env,
  );
  const pool = createPool(config.databaseUrl!, { max: 5, applicationName: "api-test", ...options.pool });
  const { app, db, routes } = await buildServer({
    config,
    pool,
    logger: options.logStream !== undefined,
    ...(options.logStream !== undefined ? { logStream: options.logStream } : {}),
    webRoot: null,
    ...options.server,
    ...(options.oidc !== undefined ? { oidc: options.oidc } : {}),
    ...(options.migrationFiles ? { migrationFiles: options.migrationFiles } : {}),
  });
  const owner = new pg.Pool({
    connectionString: (options.database ? roleUrl(adminUrl, options.database, null) : inject("mthDb").ownerUrl).replace(
      /\?.*$/,
      "",
    ),
    options: "-c role=mth_owner",
    max: 2,
    application_name: "api-test-owner",
  });
  // Like createPool: an error on an idle client (e.g. a backend terminated while the suite tears down) must never
  // become an unhandled 'error' event that fails a green run (F-DG1-009).
  owner.on("error", () => undefined);
  return {
    app,
    routes,
    db,
    owner,
    config,
    async close() {
      await app.close();
      await db.destroy();
      // Kysely's driver adopts the pool only on its first query, so destroy() does not end a pool that served only
      // raw-pool routes (e.g. a /readyz-only test): its idle client would then hold the database open for pg's 10 s
      // idle timeout and stall dropScratchDatabase (T-DG2-BE9).
      if (!(pool as pg.Pool & { ending?: boolean }).ending) await pool.end();
      await owner.end();
    },
  };
}

// ------------------------------------------------------------------------------------------------ requests

export interface Session {
  readonly cookie: string;
  readonly csrf: string;
  readonly userId: string;
}

export interface Res<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: LightMyRequestResponse["headers"];
  readonly raw: LightMyRequestResponse;
}

export interface RequestOptions {
  readonly session?: Session | null;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Omit the CSRF header / Origin on unsafe methods (negative tests). */
  readonly csrf?: boolean;
  readonly origin?: string | null;
  /** Skip the OpenAPI assertion (only for requests deliberately outside the contract). */
  readonly contract?: boolean;
}

// Test responses are asserted structurally; the default body type is deliberately loose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function call<T = any>(
  app: FastifyInstance,
  method: string,
  url: string,
  opts: RequestOptions = {},
): Promise<Res<T>> {
  const unsafe = !["GET", "HEAD"].includes(method);
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.session) headers["cookie"] = opts.session.cookie;
  if (unsafe && opts.origin !== null) headers["origin"] = opts.origin ?? APP_ORIGIN;
  if (unsafe && opts.session && opts.csrf !== false) headers["x-csrf-token"] = opts.session.csrf;
  const raw = await app.inject({
    method: method as "GET",
    url,
    headers,
    ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
  });
  if (opts.contract !== false) {
    assertContract(method, url, { statusCode: raw.statusCode, headers: raw.headers, body: raw.body });
    assertAcceptedRequest(method, url, raw.statusCode, opts.body);
  }
  const isJson = String(raw.headers["content-type"] ?? "").includes("json");
  return {
    status: raw.statusCode,
    body: (isJson && raw.body !== "" ? raw.json() : raw.body) as T,
    headers: raw.headers,
    raw,
  };
}

/** Dev login as the synthetic subject, then read /me for the CSRF token. */
export async function signIn(app: FastifyInstance, subject: string): Promise<Session> {
  const login = await call(app, "POST", "/api/v1/auth/dev-login", { body: { username: subject } });
  if (login.status !== 204)
    throw new Error(`dev login for ${subject} failed: ${login.status} ${JSON.stringify(login.body)}`);
  const setCookie = login.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0]! : String(setCookie);
  const cookie = first.split(";")[0]!;
  const me = await call<{ csrfToken: string; user: { id: string } }>(app, "GET", "/api/v1/me", {
    session: { cookie, csrf: "", userId: "" },
  });
  return { cookie, csrf: me.body.csrfToken, userId: me.body.user.id };
}

// ------------------------------------------------------------------------------------------------ fixtures

export const uniq = (prefix: string) => `${prefix}${randomBytes(3).toString("hex").toUpperCase()}`;

const ROLE_IDS = new Map<string, string>();
async function roleId(db: Db, code: string): Promise<string> {
  if (!ROLE_IDS.has(code))
    ROLE_IDS.set(
      code,
      (await db.selectFrom("role").select("id").where("code", "=", code).executeTakeFirstOrThrow()).id,
    );
  return ROLE_IDS.get(code)!;
}

export async function createOrg(db: Db, code = uniq("ORG")): Promise<{ id: string; code: string }> {
  const id = uuidv7();
  await db
    .insertInto("organization")
    .values({ id, code, name_en: `Synthetic ${code}`, name_ar: `اصطناعي ${code}`, created_by: null, updated_by: null })
    .execute();
  return { id, code };
}

export async function createBu(
  db: Db,
  organizationId: string,
  parent: string | null = null,
  code = uniq("BU"),
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("business_unit")
    .values({
      id,
      organization_id: organizationId,
      parent_business_unit_id: parent,
      code,
      name_en: `Unit ${code}`,
      name_ar: `وحدة ${code}`,
      created_by: null,
      updated_by: null,
    })
    .execute();
  return id;
}

/** A synthetic user bound to the dev issuer; returns id and the dev-login subject. */
export async function createUser(
  db: Db,
  organizationId: string,
  opts: { status?: "active" | "disabled"; email?: string } = {},
): Promise<{ id: string; subject: string }> {
  const id = uuidv7();
  const subject = `u.${randomBytes(5).toString("hex")}`;
  await db
    .insertInto("app_user")
    .values({
      id,
      organization_id: organizationId,
      display_name: `Synthetic ${subject}`,
      email: opts.email ?? `${subject}@example.invalid`,
      status: opts.status ?? "active",
      created_by: null,
      updated_by: null,
    })
    .execute();
  await db.insertInto("user_identity").values({ id: uuidv7(), user_id: id, issuer: DEV_ISSUER, subject }).execute();
  return { id, subject };
}

export async function grant(
  db: Db,
  grantorId: string,
  userId: string,
  role: string,
  scope: { type: "organization" | "business_unit" | "transformation"; id: string },
  organizationId: string,
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("scoped_assignment")
    .values({
      id,
      organization_id: organizationId,
      user_id: userId,
      role_id: await roleId(db, role),
      scope_type: scope.type,
      scope_id: scope.id,
      reason: "test fixture grant",
      granted_by: grantorId,
      created_by: null,
      updated_by: null,
    })
    .execute();
  return id;
}

export async function createTransformationRow(
  db: Db,
  organizationId: string,
  businessUnitId: string,
  createdBy: string,
): Promise<string> {
  const id = uuidv7();
  await db
    .insertInto("transformation")
    .values({
      id,
      organization_id: organizationId,
      business_unit_id: businessUnitId,
      code: uniq("TX"),
      name: "Synthetic fixture transformation",
      mode: "end_to_end",
      current_phase: "diagnose",
      timezone: "Asia/Riyadh",
      currency: "SAR",
      created_by: createdBy,
      updated_by: createdBy,
    })
    .execute();
  return id;
}

/**
 * Two organizations for cross-scope tests (A12):
 *   org A: BU a1 (with child a1x) and sibling BU a2;  org B: BU b1.
 *   users: admin (ADM_ACCESS + ADM_TECH @ A), office (TO @ A, inherits), leadA1 (TL @ BU a1, no inheritance),
 *          auditor (AUD @ A, inherits), nobody (no grants), officeB (TO @ B), disabled (disabled user).
 */
export async function seedWorld(db: Db) {
  const orgA = await createOrg(db);
  const orgB = await createOrg(db);
  const a1 = await createBu(db, orgA.id);
  const a1x = await createBu(db, orgA.id, a1);
  const a2 = await createBu(db, orgA.id);
  const b1 = await createBu(db, orgB.id);
  const grantor = await createUser(db, orgA.id);
  const admin = await createUser(db, orgA.id);
  const office = await createUser(db, orgA.id);
  const leadA1 = await createUser(db, orgA.id);
  const auditor = await createUser(db, orgA.id);
  const nobody = await createUser(db, orgA.id);
  const officeB = await createUser(db, orgB.id);
  const disabled = await createUser(db, orgA.id, { status: "disabled" });
  await grant(db, grantor.id, admin.id, "ADM_ACCESS", { type: "organization", id: orgA.id }, orgA.id);
  await grant(db, grantor.id, admin.id, "ADM_TECH", { type: "organization", id: orgA.id }, orgA.id);
  await grant(db, grantor.id, office.id, "TO", { type: "organization", id: orgA.id }, orgA.id);
  await grant(db, grantor.id, leadA1.id, "TL", { type: "business_unit", id: a1 }, orgA.id);
  await grant(db, grantor.id, auditor.id, "AUD", { type: "organization", id: orgA.id }, orgA.id);
  await grant(db, grantor.id, officeB.id, "TO", { type: "organization", id: orgB.id }, orgB.id);
  return { orgA, orgB, a1, a1x, a2, b1, grantor, admin, office, leadA1, auditor, nobody, officeB, disabled };
}
export type World = Awaited<ReturnType<typeof seedWorld>>;

/** Audit rows for a record, oldest first. */
export async function auditOf(db: Db, recordId: string) {
  return db.selectFrom("audit_event").selectAll().where("record_id", "=", recordId).orderBy("seq").execute();
}

/** Audit rows written by one request (scope-local; never a global count, F-DG1-110). */
export async function auditOfRequest(db: Db, requestId: string) {
  return db.selectFrom("audit_event").selectAll().where("request_id", "=", requestId).orderBy("seq").execute();
}

/**
 * GLOBAL audit row count. Do not use it for "nothing was written" assertions: any concurrent or late write elsewhere
 * changes it (F-DG1-110). Prefer auditOf(recordId) or auditOfRequest(requestId). Kept for existing QA suites.
 */
export async function auditCount(db: Db): Promise<number> {
  const r = await db
    .selectFrom("audit_event")
    .select((eb) => eb.fn.countAll<string>().as("n"))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/**
 * What contract.test.ts hands every P3 exercise seam (`test/integration/contract/p3-exercises-<task>.ts`,
 * p3-work-split §5): the API, the seeded world, and `mirrored`, the validating call that also checks each successful
 * body against the zod mirror the seam exports in its `P3_MIRRORS_<TASK>` map. Seams sign in their own sessions.
 */
export interface P3ExerciseContext {
  readonly api: TestApi;
  readonly world: World;
  // Test responses are asserted structurally; the body type is deliberately loose (as in `call`).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly mirrored: (method: string, url: string, opts?: RequestOptions) => Promise<Res<any>>;
}

/**
 * What contract.test.ts hands every P4 exercise seam (`test/integration/contract/p4-exercises-<task>.ts`, p4-work-split
 * §1 S-10): the same shape as the P3 seams.
 */
export type P4ExerciseContext = P3ExerciseContext;

export { createDb, createPool };
