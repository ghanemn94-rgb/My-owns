// KPI restatement decision, the one restatement run, and the report reissue offers (T-DG5-KBE-E2; ADR-0047 §2-§3,
// §6-§8; p5-work-split §G.2; REQ-S07-016):
//  - (b) deciding a submitted Q1 restatement as a user without kpi_restatement.approve is 403
//    kpi_restatement.no_authority, and as its requester 403 kpi_restatement.self_decision; both write nothing;
//  - (c) after approval, the Q1 report snapshot issued earlier returns its old content, versions and approval state;
//    one reissue offer exists for it; reissueReportSnapshot plus issue gives issueVersion 2, and v1 is superseded with
//    unchanged content;
//  - replaying the approval event three times writes one run and one set of offers;
//  - a formula KPI's restatement run binds each input to its source's latest stored evaluation (D-156 g), and the
//    applied values equal the retained "after" values;
//  - rejecting without a note is 422 kpi_restatement.note_required;
//  - AUD 403; If-Match 428/409; one audit event per decision; commit-time re-authorization.
// All data is SYNTHETIC. Every decision is made through the API by a synthetic user holding the approval right: a demo
// business approval that approves nothing real. The two period-bound executive-dashboard snapshots are synthetic
// fixture rows written directly (that output's assembler is a later task), labelled so; they approve nothing. Nothing
// touches the engineering gates DG0-DG7.
import { insertAuditEvent } from "@mth/db";
import { canonicalDecimal } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recalculate } from "../../../../worker/src/handlers/kpi.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { ifMatch, seedKpiWorld, type KpiWorld } from "../kpi/fixtures.ts";
import { freshUser, postVersion } from "../kpi-p4/kbe-b-fixtures.ts";
import { mapPartyTo, runRecalculation } from "../kpi-p4/kbe-c-fixtures.ts";
import { decide, issuedKpiRegister, reissueOffers, runRestatementEvents } from "./decision-fixtures.ts";
import {
  acceptedActual,
  createRestatement,
  latestEvaluation,
  quarter,
  quarterlyKpi,
  RESTATED_FLOW,
  reconciliationOf,
  restatementAction,
  stepQuarter,
  type Body,
  type Quarter,
} from "./fixtures.ts";

let api: TestApi;
let w: World;
let k: KpiWorld;
let office: Session;
/** Quarters of 2081: q1 closed (values accepted while open), q2 open. */
let q1: Quarter;
let q2: Quarter;
/** One KPI per test, each with an accepted, evaluated Q1 value (set up in beforeAll while Q1 is open). */
const sharedQ1: { authority?: Body; main?: Body; formula?: Body; formulaSource?: Body; rules?: Body } = {};

const restatementRow = (id: string) =>
  api.db.selectFrom("kpi_restatement").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const outboxOf = (id: string) =>
  api.db.selectFrom("outbox_event").select(["event_type", "idempotency_key"]).where("aggregate_id", "=", id).execute();
const restatementAudit = async (id: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_type", "actor_user_id", "on_behalf_of_user_id"])
      .where("record_type", "=", "kpi_restatement")
      .where("record_id", "=", id)
      .where("action", "like", "kpi\\_restatement.%")
      .orderBy("occurred_at")
      .orderBy("id")
      .execute()
  ).map((a) => a.action);
const workItems = (subjectId: string, kind: string) =>
  api.db
    .selectFrom("work_item")
    .select(["assignee_user_id", "status", "dedupe_key"])
    .where("subject_id", "=", subjectId)
    .where("kind", "=", kind)
    .orderBy("assignee_user_id")
    .execute();

/** A submitted Q1 restatement of the KPI with the version, by the requester. Returns its id (version 2). */
async function submittedRestatement(kpiId: string, versionId: string, requester: Session, extra: object = {}) {
  const created = await createRestatement(
    api,
    k,
    kpiId,
    { kpiVersionId: versionId, reportingPeriodIds: [q1.id], reason: "Synthetic: a corrected source extract", ...extra },
    requester,
  );
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const submitted = await restatementAction(api, k, created.body.id, "submit", 1, requester);
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  return created.body.id as string;
}

/**
 * A SYNTHETIC issued executive-dashboard snapshot of one period that recorded the KPI's version (written directly, in
 * one transaction, with the shape the snapshot guards require; it approves nothing).
 */
