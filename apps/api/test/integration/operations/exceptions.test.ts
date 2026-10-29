// Operational exceptions and the worker heartbeat (ADR-0053 §2, §4, §6, §9; REQ-S12-019; T-DG6-BE-K), against the
// run's disposable PostgreSQL:
//  1. the worker failure hook (apps/worker/src/kit.ts captureJobFailure): one failing job key that fails 3 times gives
//     exactly ONE active exception with occurrence_count 3, linked to its failure-queue row, with one audit event per
//     occurrence; a replay of the same failed job (same processed_message key) creates nothing; a success resolves it
//     `recovered` (no user); a later failure opens a NEW exception; the stored messages are redacted;
//  2. the API raise service and its worker twin write the same rows and audit actions;
//  3. acknowledge / resolve: every refusal (400, 403 AUD, 404, 409 version, 409 not open, 409 resolved, 422 note, 428),
//     the audit event with prior and new version, authorization re-checked at commit;
//  4. the scope rule: a transformation-scope KDS sees only exceptions linked to a KPI of its transformation (any other is
//     404, including the platform ones); an organization-level reader sees the organization's and the platform ones;
//     another organization's reader gets 403/404; a linked KPI shows DG4's label and value (Unknown is null, never 0);
//  5. the heartbeat: `unknown` with no beat, `stale` after 90 s, `alive`; the watch opens `heartbeat_missed` once,
//     does not double-count within 30 s, and resolves it `recovered` when beats resume.
// Every value is SYNTHETIC. Acknowledging or resolving an exception approves nothing (not a business approval, G1-G6)
// and never touches DG0-DG7 or a KPI value.
import { randomBytes } from "node:crypto";
import { createDb, sql, type Tx } from "@mth/db";
import type { FastifyRequest } from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  captureJobFailure,
  raiseOperationalExceptionTwin,
  settleRetriedJob,
  JOB_EXCEPTION_LEDGER,
} from "../../../../worker/src/kit.ts";
import {
  heartbeatWatchStep,
  raiseOperationalException,
  readWorkerHeartbeat,
} from "../../../src/modules/operations/index.ts";
import { acknowledgeException } from "../../../src/modules/operations/exceptions.ts";
import { HttpProblem } from "../../../src/modules/platform/index.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const L = "/api/v1/admin/operations/exceptions";
const H = "/api/v1/admin/operations/heartbeat";
const SERVICE = { actorUserId: null, actorType: "service" as const, requestId: "be-k:test" };

let api: TestApi;
let w: World;
let admin: Session;
let auditor: Session;
let nobody: Session;
let officeB: Session;

/** A synthetic queue name of letters only (the 0074 queue_name rule), unique to this run. */
const queue = (tag: string) =>
  `bek.${tag}_${[...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("")}`;
/** An outbox envelope naming organization A (the failure queue takes its key and organization from it). */
const envelope = (key: string) => ({
  outboxEventId: crypto.randomUUID(),
  eventType: "synthetic.event",
  schemaVersion: 1,
  idempotencyKey: key,
  organizationId: w.orgA.id,
  payload: {},
});
const exceptionsOf = (q: string) =>
  api.db
    .selectFrom("operational_exception")
    .selectAll()
    .where("source_code", "=", q)
    .orderBy("first_occurred_at")
    .orderBy("id")
    .execute();
const eventsOf = (id: string) =>
  api.db
    .selectFrom("operational_exception_event")
    .selectAll()
    .where("operational_exception_id", "=", id)
    .orderBy("record_version")
    .execute();
const raise = (
  q: string,
  organizationId: string | null = w.orgA.id,
  kpiLinks?: { kpiDefinitionId: string; transformationId: string }[],
) =>
  api.db.transaction().execute((tx) =>
    raiseOperationalException(tx, SERVICE, {
      organizationId,
      sourceKind: kpiLinks ? "data_freshness" : "job",
      sourceCode: kpiLinks ? `kpi:${kpiLinks[0]!.kpiDefinitionId}` : q,
      failureClass: kpiLinks ? "data_stale" : "job_failed",
      errorCode: kpiLinks ? "kpi.stale" : "automation.retries_exhausted",
      errorMessage: "Synthetic failure.",
      ...(kpiLinks ? { kpiLinks } : {}),
    }),
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
});

