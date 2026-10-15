// The deployment environment and the in-app demo reset against a real PostgreSQL (ADR-0050 §1, §2, §6, §8, §9;
// REQ-S18-001, REQ-S18-003, REQ-PB-089; p5-work-split §J.1; T-DG5-BE-S). Literal tests:
//  - REQ-S18-001: GET /environment returns synthetic: true in the demo database and false in production;
//  - requestDemoReset in production gives 409 environment.not_demo; AUD gets 403; If-Match gives 428/409;
// plus the status view (ETag = latest run number), not configured (409), in progress (409), commit-time
// re-authorization, one audit event and one outbox event per accepted request, and the worker's demo.reset job:
// acknowledged before the drop (a redelivery does nothing), then the real reset re-creates and re-seeds the database
// with requested_via = 'api'. Each database here is a scratch database of this run's disposable cluster. Everything is
// SYNTHETIC; a reset approves nothing, and nothing here touches the engineering gates DG0-DG7.
import { bootstrap, createDb, createPool, migrate, resetDemo, seedDemo, type DemoRunSummary } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { TEST_DEMO_MODULES } from "../../../../../packages/db/test/demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { DemoResetJobError, handleDemoReset } from "../../../../worker/src/handlers/demo.ts";
import { DEMO_EVENT_QUEUES, DEMO_QUEUES } from "../../../../worker/src/queues/demo.ts";
import { QUEUES_FOR_EVENT } from "../../../../worker/src/queues/index.ts";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ENV = "/api/v1/environment";
const STATUS = "/api/v1/admin/environment";
const RESETS = "/api/v1/admin/environment/demo-resets";
const NOT_DEMO = "This is available only in the demo environment.";
/**
 * A status read with no run answers ETag "0" (ETag = latest run number, "0" when none: the operation's own summary),
 * but its 200 response declares `ETag` (pattern >= 1). Until the orchestrator applies the proposed ETagOrZero patch
 * (BE-S handback; the D-153/D-156 precedent) such a read skips only the contract assertion. Remove this then.
 */
const VERSION_ZERO_READ = { contract: false } as const;

interface Site {
  api: TestApi;
  w: World;
  admin: Session;
  auditor: Session;
  lead: Session;
  name: string;
}

let demo: Site;
let prod: Site;
let seeded: DemoRunSummary;
let demoClosed = false;
const scratch: string[] = [];

async function site(name: string, env: Record<string, string>): Promise<Site> {
  const api = await startApi({ database: name, env });
  const w = await seedWorld(api.db);
  return {
    api,
    w,
    name,
    admin: await signIn(api.app, w.admin.subject),
    auditor: await signIn(api.app, w.auditor.subject),
    lead: await signIn(api.app, w.leadA1.subject),
  };
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  const demoDb = await createScratchDatabase(adminUrl, "mth_env_demo");
  const prodDb = await createScratchDatabase(adminUrl, "mth_env_prod");
  scratch.push(demoDb, prodDb);
  for (const db of [demoDb, prodDb]) await migrate(roleUrl(adminUrl, db, "mth_owner"));
  // The demo database: seeded (synthetic test dataset) before anything else, as `mth-db seed-demo` requires.
  seeded = await seedDemo(roleUrl(adminUrl, demoDb, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    modules: TEST_DEMO_MODULES,
  });
  // The production database: initialized by the production path (bootstrap writes the production marker).
  const owner = createDb(createPool(roleUrl(adminUrl, prodDb, "mth_owner"), { max: 1 }));
  try {
    await bootstrap(owner, {
      orgCode: "PRODORG",
      orgNameEn: "Example Production Organization",
      orgNameAr: "مؤسسة إنتاج مثال",
      defaultTimezone: "Asia/Riyadh",
      defaultCurrency: "SAR",
      adminDisplayName: "First Admin",
      adminEmail: null,
      adminIssuer: "https://idp.example.invalid/realms/mth",
      adminSubject: "first-admin",
    });
  } finally {
    await owner.destroy();
  }
  // Both deployments are configured for the in-app reset, so production's refusal is environment.not_demo itself.
  demo = await site(demoDb, { MTH_DEMO_ADMIN_DATABASE_URL: adminUrl, MTH_ENV: "demo" });
  prod = await site(prodDb, { MTH_DEMO_ADMIN_DATABASE_URL: adminUrl });
}, 180_000);

afterAll(async () => {
  if (!demoClosed) await demo?.api.close();
  await prod?.api.close();
  for (const name of scratch) await dropScratchDatabase(inject("mthDb").adminUrl, name);
});

