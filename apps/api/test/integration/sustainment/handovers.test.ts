// BAU handovers and receiving-owner acceptance (T-DG4-BE-I; ADR-0034 §5, §9, §12; REQ-S11-005, REQ-PB-083). Proves,
// against the run's disposable PostgreSQL:
//  - REQ-S11-005 A11 "a handover missing data access is rejected": 422 bau_handover.incomplete naming "data access" at
//    /dataAccess, and no state change (status, version, audit, work items unchanged); every missing item is named;
//  - REQ-S11-005 A11 "acceptance by anyone other than the receiving owner returns 403": another BO (who holds
//    bau_handover.accept) gets 403 bau_handover.not_receiving_owner; WL, TL, TO and AUD get 403; an ADM-only caller gets
//    403 (REQ-S10-003), not 404; the receiving owner returns with a reason (400 without);
//  - REQ-PB-083 A11 "accepting a handover creates recurring BAU review tasks for the BAU owner exactly once": one
//    sustainment_review for the BO with its My Work item; a repeated acceptance is 422 and creates nothing; calling
//    scheduleAreaReview again for the same due date creates nothing (the unique key);
//  - the acceptance transaction: area -> BAU (BAU owner, KPI owner, current handover, next review date = business date +
//    one review period), routine ownership transfer of linked KPIs, controls without owner and linked benefits
//    (version + 1, audited);
//  - the state machine (draft -> submitted -> accepted | returned; returned -> submitted; frozen, accepted_final,
//    status_transition, area_not_open, exists), If-Match 428/409, audit per mutation, commit-time authorization.
// All data is SYNTHETIC. The acceptance is a synthetic in-product business approval of test data; nothing touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody } from "../benefits/fixtures.ts";
import {
  createArea,
  createNoteEvidence,
  fullContent,
  insertControl,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";
import { scheduleAreaReview } from "../../../src/modules/sustainment/performance-areas.ts";

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

const NOT_RECEIVING = "Only the receiving owner can accept or return this handover.";

/** An area with an ownerless control, an evidence item and a draft handover (content optional). */
async function draftHandover(content: Record<string, unknown> = fullContent(s.b.users.bo.id), withEvidence = true) {
  const area = await createArea(send, s);
  const controlId = await insertControl(api.db, s.b, area.id, null);
  const created = await send("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...content },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  let version = 1;
  if (withEvidence) {
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ev = await send("POST", `${s.handovers}/${created.body.id}/evidence`, {
      session: s.wl.session,
      headers: ifm(1),
      body: { evidenceId },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    version = ev.body.version;
  }
  return { area, controlId, id: created.body.id as string, H: `${s.handovers}/${created.body.id}`, version };
}

async function submitted(content?: Record<string, unknown>) {
  const d = await draftHandover(content);
  const sub = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(d.version) });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  return { ...d, version: sub.body.version as number };
}

const handoverRow = (id: string) =>
  api.db.selectFrom("bau_handover").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const workItems = (subjectId: string) =>
  api.db.selectFrom("work_item").selectAll().where("subject_id", "=", subjectId).orderBy("created_at").execute();
const reviewsOf = (areaId: string) =>
  api.db.selectFrom("sustainment_review").selectAll().where("performance_area_id", "=", areaId).execute();

describe("submission validates every M0217 item (REQ-S11-005)", () => {
  it("a handover missing data access is 422 bau_handover.incomplete naming 'data access'; no state change", async () => {
    const { dataAccess: _drop, ...noDataAccess } = fullContent(s.b.users.bo.id);
    const d = await draftHandover(noDataAccess);
    const before = await handoverRow(d.id);
    const auditBefore = (await auditOf(api.db, d.id)).length;
    const r = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(d.version) });
    expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
      422,
      "urn:mth:problem:validation",
      "bau_handover.incomplete",
      "The BAU handover is incomplete. Missing: data access.",
    ]);
    expect(r.body.errors).toEqual([
      { pointer: "/dataAccess", code: "bau_handover.incomplete", message: "data access" },
    ]);
    const after = await handoverRow(d.id);
    expect([after.status, after.version, after.submitted_at]).toEqual(["draft", before.version, null]);
    expect((await auditOf(api.db, d.id)).length).toBe(auditBefore);
    expect(await workItems(d.id)).toEqual([]);
    const read = await send("GET", d.H, { session: s.b.s.auditor });
    expect(read.body.missingItems).toEqual(["data_access"]);
  });

  it("an empty handover names every missing item, in the ADR-0034 §12 order, each at its field", async () => {
    const area = await createArea(send, s);
    const created = await send("POST", s.handovers, {
      session: s.b.s.tl,
      body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id },
    });
    expect(created.status).toBe(201);
    const r = await send("POST", `${s.handovers}/${created.body.id}/submit`, { session: s.b.s.tl, headers: ifm(1) });
    expect([r.status, r.body.detail]).toEqual([
      422,
      "The BAU handover is incomplete. Missing: KPI owner, operating procedures, controls, evidence, capability readiness, unresolved accepted risks, benefit monitoring cadence, data access, improvement backlog.",
    ]);
    expect(r.body.errors.map((e: { pointer: string }) => e.pointer)).toEqual([
      "/kpiOwnerUserId",
      "/operatingProcedures",
      "/controlIds",
      "/evidenceIds",
      "/capabilityReadiness",
      "/unresolvedAcceptedRisks",
      "/benefitMonitoringCadence",
      "/dataAccess",
      "/improvementBacklogSummary",
    ]);
  });

  it("a complete submission notifies the receiving owner once (My Work), and freezes the content", async () => {
    const d = await submitted();
    const items = await workItems(d.id);
    expect(items.map((i) => [i.kind, i.assignee_user_id, i.status, i.message_key])).toEqual([
      ["bau_handover_to_accept", s.b.users.bo.id, "open", "sustainment.task.bau_handover_to_accept"],
    ]);
    const mine = await send("GET", "/api/v1/me/work-items", { session: s.b.s.bo });
    expect(mine.status).toBe(200);
    expect(mine.body.items.some((i: { subjectId: string }) => i.subjectId === d.id)).toBe(true);
    const frozen = await send("PATCH", d.H, {
      session: s.wl.session,
      headers: ifm(d.version),
      body: { dataAccess: "changed" },
    });
    expect([frozen.status, frozen.body.code, frozen.body.detail]).toEqual([
      422,
      "bau_handover.frozen",
      "A submitted handover can only be accepted or returned.",
    ]);
    const again = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(d.version) });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "bau_handover.status_transition",
      "This handover cannot move from submitted to submitted.",
    ]);
  });
});

