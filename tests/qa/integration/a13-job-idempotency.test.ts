// A13 (REQ-S20-013 first cases; REQ-S16-005, REQ-S12-004): job-framework idempotency.
//
// Acceptance criterion: the outbox relay / `transformation.created` handler processed twice produces ONE ledger effect
// (the idempotency key is honoured); a duplicate delivery is a no-op. Derived from ADR-0008 and the create contract
// (docs/api/openapi.yaml createTransformation: record + audit + outbox event in one transaction; Idempotency-Key
// replay returns the original 201).
//
// "Ledger effect" = the consumer ledger row (processed_message) plus the handler's one audit event on the
// transformation's trail. The suite drives the REAL API (inject) to create records, then the REAL worker functions and
// pg-boss on the same disposable database: relay twice, relay a replayed row, handle twice, handle concurrently, and
// finally let the running worker process a duplicate delivery. This file uses its own fresh database, because pg-boss
// queue policies are global state. All data is synthetic.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import {
  createBoss,
  ensureQueues,
  handleTransformationCreated,
  QUEUES,
  relayOnce,
  startWorker,
  STARTER_AUTOMATION_CONSUMER,
} from "../../../apps/worker/src/index.ts";
import {
  auditOf,
  createBu,
  createPool,
  createOrg,
  createTransformation,
  createUser,
  expectProblem,
  grant,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
} from "../support/api.ts";

let dbName: string;
let appUrl: string;
let api: TestApi;
let owner: ReturnType<typeof createPool>;
let boss: ReturnType<typeof createBoss>;
let office: Session;
let bu: string;

async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, what: string, ms = 20_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function outboxOf(transformationId: string) {
  return api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", transformationId).execute();
}

/** The ledger effect of the starter automation for one transformation. */
async function effectOf(transformationId: string) {
  const [event] = await outboxOf(transformationId);
  const ledger = await api.db
    .selectFrom("processed_message")
    .selectAll()
    .where("consumer", "=", STARTER_AUTOMATION_CONSUMER)
    .where("idempotency_key", "=", event!.idempotency_key)
    .execute();
  const audits = (await auditOf(api.db, transformationId)).filter((e) =>
    e.action.startsWith("transformation.starter_automation_"),
  );
  return { ledger: ledger.length, audits: audits.length, outcome: ledger[0]?.outcome ?? null };
}

async function jobsFor(outboxEventId: string) {
  const r = await owner.query<{ id: string; state: string; output: unknown; data: unknown }>(
    "SELECT id, state, output, data FROM pgboss.job WHERE name = $1 AND data->>'outboxEventId' = $2 ORDER BY created_on",
    [QUEUES.transformationCreated, outboxEventId],
  );
  return r.rows;
}

async function created(name: string, key?: string) {
  const r = await createTransformation(api.app, office, { businessUnitId: bu, name, mode: "end_to_end" }, key);
  expect(r.status).toBe(201);
  return r;
}

/** Relay until this transformation's event is published (other events may be queued ahead of it). */
async function relayUntilPublished(transformationId: string) {
  await waitFor(async () => {
    await relayOnce(api.db, boss);
    const [e] = await outboxOf(transformationId);
    return e?.published_at ? e : null;
  }, "outbox event published");
}

beforeAll(async () => {
  const { adminUrl } = testDatabase();
  dbName = await createScratchDatabase(adminUrl, "mth_qa_a13");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  appUrl = roleUrl(adminUrl, dbName, "mth_app");
  api = await startApi({ env: { DATABASE_URL: appUrl } });
  owner = createPool(roleUrl(adminUrl, dbName, "mth_owner"), { max: 2, applicationName: "qa-a13-owner" });

  const org = await createOrg(api.db);
  bu = await createBu(api.db, org.id);
  const grantor = await createUser(api.db, org.id);
  const u = await createUser(api.db, org.id);
  await grant(api.db, grantor.id, u.id, "TO", { type: "organization", id: org.id }, org.id);
  office = await signIn(api.app, u.subject);

  boss = createBoss(appUrl, { schedule: false, supervise: false, applicationName: "qa-a13" });
  boss.on("error", () => undefined);
  await boss.start();
  await ensureQueues(boss, { retryLimit: 0 });
});

afterAll(async () => {
  await boss?.stop({ graceful: false, wait: true, timeout: 5000 });
  await api?.close();
  await owner?.end();
  if (dbName) await dropScratchDatabase(testDatabase().adminUrl, dbName);
});

describe("A13 create with Idempotency-Key: a retried request is one record and one outbox event", () => {
  it("replays the original 201 and writes nothing new; the same key with another body is 422", async () => {
    const key = `qa-a13-${uniq("K")}`;
    const name = `QA A13 idem ${uniq("")}`;
    const first = await created(name, key);
    const replay = await created(name, key);
    expect(replay.body).toEqual(first.body);
    const rows = await api.db.selectFrom("transformation").select("id").where("name", "=", name).execute();
    expect(rows).toHaveLength(1);
    expect(await outboxOf(first.body.id)).toHaveLength(1);

    const other = await createTransformation(
      api.app,
      office,
      { businessUnitId: bu, name: `${name} changed`, mode: "end_to_end" },
      key,
    );
    expectProblem(other, 422, other.body.type);
    expect(
      await api.db.selectFrom("transformation").select("id").where("name", "=", `${name} changed`).execute(),
    ).toHaveLength(0);
  });
});