afterAll(async () => {
  await api?.close();
});

describe("the worker failure hook (ADR-0053 §2; kit.ts captureJobFailure / settleRetriedJob)", () => {
  it("one job key failing 3 times -> exactly one active exception with occurrence_count 3; a replay creates nothing", async () => {
    const q = queue("three");
    const data = envelope(`synthetic:${q}`);
    const jobIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const jobId of jobIds)
      await captureJobFailure(api.db, { queue: q, jobId, data, attempts: 5, error: new Error("Synthetic failure") });
    const rows = await exceptionsOf(q);
    expect(rows).toHaveLength(1);
    const e = rows[0]!;
    expect([e.status, e.occurrence_count, e.organization_id, e.source_kind, e.failure_class, e.dedup_key]).toEqual([
      "open",
      3,
      w.orgA.id,
      "job",
      "job_failed",
      `job:${q}:job_failed`,
    ]);
    expect(e.last_error_code).toBe("automation.retries_exhausted");
    const failures = await api.db.selectFrom("operational_failure").selectAll().where("queue_name", "=", q).execute();
    expect(failures).toHaveLength(1);
    expect(e.operational_failure_id).toBe(failures[0]!.id);
    expect((await eventsOf(e.id)).map((x) => [x.event_kind, x.occurrence_count])).toEqual([
      ["opened", 1],
      ["recurred", 2],
      ["recurred", 3],
    ]);
    const audits = await auditOf(api.db, e.id);
    expect(audits.map((a) => [a.action, a.actor_type, a.prior_version, a.new_version])).toEqual([
      ["operational_exception.opened", "service", null, 1],
      ["operational_exception.recurred", "service", 1, 2],
      ["operational_exception.recurred", "service", 2, 3],
    ]);

    // A replay of the third failed job (same pg-boss job id): for an organization job the DG5 job.failed outbox key
    // already refuses it and the whole capture rolls back, so nothing new is written.
    await expect(
      captureJobFailure(api.db, { queue: q, jobId: jobIds[2]!, data, attempts: 5, error: new Error("again") }),
    ).rejects.toThrow(/outbox_event_idempotency_key_key/);
    const after = await exceptionsOf(q);
    expect(after.map((r) => [r.id, r.occurrence_count, r.version])).toEqual([[e.id, 3, 3]]);
    const ledger = await api.db
      .selectFrom("processed_message")
      .select("idempotency_key")
      .where("consumer", "=", JOB_EXCEPTION_LEDGER)
      .where("idempotency_key", "like", `${q}:%`)
      .execute();
    expect(ledger).toHaveLength(3);
  });

  it("a replay of the same failed job is a no-op for the exception (the processed_message ledger), also with no outbox row", async () => {
    // An organization-less job writes no outbox row, so the DG5 capture accepts the replay (its failure row adds the
    // attempts); the exception's ledger key `<queue>:<job id>` is what keeps the occurrence count unchanged.
    const q = queue("replay");
    const jobId = crypto.randomUUID();
    for (let i = 0; i < 3; i++)
      await captureJobFailure(api.db, { queue: q, jobId, data: {}, attempts: 5, error: new Error("Synthetic") });
    const rows = await exceptionsOf(q);
    expect(rows.map((r) => [r.status, r.occurrence_count, r.version])).toEqual([["open", 1, 1]]);
    expect((await auditOf(api.db, rows[0]!.id)).map((a) => a.action)).toEqual(["operational_exception.opened"]);
    const [failure] = await api.db.selectFrom("operational_failure").selectAll().where("queue_name", "=", q).execute();
    expect(failure!.attempts).toBe(15); // DG5 behaviour unchanged: the failure row counts every capture's attempts
  });

  it("a success resolves the exception `recovered` (no user); a later failure opens a NEW exception", async () => {
    const q = queue("recover");
    const data = envelope(`synthetic:${q}`);
    await captureJobFailure(api.db, { queue: q, jobId: crypto.randomUUID(), data, attempts: 5, error: new Error("x") });
    const [opened] = await exceptionsOf(q);
    // A success of the same queue in ANOTHER organization does not resolve it.
    await settleRetriedJob(api.db, {
      queue: q,
      jobId: crypto.randomUUID(),
      data: { ...data, organizationId: w.orgB.id },
    });
    expect((await exceptionsOf(q)).map((r) => r.status)).toEqual(["open"]);
    await settleRetriedJob(api.db, { queue: q, jobId: crypto.randomUUID(), data });
    const [resolved] = await exceptionsOf(q);
    expect([
      resolved!.id,
      resolved!.status,
      resolved!.resolution,
      resolved!.resolved_by,
      resolved!.resolution_note,
    ]).toEqual([opened!.id, "resolved", "recovered", null, null]);
    expect((await auditOf(api.db, opened!.id)).map((a) => a.action)).toEqual([
      "operational_exception.opened",
      "operational_exception.resolved",
    ]);
    // A success with nothing active writes nothing.
    await settleRetriedJob(api.db, { queue: q, jobId: crypto.randomUUID(), data });
    expect((await auditOf(api.db, opened!.id)).length).toBe(2);
    await captureJobFailure(api.db, { queue: q, jobId: crypto.randomUUID(), data, attempts: 5, error: new Error("y") });
    const all = await exceptionsOf(q);
    expect(all.map((r) => [r.status, r.occurrence_count])).toEqual([
      ["resolved", 1],
      ["open", 1],
    ]);
    expect(all[1]!.id).not.toBe(opened!.id);
  });

  it("a scheduled (organization-less) job opens a platform exception", async () => {
    const q = queue("platform");
    await captureJobFailure(api.db, { queue: q, jobId: crypto.randomUUID(), data: {}, attempts: 5, error: "boom" });
    const [e] = await exceptionsOf(q);
    expect([e!.organization_id, e!.status]).toEqual([null, "open"]);
  });

  it("redacts the stored error text (ADR-0053 §4 item 4) in the exception and the failure-queue row", async () => {
    const q = queue("redact");
    const secret =
      "GET https://user:pa55word@store.example.invalid/x?X-Amz-Signature=abcdef&code=xyz failed with Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123 key AKIAABCDEFGHIJKLMNOP /links/abcdefghijklmnopqrstuvwxyzABCDEFGHIJK0123456";
    await captureJobFailure(api.db, {
      queue: q,
      jobId: crypto.randomUUID(),
      data: {},
      attempts: 5,
      error: new Error(secret),
    });
    const [e] = await exceptionsOf(q);
    const [f] = await api.db.selectFrom("operational_failure").selectAll().where("queue_name", "=", q).execute();
    for (const stored of [e!.last_error_message, f!.error_message]) {
      for (const leak of [
        "pa55word",
        "abcdef&",
        "code=xyz",
        "abcdefghijklmnopqrstuvwxyz0123",
        "AKIAABCDEFGHIJKLMNOP",
        "ABCDEFGHIJK0123456",
      ])
        expect(stored).not.toContain(leak);
      expect(stored).toContain("Bearer [secret]");
      expect(stored).toContain("/links/[token]");
    }
  });
});