describe("only the receiving owner accepts or returns (REQ-S11-005)", () => {
  it("anyone other than the receiving owner gets 403; the receiving owner's acceptance succeeds", async () => {
    const d = await submitted();
    const other = await send("POST", `${d.H}/accept`, { session: s.bo2.session, headers: ifm(d.version), body: {} });
    expect([other.status, other.body.code, other.body.detail]).toEqual([
      403,
      "bau_handover.not_receiving_owner",
      NOT_RECEIVING,
    ]);
    for (const session of [s.wl.session, s.b.s.tl, s.to.session, s.b.s.fin, s.b.s.auditor]) {
      const r = await send("POST", `${d.H}/accept`, { session, headers: ifm(d.version), body: {} });
      expect(r.status).toBe(403);
    }
    // ADM-only (technical admin): 403, never 404 (REQ-S10-003); an outsider of another organization: 404.
    const adm = await send("POST", `${d.H}/accept`, { session: s.b.s.admin, headers: ifm(d.version), body: {} });
    expect([adm.status, adm.body.code]).toEqual([403, "forbidden"]);
    const admReturn = await send("POST", `${d.H}/return`, {
      session: s.b.s.admin,
      headers: ifm(d.version),
      body: { reason: "Synthetic" },
    });
    expect(admReturn.status).toBe(403);
    expect(
      (await send("POST", `${d.H}/accept`, { session: s.b.s.outsider, headers: ifm(d.version), body: {} })).status,
    ).toBe(404);
    expect((await handoverRow(d.id)).status).toBe("submitted");
    const ok = await send("POST", `${d.H}/accept`, { session: s.b.s.bo, headers: ifm(d.version), body: {} });
    expect([ok.status, ok.body.status, ok.body.acceptedBy]).toEqual([200, "accepted", s.b.users.bo.id]);
  });

  it("return needs a reason (400 bau_handover.return_reason_required); returned -> edited -> resubmitted", async () => {
    const d = await submitted();
    for (const body of [{}, { reason: "  " }, { reason: "x" }]) {
      const r = await send("POST", `${d.H}/return`, { session: s.b.s.bo, headers: ifm(d.version), body });
      expect([r.status, r.body.errors[0]]).toEqual([
        400,
        {
          pointer: "/reason",
          code: "bau_handover.return_reason_required",
          message: "A reason is required to return a handover.",
        },
      ]);
    }
    const other = await send("POST", `${d.H}/return`, {
      session: s.bo2.session,
      headers: ifm(d.version),
      body: { reason: "Synthetic" },
    });
    expect([other.status, other.body.code]).toEqual([403, "bau_handover.not_receiving_owner"]);
    const ret = await send("POST", `${d.H}/return`, {
      session: s.b.s.bo,
      headers: ifm(d.version),
      body: { reason: "Synthetic: the SOP lacks the escalation step" },
    });
    expect([ret.status, ret.body.status, ret.body.returnedBy, ret.body.returnReason]).toEqual([
      200,
      "returned",
      s.b.users.bo.id,
      "Synthetic: the SOP lacks the escalation step",
    ]);
    // The My Work item is closed with the return.
    expect((await workItems(d.id)).map((i) => i.status)).toEqual(["done"]);
    const ownerChange = await send("PATCH", d.H, {
      session: s.wl.session,
      headers: ifm(ret.body.version),
      body: { receivingOwnerUserId: s.bo2.id },
    });
    expect([ownerChange.status, ownerChange.body.errors[0].pointer]).toEqual([422, "/receivingOwnerUserId"]);
    const edit = await send("PATCH", d.H, {
      session: s.wl.session,
      headers: ifm(ret.body.version),
      body: { operatingProcedures: "Synthetic SOP v2 with escalation" },
    });
    expect(edit.status).toBe(200);
    const resub = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(edit.body.version) });
    expect([resub.status, resub.body.status]).toEqual([200, "submitted"]);
    // A new My Work item for the new submission (dedupe on the handover version).
    expect((await workItems(d.id)).map((i) => i.status)).toEqual(["done", "open"]);
    const draftAccept = await send("POST", `${d.H}/return`, {
      session: s.b.s.bo,
      headers: ifm(resub.body.version),
      body: { reason: "Synthetic second return" },
    });
    expect(draftAccept.status).toBe(200);
    const notSubmitted = await send("POST", `${d.H}/accept`, {
      session: s.b.s.bo,
      headers: ifm(draftAccept.body.version),
      body: {},
    });
    expect([notSubmitted.status, notSubmitted.body.type, notSubmitted.body.code, notSubmitted.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "bau_handover.status_transition",
      "This handover cannot move from returned to accepted.",
    ]);
  });
});