async function syntheticPeriodSnapshot(
  period: Quarter,
  kpiId: string,
  versionId: string,
  methodologyVersionId: string,
) {
  const id = uuidv7();
  await api.db.transaction().execute(async (tx) => {
    await tx
      .insertInto("report_snapshot")
      .values({
        id,
        organization_id: w.orgA.id,
        transformation_id: k.transformationId,
        definition_code: "executive_dashboard",
        subject_type: "transformation",
        subject_id: k.transformationId,
        reporting_period_id: period.id,
        period_label: period.label,
        period_start: period.start,
        period_end: period.end,
        as_of: new Date(),
        content_schema_version: 1,
        content: JSON.stringify({ synthetic: true }),
        content_sha256: "0".repeat(64),
        methodology_version_id: methodologyVersionId,
        approval_state: "not_applicable",
        provisional_value_count: 0,
        unknown_value_count: 0,
        series_id: id,
        created_by: k.users.tl.id,
        updated_by: k.users.tl.id,
      })
      .execute();
    await tx
      .insertInto("report_snapshot_version")
      .values({
        id: uuidv7(),
        organization_id: w.orgA.id,
        transformation_id: k.transformationId,
        snapshot_id: id,
        version_kind: "kpi_version",
        reference_id: versionId,
        reference_key: `kpi_definition:${kpiId}`,
        version_label: "v1",
      })
      .execute();
    const fixtureActor = {
      actorType: "user",
      actorUserId: k.users.tl.id,
      requestId: `fixture-${id}`,
      source: "api",
    } as const;
    const audited = { recordType: "report_snapshot", recordId: id, organizationId: w.orgA.id } as const;
    await insertAuditEvent(tx, fixtureActor, {
      ...audited,
      action: "report_snapshot.generate",
      transformationId: k.transformationId,
      newVersion: 1,
    });
    await insertAuditEvent(tx, fixtureActor, {
      ...audited,
      action: "report_snapshot.issue",
      transformationId: k.transformationId,
      priorVersion: 1,
      newVersion: 2,
    });
    await tx
      .updateTable("report_snapshot")
      .set({
        status: "issued",
        issue_version: 1,
        issued_at: new Date(),
        issued_by: k.users.tl.id,
        version: 2,
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  });
  return id;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  k = await seedKpiWorld(api, w);
  office = await signIn(api.app, w.office.subject);
  q1 = await quarter(api, w, 2081, 1, office);
  q2 = await quarter(api, w, 2081, 2, office);
  await stepQuarter(api, w, q1, "open", office);
  sharedQ1.authority = await quarterlyKpi(api, k);
  await acceptedActual(api, k, sharedQ1.authority.id, q1, "90");
  sharedQ1.main = await quarterlyKpi(api, k);
  await acceptedActual(api, k, sharedQ1.main.id, q1, "90");
  sharedQ1.formulaSource = await quarterlyKpi(api, k);
  sharedQ1.formula = await quarterlyKpi(api, k, {
    ...RESTATED_FLOW,
    calculationMethod: "formula",
    formulaExpression: "a + a",
    formulaInputs: [{ variableName: "a", sourceKpiDefinitionId: sharedQ1.formulaSource.id, inputBasis: "period" }],
  });
  // The source's run also evaluates the formula KPI that reads it (the DG4 reader rule): 21 + 21 = 42.
  await acceptedActual(api, k, sharedQ1.formulaSource.id, q1, "21");
  sharedQ1.rules = await quarterlyKpi(api, k);
  await acceptedActual(api, k, sharedQ1.rules.id, q1, "50");
  await stepQuarter(api, w, q1, "close", office);
  await stepQuarter(api, w, q2, "open", office);
}, 240_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-S07-016 (b): a restatement of Q1 without authority is rejected", () => {
  it("no kpi_restatement.approve is 403 no_authority; the requester is 403 self_decision; both write nothing", async () => {
    const kpi = sharedQ1.authority!;
    // The requester (FIN + KDS) holds both rights; the decision is still never theirs (D-142 Q10).
    const id = await submittedRestatement(kpi.id, kpi.v1.id, k.s.finKds);
    const before = await restatementRow(id);
    const tasksBefore = await workItems(id, "kpi_restatement_to_decide");
    expect(tasksBefore.map((t) => t.status)).toEqual(tasksBefore.map(() => "open"));
    expect(tasksBefore.length).toBeGreaterThan(0);
    for (const s of [k.s.tl, k.s.kds, k.s.auditor]) {
      const r = await decide(api, k, id, { decision: "approve" }, 2, s);
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        403,
        "kpi_restatement.no_authority",
        "Only a person who holds the restatement approval right in this transformation can decide a restatement.",
      ]);
    }
    const self = await decide(api, k, id, { decision: "approve" }, 2, k.s.finKds);
    expect([self.status, self.body.code, self.body.detail]).toEqual([
      403,
      "kpi_restatement.self_decision",
      "The requester of a restatement cannot decide it.",
    ]);
    // Nothing written: the record, its audit trail, the outbox and the decision tasks are as they were.
    expect(await restatementRow(id)).toEqual(before);
    expect(await restatementAudit(id)).toEqual(["kpi_restatement.create", "kpi_restatement.submit"]);
    expect(await outboxOf(id)).toEqual([]);
    expect(await workItems(id, "kpi_restatement_to_decide")).toEqual(tasksBefore);
    // Each refusal is audited as a denial (ADR-0004), like every 403.
    const denied = await api.db
      .selectFrom("audit_event")
      .select("actor_user_id")
      .where("action", "=", "authorization.denied")
      .where("record_id", "=", id)
      .execute();
    expect(denied.map((d) => d.actor_user_id).sort()).toEqual(
      [k.users.tl.id, k.users.kds.id, k.users.auditor.id, k.users.finKds.id].sort(),
    );

    // Rejecting without a note is 422 note_required (nothing written); with a note, FIN rejects.
    const noNote = await decide(api, k, id, { decision: "reject" }, 2, k.s.fin);
    expect([noNote.status, noNote.body.code, noNote.body.detail]).toEqual([
      422,
      "kpi_restatement.note_required",
      "A rejection needs a note.",
    ]);
    expect(await restatementRow(id)).toEqual(before);
    const rejected = await decide(
      api,
      k,
      id,
      { decision: "reject", note: "Synthetic: the corrected extract is not final" },
      2,
      k.s.fin,
    );
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200);
    expect([
      rejected.body.status,
      rejected.body.version,
      rejected.body.decidedBy,
      rejected.body.authorityPermission,
      rejected.body.authorityRoleCode,
      rejected.body.decisionNote,
    ]).toEqual([
      "rejected",
      3,
      k.users.fin.id,
      "kpi_restatement.approve",
      "FIN",
      "Synthetic: the corrected extract is not final",
    ]);
    // A rejection publishes nothing and completes the decision tasks; it is final.
    expect(await outboxOf(id)).toEqual([]);
    expect((await workItems(id, "kpi_restatement_to_decide")).map((t) => t.status)).toEqual(
      tasksBefore.map(() => "done"),
    );
    expect(await restatementAudit(id)).toEqual([
      "kpi_restatement.create",
      "kpi_restatement.submit",
      "kpi_restatement.decide",
    ]);
    const again = await decide(api, k, id, { decision: "approve" }, 3, k.s.bo);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "kpi_restatement.not_submitted",
      "Only a submitted restatement can be decided.",
    ]);
    expect(await runRestatementEvents(api, id)).toEqual([]);
  });
});

