// A11 "Adoption and sustainment", part 3: accepted handover creates recurring BAU tasks, and BAU outlives the
// transformation (qa-verifier, T-DG4-QA-C). ONE synthetic transformation is taken natively through the real API from
// creation to closure (QA-B's gates-native support: G1-G5 passed by a Lead submitting and a Sponsor approving, each
// missing criterion covered by an accepted exception); its G6 is then earned with real sustainment records. Assertions
// are derived from the acceptance text of the requirement row named in each title (docs/delivery/requirements.csv) and
// docs/api/openapi.yaml:
//  - REQ-S11-005: a handover missing data access is refused; acceptance by anyone other than the receiving owner is 403;
//  - REQ-PB-021, REQ-S04-008: G6 submission without an accepted BAU handover is refused listing 'Ownership transfer';
//  - REQ-PB-083: accepting a handover creates recurring BAU review tasks for the BAU owner exactly once;
//  - REQ-PB-084: CI items remain visible after closure; G6 lists the backlog;
//  - REQ-S03-002, REQ-S11-004: after the transformation is closed its performance area still generates the next
//    scheduled review on time and accepts KPI actuals;
//  - REQ-S11-008, REQ-S12-016: a failed control check creates one owned recovery action with a follow-up date; a lesson
//    is searchable from another transformation;
//  - REQ-S11-009: after reopening, the original handover acceptance and the closure date are unchanged;
//  - REQ-PB-020: G5 is reached and decided natively (the G5 refusal texts themselves are QA-B's A08 suite).
// The worker functions used are the exported production job functions (the daily scans with an explicit business date,
// and the corrective consumer given the relay's envelope of the real outbox row).
// All data is SYNTHETIC. Every gate, exception, handover, transition and approval decision is a synthetic in-product
// business action by a test person on test data. It approves nothing real; product G6 never implies DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  coverWithException,
  gateView,
  nativePerson,
  passGatesNatively,
  plusDays,
  RATIONALE,
  seedNativeGateWorld,
  submitGate,
  decideGate,
  type NativeGateWorld,
  type Person,
} from "../support/gates-native.ts";
import {
  ensureDefaultCalendar,
  expectCode,
  get200,
  ifMatch,
  monthlyPeriod,
  seedWorld,
  type Body,
  type World,
} from "../support/p4.ts";
import {
  businessToday,
  envelopesOf,
  fullContent,
  handleControlCheckFailed,
  runControlCheckScan,
  runReviewScan,
} from "../support/a11.ts";

let api: TestApi;
let w: World;
let g: NativeGateWorld;
let today: string;
let kds: Person;
let bo2: Person;
let admin: Session;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

// Records shared by the serial steps below.
let area: Body;
let controlId: string;
let kpiId: string;
let handover: Body;
let ciItem: Body;
let closure: Body;
const G6_NATIVE = ["g6.benefits_evidence", "g6.ownership_transfer", "g6.controls", "g6.improvement_backlog"];

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  g = await seedNativeGateWorld(api, w, "A11 BAU");
  today = await businessToday(api, g.organizationId);
  admin = await signIn(api.app, w.admin.subject);
  kds = await nativePerson(api, w, admin, g.transformationId, "KDS");
  bo2 = await nativePerson(api, w, admin, g.transformationId, "BO");
  // The organization's default business calendar (working-day follow-up dates; created by the technical admin).
  await ensureDefaultCalendar(api, w);
  // The Lead makes the transformation active (TransformationUpdate.status), as a business user starts it.
  const t = await get200(api, g.tl.session, g.base);
  const activated = await send("PATCH", g.base, {
    session: g.tl.session,
    headers: ifMatch(t.version),
    body: { status: "active" },
  });
  expect(activated.status, JSON.stringify(activated.body)).toBe(200);
  await passGatesNatively(api, g, ["G1", "G2", "G3", "G4"], plusDays(today, 120));
  // G5 natively: every missing criterion covered by an accepted exception, submitted by the Lead and approved by the
  // configured approver with the scale scope its approval must record.
  const ini = await send("POST", "/api/v1/initiatives", {
    session: g.tl.session,
    body: { transformationId: g.transformationId, name: "Synthetic QA A11 pilot" },
  });
  expect(ini.status, JSON.stringify(ini.body)).toBe(201);
  const missing = ((await gateView(api, g, "G5")).criteria as Body[]).filter(
    (c) => c.mandatory && c.completeness !== "complete",
  );
  for (const c of missing) await coverWithException(api, g, "G5", c.key, plusDays(today, 120));
  const sub5 = await submitGate(api, g, "G5");
  expect(sub5.status, JSON.stringify(sub5.body)).toBe(201);
  const d5 = await decideGate(api, g, "G5", g.sp.session, {
    submissionNo: sub5.body.submissionNo,
    outcome: "approved",
    rationale: "Synthetic QA: pilot results justify scaling to BU a1 only (approves nothing real).",
    scaleScope: { items: [{ initiativeId: ini.body.id, businessUnitId: w.a1, note: "Synthetic QA pilot BU" }] },
  });
  expect(d5.status, JSON.stringify(d5.body)).toBe(201);
}, 300_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const criterion = async (key: string) => {
  const v = await gateView(api, g, "G6");
  return (v.criteria as Body[]).find((c) => c.key === key)!;
};
const reviewsOf = (areaId: string) =>
  api.db
    .selectFrom("sustainment_review")
    .select(["id", "assignee_user_id", "due_date", "status"])
    .where("performance_area_id", "=", areaId)
    .orderBy("due_date")
    .execute();