describe("the API raise service and its worker twin (ADR-0002 rule 5)", () => {
  it("write the same rows and audit actions", async () => {
    const [qa, qb] = [queue("parity"), queue("parity")];
    const input = (q: string) => ({
      organizationId: w.orgA.id,
      sourceKind: "job" as const,
      sourceCode: q,
      failureClass: "job_failed" as const,
      errorCode: "automation.retries_exhausted",
      errorMessage: "Synthetic parity failure.",
    });
    const actor = {
      actorType: "service" as const,
      actorUserId: null,
      requestId: "be-k:parity",
      source: "worker" as const,
    };
    for (let i = 0; i < 2; i++) {
      await api.db.transaction().execute((tx) => raiseOperationalException(tx, SERVICE, input(qa)));
      await api.db.transaction().execute((tx) => raiseOperationalExceptionTwin(tx, actor, input(qb)));
    }
    const shape = async (q: string) => {
      const [r] = await exceptionsOf(q);
      const { id, source_code, dedup_key, first_occurred_at, last_occurred_at, created_at, updated_at, ...rest } = r!;
      void [source_code, first_occurred_at, last_occurred_at, created_at, updated_at];
      return {
        rest,
        dedup: dedup_key.replace(q, "Q"),
        events: (await eventsOf(id)).map((e) => [e.event_kind, e.status, e.occurrence_count, e.error_code]),
        audits: (await auditOf(api.db, id)).map((a) => [a.action, a.actor_type, a.prior_version, a.new_version]),
      };
    };
    expect(await shape(qb)).toEqual(await shape(qa));
  });
});

