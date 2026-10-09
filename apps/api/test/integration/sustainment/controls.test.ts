// BAU controls, control checks and sustainment reviews (T-DG4-BE-I2; ADR-0034 §6, §9, §11, §12; REQ-S11-008,
// REQ-S11-004). Proves, against the run's disposable PostgreSQL:
//  - controls: create (BO, TO) with a CTL-nn code, version 1 and one audit event; the first check date defaults to the
//    business date plus one period (an explicit null stays "not scheduled"); edit and retire with If-Match (428/409),
//    retire needs a reason (400 at /retireReason), a retired control is final (422 control.retired, exact text);
//    AUD 403, WL 403 (no control.manage), ADM-only 404, outsider 404; a retired area 422; another transformation's
//    area 422 validation.reference;
//  - control checks (created by the worker's control-check scan): passed or failed by BO/TO; a failed check without its
//    note is 400 control_check.result_note_required at /resultNote and writes nothing; a failed check writes ONE outbox
//    event control_check.failed with exactly the ADR-0031 §5.4 payload and key `control_check.failed:<checkId>`, in the
//    same transaction as the check (REQ-S11-008); a recorded check is final (422 control_check.final, exact text); the
//    check's control_check_due work item is closed; AUD/WL 403, ADM 404, If-Match 428/409; commit-time authorization;
//  - reviews: only the assignee completes (403 sustainment_review.not_assignee for a FIN who holds the permission),
//    with outcome note and performance signal (`unknown` is valid); a completed review is final (422
//    sustainment_review.final); its work item is closed; AUD 403, ADM 404, If-Match 428/409;
//  - parity (D-102 (2)): the worker's scheduleAreaReviewInTx writes the same rows as the API's scheduleAreaReview.
// All data is SYNTHETIC; nothing here is a business approval, and nothing touches DG0-DG7.
import { sql } from "@mth/db";
import { checkFailedPayload } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runControlCheckScan, scheduleAreaReviewInTx } from "../../../../worker/src/handlers/sustainment.ts";
import { jobActor } from "../../../../worker/src/kit.ts";
import { businessDatePlusPeriod, scheduleAreaReview } from "../../../src/modules/sustainment/performance-areas.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { areaInBau, createArea, seedSustainmentWorld, type SustainmentWorld } from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const controls = () => `${s.b.base}/controls`;
const checks = () => `${s.b.base}/control-checks`;
const reviews = () => `${s.b.base}/sustainment-reviews`;
let dateSeq = 0;
/** A distinct past due date per control, so each scan creates exactly one check for it. */
const nextDue = () => `2025-0${1 + (dateSeq % 9)}-${String(10 + Math.floor(dateSeq++ / 9)).padStart(2, "0")}`;