const myWork = async (session: Session) =>
  (await get200(api, session, `/api/v1/me/work-items?limit=100&transformationId=${g.transformationId}`))
    .items as Body[];

describe("A11 BAU and sustainment on a natively governed transformation", () => {
  it("REQ-PB-020: G1-G5 were passed natively; the transformation is in Realize and G6 is still Draft", async () => {
    const t = await get200(api, g.auditor.session, g.base);
    expect(t.currentPhase).toBe("realize");
    for (const code of ["G1", "G2", "G3", "G4", "G5"])
      expect((await gateView(api, g, code)).gate.status).toBe("approved");
    expect((await gateView(api, g, "G6")).gate.status).toBe("draft");
  });

  it("setup: a performance area with a linked KPI and an ownerless control, created through the API", async () => {
    const a = await send("POST", `${g.base}/performance-areas`, {
      session: g.bo.session,
      body: { name: "Synthetic QA prepaid churn performance", reviewFrequency: "monthly", reviewInterval: 1 },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    area = a.body;
    const def = await send("POST", `${g.base}/kpi-definitions`, {
      session: kds.session,
      body: {
        name: "Synthetic QA monthly churned lines",
        unitKind: "count",
        unitLabel: "lines",
        polarity: "lower_is_better",
        frequency: "monthly",
        ownerUserId: kds.id,
      },
    });
    expect(def.status, JSON.stringify(def.body)).toBe(201);
    const act = await send("POST", `${g.base}/kpi-definitions/${def.body.id}/activate`, {
      session: kds.session,
      headers: ifMatch(def.body.version),
    });
    expect(act.status, JSON.stringify(act.body)).toBe(200);
    const v = await send("POST", `${g.base}/kpi-definitions/${def.body.id}/versions`, {
      session: kds.session,
      body: {
        measureType: "lower_is_better",
        valueNature: "flow",
        aggregationRule: "sum",
        submissionRoute: "direct_accept",
      },
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const va = await send("POST", `${g.base}/kpi-versions/${v.body.id}/activate`, {
      session: kds.session,
      headers: ifMatch(v.body.version),
    });
    expect(va.status, JSON.stringify(va.body)).toBe(200);
    kpiId = def.body.id;
    const link = await send("POST", `${g.base}/performance-areas/${area.id}/links`, {
      session: g.bo.session,
      body: { linkKind: "kpi", kpiDefinitionId: kpiId },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const c = await send("POST", `${g.base}/controls`, {
      session: g.bo.session,
      body: { performanceAreaId: area.id, name: "Synthetic QA monthly churn reconciliation", frequency: "monthly" },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    controlId = c.body.id;
  });

  it("REQ-S11-005: a handover missing data access is refused (422 naming data access); nothing changes", async () => {
    const { dataAccess: _omitted, ...withoutDataAccess } = fullContent(kds.id);
    const h = await send("POST", `${g.base}/bau-handovers`, {
      session: g.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: g.bo.id, ...withoutDataAccess },
    });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    handover = h.body;
    const ev = await send("POST", `${g.base}/evidence`, {
      session: g.wl.session,
      body: { kind: "note", title: "Synthetic QA SOP sign-off", noteBody: "Synthetic SOP v1", ownerUserId: g.wl.id },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const withEv = await send("POST", `${g.base}/bau-handovers/${handover.id}/evidence`, {
      session: g.wl.session,
      headers: ifMatch(handover.version),
      body: { evidenceId: ev.body.id },
    });
    expect(withEv.status, JSON.stringify(withEv.body)).toBe(201);
    const refused = await send("POST", `${g.base}/bau-handovers/${handover.id}/submit`, {
      session: g.wl.session,
      headers: ifMatch(withEv.body.version),
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(String(refused.body.detail).toLowerCase()).toContain("data access");
    expect((refused.body.errors as Body[]).map((e) => e.pointer)).toEqual(["/dataAccess"]);
    const read = await get200(api, g.auditor.session, `${g.base}/bau-handovers/${handover.id}`);
    expect([read.status, read.version]).toEqual(["draft", withEv.body.version]);
    // Supplying data access makes it submittable.
    const fixed = await send("PATCH", `${g.base}/bau-handovers/${handover.id}`, {
      session: g.wl.session,
      headers: ifMatch(read.version),
      body: { dataAccess: "Synthetic QA: read access to the churn mart granted" },
    });
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    const sub = await send("POST", `${g.base}/bau-handovers/${handover.id}/submit`, {
      session: g.wl.session,
      headers: ifMatch(fixed.body.version),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    handover = sub.body;
  });

  it("REQ-PB-021, REQ-S04-008: G6 without an accepted BAU handover is refused, listing 'Ownership transfer'", async () => {
    const own = await criterion("g6.ownership_transfer");
    expect([own.labelEn, own.completeness]).toEqual(["Ownership transfer", "incomplete"]);
    const res = await submitGate(api, g, "G6");
    expectCode(res, 422, "gate_criteria_incomplete");
    expect(String(res.body.detail)).toContain("Ownership transfer");
    expect((await gateView(api, g, "G6")).gate.status).toBe("draft");
  });

  it("REQ-S11-005: acceptance by anyone other than the receiving owner is 403; nothing is accepted", async () => {
    for (const p of [bo2, g.sp, g.tl, g.wl, g.to, g.auditor]) {
      const r = await send("POST", `${g.base}/bau-handovers/${handover.id}/accept`, {
        session: p.session,
        headers: ifMatch(handover.version),
        body: {},
      });
      expect(r.status, `${p.id}: ${JSON.stringify(r.body)}`).toBe(403);
    }
    // Another holder of the acceptance permission (a second Business Owner) is refused as not the receiving owner
    // (the contract's 403 code for acceptBauHandover).
    const other = await send("POST", `${g.base}/bau-handovers/${handover.id}/accept`, {
      session: bo2.session,
      headers: ifMatch(handover.version),
      body: {},
    });
    expectCode(other, 403, "bau_handover.not_receiving_owner");
    const read = await get200(api, g.auditor.session, `${g.base}/bau-handovers/${handover.id}`);
    expect([read.status, read.version]).toEqual(["submitted", handover.version]);
    expect(await reviewsOf(area.id)).toEqual([]);
  });

  it("REQ-PB-083: the receiving owner's acceptance creates the BAU review task for the BAU owner exactly once", async () => {
    const acc = await send("POST", `${g.base}/bau-handovers/${handover.id}/accept`, {
      session: g.bo.session,
      headers: ifMatch(handover.version),
      body: { note: "Synthetic QA: accepted into BAU" },
    });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    handover = acc.body;
    expect([handover.status, handover.acceptedBy]).toEqual(["accepted", g.bo.id]);
    const a = await get200(api, g.auditor.session, `${g.base}/performance-areas/${area.id}`);
    expect([a.status, a.bauOwnerUserId]).toEqual(["bau", g.bo.id]);
    expect(typeof a.nextReviewDate).toBe("string");
    area = a;
    const reviews = await reviewsOf(area.id);
    expect(reviews.map((r) => [r.assignee_user_id, String(r.due_date).slice(0, 10)])).toEqual([
      [g.bo.id, a.nextReviewDate],
    ]);
    const tasks = (await myWork(g.bo.session)).filter((i) => i.subjectId === reviews[0]!.id);
    expect(tasks).toHaveLength(1);
    // Exactly once: a repeated acceptance is refused and the daily scan for today creates no second task.
    const again = await send("POST", `${g.base}/bau-handovers/${handover.id}/accept`, {
      session: g.bo.session,
      headers: ifMatch(handover.version),
      body: {},
    });
    expect(again.status).toBe(422);
    await runReviewScan(api.db, "qa-a11-review-scan-today", { asOf: today, organizationId: g.organizationId });
    expect(await reviewsOf(area.id)).toHaveLength(1);
    expect((await myWork(g.bo.session)).filter((i) => i.subjectId === reviews[0]!.id)).toHaveLength(1);
  });

  it("REQ-PB-083 'recurring': the scan at the review's window schedules the following review, once", async () => {
    const first = area.nextReviewDate as string;
    // The scan run inside the first review's 7-day window advances the schedule (the first review already exists).
    await runReviewScan(api.db, "qa-a11-review-scan-1", {
      asOf: plusDays(first, -7),
      organizationId: g.organizationId,
    });
    await runReviewScan(api.db, "qa-a11-review-scan-1b", {
      asOf: plusDays(first, -7),
      organizationId: g.organizationId,
    });
    const reviews = await reviewsOf(area.id);
    expect(reviews.map((r) => String(r.due_date).slice(0, 10))).toEqual([first]);
    const a = await get200(api, g.auditor.session, `${g.base}/performance-areas/${area.id}`);
    expect(a.nextReviewDate > first).toBe(true);
    area = a;
  });

  it("REQ-PB-084: G6 lists the continuous-improvement backlog; an item makes the criterion complete", async () => {
    expect((await criterion("g6.improvement_backlog")).completeness).toBe("incomplete");
    const ci = await send("POST", `${g.base}/improvement-items`, {
      session: g.bo.session,
      body: {
        title: "Synthetic QA: automate the reconciliation extract",
        sourceKind: "manual",
        performanceAreaId: area.id,
        ownerUserId: g.bo.id,
        priority: "M",
      },
    });
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    ciItem = ci.body;
    expect((await criterion("g6.improvement_backlog")).completeness).toBe("complete");
    expect((await criterion("g6.ownership_transfer")).completeness).toBe("complete");
    expect((await criterion("g6.controls")).completeness).toBe("complete");
  });

  it("setup: benefits evidence through an approved transition decision (BO proposes, the Sponsor decides)", async () => {
    const bf = await send("POST", `${g.base}/benefits`, {
      session: g.bo.session,
      body: {
        title: "Synthetic QA churn reduction",
        description: "Lower churn on the synthetic prepaid base.",
        benefitType: "revenue",
        valueClass: "revenue_uplift",
        ownerUserId: g.bo.id,
        currency: "SAR",
        financialStatementLine: "Revenue - prepaid",
      },
    });
    expect(bf.status, JSON.stringify(bf.body)).toBe(201);
    const td = await send("POST", `${g.base}/transition-decisions`, {
      session: g.bo.session,
      body: {
        benefitId: bf.body.id,
        residualOwnerUserId: g.bo.id,
        rationale: "Synthetic QA: the churn benefit realizes over 18 months after delivery",
        expectedRealizationEnd: plusDays(today, 540),
        monitoringFrequency: "quarterly",
        firstMonitoringDate: plusDays(today, 60),
      },
    });
    expect(td.status, JSON.stringify(td.body)).toBe(201);
    const sub = await send("POST", `${g.base}/transition-decisions/${td.body.id}/submit`, {
      session: g.bo.session,
      headers: ifMatch(td.body.version),
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    const ap = await get200(api, g.sp.session, `/api/v1/approvals/${sub.body.approvalId}`);
    const d = await send("POST", `/api/v1/approvals/${sub.body.approvalId}/decisions`, {
      session: g.sp.session,
      headers: ifMatch(ap.version),
      body: { outcome: "approve", rationale: RATIONALE, subjectVersion: ap.subjectVersion },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect((await criterion("g6.benefits_evidence")).completeness).toBe("complete");
  });

  it("REQ-PB-084, REQ-S04-008: the G6 submission snapshot lists the backlog item; G6 is approved; no DG record is named", async () => {
    const v = await gateView(api, g, "G6");
    for (const c of v.criteria as Body[])
      if (c.mandatory && c.completeness !== "complete") {
        // Criteria outside the four sustainment ones (e.g. document evidence) are covered by an accepted exception.
        expect(G6_NATIVE).not.toContain(c.key);
        await coverWithException(api, g, "G6", c.key, plusDays(today, 60));
      }
    const sub = await submitGate(api, g, "G6");
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const snap = JSON.stringify(sub.body.snapshot ?? sub.body);
    expect(snap).toContain(ciItem.id);
    expect(snap).toContain(handover.id);
    const d = await decideGate(api, g, "G6", g.sp.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "approved",
      rationale: "Synthetic QA G6 approval (a product business approval of test data only).",
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(JSON.stringify(d.body)).not.toMatch(/\bDG[0-7]\b/);
  });

  it("setup: the transformation is closed through the governed closure (TL)", async () => {
    const r = await send("POST", `${g.base}/close`, { session: g.tl.session, body: { note: "Synthetic QA closure" } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    closure = r.body;
    const t = await get200(api, g.auditor.session, `${g.base}/status-model`);
    expect(t.closureState).toBe("closed");
    expect(t.label).not.toMatch(/success/i);
  });

  it("REQ-PB-084: after closure the CI backlog item is still listed and readable", async () => {
    const list = await get200(api, g.auditor.session, `${g.base}/improvement-items?limit=100`);
    expect((list.items as Body[]).map((x) => x.id)).toContain(ciItem.id);
    const one = await get200(api, g.bo.session, `${g.base}/improvement-items?performanceAreaId=${area.id}`);
    expect((one.items as Body[]).map((x) => [x.id, x.title])).toContainEqual([ciItem.id, ciItem.title]);
  });

  it("REQ-S11-004, REQ-S03-002: after closure the next scheduled review task is created on time for the BAU owner", async () => {
    const due = area.nextReviewDate as string;
    // One day before the 7-day window: nothing yet (not early).
    await runReviewScan(api.db, "qa-a11-after-closure-early", {
      asOf: plusDays(due, -8),
      organizationId: g.organizationId,
    });
    expect((await reviewsOf(area.id)).map((r) => String(r.due_date).slice(0, 10))).not.toContain(due);
    // The day the window opens: created, for the BAU owner, with its My Work task (on time).
    await runReviewScan(api.db, "qa-a11-after-closure", { asOf: plusDays(due, -7), organizationId: g.organizationId });
    const created = (await reviewsOf(area.id)).filter((r) => String(r.due_date).slice(0, 10) === due);
    expect(created.map((r) => r.assignee_user_id)).toEqual([g.bo.id]);
    const task = (await myWork(g.bo.session)).filter((i) => i.subjectId === created[0]!.id);
    expect(task.map((t) => t.dueDate)).toEqual([due]);
    const t = await get200(api, g.auditor.session, g.base);
    expect(t.status).toBe("closed");
  });

  it("REQ-S03-002: after closure the area's KPI still accepts an actual", async () => {
    const p = await monthlyPeriod(api, w);
    const r = await send("POST", `${g.base}/kpi-definitions/${kpiId}/actuals`, {
      session: kds.session,
      body: {
        scopeKind: "transformation",
        scopeId: g.transformationId,
        action: "submit",
        reportingPeriodId: p.id,
        value: "1200",
        dataAsOf: p.end,
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.actual.status).toBe("accepted");
  });

  it("REQ-S11-008, REQ-S12-016: a failed control check creates exactly one owned recovery action with a follow-up date", async () => {
    const control = await api.db
      .selectFrom("control")
      .select(["next_check_date", "owner_user_id"])
      .where("id", "=", controlId)
      .executeTakeFirstOrThrow();
    // The ownerless control went to the receiving owner with the handover.
    expect(control.owner_user_id).toBe(g.bo.id);
    const dueDate = String(control.next_check_date).slice(0, 10);
    await runControlCheckScan(api.db, "qa-a11-control-scan", {
      asOf: plusDays(dueDate, -7),
      organizationId: g.organizationId,
    });
    const checks = await get200(api, g.bo.session, `${g.base}/control-checks?performanceAreaId=${area.id}`);
    const check = (checks.items as Body[]).find((c) => c.controlId === controlId && c.status === "due");
    expect(check, JSON.stringify(checks.body)).toBeTruthy();
    const rec = await send("POST", `${g.base}/control-checks/${check.id}/record`, {
      session: g.bo.session,
      headers: ifMatch(check.version),
      body: { result: "failed", resultNote: "Synthetic QA: 312 lines unreconciled" },
    });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    const cases = async () =>
      ((await get200(api, g.auditor.session, `${g.base}/corrective-actions?limit=100`)).items as Body[]).filter(
        (c) => c.sourceRecordId === check.id,
      );
    expect(await cases()).toEqual([]);
    const [env] = await envelopesOf(api, check.id, "control_check.failed");
    await handleControlCheckFailed(api.db, env!, "qa-a11-control-failed");
    await handleControlCheckFailed(api.db, env!, "qa-a11-control-failed-redelivery");
    const one = await cases();
    expect(one).toHaveLength(1);
    expect(one[0].ownerUserId).toBe(g.bo.id);
    expect(typeof one[0].followUpDate).toBe("string");
    const items = (await myWork(g.bo.session)).filter((i) => i.subjectId === one[0].id);
    expect(items.map((i) => i.dueDate)).toEqual([one[0].followUpDate]);
  });

  it("REQ-S11-008: a lesson published here is searchable by a user of another transformation", async () => {
    const word = `qa${g.transformationId.replace(/-/g, "").slice(-8)}`;
    const l = await send("POST", `${g.base}/lessons`, {
      session: g.bo.session,
      body: {
        title: `Synthetic QA ${word} reconciliation lesson`,
        lessonText: "Synthetic QA: reconcile churn monthly before the board pack.",
        tags: ["churn"],
        performanceAreaId: area.id,
      },
    });
    expect(l.status, JSON.stringify(l.body)).toBe(201);
    const pub = await send("POST", `${g.base}/lessons/${l.body.id}/publish`, {
      session: g.bo.session,
      headers: ifMatch(l.body.version),
    });
    expect(pub.status, JSON.stringify(pub.body)).toBe(200);
    // Another transformation of the same business unit, created by the Lead; a person granted only there.
    const t2 = await send("POST", "/api/v1/transformations", {
      session: g.tl.session,
      body: { businessUnitId: w.a1, name: "Synthetic QA A11 second transformation", mode: "end_to_end" },
    });
    expect(t2.status, JSON.stringify(t2.body)).toBe(201);
    const reader = await nativePerson(api, w, admin, t2.body.id, "BO");
    const hit = await get200(api, reader.session, `/api/v1/lessons/search?q=${word}`);
    expect((hit.items as Body[]).map((h) => h.lesson.id)).toEqual([l.body.id]);
  });

  it("REQ-S11-009: after reopening, the original handover acceptance and the closure date are unchanged", async () => {
    const before = await get200(api, g.auditor.session, `${g.base}/bau-handovers/${handover.id}`);
    const closuresBefore = await get200(api, g.auditor.session, `${g.base}/closure-records`);
    const a = await get200(api, g.auditor.session, `${g.base}/performance-areas/${area.id}`);
    const r = await send("POST", `${g.base}/performance-areas/${area.id}/reopen`, {
      session: g.tl.session,
      headers: ifMatch(a.version),
      body: { reason: "Synthetic QA: churn deteriorated for two months" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe("reopened");
    const after = await get200(api, g.auditor.session, `${g.base}/bau-handovers/${handover.id}`);
    expect([after.status, after.acceptedAt, after.acceptedBy, after.version]).toEqual([
      "accepted",
      before.acceptedAt,
      before.acceptedBy,
      before.version,
    ]);
    const closuresAfter = await get200(api, g.auditor.session, `${g.base}/closure-records`);
    expect(closuresAfter).toEqual(closuresBefore);
    expect((closuresAfter.items as Body[]).map((c) => c.closedAt)).toContain(closure.closedAt);
    const read = await get200(api, g.auditor.session, `${g.base}/performance-areas/${area.id}`);
    expect(read.cycles).toHaveLength(2);
    expect(read.cycles[0]).toEqual(a.cycles[0]);
    expect(read.cycles[1]).toMatchObject({
      priorHandoverId: handover.id,
      priorHandoverAcceptedAt: before.acceptedAt,
      priorClosedAt: closure.closedAt,
    });
  });
});