describe("acceptance transfers routine ownership and creates the first review exactly once (REQ-PB-083)", () => {
  it("area -> BAU; KPIs, controls and benefits transferred; one review and one My Work item for the BAU owner", async () => {
    const kpiOwner = await extraUser(api, w, s.b, "KDS");
    const area = await createArea(send, s, { reviewFrequency: "monthly", reviewInterval: 2 });
    const A = `${s.areas}/${area.id}`;
    const benefit = await send("POST", `${s.b.base}/benefits`, { session: s.b.s.bo, body: financialBody(s.b) });
    expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
    for (const body of [
      { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId },
      { linkKind: "benefit", benefitId: benefit.body.id },
    ])
      expect((await send("POST", `${A}/links`, { session: s.b.s.bo, body })).status).toBe(201);
    const ownerless = await insertControl(api.db, s.b, area.id, null);
    const owned = await insertControl(api.db, s.b, area.id, s.to.id);
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ho = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(kpiOwner.id) },
    });
    const H = `${s.handovers}/${ho.body.id}`;
    const ev = await send("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
    const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
    const kpiBefore = await api.db
      .selectFrom("kpi_definition")
      .select(["version", "owner_user_id"])
      .where("id", "=", s.b.kpiDefinitionId)
      .executeTakeFirstOrThrow();
    // The acceptance business date + 2 calendar months (monthly x 2), in PostgreSQL's month arithmetic.
    const expectedDue = (
      await sql<{
        d: string;
      }>`SELECT (p4_business_date(now(), o.default_timezone) + interval '2 months')::date::text AS d
        FROM organization o WHERE o.id = ${s.b.organizationId}::uuid`.execute(api.db)
    ).rows[0]!.d;

    const acc = await send("POST", `${H}/accept`, {
      session: s.b.s.bo,
      headers: ifm(sub.body.version),
      body: { note: "Synthetic: accepted for BAU" },
    });
    expect([acc.status, acc.body.status, acc.body.acceptanceNote]).toEqual([
      200,
      "accepted",
      "Synthetic: accepted for BAU",
    ]);
    const areaNow = await send("GET", A, { session: s.b.s.auditor });
    expect([
      areaNow.body.status,
      areaNow.body.bauOwnerUserId,
      areaNow.body.kpiOwnerUserId,
      areaNow.body.currentHandoverId,
      areaNow.body.nextReviewDate,
    ]).toEqual(["bau", s.b.users.bo.id, kpiOwner.id, ho.body.id, expectedDue]);

    const kpiAfter = await api.db
      .selectFrom("kpi_definition")
      .select(["version", "owner_user_id"])
      .where("id", "=", s.b.kpiDefinitionId)
      .executeTakeFirstOrThrow();
    expect(kpiAfter).toEqual({ version: kpiBefore.version + 1, owner_user_id: kpiOwner.id });
    expect((await auditOf(api.db, s.b.kpiDefinitionId)).at(-1)!.action).toBe("kpi_definition.ownership_transfer");
    const controls = await api.db
      .selectFrom("control")
      .select(["id", "owner_user_id", "version"])
      .where("performance_area_id", "=", area.id)
      .orderBy("id")
      .execute();
    expect(controls.find((c) => c.id === ownerless)).toMatchObject({ owner_user_id: s.b.users.bo.id, version: 2 });
    expect(controls.find((c) => c.id === owned)).toMatchObject({ owner_user_id: s.to.id, version: 1 });
    const ben = await api.db
      .selectFrom("benefit")
      .select(["bau_owner_user_id", "control_cadence", "version"])
      .where("id", "=", benefit.body.id)
      .executeTakeFirstOrThrow();
    expect(ben).toEqual({ bau_owner_user_id: s.b.users.bo.id, control_cadence: "monthly", version: 2 });

    // The first recurring review, exactly once, for the BAU owner, with its My Work item.
    const reviews = await reviewsOf(area.id);
    expect(reviews.map((r) => [r.assignee_user_id, String(r.due_date).slice(0, 10), r.status, r.cycle_no])).toEqual([
      [s.b.users.bo.id, areaNow.body.nextReviewDate, "due", 1],
    ]);
    const reviewItems = await workItems(reviews[0]!.id);
    expect(reviewItems.map((i) => [i.kind, i.assignee_user_id])).toEqual([["performance_review_due", s.b.users.bo.id]]);
    expect((await workItems(ho.body.id)).map((i) => i.status)).toEqual(["done"]);

    // A repeated acceptance is refused (accepted is final) and creates nothing.
    const again = await send("POST", `${H}/accept`, { session: s.b.s.bo, headers: ifm(acc.body.version), body: {} });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "bau_handover.accepted_final",
      "An accepted handover is final and cannot be changed.",
    ]);
    // The scheduler is idempotent on the area and due date (the scan's path, too).
    const replay = await api.db
      .transaction()
      .execute((tx) => scheduleAreaReview(tx, area.id, areaNow.body.nextReviewDate));
    expect(replay).toEqual({ outcome: "existing", reviewId: reviews[0]!.id });
    expect(await reviewsOf(area.id)).toHaveLength(1);
    expect(await workItems(reviews[0]!.id)).toHaveLength(1);
    // Accepted is final for every edit, too.
    const edit = await send("PATCH", H, {
      session: s.wl.session,
      headers: ifm(acc.body.version),
      body: { dataAccess: "x" },
    });
    expect([edit.status, edit.body.code]).toEqual([422, "bau_handover.accepted_final"]);
    expect((await auditOf(api.db, ho.body.id)).map((a) => a.action)).toEqual([
      "bau_handover.create",
      "bau_handover.evidence_add",
      "bau_handover.submit",
      "bau_handover.accept",
    ]);
  });
});