describe("REQ-S07-016 (c): approval recalculates Q1 once and offers the reissue of the Q1 report issued earlier", () => {
  it("the issued report is unchanged; one offer per affected snapshot; reissue + issue gives issueVersion 2; v1 superseded and unchanged; three replays write one run and one set of offers", async () => {
    const kpi = sharedQ1.main!;
    // The KPI register, issued earlier (it records the KPI's active version v1).
    const register = await issuedKpiRegister(api, k);
    const S = `${k.base}/report-snapshots`;
    const v1Before = (await call<Body>(api.app, "GET", `${S}/${register.id}`, { session: k.s.auditor })).body;
    const versionsBefore = (await call<Body>(api.app, "GET", `${S}/${register.id}/versions`, { session: k.s.auditor }))
      .body;
    expect(versionsBefore.items.some((v: Body) => v.referenceId === kpi.v1.id)).toBe(true);
    const methodology = await api.db
      .selectFrom("report_snapshot")
      .select("methodology_version_id")
      .where("id", "=", register.id)
      .executeTakeFirstOrThrow();
    // SYNTHETIC period-bound snapshots: Q1 overlaps the restated period, Q2 does not.
    const dashQ1 = await syntheticPeriodSnapshot(q1, kpi.id, kpi.v1.id, methodology.methodology_version_id);
    const dashQ2 = await syntheticPeriodSnapshot(q2, kpi.id, kpi.v1.id, methodology.methodology_version_id);

    // The target change: version 2 (target 120) through a DG4 change request decided by the Business Owner.
    const v2 = await postVersion(api, k, kpi.id, { ...RESTATED_FLOW, targetValue: "120", changeReason: "Synthetic" });
    expect(v2.status, JSON.stringify(v2.body)).toBe(201);
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    const def = await call<Body>(api.app, "GET", `${k.base}/kpi-definitions/${kpi.id}`, { session: k.s.tl });
    const CR = `${k.base}/change-requests`;
    const cr = await call<Body>(api.app, "POST", CR, {
      session: k.s.tl,
      body: {
        changeKind: "target",
        subjectType: "kpi_definition",
        subjectId: kpi.id,
        subjectVersion: def.body.version,
        proposedRecordType: "kpi_version",
        proposedRecordId: v2.body.id,
        proposedChange: { targetValue: { from: "100", to: "120" } },
        reason: "Synthetic: a stretch target agreed by the business owner",
      },
    });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    const sub = await call<Body>(api.app, "POST", `${CR}/${cr.body.id}/submit`, {
      session: k.s.tl,
      headers: ifMatch(1),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const appr = await call<Body>(api.app, "GET", `/api/v1/approvals/${sub.body.approvalId}`, { session: k.s.bo });
    const crDecided = await call<Body>(api.app, "POST", `/api/v1/approvals/${sub.body.approvalId}/decisions`, {
      session: k.s.bo,
      headers: ifMatch(appr.body.version),
      body: { outcome: "approve", rationale: "Synthetic demo decision.", subjectVersion: appr.body.subjectVersion },
    });
    expect(crDecided.status, JSON.stringify(crDecided.body)).toBe(200);
    await runRecalculation(api, v2.body.id);
    const q1Before = await latestEvaluation(api, kpi.id, q1.id);
    expect([q1Before?.kpi_version_id, q1Before?.final_target]).toEqual([kpi.v1.id, "100.000000"]);

    // The restatement of Q1 with version 2, requested by KDS and approved by the Business Owner.
    const id = await submittedRestatement(kpi.id, v2.body.id, k.s.kds, { changeRequestId: cr.body.id });
    const retained = (await reconciliationOf(api, k, id)).body;
    expect(retained.retained).toBe(true);
    const approved = await decide(api, k, id, { decision: "approve", note: "Synthetic approval" }, 2, k.s.bo);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect([
      approved.body.status,
      approved.body.version,
      approved.body.decidedBy,
      approved.body.authorityRoleCode,
      approved.body.calculationRunId,
    ]).toEqual(["approved", 3, k.users.bo.id, "BO", null]);
    expect(approved.headers.etag).toBe('"3"');
    expect(await outboxOf(id)).toEqual([
      { event_type: "kpi_restatement.approved", idempotency_key: `kpi_restatement.approved:${id}` },
    ]);
    expect((await workItems(id, "kpi_restatement_to_decide")).every((t) => t.status === "done")).toBe(true);
    // Before the run: no offer, Q1 unchanged.
    expect((await reissueOffers(api, k, id, k.s.auditor)).body.items).toEqual([]);
    expect(await latestEvaluation(api, kpi.id, q1.id)).toEqual(q1Before);

    // The event delivered three times: one run (the first), two duplicates.
    const runs = await runRestatementEvents(api, id, 3);
    expect(runs.map((r) => r.outcome)).toEqual(["done", "duplicate", "duplicate"]);
    // A redelivery under another key (a re-published event) finds the run: the run key is the backstop.
    const env = await api.db
      .selectFrom("outbox_event")
      .select(["id", "organization_id", "payload"])
      .where("aggregate_id", "=", id)
      .executeTakeFirstOrThrow();
    const again = await recalculate(
      api.db,
      {
        outboxEventId: env.id,
        eventType: "kpi_restatement.approved",
        schemaVersion: 1,
        idempotencyKey: `synthetic-republish:${id}`,
        organizationId: env.organization_id,
        payload: env.payload as Record<string, unknown>,
      },
      "test-republish",
    );
    expect([again.outcome, again.runId]).toEqual(["already_run", runs[0]!.runId]);
    const runRows = await api.db
      .selectFrom("calculation_run")
      .select(["id", "status", "trigger_record_type", "trigger_slot", "idempotency_key", "evaluation_count"])
      .where("trigger_kind", "=", "restatement_approved")
      .where("trigger_record_id", "=", id)
      .execute();
    expect(runRows.map((r) => [r.status, r.trigger_record_type, r.trigger_slot, r.idempotency_key])).toEqual([
      ["completed", "kpi_restatement", 1, `kpi_restatement:${id}`],
    ]);
    expect(runRows[0]!.evaluation_count).toBe(retained.rows.length);

    // The restatement is applied with its run (one audit event, the service acting on behalf of the decider).
    const applied = await call<Body>(api.app, "GET", `${k.base}/kpi-restatements/${id}`, { session: k.s.auditor });
    expect([applied.body.status, applied.body.calculationRunId, applied.body.version]).toEqual([
      "applied",
      runRows[0]!.id,
      4,
    ]);
    expect(applied.body.appliedAt).not.toBeNull();
    const applyAudit = await api.db
      .selectFrom("audit_event")
      .select(["actor_type", "on_behalf_of_user_id"])
      .where("record_id", "=", id)
      .where("action", "=", "kpi_restatement.apply")
      .execute();
    expect(applyAudit).toEqual([{ actor_type: "service", on_behalf_of_user_id: k.users.bo.id }]);

    // Restated values are current: Q1's latest evaluation is the run's, with version 2, and equals the retained "after".
    const q1After = await latestEvaluation(api, kpi.id, q1.id);
    expect([q1After?.kpi_version_id, q1After?.final_target]).toEqual([v2.body.id, "120.000000"]);
    const runEvals = await api.db
      .selectFrom("kpi_evaluation")
      .selectAll()
      .where("calculation_run_id", "=", runRows[0]!.id)
      .execute();
    for (const row of retained.rows as Body[]) {
      const e = runEvals.find(
        (x) =>
          x.kpi_definition_id === kpi.id &&
          x.reporting_period_id === row.reportingPeriodId &&
          x.scope_id === row.scopeId &&
          x.value_basis === row.valueBasis,
      );
      expect(e, JSON.stringify(row)).toBeDefined();
      expect([
        e!.value_status,
        e!.value_status === "ok" && e!.value !== null ? canonicalDecimal(e!.value) : null,
        e!.calculated_rag,
        e!.final_target === null ? null : canonicalDecimal(e!.final_target),
      ]).toEqual([row.after.valueStatus, row.after.value, row.after.rag, row.after.target]);
    }
    // The pre-restatement evaluation stays readable (append-only): the reconciliation's before row names it.
    expect(retained.rows[0].before.evaluationId).toBe(q1Before?.id);
    expect(
      await api.db.selectFrom("kpi_evaluation").select("id").where("id", "=", q1Before!.id).executeTakeFirst(),
    ).toBeDefined();

    // The issued register is unchanged: content, hash, versions and approval state.
    const v1After = (await call<Body>(api.app, "GET", `${S}/${register.id}`, { session: k.s.auditor })).body;
    expect(v1After).toEqual(v1Before);
    expect((await call<Body>(api.app, "GET", `${S}/${register.id}/versions`, { session: k.s.auditor })).body).toEqual(
      versionsBefore,
    );
    // One offer per affected snapshot: the register (no period) and the Q1 dashboard; the Q2 dashboard has none.
    const offers = (await reissueOffers(api, k, id, k.s.auditor)).body.items as Body[];
    expect(offers.map((o) => o.snapshotId).sort()).toEqual([register.id, dashQ1].sort());
    expect(offers.some((o) => o.snapshotId === dashQ2)).toBe(false);
    // T-DG6-BE-V (ADR-0007 §4a): the offers and the snapshot's pinned versions are cursor-paged. One item per page
    // walks the same list in the same order as one page of 100; a forged cursor value is a 400, never a 500.
    for (const url of [`${k.base}/kpi-restatements/${id}/reissue-offers`, `${S}/${register.id}/versions`]) {
      const whole = (await call<Body>(api.app, "GET", `${url}?limit=100`, { session: k.s.auditor })).body;
      expect([url, whole.items.length >= 2, whole.nextCursor]).toEqual([url, true, null]);
      const stepped: Body[] = [];
      let cursor: string | null = null;
      let firstCursor: string | null = null;
      do {
        const q: string = cursor === null ? "limit=1" : `limit=1&cursor=${cursor}`;
        const page = await call<Body>(api.app, "GET", `${url}?${q}`, { session: k.s.auditor });
        expect([url, page.status]).toEqual([url, 200]);
        stepped.push(...page.body.items);
        cursor = page.body.nextCursor;
        firstCursor ??= cursor;
      } while (cursor !== null && stepped.length <= whole.items.length);
      expect(stepped).toEqual(whole.items);
      const { h, k: keys } = JSON.parse(Buffer.from(firstCursor!, "base64url").toString("utf8")) as Body;
      const forged = Buffer.from(JSON.stringify({ k: keys.map(() => "x'; --"), h })).toString("base64url");
      const refused = await call<Body>(api.app, "GET", `${url}?cursor=${forged}`, { session: k.s.auditor });
      expect([url, refused.status, refused.body.errors?.[0]?.code]).toEqual([url, 400, "validation.cursor"]);
    }
    const registerOffer = offers.find((o) => o.snapshotId === register.id)!;
    expect([registerOffer.definitionCode, registerOffer.issueVersion, registerOffer.periodLabel]).toEqual([
      "registers",
      1,
      null,
    ]);
    expect(offers.find((o) => o.snapshotId === dashQ1)!.periodLabel).toBe(q1.label);
    // One reissue task per series and holder of report.issue (TL holders here), created once.
    const tasks = await workItems(register.id, "report_reissue_offer");
    expect(tasks.map((t) => t.assignee_user_id)).toEqual(expect.arrayContaining([k.users.tl.id, k.users.finTl.id]));
    expect(new Set(tasks.map((t) => t.dedupe_key)).size).toBe(tasks.length);
    expect(tasks.every((t) => t.dedupe_key === `report_reissue_offer:${id}:${register.id}:${t.assignee_user_id}`)).toBe(
      true,
    );
    expect(await workItems(dashQ2, "report_reissue_offer")).toEqual([]);
    const offerRows = await api.db
      .selectFrom("kpi_restatement_reissue_offer")
      .select("id")
      .where("restatement_id", "=", id)
      .execute();
    expect(offerRows.length).toBe(2);

    // A person reissues the register: reissue + issue gives issue version 2; v1 is superseded, its content unchanged.
    const re = await call<Body>(api.app, "POST", `${S}/${register.id}/reissue`, {
      session: k.s.tl,
      headers: ifMatch(v1After.version),
      body: { reason: "Synthetic: Q1 restated" },
    });
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    const issued2 = await call<Body>(api.app, "POST", `${S}/${re.body.id}/issue`, {
      session: k.s.tl,
      headers: ifMatch(re.body.version),
      body: { note: "Synthetic reissue after the Q1 restatement" },
    });
    expect([issued2.status, issued2.body.issueVersion, issued2.body.seriesId]).toEqual([200, 2, register.seriesId]);
    const v1Final = (await call<Body>(api.app, "GET", `${S}/${register.id}`, { session: k.s.auditor })).body;
    expect([v1Final.status, v1Final.issueVersion]).toEqual(["superseded", 1]);
    expect([v1Final.content, v1Final.contentSha256, v1Final.approvalState]).toEqual([
      v1Before.content,
      v1Before.contentSha256,
      v1Before.approvalState,
    ]);
    // The superseded v1 is still listed as offered, with its current state.
    const finalOffers = (await reissueOffers(api, k, id, k.s.auditor)).body.items as Body[];
    expect(finalOffers.find((o) => o.snapshotId === register.id)!.snapshotStatus).toBe("superseded");
  });
});

describe("the restatement run of a formula KPI (D-156 g)", () => {
  it("binds each input to its source's latest stored evaluation, on the input's basis; applied values equal the retained after values", async () => {
    const formula = sharedQ1.formula!;
    const source = sharedQ1.formulaSource!;
    const sourceEval = await latestEvaluation(api, source.id, q1.id);
    expect([sourceEval?.value, sourceEval?.value_status]).toEqual(["21.000000", "ok"]);
    const id = await submittedRestatement(formula.id, formula.v1.id, k.s.kds);
    const retained = (await reconciliationOf(api, k, id)).body.rows as Body[];
    expect(retained.map((r) => [r.valueBasis, r.after.value, r.after.valueStatus])).toEqual([
      ["period", "42", "ok"],
      ["cumulative", "42", "ok"],
    ]);
    expect((await decide(api, k, id, { decision: "approve" }, 2, k.s.sp)).status).toBe(200);
    const [run] = await runRestatementEvents(api, id);
    expect(run!.outcome).toBe("done");
    const evals = await api.db
      .selectFrom("kpi_evaluation")
      .selectAll()
      .where("calculation_run_id", "=", run!.runId!)
      .where("kpi_definition_id", "=", formula.id)
      .orderBy("value_basis", "desc")
      .execute();
    expect(evals.map((e) => [e.value_basis, canonicalDecimal(e.value!), e.value_status, e.kpi_version_id])).toEqual(
      retained.map((r) => [r.valueBasis, r.after.value, r.after.valueStatus, formula.v1.id]),
    );
    // The lineage names the bound source evaluation: its version, how it was valued and its value.
    const inputs = evals[0]!.inputs as Body;
    expect([
      inputs.sources.a.kpiDefinitionId,
      inputs.sources.a.kpiVersionId,
      inputs.sources.a.valueSource,
      inputs.sources.a.value,
    ]).toEqual([source.id, source.v1.id, "entered", "21.000000"]);
    // The source itself is not restated: its latest evaluation is the one bound.
    expect(await latestEvaluation(api, source.id, q1.id)).toEqual(sourceEval);
  });
});

describe("decideKpiRestatement: the shared mutation rules", () => {
  it("AUD 403; If-Match 428/409; 404; one audit event per decision; commit-time re-authorization writes nothing", async () => {
    const kpi = sharedQ1.rules!;
    const id = await submittedRestatement(kpi.id, kpi.v1.id, k.s.kds);
    const approve = { decision: "approve" };
    expect((await decide(api, k, id, approve, 2, k.s.auditor)).status).toBe(403);
    const missingIfMatch = await decide(api, k, id, approve, null, k.s.bo);
    expect([missingIfMatch.status, missingIfMatch.body.code]).toEqual([428, "precondition_required"]);
    const stale = await decide(api, k, id, approve, 1, k.s.bo);
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    expect((await decide(api, k, crypto.randomUUID(), approve, 2, k.s.bo)).status).toBe(404);
    expect((await decide(api, k, id, { decision: "approve", extra: 1 }, 2, k.s.bo)).status).toBe(400);
    // A Business Owner whose grant is revoked while the request waits gets 403, and nothing is written.
    const bo = await freshUser(api, k, w.orgA.id, w.grantor.id, "BO");
    const late = await afterIdentity(
      api,
      bo.id,
      () => decide(api, k, id, approve, 2, bo.session),
      () => revokeAll(api, w.grantor.id, bo.id),
    );
    expect(late.status).toBe(403);
    const still = await restatementRow(id);
    expect([still.status, still.version, still.decided_by]).toEqual(["submitted", 2, null]);
    expect(await outboxOf(id)).toEqual([]);
    // The decision: exactly one kpi_restatement.decide event, with the decision's changes.
    const ok = await decide(api, k, id, approve, 2, k.s.bo);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(await restatementAudit(id)).toEqual([
      "kpi_restatement.create",
      "kpi_restatement.submit",
      "kpi_restatement.decide",
    ]);
    const event = await api.db
      .selectFrom("audit_event")
      .select(["actor_user_id", "prior_version", "new_version", "changes"])
      .where("record_id", "=", id)
      .where("action", "=", "kpi_restatement.decide")
      .executeTakeFirstOrThrow();
    expect([event.actor_user_id, event.prior_version, event.new_version]).toEqual([k.users.bo.id, 2, 3]);
    expect((event.changes as Body).status).toEqual({ from: "submitted", to: "approved" });
    // A decision tolerates no second decider: the restatement is no longer submitted.
    expect((await decide(api, k, id, approve, 3, k.s.fin)).body.code).toBe("kpi_restatement.not_submitted");
    // Apply it, so the KPI has no restatement in progress afterwards.
    expect((await runRestatementEvents(api, id)).map((r) => r.outcome)).toEqual(["done"]);
    expect((await restatementRow(id)).status).toBe("applied");
  });
});