async function newControl(areaId: string, body: Record<string, unknown> = {}) {
  const r = await send("POST", controls(), {
    session: s.to.session,
    body: { performanceAreaId: areaId, name: "Synthetic SIM-swap review", frequency: "monthly", ...body },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number; nextCheckDate: string | null };
}

/** A due check of a new control (owner BO unless given), created by the worker's scan for this organization. */
async function dueCheck(areaId: string, owner: string | null = s.b.users.bo.id) {
  const due = nextDue();
  const ctl = await newControl(areaId, { ownerUserId: owner, nextCheckDate: due });
  const scan = await runControlCheckScan(api.db, `test-${ctl.id}`, { asOf: due, organizationId: s.b.organizationId });
  const step = scan.steps.find((x) => x.subjectId === ctl.id)!;
  expect([step.outcome, step.dueDate]).toEqual(["created", due]);
  return { control: ctl, checkId: step.recordId!, K: `${checks()}/${step.recordId}/record`, due };
}

const checkRow = (id: string) =>
  api.db.selectFrom("control_check").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const outboxOf = (checkId: string) =>
  api.db.selectFrom("outbox_event").selectAll().where("aggregate_id", "=", checkId).execute();
const workItemsOf = (subjectId: string) =>
  api.db.selectFrom("work_item").selectAll().where("subject_id", "=", subjectId).execute();

describe("controls (ADR-0034 §6)", () => {
  it("BO and TO create; CTL-nn, version 1, audited; the first check date defaults to one period ahead", async () => {
    const area = await createArea(send, s);
    const a = await newControl(area.id, { frequency: "quarterly" });
    expect([a.code.startsWith("CTL-"), a.version]).toEqual([true, 1]);
    expect(a.nextCheckDate).toBe(await businessDatePlusPeriod(api.db, s.b.organizationId, "quarterly", 1));
    const audit = await auditOf(api.db, a.id);
    expect(audit.map((e) => e.action)).toEqual(["control.create"]);
    const b = await send("POST", controls(), {
      session: s.b.s.bo,
      body: { performanceAreaId: area.id, name: "Synthetic unscheduled", frequency: "annual", nextCheckDate: null },
    });
    expect([b.status, b.body.nextCheckDate, b.body.ownerUserId]).toEqual([201, null, null]);
    const list = await send("GET", `${controls()}?performanceAreaId=${area.id}`, { session: s.b.s.auditor });
    expect(list.body.items.map((c: { id: string }) => c.id).sort()).toEqual([a.id, b.body.id].sort());
  });

  it("AUD and WL 403, ADM-only and an outsider 404; nothing written", async () => {
    const area = await createArea(send, s);
    const body = { performanceAreaId: area.id, name: "Synthetic", frequency: "monthly" };
    for (const session of [s.b.s.auditor, s.wl.session, s.b.s.fin])
      expect((await send("POST", controls(), { session, body })).status).toBe(403);
    for (const session of [s.b.s.admin, s.b.s.outsider]) {
      expect((await send("POST", controls(), { session, body })).status).toBe(404);
      expect((await send("GET", controls(), { session })).status).toBe(404);
    }
    const n = await api.db.selectFrom("control").select("id").where("performance_area_id", "=", area.id).execute();
    expect(n).toEqual([]);
  });

  it("a retired area is 422 performance_area.retired; another transformation's area is 422 validation.reference", async () => {
    const area = await createArea(send, s);
    const ret = await send("POST", `${s.areas}/${area.id}/retire`, {
      session: s.to.session,
      headers: ifm(1),
      body: { reason: "Synthetic: merged" },
    });
    expect(ret.status).toBe(200);
    const r = await send("POST", controls(), {
      session: s.to.session,
      body: { performanceAreaId: area.id, name: "Synthetic", frequency: "monthly" },
    });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "performance_area.retired",
      "This performance area is retired and can no longer be changed.",
    ]);
    const other = await send("POST", controls(), {
      session: s.to.session,
      body: { performanceAreaId: crypto.randomUUID(), name: "Synthetic", frequency: "monthly" },
    });
    expect([other.status, other.body.code, other.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/performanceAreaId",
    ]);
  });

  it("update and retire: If-Match 428/409, retire needs a reason, a retired control is final; audited", async () => {
    const area = await createArea(send, s);
    const c = await newControl(area.id);
    const C = `${controls()}/${c.id}`;
    expect((await send("PATCH", C, { session: s.to.session, body: { name: "x" } })).status).toBe(428);
    expect((await send("PATCH", C, { session: s.to.session, headers: ifm(7), body: { name: "x" } })).status).toBe(409);
    expect((await send("PATCH", C, { session: s.b.s.auditor, headers: ifm(1), body: { name: "x" } })).status).toBe(403);
    const noReason = await send("PATCH", C, { session: s.to.session, headers: ifm(1), body: { status: "retired" } });
    expect([noReason.status, noReason.body.errors[0].pointer, noReason.body.errors[0].code]).toEqual([
      400,
      "/retireReason",
      "validation.required",
    ]);
    const edited = await send("PATCH", C, {
      session: s.to.session,
      headers: ifm(1),
      body: { frequency: "weekly", frequencyInterval: 2, ownerUserId: s.b.users.bo.id },
    });
    expect([edited.status, edited.body.version, edited.body.frequency, edited.body.ownerUserId]).toEqual([
      200,
      2,
      "weekly",
      s.b.users.bo.id,
    ]);
    const retired = await send("PATCH", C, {
      session: s.b.s.bo,
      headers: ifm(2),
      body: { status: "retired", retireReason: "Synthetic: automated" },
    });
    expect([retired.status, retired.body.status, retired.body.retireReason]).toEqual([
      200,
      "retired",
      "Synthetic: automated",
    ]);
    const final = await send("PATCH", C, { session: s.b.s.bo, headers: ifm(3), body: { name: "Synthetic again" } });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "control.retired",
      "This control is retired and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, c.id)).map((e) => e.action)).toEqual([
      "control.create",
      "control.update",
      "control.retire",
    ]);
  });
});