const outboxOf = (s: Site) =>
  s.api.db
    .selectFrom("outbox_event")
    .select(["id", "event_type", "payload", "idempotency_key", "organization_id"])
    .where("event_type", "=", "demo.reset_requested")
    .execute();
const resetAudits = (s: Site) =>
  s.api.db.selectFrom("audit_event").selectAll().where("action", "=", "demo_environment.reset_requested").execute();

describe("GET /environment (REQ-S18-001, REQ-PB-089)", () => {
  it("returns synthetic: true in the demo database, with the dataset and the synthetic clock", async () => {
    for (const session of [demo.admin, demo.auditor, demo.lead]) {
      const res = await call<Body>(demo.api.app, "GET", ENV, { session });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        kind: "demo",
        synthetic: true,
        datasetCode: "international_roaming",
        datasetVersion: "1.0.0",
        syntheticClockAt: "2026-09-01T06:00:00.000Z",
      });
    }
  });

  it("returns synthetic: false in production (production-marked, and unmarked fails safe to production)", async () => {
    const res = await call<Body>(prod.api.app, "GET", ENV, { session: prod.admin });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kind: "production",
      synthetic: false,
      datasetCode: null,
      datasetVersion: null,
      syntheticClockAt: null,
    });
    const marker = await prod.api.db.selectFrom("deployment_environment").selectAll().executeTakeFirstOrThrow();
    expect([marker.environment_kind, marker.initialized_via]).toEqual(["production", "bootstrap"]);
    // The shared per-run database has no marker at all: reported as production (ADR-0050 §1, fail-safe).
    const shared = await startApi();
    try {
      const w = await seedWorld(shared.db);
      const s = await signIn(shared.app, w.office.subject);
      const r = await call<Body>(shared.app, "GET", ENV, { session: s });
      expect([r.status, r.body.kind, r.body.synthetic]).toEqual([200, "production", false]);
    } finally {
      await shared.close();
    }
  });

  it("401 without a session; 400 on an undeclared query parameter", async () => {
    expect((await call(demo.api.app, "GET", ENV)).status).toBe(401);
    expect((await call(demo.api.app, "GET", `${ENV}?kind=demo`, { session: demo.lead })).status).toBe(400);
  });
});

describe("GET /admin/environment (demo.reset; ADM_TECH)", () => {
  it("shows the latest run (counts, checksum, coverage) with ETag = the run number", async () => {
    const res = await call<Body>(demo.api.app, "GET", STATUS, { session: demo.admin });
    expect(res.status).toBe(200);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({ kind: "demo", resetConfigured: true, version: 1 });
    expect(res.body.latestRun).toMatchObject({
      runNo: 1,
      runKind: "seed",
      requestedVia: "cli",
      requestedBy: null,
      datasetCode: "international_roaming",
      datasetVersion: "1.0.0",
      syntheticClockAt: "2026-09-01T06:00:00.000Z",
      checksumSha256: seeded.checksumSha256,
      coverage: {},
      coverageComplete: false,
    });
    expect(res.body.latestRun.recordCounts).toEqual(seeded.recordCounts);
  });

  it("production: kind production, no run, version 0, reset not available", async () => {
    const res = await call<Body>(prod.api.app, "GET", STATUS, { session: prod.admin, ...VERSION_ZERO_READ });
    expect([res.status, res.headers["etag"]]).toEqual([200, '"0"']);
    expect(res.body).toEqual({ kind: "production", latestRun: null, resetConfigured: false, version: 0 });
  });

  it("403 for AUD, TL and a user without grants; 401 without a session", async () => {
    for (const session of [demo.auditor, demo.lead, await signIn(demo.api.app, demo.w.nobody.subject)])
      expect((await call(demo.api.app, "GET", STATUS, { session })).status).toBe(403);
    expect((await call(demo.api.app, "GET", STATUS)).status).toBe(401);
  });
});