describe("the benefit's control cadence follows a weekly handover cadence (ADR-0034 amendment A1; T-DG4-BE-R2)", () => {
  it("a weekly handover sets a linked benefit's control_cadence to weekly, version + 1, audited", async () => {
    const area = await createArea(send, s);
    const A = `${s.areas}/${area.id}`;
    const benefit = await send("POST", `${s.b.base}/benefits`, { session: s.b.s.bo, body: financialBody(s.b) });
    expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
    expect(
      (
        await send("POST", `${A}/links`, {
          session: s.b.s.bo,
          body: { linkKind: "benefit", benefitId: benefit.body.id },
        })
      ).status,
    ).toBe(201);
    const before = await api.db
      .selectFrom("benefit")
      .select(["bau_owner_user_id", "control_cadence", "version"])
      .where("id", "=", benefit.body.id)
      .executeTakeFirstOrThrow();
    expect([before.bau_owner_user_id, before.control_cadence]).toEqual([null, null]);
    await insertControl(api.db, s.b, area.id, null);
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ho = await send("POST", s.handovers, {
      session: s.wl.session,
      body: {
        performanceAreaId: area.id,
        receivingOwnerUserId: s.b.users.bo.id,
        ...fullContent(s.b.users.bo.id),
        benefitMonitoringCadence: "weekly",
      },
    });
    expect(ho.status, JSON.stringify(ho.body)).toBe(201);
    const H = `${s.handovers}/${ho.body.id}`;
    const ev = await send("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
    const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const acc = await send("POST", `${H}/accept`, { session: s.b.s.bo, headers: ifm(sub.body.version), body: {} });
    expect([acc.status, acc.body.status], JSON.stringify(acc.body)).toEqual([200, "accepted"]);
    const after = await api.db
      .selectFrom("benefit")
      .select(["bau_owner_user_id", "control_cadence", "version"])
      .where("id", "=", benefit.body.id)
      .executeTakeFirstOrThrow();
    expect(after).toEqual({
      bau_owner_user_id: s.b.users.bo.id,
      control_cadence: "weekly",
      version: before.version + 1,
    });
    const last = (await auditOf(api.db, benefit.body.id)).at(-1)!;
    expect([last.prior_version, last.new_version]).toEqual([before.version, before.version + 1]);
    expect(last.changes).toMatchObject({ control_cadence: { from: null, to: "weekly" } });
    // The API shows it, too (the contract enum admits weekly since 0060).
    const shown = await send("GET", `${s.b.base}/benefits/${benefit.body.id}`, { session: s.b.s.auditor });
    expect([shown.status, shown.body.controlCadence]).toEqual([200, "weekly"]);
  });
});

describe("preparation rules, gates and concurrency", () => {
  it("one handover in progress per cycle (409); only an establishing or reopened area (422); AUD 403; ADM 404", async () => {
    const d = await draftHandover();
    const dup = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: d.area.id, receivingOwnerUserId: s.b.users.bo.id },
    });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "bau_handover.exists",
      "This performance area already has a handover in progress for this cycle.",
    ]);
    const retired = await createArea(send, s);
    expect(
      (
        await send("POST", `${s.areas}/${retired.id}/retire`, {
          session: s.b.s.bo,
          headers: ifm(1),
          body: { reason: "Synthetic retire" },
        })
      ).status,
    ).toBe(200);
    const closed = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: retired.id, receivingOwnerUserId: s.b.users.bo.id },
    });
    expect([closed.status, closed.body.code, closed.body.detail]).toEqual([
      422,
      "bau_handover.area_not_open",
      "A handover is prepared for an establishing or reopened performance area.",
    ]);
    for (const [session, status] of [
      [s.b.s.auditor, 403],
      [s.b.s.bo, 403], // BO holds no bau_handover.prepare by default (ADR-0034 §9)
      [s.to.session, 403],
      [s.b.s.admin, 404],
      [s.b.s.outsider, 404],
    ] as const) {
      const r = await send("POST", s.handovers, {
        session,
        body: { performanceAreaId: d.area.id, receivingOwnerUserId: s.b.users.bo.id },
      });
      expect(r.status).toBe(status);
      expect((await send("PATCH", d.H, { session, headers: ifm(d.version), body: { dataAccess: "x" } })).status).toBe(
        status,
      );
      expect((await send("POST", `${d.H}/submit`, { session, headers: ifm(d.version) })).status).toBe(status);
    }
    expect((await send("GET", d.H, { session: s.b.s.admin })).status).toBe(404);
    expect((await send("GET", s.handovers, { session: s.b.s.outsider })).status).toBe(404);
    const unknownArea = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: "00000000-0000-7000-8000-000000000000", receivingOwnerUserId: s.b.users.bo.id },
    });
    expect([unknownArea.status, unknownArea.body.code]).toEqual([422, "validation.reference"]);
  });

  it("If-Match: missing 428, stale 409 on every handover mutation", async () => {
    const d = await draftHandover();
    expect((await send("PATCH", d.H, { session: s.wl.session, body: { dataAccess: "x" } })).status).toBe(428);
    const stale = await send("PATCH", d.H, {
      session: s.wl.session,
      headers: ifm(d.version + 5),
      body: { dataAccess: "x" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, d.version]);
    expect((await send("POST", `${d.H}/submit`, { session: s.wl.session })).status).toBe(428);
    expect((await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(99) })).status).toBe(409);
    expect((await send("POST", `${d.H}/evidence`, { session: s.wl.session, body: { evidenceId: d.id } })).status).toBe(
      428,
    );
    const sub = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(d.version) });
    expect((await send("POST", `${d.H}/accept`, { session: s.b.s.bo, body: {} })).status).toBe(428);
    expect((await send("POST", `${d.H}/accept`, { session: s.b.s.bo, headers: ifm(1), body: {} })).status).toBe(409);
    expect((await send("POST", `${d.H}/return`, { session: s.b.s.bo, body: { reason: "Synthetic" } })).status).toBe(
      428,
    );
    expect((await handoverRow(d.id)).version).toBe(sub.body.version);
  });

  it("evidence must belong to the transformation; a frozen handover takes none", async () => {
    const d = await draftHandover(fullContent(s.b.users.bo.id), false);
    const bad = await send("POST", `${d.H}/evidence`, {
      session: s.wl.session,
      headers: ifm(1),
      body: { evidenceId: "00000000-0000-7000-8000-000000000000" },
    });
    expect([bad.status, bad.body.code, bad.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/evidenceId",
    ]);
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ok = await send("POST", `${d.H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
    expect([ok.status, ok.body.evidenceIds, ok.body.version]).toEqual([201, [evidenceId], 2]);
    const sub = await send("POST", `${d.H}/submit`, { session: s.wl.session, headers: ifm(2) });
    const evidence2 = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const frozen = await send("POST", `${d.H}/evidence`, {
      session: s.wl.session,
      headers: ifm(sub.body.version),
      body: { evidenceId: evidence2 },
    });
    expect([frozen.status, frozen.body.code]).toEqual([422, "bau_handover.frozen"]);
  });

  it("commit-time: bau_handover.accept revoked while the acceptance waited is 403; nothing written", async () => {
    const bo3 = await extraUser(api, w, s.b, "BO");
    const area = await createArea(send, s);
    await insertControl(api.db, s.b, area.id, null);
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ho = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: bo3.id, ...fullContent(bo3.id) },
    });
    const H = `${s.handovers}/${ho.body.id}`;
    const ev = await send("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
    const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
    expect(sub.status).toBe(200);
    const res = await afterIdentity(
      api,
      bo3.id,
      () =>
        call(api.app, "POST", `${H}/accept`, {
          session: bo3.session,
          headers: ifm(sub.body.version),
          body: {},
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, bo3.id),
    );
    expect(res.status).toBe(403);
    expect((await handoverRow(ho.body.id)).status).toBe("submitted");
    expect(await reviewsOf(area.id)).toEqual([]);
  });
});