describe("control checks: a failed check emits one control_check.failed (REQ-S11-008)", () => {
  it("failed without a note is 400 control_check.result_note_required at /resultNote; nothing written", async () => {
    const area = await createArea(send, s);
    const { checkId, K } = await dueCheck(area.id);
    const before = await checkRow(checkId);
    const r = await send("POST", K, { session: s.to.session, headers: ifm(1), body: { result: "failed" } });
    expect([r.status, r.body.errors]).toEqual([
      400,
      [
        {
          pointer: "/resultNote",
          code: "control_check.result_note_required",
          message: "A failed control check needs a result note.",
        },
      ],
    ]);
    expect(await checkRow(checkId)).toEqual(before);
    expect(await outboxOf(checkId)).toEqual([]);
  });

  it("a failed check: one outbox event with exactly the ADR-0031 §5.4 payload; the check is final afterwards", async () => {
    const area = await createArea(send, s);
    const { control, checkId, K } = await dueCheck(area.id);
    const items = await workItemsOf(checkId);
    expect(items.map((i) => [i.kind, i.assignee_user_id, i.status])).toEqual([
      ["control_check_due", s.b.users.bo.id, "open"],
    ]);
    const r = await send("POST", K, {
      session: s.b.s.bo,
      headers: ifm(1),
      body: { result: "failed", resultNote: "Synthetic: 3 unreviewed swaps" },
    });
    expect([r.status, r.body.status, r.body.performedBy, r.body.resultNote, r.body.version]).toEqual([
      200,
      "failed",
      s.b.users.bo.id,
      "Synthetic: 3 unreviewed swaps",
      2,
    ]);
    const events = await outboxOf(checkId);
    expect(events).toHaveLength(1);
    const e = events[0]!;
    expect([e.event_type, e.schema_version, e.aggregate_type, e.idempotency_key, e.organization_id]).toEqual([
      "control_check.failed",
      1,
      "control_check",
      `control_check.failed:${checkId}`,
      s.b.organizationId,
    ]);
    const payload = checkFailedPayload.parse(e.payload);
    const today = (await sql<{ d: string }>`SELECT p4_business_date(now(), 'Asia/Riyadh')::text AS d`.execute(api.db))
      .rows[0]!.d;
    expect(payload).toEqual({
      checkId,
      checkRecordType: "control_check",
      transformationId: s.b.transformationId,
      ownerUserId: s.b.users.bo.id,
      subjectLabel: "Synthetic SIM-swap review",
      failedAt: r.body.performedAt,
      businessDate: today,
    });
    expect(control.id).toBe(r.body.controlId);
    expect((await workItemsOf(checkId)).map((i) => i.status)).toEqual(["done"]);
    const again = await send("POST", K, { session: s.b.s.bo, headers: ifm(2), body: { result: "passed" } });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "control_check.final",
      "This control check is failed and can no longer be changed.",
    ]);
    expect(await outboxOf(checkId)).toHaveLength(1);
    expect((await auditOf(api.db, checkId)).map((a) => a.action)).toEqual([
      "control_check.create",
      "control_check.failed",
    ]);
  });

  it("an ownerless control's check goes to the BAU owner; its failure event carries ownerUserId null", async () => {
    const { area } = await areaInBau(api, s);
    const { checkId, K } = await dueCheck(area.id, null);
    expect((await checkRow(checkId)).assignee_user_id).toBe(s.b.users.bo.id);
    const r = await send("POST", K, {
      session: s.to.session,
      headers: ifm(1),
      body: { result: "failed", resultNote: "Synthetic: missing sign-off" },
    });
    expect(r.status).toBe(200);
    expect(checkFailedPayload.parse((await outboxOf(checkId))[0]!.payload).ownerUserId).toBeNull();
  });

  it("a passed check emits nothing; AUD/WL 403, ADM 404, If-Match 428/409", async () => {
    const area = await createArea(send, s);
    const { checkId, K } = await dueCheck(area.id);
    for (const session of [s.b.s.auditor, s.wl.session])
      expect((await send("POST", K, { session, headers: ifm(1), body: { result: "passed" } })).status).toBe(403);
    expect((await send("POST", K, { session: s.b.s.admin, headers: ifm(1), body: { result: "passed" } })).status).toBe(
      404,
    );
    expect((await send("POST", K, { session: s.to.session, body: { result: "passed" } })).status).toBe(428);
    expect((await send("POST", K, { session: s.to.session, headers: ifm(9), body: { result: "passed" } })).status).toBe(
      409,
    );
    const ok = await send("POST", K, { session: s.to.session, headers: ifm(1), body: { result: "passed" } });
    expect([ok.status, ok.body.status, ok.body.resultNote, ok.body.correctiveCaseId]).toEqual([
      200,
      "passed",
      null,
      null,
    ]);
    expect(await outboxOf(checkId)).toEqual([]);
    const listed = await send("GET", `${checks()}?status=passed&performanceAreaId=${area.id}`, {
      session: s.b.s.auditor,
    });
    expect(listed.body.items.map((k: { id: string }) => k.id)).toEqual([checkId]);
  });

  it("authorization is re-checked at commit time: a recorder revoked mid-request gets 403 and nothing is written", async () => {
    const area = await createArea(send, s);
    const { checkId, K } = await dueCheck(area.id);
    const to2 = await extraUser(api, w, s.b, "TO");
    const res = await afterIdentity(
      api,
      to2.id,
      () =>
        call(api.app, "POST", K, {
          session: to2.session,
          headers: ifm(1),
          body: { result: "failed", resultNote: "Synthetic" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, to2.id),
    );
    expect(res.status).toBe(403);
    expect((await checkRow(checkId)).status).toBe("due");
    expect(await outboxOf(checkId)).toEqual([]);
  });
});