describe("POST /admin/environment/demo-resets (requestDemoReset)", () => {
  it("production: 409 environment.not_demo (exact text); nothing written", async () => {
    const res = await call<Body>(prod.api.app, "POST", RESETS, { session: prod.admin, headers: { "if-match": '"0"' } });
    expect([res.status, res.body.code, res.body.detail]).toEqual([409, "environment.not_demo", NOT_DEMO]);
    expect(await outboxOf(prod)).toEqual([]);
    expect(await resetAudits(prod)).toEqual([]);
  });

  it("AUD gets 403 (and TL); nothing written", async () => {
    for (const session of [demo.auditor, demo.lead]) {
      const res = await call<Body>(demo.api.app, "POST", RESETS, { session, headers: { "if-match": '"1"' } });
      expect(res.status).toBe(403);
    }
    expect(await outboxOf(demo)).toEqual([]);
    expect(await resetAudits(demo)).toEqual([]);
  });

  it("If-Match: missing -> 428, malformed -> 400, stale -> 409; nothing written", async () => {
    const missing = await call<Body>(demo.api.app, "POST", RESETS, { session: demo.admin });
    expect(missing.status).toBe(428);
    const malformed = await call<Body>(demo.api.app, "POST", RESETS, {
      session: demo.admin,
      headers: { "if-match": "*" },
    });
    expect(malformed.status).toBe(400);
    for (const stale of ['"0"', '"2"']) {
      const res = await call<Body>(demo.api.app, "POST", RESETS, {
        session: demo.admin,
        headers: { "if-match": stale },
      });
      expect([res.status, res.body.code, res.body.currentVersion]).toEqual([409, "version_conflict", 1]);
    }
    expect(await outboxOf(demo)).toEqual([]);
  });

  it("not configured: 409 demo_reset.not_configured (exact text); nothing written", async () => {
    const api = await startApi({ database: demo.name, env: { MTH_ENV: "demo" } });
    try {
      const s = await signIn(api.app, demo.w.admin.subject);
      const status = await call<Body>(api.app, "GET", STATUS, { session: s });
      expect(status.body.resetConfigured).toBe(false);
      const res = await call<Body>(api.app, "POST", RESETS, { session: s, headers: { "if-match": '"1"' } });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        409,
        "demo_reset.not_configured",
        "Demo reset is not configured for this deployment.",
      ]);
    } finally {
      await api.close();
    }
    expect(await outboxOf(demo)).toEqual([]);
  });

  it("commit-time authorization: demo.reset revoked while the request waits -> 403; nothing written", async () => {
    const user = await createUser(demo.api.db, demo.w.orgA.id);
    await grant(
      demo.api.db,
      demo.w.grantor.id,
      user.id,
      "ADM_TECH",
      { type: "organization", id: demo.w.orgA.id },
      demo.w.orgA.id,
    );
    const s = await signIn(demo.api.app, user.subject);
    const res = await afterIdentity(
      demo.api,
      user.id,
      () => call(demo.api.app, "POST", RESETS, { session: s, headers: { "if-match": '"1"' } }),
      () => revokeAll(demo.api, demo.w.grantor.id, user.id),
    );
    expect(res.status).toBe(403);
    expect(await outboxOf(demo)).toEqual([]);
    expect(await resetAudits(demo)).toEqual([]);
  });

  it("202 queued: one audit event and one demo.reset_requested event in the same transaction; a second -> 409 in progress", async () => {
    const res = await call<Body>(demo.api.app, "POST", RESETS, { session: demo.admin, headers: { "if-match": '"1"' } });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: "queued", requestedBy: demo.admin.userId });
    const events = await outboxOf(demo);
    expect(events).toHaveLength(1);
    const run = await demo.api.db.selectFrom("demo_dataset_run").select("id").executeTakeFirstOrThrow();
    expect(events[0]).toMatchObject({
      idempotency_key: `demo.reset_requested:${run.id}`,
      organization_id: demo.w.orgA.id,
      payload: { requestedBy: demo.admin.userId, latestRunNo: 1 },
    });
    const audits = await resetAudits(demo);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actor_user_id: demo.admin.userId,
      record_type: "demo_dataset_run",
      record_id: run.id,
      source: "api",
    });
    expect((await auditOf(demo.api.db, run.id)).map((a) => a.action)).toContain("demo_environment.reset_requested");

    const again = await call<Body>(demo.api.app, "POST", RESETS, {
      session: demo.admin,
      headers: { "if-match": '"1"' },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      409,
      "demo_reset.in_progress",
      "A demo reset is already running.",
    ]);
    expect(await outboxOf(demo)).toHaveLength(1);
    expect(await resetAudits(demo)).toHaveLength(1);
    // The relay routes the event to the demo.reset queue (one consumer).
    expect(DEMO_QUEUES.map((q) => q.name)).toEqual(["demo.reset"]);
    expect(DEMO_EVENT_QUEUES).toEqual({ "demo.reset_requested": "demo.reset" });
    expect(QUEUES_FOR_EVENT["demo.reset_requested"]).toEqual(["demo.reset"]);
  });
});