describe("routes: list, get, acknowledge, resolve, and the scope rule (ADR-0053 §2, §9)", () => {
  let kds: Session;
  let kdsId: string;
  let t1: string;
  let k1: string;
  let k2: string;
  let t2: string;
  let e1: string; // data_stale linked to K1 @ T1
  let e2: string; // data_stale linked to K2 @ T2
  let e3: string; // organization job exception, no link
  let e4: string; // platform job exception

  beforeAll(async () => {
    t1 = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
    t2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
    const u = await createUser(api.db, w.orgA.id);
    kdsId = u.id;
    await grant(api.db, w.grantor.id, u.id, "KDS", { type: "transformation", id: t1 }, w.orgA.id);
    kds = await signIn(api.app, u.subject);
    const kds2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, kds2.id, "KDS", { type: "transformation", id: t2 }, w.orgA.id);
    const kds2S = await signIn(api.app, kds2.subject);
    const kpi = async (t: string, s: Session, name: string) => {
      const r = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/kpi-definitions`, {
        session: s,
        body: { name, unitKind: "count", unitLabel: null, polarity: "higher_is_better", frequency: "monthly" },
      });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };
    k1 = await kpi(t1, kds, "Synthetic KPI one");
    k2 = await kpi(t2, kds2S, "Synthetic KPI two");
    e1 = (await raise("", w.orgA.id, [{ kpiDefinitionId: k1, transformationId: t1 }])).exceptionId;
    e2 = (await raise("", w.orgA.id, [{ kpiDefinitionId: k2, transformationId: t2 }])).exceptionId;
    e3 = (await raise(queue("org"))).exceptionId;
    e4 = (await raise(queue("plat"), null)).exceptionId;
  });

  const ids = (body: Body) => (body.items as { id: string }[]).map((i) => i.id);

  it("a transformation-scope KDS lists and reads only the exceptions linked to its transformation; others are 404", async () => {
    const listed = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: kds });
    expect(listed.status).toBe(200);
    expect(ids(listed.body)).toContain(e1);
    for (const hidden of [e2, e3, e4]) expect(ids(listed.body)).not.toContain(hidden);
    const got = await call<Body>(api.app, "GET", `${L}/${e1}`, { session: kds });
    expect(got.status).toBe(200);
    expect(got.body.linkedKpiCount).toBe(1);
    expect(got.body.hiddenKpiCount).toBe(0);
    // No accepted actual yet: DG4's Unknown, a null value and date, never 0 or fresh.
    expect(got.body.linkedKpis).toEqual([
      {
        kpiDefinitionId: k1,
        transformationId: t1,
        name: "Synthetic KPI one",
        unitKind: "count",
        freshness: "unknown",
        lastValue: null,
        lastValueAt: null,
      },
    ]);
    // ... and the DG4 panel says the same (the linked-KPI read is parity with kpi-status.ts).
    const panel = await call<Body>(api.app, "GET", `/api/v1/transformations/${t1}/kpi-definitions/${k1}/status`, {
      session: kds,
    });
    expect(panel.status).toBe(200);
    expect([panel.body.freshness.status, panel.body.actual]).toEqual(["unknown", null]);
    for (const hidden of [e2, e3, e4])
      expect((await call<Body>(api.app, "GET", `${L}/${hidden}`, { session: kds })).status).toBe(404);
    // Acknowledging outside scope is 404 too; nothing is written.
    const before = (await auditOf(api.db, e2)).length;
    const r = await call<Body>(api.app, "POST", `${L}/${e2}/acknowledge`, {
      session: kds,
      body: { note: null },
      headers: ifm(1),
    });
    expect(r.status).toBe(404);
    expect((await auditOf(api.db, e2)).length).toBe(before);
  });

  it("an organization-level reader sees the organization's and the platform exceptions; filters apply", async () => {
    const listed = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: auditor });
    expect(listed.status).toBe(200);
    for (const id of [e1, e2, e3, e4]) expect(ids(listed.body)).toContain(id);
    const stale = await call<Body>(
      api.app,
      "GET",
      `${L}?organizationId=${w.orgA.id}&failureClass=data_stale&limit=100`,
      {
        session: auditor,
      },
    );
    expect(ids(stale.body)).toEqual(expect.arrayContaining([e1, e2]));
    expect(ids(stale.body)).not.toContain(e3);
    const got = await call<Body>(api.app, "GET", `${L}/${e2}`, { session: auditor });
    expect(got.status).toBe(200);
    expect(got.body.linkedKpis.length + got.body.hiddenKpiCount).toBe(1);
    // Another organization's reader: 403 on organization A's list, 404 on its exceptions; its own list has none of A's.
    expect((await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}`, { session: officeB })).status).toBe(
      403,
    );
    expect((await call<Body>(api.app, "GET", `${L}/${e3}`, { session: officeB })).status).toBe(404);
    const own = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgB.id}&limit=100`, { session: officeB });
    expect(own.status).toBe(200);
    for (const id of [e1, e2, e3]) expect(ids(own.body)).not.toContain(id);
    expect(ids(own.body)).toContain(e4); // platform exceptions are visible to every organization-level reader
    expect((await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(
      403,
    );
  });

  it("acknowledge: KDS in scope; refusals 428, 409, 422, AUD 403; one audit event with prior and new version", async () => {
    const url = `${L}/${e1}/acknowledge`;
    expect((await call<Body>(api.app, "POST", url, { session: kds, body: { note: null } })).status).toBe(428);
    expect(
      (await call<Body>(api.app, "POST", url, { session: kds, body: { note: null }, headers: ifm(9) })).status,
    ).toBe(409);
    const blank = await call<Body>(api.app, "POST", url, { session: kds, body: { note: " \t " }, headers: ifm(1) });
    expect([blank.status, blank.body.code, blank.body.detail]).toEqual([
      422,
      "operations.note_required",
      "Enter a note of 3 to 1,000 characters.",
    ]);
    expect(
      (await call<Body>(api.app, "POST", url, { session: auditor, body: { note: null }, headers: ifm(1) })).status,
    ).toBe(403);
    expect((await call<Body>(api.app, "POST", url, { session: kds, body: {}, headers: ifm(1) })).status).toBe(400);
    expect((await auditOf(api.db, e1)).length).toBe(1); // opened only: no refusal wrote anything
    const ok = await call<Body>(api.app, "POST", url, {
      session: kds,
      body: { note: "  Synthetic: on it.  " },
      headers: ifm(1),
    });
    expect(ok.status).toBe(200);
    expect([ok.body.status, ok.body.acknowledgedBy, ok.body.acknowledgeNote, ok.body.version]).toEqual([
      "acknowledged",
      kdsId,
      "Synthetic: on it.",
      2,
    ]);
    expect(ok.headers["etag"]).toBe('"2"');
    expect(ok.body.events.map((e: Body) => e.eventKind)).toEqual(["opened", "acknowledged"]);
    const audits = await auditOf(api.db, e1);
    expect(audits.map((a) => [a.action, a.actor_user_id, a.prior_version, a.new_version])).toEqual([
      ["operational_exception.opened", null, null, 1],
      ["operational_exception.acknowledged", kdsId, 1, 2],
    ]);
    const again = await call<Body>(api.app, "POST", url, { session: kds, body: { note: null }, headers: ifm(2) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      409,
      "operations.exception_not_open",
      "Only an open operational exception can be acknowledged.",
    ]);
    // A recurrence while acknowledged keeps it acknowledged and counts once.
    await raise("", w.orgA.id, [{ kpiDefinitionId: k1, transformationId: t1 }]);
    const row = await api.db
      .selectFrom("operational_exception")
      .selectAll()
      .where("id", "=", e1)
      .executeTakeFirstOrThrow();
    expect([row.status, row.occurrence_count, row.version]).toEqual(["acknowledged", 2, 3]);
  });

  it("resolve: note required, AUD 403, 409 resolved afterwards; resolving changes no KPI", async () => {
    const url = `${L}/${e1}/resolve`;
    const short = await call<Body>(api.app, "POST", url, { session: kds, body: { note: "no" }, headers: ifm(3) });
    expect([short.status, short.body.code]).toEqual([422, "operations.note_required"]);
    expect(
      (await call<Body>(api.app, "POST", url, { session: auditor, body: { note: "Synthetic." }, headers: ifm(3) }))
        .status,
    ).toBe(403);
    expect((await call<Body>(api.app, "POST", url, { session: kds, body: { note: "Synthetic." } })).status).toBe(428);
    const kpiBefore = await api.db
      .selectFrom("kpi_definition")
      .selectAll()
      .where("id", "=", k1)
      .executeTakeFirstOrThrow();
    const ok = await call<Body>(api.app, "POST", url, {
      session: kds,
      body: { note: "Synthetic: data reloaded." },
      headers: ifm(3),
    });
    expect(ok.status).toBe(200);
    expect([ok.body.status, ok.body.resolution, ok.body.resolvedBy, ok.body.resolutionNote]).toEqual([
      "resolved",
      "manual",
      kdsId,
      "Synthetic: data reloaded.",
    ]);
    expect((await auditOf(api.db, e1)).at(-1)).toMatchObject({
      action: "operational_exception.resolved",
      prior_version: 3,
      new_version: 4,
    });
    const final = await call<Body>(api.app, "POST", url, {
      session: kds,
      body: { note: "Synthetic." },
      headers: ifm(4),
    });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      409,
      "operations.exception_resolved",
      "This operational exception is already resolved.",
    ]);
    const ackResolved = await call<Body>(api.app, "POST", `${L}/${e1}/acknowledge`, {
      session: kds,
      body: { note: null },
      headers: ifm(4),
    });
    expect([ackResolved.status, ackResolved.body.code]).toEqual([409, "operations.exception_resolved"]);
    expect(
      await api.db.selectFrom("kpi_definition").selectAll().where("id", "=", k1).executeTakeFirstOrThrow(),
    ).toEqual(kpiBefore);
    // Resolved is final for the default list; a new failure of the same source opens a new exception.
    const listed = await call<Body>(api.app, "GET", `${L}?organizationId=${w.orgA.id}&limit=100`, { session: kds });
    expect(ids(listed.body)).not.toContain(e1);
    const reopened = await raise("", w.orgA.id, [{ kpiDefinitionId: k1, transformationId: t1 }]);
    expect([reopened.outcome, reopened.exceptionId === e1]).toEqual(["opened", false]);
  });

  it("re-checks authorization at commit on the reloaded grants (a right lost meanwhile is 403; nothing written)", async () => {
    const before = (await auditOf(api.db, e3)).length;
    const principal = {
      kind: "user",
      userId: w.admin.id,
      organizationId: w.orgA.id,
      grants: [],
      tracker: { decisions: 0 },
    };
    const request = {
      id: "be-k-commit-time",
      principal,
      reauthenticate: async () => ({ ...principal }),
    } as unknown as FastifyRequest;
    let caught: unknown;
    try {
      await api.db.transaction().execute((tx) => acknowledgeException(tx, request, e3, 1, null));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HttpProblem);
    expect((caught as HttpProblem).status).toBe(403);
    expect((await auditOf(api.db, e3)).length).toBe(before);
    // The ADM_TECH admin (organization level) may acknowledge the platform exception.
    const ok = await call<Body>(api.app, "POST", `${L}/${e4}/acknowledge`, {
      session: admin,
      body: { note: null },
      headers: ifm(1),
    });
    expect(ok.status).toBe(200);
  });
});

describe("the worker heartbeat (ADR-0053 §6)", () => {
  /** Runs `fn` in a REPEATABLE READ owner transaction that is always rolled back (no row of the shared run survives). */
  async function inRolledBack(fn: (tx: Tx) => Promise<void>) {
    const pool = new pg.Pool({
      connectionString: inject("mthDb").ownerUrl.replace(/\?.*$/, ""),
      options: "-c role=mth_owner",
      max: 1,
    });
    pool.on("error", () => undefined);
    const db = createDb(pool);
    const rollback = new Error("rollback");
    try {
      await db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (tx) => {
          await fn(tx);
          throw rollback;
        });
    } catch (err) {
      if (err !== rollback) throw err;
    } finally {
      await db.destroy();
    }
  }

  it("unknown with no beat (the watch raises nothing), stale after 90 s (the watch opens once), alive (recovered)", async () => {
    await inRolledBack(async (tx) => {
      await sql`DELETE FROM worker_heartbeat`.execute(tx);
      const none = await readWorkerHeartbeat(tx);
      expect([none.status, none.newestBeatAt, none.instances, none.staleAfterSeconds]).toEqual([
        "unknown",
        null,
        [],
        90,
      ]);
      expect(await heartbeatWatchStep(tx)).toEqual({ state: "unknown", action: "none", exceptionId: null });
      await sql`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count, queue_count)
        VALUES (mth_uuid_v7(), 'bek-old', '0.0.0-synthetic', now() - interval '10 minutes', now() - interval '91 seconds', 3, 40)`.execute(
        tx,
      );
      const stale = await readWorkerHeartbeat(tx);
      expect([stale.status, stale.instances.map((i) => [i.instanceKey, i.status, i.beatCount])]).toEqual([
        "stale",
        [["bek-old", "stale", "3"]],
      ]);
      const opened = await heartbeatWatchStep(tx);
      expect([opened.state, opened.action]).toEqual(["stale", "opened"]);
      expect((await heartbeatWatchStep(tx)).action).toBe("skipped"); // within 30 s: not counted again
      const row = await tx
        .selectFrom("operational_exception")
        .selectAll()
        .where("id", "=", opened.exceptionId!)
        .executeTakeFirstOrThrow();
      expect([row.organization_id, row.dedup_key, row.status, row.occurrence_count]).toEqual([
        null,
        "worker:worker:heartbeat_missed",
        "open",
        1,
      ]);
      await sql`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count, queue_count)
        VALUES (mth_uuid_v7(), 'bek-new', '0.0.0-synthetic', now() - interval '1 minute', now() - interval '5 seconds', 2, 40)`.execute(
        tx,
      );
      const alive = await readWorkerHeartbeat(tx);
      expect([alive.status, alive.instances.map((i) => [i.instanceKey, i.status])]).toEqual([
        "alive",
        [
          ["bek-new", "alive"],
          ["bek-old", "stale"],
        ],
      ]);
      expect(await heartbeatWatchStep(tx)).toEqual({
        state: "alive",
        action: "recovered",
        exceptionId: opened.exceptionId,
      });
      const recovered = await tx
        .selectFrom("operational_exception")
        .select(["status", "resolution", "resolved_by"])
        .where("id", "=", opened.exceptionId!)
        .executeTakeFirstOrThrow();
      expect(recovered).toEqual({ status: "resolved", resolution: "recovered", resolved_by: null });
      expect((await heartbeatWatchStep(tx)).action).toBe("none");
    });
  });

  it("getWorkerHeartbeat: a fresh beat reads alive; AUD reads; 403 without operations.read; 401 anonymous", async () => {
    const key = `bek-${randomBytes(6).toString("hex")}`;
    await sql`INSERT INTO worker_heartbeat (id, instance_key, app_version, started_at, last_beat_at, beat_count, queue_count)
      VALUES (mth_uuid_v7(), ${key}, '0.0.0-synthetic', now(), now(), 1, 40)`.execute(api.db);
    try {
      const r = await call<Body>(api.app, "GET", H, { session: auditor });
      expect(r.status).toBe(200);
      expect(r.body.status).toBe("alive");
      expect(r.body.instances.map((i: Body) => i.instanceKey)).toContain(key);
      expect((await call<Body>(api.app, "GET", H, { session: nobody })).status).toBe(403);
      expect((await call<Body>(api.app, "GET", H)).status).toBe(401);
    } finally {
      await api.owner.query("DELETE FROM worker_heartbeat WHERE instance_key = $1", [key]);
    }
  });
});