describe("sustainment reviews: the assignee completes (ADR-0034 §6, §9)", () => {
  it("only the assignee completes; final afterwards; work item closed; AUD 403, ADM 404, If-Match 428/409", async () => {
    const { area } = await areaInBau(api, s);
    const list = await send("GET", `${reviews()}?performanceAreaId=${area.id}&status=due`, { session: s.b.s.auditor });
    expect(list.body.items).toHaveLength(1);
    const review = list.body.items[0] as { id: string; assigneeUserId: string; createdSource: string };
    expect([review.assigneeUserId, review.createdSource]).toEqual([s.b.users.bo.id, "api"]);
    const R = `${reviews()}/${review.id}/complete`;
    const body = { outcomeNote: "Synthetic: churn stable", performanceSignal: "unknown" };
    const fin = await send("POST", R, { session: s.b.s.fin, headers: ifm(1), body });
    expect([fin.status, fin.body.code, fin.body.detail]).toEqual([
      403,
      "sustainment_review.not_assignee",
      "Only the assigned reviewer can complete this review.",
    ]);
    expect((await send("POST", R, { session: s.b.s.auditor, headers: ifm(1), body })).status).toBe(403);
    expect((await send("POST", R, { session: s.b.s.admin, headers: ifm(1), body })).status).toBe(404);
    expect((await send("POST", R, { session: s.b.s.bo, body })).status).toBe(428);
    expect((await send("POST", R, { session: s.b.s.bo, headers: ifm(4), body })).status).toBe(409);
    const bad = await send("POST", R, {
      session: s.b.s.bo,
      headers: ifm(1),
      body: { outcomeNote: "Synthetic", performanceSignal: "great" },
    });
    expect([bad.status, bad.body.errors[0].pointer]).toEqual([400, "/performanceSignal"]);
    const done = await send("POST", R, { session: s.b.s.bo, headers: ifm(1), body });
    expect([done.status, done.body.status, done.body.performanceSignal, done.body.completedBy]).toEqual([
      200,
      "done",
      "unknown",
      s.b.users.bo.id,
    ]);
    expect((await workItemsOf(review.id)).map((i) => [i.kind, i.status])).toEqual([["performance_review_due", "done"]]);
    const again = await send("POST", R, { session: s.b.s.bo, headers: ifm(2), body });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "sustainment_review.final",
      "This review is done and can no longer be changed.",
    ]);
    expect((await auditOf(api.db, review.id)).map((a) => a.action)).toEqual([
      "sustainment_review.create",
      "sustainment_review.complete",
    ]);
  });

  it("parity (D-102 (2)): the worker's review twin writes the same rows as the API's scheduleAreaReview", async () => {
    const { area: a1 } = await areaInBau(api, s);
    const { area: a2 } = await areaInBau(api, s);
    const due = "2031-03-15";
    const actorApi = jobActor("parity-api");
    const viaApi = await api.db.transaction().execute((tx) => scheduleAreaReview(tx, a1.id, due, actorApi));
    const viaWorker = await api.db
      .transaction()
      .execute((tx) => scheduleAreaReviewInTx(tx, jobActor("parity-worker"), a2.id, due));
    expect([viaApi.outcome, viaWorker.outcome]).toEqual(["created", "created"]);
    const again = await api.db
      .transaction()
      .execute((tx) => scheduleAreaReviewInTx(tx, jobActor("parity-worker"), a2.id, due));
    expect(again).toEqual({ outcome: "existing", reviewId: viaWorker.reviewId });
    const shape = async (reviewId: string, areaId: string) => {
      const r = await api.db
        .selectFrom("sustainment_review")
        .select([
          "subject_kind",
          "cycle_no",
          "transition_decision_id",
          "assignee_user_id",
          "status",
          "created_source",
          "created_by",
          "updated_by",
          "version",
          sql<string>`due_date::text`.as("due"),
        ])
        .where("id", "=", reviewId)
        .executeTakeFirstOrThrow();
      const item = await api.db
        .selectFrom("work_item")
        .select([
          "kind",
          "assignee_user_id",
          "subject_type",
          "message_key",
          "message_params",
          "status",
          "created_source",
        ])
        .select([sql<string>`due_date::text`.as("due"), sql<string>`replace(link_path, ${areaId}, 'A')`.as("link")])
        .select(sql<string>`replace(dedupe_key, ${areaId}, 'A')`.as("dedupe"))
        .where("subject_id", "=", reviewId)
        .executeTakeFirstOrThrow();
      const audit = await api.db
        .selectFrom("audit_event")
        .select(["action", "actor_type", "source", "changes"])
        .where("record_id", "=", reviewId)
        .execute();
      const params = item.message_params as { areaCode: string };
      return {
        r,
        item: { ...item, message_params: { ...params, areaCode: "PA" } },
        audit: audit.map((x) => ({ ...x, changes: Object.keys(x.changes as object).sort() })),
      };
    };
    expect(await shape(viaWorker.reviewId, a2.id)).toEqual(await shape(viaApi.reviewId, a1.id));
  });
});