describe("the worker's demo.reset job (ADR-0050 §6)", () => {
  const envelopeOf = (e: {
    id: string;
    event_type: string;
    idempotency_key: string;
    organization_id: string;
    payload: unknown;
  }) => ({
    outboxEventId: e.id,
    eventType: e.event_type,
    schemaVersion: 1,
    idempotencyKey: e.idempotency_key,
    organizationId: e.organization_id,
    payload: e.payload as Record<string, unknown>,
  });

  it("fails with a stable code when this deployment is not a configured demo one; nothing acknowledged", async () => {
    const [event] = await outboxOf(demo);
    const envelope = envelopeOf(event!);
    const reset = async (): Promise<DemoRunSummary> => {
      throw new Error("must not run");
    };
    for (const [settings, code] of [
      [
        { mthEnv: "production", adminUrl: "postgres://x@127.0.0.1/postgres", databaseUrl: "postgres://x@127.0.0.1/d" },
        "environment.not_demo",
      ],
      [{ mthEnv: "demo", adminUrl: null, databaseUrl: "postgres://x@127.0.0.1/d" }, "demo_reset.not_configured"],
    ] as const) {
      const err = await handleDemoReset(demo.api.db, envelope, "job-1", { settings: () => settings, reset }).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(DemoResetJobError);
      expect((err as DemoResetJobError).code).toBe(code);
    }
    const ledger = await demo.api.db
      .selectFrom("processed_message")
      .selectAll()
      .where("consumer", "=", "demo.reset")
      .execute();
    expect(ledger).toEqual([]);
  });

  it("acknowledges before the drop, then re-creates and re-seeds the database (requested_via api); a redelivery does nothing", async () => {
    const { adminUrl } = inject("mthDb");
    const [event] = await outboxOf(demo);
    const envelope = envelopeOf(event!);
    const requester = demo.admin.userId;
    await demo.api.close(); // the reset drops the database: no API connection may stay open on it
    demoClosed = true;
    const workerDb = createDb(createPool(roleUrl(adminUrl, demo.name, "mth_app"), { max: 1 }));
    let resets = 0;
    let ackSeenBeforeDrop = false;
    const settings = () => ({ mthEnv: "demo", adminUrl, databaseUrl: roleUrl(adminUrl, demo.name, "mth_app") });
    try {
      const outcome = await handleDemoReset(workerDb, envelope, "job-reset-1", {
        settings,
        reset: async (options) => {
          resets += 1;
          const owner = createDb(createPool(options.ownerUrl, { max: 1 }));
          try {
            const row = await owner
              .selectFrom("processed_message")
              .select("idempotency_key")
              .where("consumer", "=", "demo.reset")
              .executeTakeFirst();
            ackSeenBeforeDrop = row?.idempotency_key === envelope.idempotencyKey;
          } finally {
            await owner.destroy();
          }
          return resetDemo({ ...options, modules: TEST_DEMO_MODULES });
        },
      });
      expect(ackSeenBeforeDrop).toBe(true);
      expect(outcome).toEqual({ outcome: "reset", runNo: 1, checksumSha256: seeded.checksumSha256 });
    } finally {
      await workerDb.destroy();
    }
    const fresh = createDb(createPool(roleUrl(adminUrl, demo.name, "mth_owner"), { max: 1 }));
    try {
      const runs = await fresh.selectFrom("demo_dataset_run").selectAll().execute();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        run_no: 1,
        run_kind: "reset",
        requested_via: "api",
        requested_by: requester,
        checksum_sha256: seeded.checksumSha256,
      });
      expect(runs[0]!.record_counts).toEqual(seeded.recordCounts);
      // The world the tests added (users, grants, the request itself) went with the drop: synthetic data, by design.
      expect(await fresh.selectFrom("outbox_event").select("id").execute()).toEqual([]);
      // A redelivery against the re-created database would find its own new ledger; against the same ledger it is a
      // duplicate. Simulate the redelivery of the same job on a database that already acknowledged it:
      await fresh
        .insertInto("processed_message")
        .values({ consumer: "demo.reset", idempotency_key: envelope.idempotencyKey, outcome: "done" })
        .execute();
      const again = await handleDemoReset(fresh, envelope, "job-reset-1", {
        settings,
        reset: async () => {
          resets += 1;
          throw new Error("must not reset twice");
        },
      });
      expect(again).toEqual({ outcome: "duplicate" });
      expect(resets).toBe(1);
    } finally {
      await fresh.destroy();
    }
  }, 300_000);
});