describe("A13 outbox relay: publishing twice enqueues one job", () => {
  it("a second relay pass is a no-op, and a replayed (un-marked) row does not create a second job", async () => {
    const t = await created(`QA A13 relay ${uniq("")}`);
    const [event] = await outboxOf(t.body.id);
    expect(event!.event_type).toBe("transformation.created");
    expect(event!.published_at).toBeNull();

    await relayUntilPublished(t.body.id);
    const again = await relayOnce(api.db, boss);
    expect(again.published).toBe(0);
    expect(await jobsFor(event!.id)).toHaveLength(1);

    // Simulate a crash window: the row looks unpublished again, so the relay sends it a second time.
    await owner.query("UPDATE outbox_event SET published_at = NULL WHERE id = $1", [event!.id]);
    await relayUntilPublished(t.body.id);
    const jobs = await jobsFor(event!.id);
    expect(jobs, "a replayed relay send created a second job").toHaveLength(1);
    expect(jobs[0]!.id).toBe(event!.id);
  });
});

describe("A13 transformation.created handler: processed twice = one ledger effect", () => {
  it("first run is 'done', the duplicate is 'duplicate'; one ledger row and one audit event", async () => {
    const t = await created(`QA A13 handler ${uniq("")}`);
    await relayUntilPublished(t.body.id);
    const [event] = await outboxOf(t.body.id);
    const [job] = await jobsFor(event!.id);

    expect(await handleTransformationCreated(api.db, job!.data, job!.id)).toBe("done");
    expect(await handleTransformationCreated(api.db, job!.data, job!.id)).toBe("duplicate");
    // A redelivery under a different job id carries the same idempotency key: still a no-op.
    expect(await handleTransformationCreated(api.db, job!.data, "qa-redelivery")).toBe("duplicate");
    expect(await effectOf(t.body.id)).toEqual({ ledger: 1, audits: 1, outcome: "done" });
  });

  it("concurrent deliveries of the same message produce exactly one effect", async () => {
    const t = await created(`QA A13 concurrent ${uniq("")}`);
    await relayUntilPublished(t.body.id);
    const [event] = await outboxOf(t.body.id);
    const [job] = await jobsFor(event!.id);
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, (_, i) => handleTransformationCreated(api.db, job!.data, `qa-concurrent-${i}`)),
    );
    expect(outcomes.filter((o) => o === "done")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(4);
    expect(await effectOf(t.body.id)).toEqual({ ledger: 1, audits: 1, outcome: "done" });
  });
});

describe("A13 running worker: a duplicate delivery is a no-op", () => {
  it("consumes the event once; an extra job with the same message completes as 'duplicate'", async () => {
    const t = await created(`QA A13 worker ${uniq("")}`);
    const worker = await startWorker({
      db: api.db,
      boss,
      timeZone: "Asia/Riyadh",
      pollIntervalMs: 100,
      jobPollingIntervalSeconds: 0.5,
      log: { info: () => undefined, error: () => undefined },
    });
    try {
      await waitFor(async () => (await effectOf(t.body.id)).ledger === 1, "first consumption");
      const [event] = await outboxOf(t.body.id);
      const [original] = await jobsFor(event!.id);

      // Duplicate delivery: the same envelope on the queue again, under a new job id.
      const dupId = await boss.send(QUEUES.transformationCreated, original!.data as object);
      expect(dupId).toBeTruthy();
      const dup = await waitFor(async () => {
        const rows = await owner.query<{ state: string; output: { outcome?: string } | null }>(
          "SELECT state, output FROM pgboss.job WHERE name = $1 AND id = $2",
          [QUEUES.transformationCreated, dupId],
        );
        return rows.rows[0]?.state === "completed" ? rows.rows[0] : null;
      }, "duplicate job completed");
      expect(dup.output?.outcome).toBe("duplicate");

      // Every earlier message of this file was also redelivered by the worker (jobs created by the relay but handled
      // directly above): once all jobs are done, every transformation still has exactly one effect.
      await waitFor(async () => {
        const r = await owner.query<{ n: string }>(
          "SELECT count(*) AS n FROM pgboss.job WHERE name = $1 AND state NOT IN ('completed')",
          [QUEUES.transformationCreated],
        );
        return Number(r.rows[0]!.n) === 0;
      }, "queue drained");
    } finally {
      await worker.stop();
    }
    const all = await api.db.selectFrom("transformation").select("id").execute();
    for (const { id } of all) {
      const e = await effectOf(id);
      expect(e.ledger, `ledger rows for ${id}`).toBeLessThanOrEqual(1);
      expect(e.audits, `starter-automation audit events for ${id}`).toBe(e.ledger);
    }
    expect(await effectOf(t.body.id)).toEqual({ ledger: 1, audits: 1, outcome: "done" });
  });
});
