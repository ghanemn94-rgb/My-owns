// The meeting-minutes, executive-dashboard, handover and meeting-pack assemblers (T-DG5-KBE-D2; ADR-0045 §1, §3, §5,
// §7; p5-work-split §F.4). Proves, against the run's disposable PostgreSQL:
//  - REQ-S13-004: each of the four generates from a seeded transformation (with its meeting or handover) and contains
//    the transformation's ID and the records: each table holds exactly the rows of the DG4 route the screen reads, in
//    that route's order, and the records are the snapshot's source rows with their versions;
//  - the executive dashboard needs a period (422 report.period_required without one) and shows Unknown and Stale
//    values with no number (never 0, never a green RAG); its areas and items are exactly GET …/dashboard?periodId=;
//  - the meeting pack lists the agenda items with their linked decisions and asks (a T16 decision linked by a published
//    executive ask, and a draft brief with its missing elements); the live view is the same assembly and follows a
//    change of the linked decision, while a generated snapshot keeps its content;
//  - approval states as ADR-0045 §3 lists them: minutes pending then approved; handover not_submitted, pending,
//    changes_requested, approved; the dashboard and the pack not_applicable.
// All data is SYNTHETIC. Approving minutes and accepting a handover are in-product record steps on test data and
// approve nothing real; product gates G1-G6 are business approvals inside the product; nothing touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import { ifm } from "../../support/p2-fixtures.ts";
import { ensureDefaultCalendar } from "../approvals/approval-world.ts";
import { seedSustainmentWorld, type SustainmentWorld } from "../contract/p4-exercises-be-i.ts";
import { openPeriod, riyadhToday } from "../contract/p4-exercises-kbe-g.ts";
import { setupMeetingWorld, type MeetingWorld } from "../governance/meeting-fixtures.ts";
import type { KpiWorld } from "../kpi/fixtures.ts";
import { DIRECT_FLOW, ownedKpi, runRecalculation, submitActual } from "../kpi-p4/kbe-c-fixtures.ts";
import {
  cell,
  draftHandover,
  field,
  generated,
  ok,
  richMeetings,
  rowIds,
  section,
  type Body,
  type RichMeetings,
} from "./kbe-d2-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let m: RichMeetings;
let s: SustainmentWorld;
const send = (method: string, url: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, method, url, o);
const get = async (url: string, session: Session): Promise<Body> => ok(await send("GET", url, { session }), 200, url);
const sourceKeys = (snap: Body): string[] => snap.sources?.map((r: Body) => `${r.recordType}:${r.recordId}`) ?? [];

async function sourcesOf(t: string, snapshotId: string, session: Session): Promise<Body[]> {
  const r = await get(`/api/v1/transformations/${t}/report-snapshots/${snapshotId}/sources?limit=100`, session);
  return r.items;
}

/** Every report value in a document: Unknown and Stale never carry a number. */
function values(doc: Body, out: Body[] = []): Body[] {
  if (Array.isArray(doc)) for (const v of doc) values(v, out);
  else if (doc !== null && typeof doc === "object") {
    if ("validation" in doc && "type" in doc && "value" in doc) out.push(doc);
    for (const v of Object.values(doc)) values(v, out);
  }
  return out;
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  m = await richMeetings(api, x);
  s = await seedSustainmentWorld(api, w);
}, 180_000);
afterAll(() => api.close());

describe("meeting_minutes (REQ-S13-004; ADR-0045 §3)", () => {
  it("contains the transformation, the meeting and every record of the DG4 meeting routes; pending, then approved", async () => {
    const T = x.transformationId;
    const url = m.review.url;
    const before = await generated(api, T, "meeting_minutes", x.lead.session, { subjectId: m.review.id });
    expect([before.subjectType, before.subjectId, before.approvalState]).toEqual(["meeting", m.review.id, "pending"]);
    expect(before.content.subject).toMatchObject({ type: "meeting", id: m.review.id });
    expect(field(section(before, "minutes"), "minutes_state")).toMatchObject({
      value: "draft",
      labelKey: "report.meeting_minutes.minutes_state.draft",
    });

    const approved = ok(
      await send("POST", `${url}/minutes/approve`, { session: x.lead.session, headers: ifm(1) }),
      200,
      "approve",
    );
    const snap = await generated(api, T, "meeting_minutes", x.lead.session, { subjectId: m.review.id });
    expect(snap.approvalState).toBe("approved");

    const meeting = await get(url, x.auditor.session);
    const meetingSec = section(snap, "meeting");
    expect(field(meetingSec, "status")).toMatchObject({
      value: meeting.status,
      labelKey: `report.meeting_status.${meeting.status}`,
    });
    expect(field(meetingSec, "scheduled_date").value).toBe(meeting.scheduledDate);
    expect(field(meetingSec, "present_count").value).toBe(meeting.presentCount);
    const minutes = section(snap, "minutes");
    expect(field(minutes, "minutes_state").value).toBe("approved");
    expect(field(minutes, "body")).toMatchObject({ type: "text", authored: "user", value: approved.body });

    // Each table holds exactly the rows of its DG4 route, in its order.
    const attendance = await get(`${url}/attendance`, x.auditor.session);
    expect(rowIds(section(snap, "attendance"))).toEqual(attendance.items.map((a: Body) => a.id));
    const att = section(snap, "attendance");
    expect(att.rows.map((r: Body) => cell(att, r, "attendance").value)).toEqual(
      attendance.items.map((a: Body) => a.attendance),
    );
    const agenda = await get(`${url}/agenda-items`, x.auditor.session);
    expect(rowIds(section(snap, "agenda"))).toEqual(agenda.items.map((a: Body) => a.id));
    const outputs = await get(`${url}/outputs`, x.auditor.session);
    expect(rowIds(section(snap, "outputs"))).toEqual(outputs.items.map((o: Body) => o.id));
    expect(outputs.items.length).toBe(1);
    const actions = await get(`${url}/actions`, x.auditor.session);
    expect(rowIds(section(snap, "actions"))).toEqual(actions.items.map((a: Body) => a.actionItemId));
    expect(rowIds(section(snap, "actions"))).toEqual([m.review.actionId]);

    // The records are the snapshot's source rows, each once, with its version at the as-of instant.
    const sources = await sourcesOf(T, snap.id, x.auditor.session);
    const keys = sources.map((r: Body) => `${r.recordType}:${r.recordId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        `meeting:${m.review.id}`,
        `meeting_minutes:${m.review.minutesId}`,
        `agenda_item:${m.review.agendaItemId}`,
        `action_item:${m.review.actionId}`,
        ...attendance.items.map((a: Body) => `meeting_attendance:${a.id}`),
        ...outputs.items.map((o: Body) => `meeting_output:${o.id}`),
      ]),
    );
    expect(sources.find((r: Body) => r.recordType === "meeting_minutes")).toMatchObject({
      recordVersion: approved.version,
      approvalState: "approved",
    });
    expect(sources.find((r: Body) => r.recordType === "meeting")).toMatchObject({ recordVersion: meeting.version });
  });

  it("a meeting of another transformation, or no meeting, is 422 report.subject_invalid; nothing written", async () => {
    const other = await generatedStatus(s.b.transformationId, "meeting_minutes", s.b.s.tl, { subjectId: m.review.id });
    expect([other.status, other.body.code]).toEqual([422, "report.subject_invalid"]);
  });
});

async function generatedStatus(t: string, code: string, session: Session, body: Record<string, unknown>) {
  return send("POST", `/api/v1/transformations/${t}/reports/${code}/generate`, { session, body });
}

describe("meeting_pack (REQ-S13-004, REQ-S10-013 content; ADR-0045 §7)", () => {
  it("lists the agenda items with their linked decisions and asks, and the meeting's actions", async () => {
    const T = x.transformationId;
    const snap = await generated(api, T, "meeting_pack", x.lead.session, { subjectId: m.steerco.id });
    expect([snap.subjectType, snap.subjectId, snap.approvalState]).toEqual(["meeting", m.steerco.id, "not_applicable"]);
    const agenda = await get(`${m.steerco.url}/agenda-items`, x.auditor.session);
    const a = section(snap, "agenda");
    expect(rowIds(a)).toEqual(agenda.items.map((i: Body) => i.id));
    const decision = await get(
      `/api/v1/transformations/${T}/executive-decisions/${m.steerco.decisionId}`,
      x.auditor.session,
    );
    const askRow = a.rows.find((r: Body) => r.recordId === m.steerco.askItemId);
    expect(cell(a, askRow, "decision").value).toBe(`${decision.code} ${decision.decision}`);
    expect(cell(a, askRow, "decision_status").value).toBe(decision.status);

    // The asks: the published one read from its T16 decision, the draft brief from its own elements.
    const asks = section(snap, "asks");
    expect(rowIds(asks)).toEqual([m.steerco.askItemId, m.steerco.briefItemId]);
    const linked = asks.rows[0];
    expect(cell(asks, linked, "ask_source").value).toBe("t16_decision");
    expect(cell(asks, linked, "decision_required").value).toBe(decision.decision);
    expect(cell(asks, linked, "impact_of_delay").value).toBe("Synthetic: the discount is lost");
    expect(cell(asks, linked, "options").value.split("\n")).toHaveLength(2);
    expect(cell(asks, linked, "missing_elements").value).toBe(0);
    const draft = asks.rows[1];
    expect(cell(asks, draft, "ask_source").value).toBe("brief");
    expect(cell(asks, draft, "decision")).toMatchObject({ value: null, validation: "not_applicable" });
    // Missing elements: impact of delay (Unknown, no text) and options (fewer than two).
    expect(cell(asks, draft, "impact_of_delay")).toMatchObject({
      value: null,
      validation: "unknown",
      reason: "missing",
    });
    expect(cell(asks, draft, "missing_elements").value).toBe(2);
    const draftItem = agenda.items.find((i: Body) => i.id === m.steerco.briefItemId);
    expect(draftItem.missingElements.sort()).toEqual(["impact_of_delay", "options"]);

    expect(rowIds(section(snap, "decisions"))).toEqual([m.steerco.decisionId]);
    expect(rowIds(section(snap, "actions"))).toEqual([m.steerco.actionId]);
    const keys = (await sourcesOf(T, snap.id, x.auditor.session)).map((r: Body) => `${r.recordType}:${r.recordId}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        `meeting:${m.steerco.id}`,
        `agenda_item:${m.steerco.askItemId}`,
        `agenda_item:${m.steerco.briefItemId}`,
        `decision:${m.steerco.decisionId}`,
        `action_item:${m.steerco.actionId}`,
      ]),
    );

    // The live view is the same assembly; it follows a change of the linked decision, the snapshot does not.
    const D = `/api/v1/transformations/${T}/executive-decisions/${m.steerco.decisionId}`;
    const changed = await send("PATCH", D, {
      session: x.lead.session,
      headers: ifm(decision.version),
      body: { title: "Synthetic: choose the billing platform (revised)" },
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const live = await get(
      `/api/v1/transformations/${T}/reports/meeting_pack/live?subjectId=${m.steerco.id}`,
      x.auditor.session,
    );
    const liveAsks = section(live, "asks");
    expect(cell(liveAsks, liveAsks.rows[0], "decision_required").value).toBe(
      "Synthetic: choose the billing platform (revised)",
    );
    const again = await get(`/api/v1/transformations/${T}/report-snapshots/${snap.id}`, x.auditor.session);
    const kept = section(again, "asks");
    expect(cell(kept, kept.rows[0], "decision_required").value).toBe(decision.decision);
    expect(again.contentSha256).toBe(snap.contentSha256);
  });
});

describe("handover (REQ-S13-004; ADR-0045 §3)", () => {
  it("contains the handover, its area's controls, its evidence and the M0217 items; the four approval states", async () => {
    const T = s.b.transformationId;
    const h = await draftHandover(api, s);
    const snap = await generated(api, T, "handover", s.wl.session, { subjectId: h.id });
    expect([snap.subjectType, snap.subjectId, snap.approvalState]).toEqual(["bau_handover", h.id, "not_submitted"]);
    const view = await get(h.H, s.b.s.auditor);
    const hs = section(snap, "handover");
    expect(field(hs, "code").value).toBe(view.code);
    expect(field(hs, "status").value).toBe("draft");
    expect(field(hs, "data_access")).toMatchObject({ value: view.dataAccess, authored: "user" });
    expect(field(hs, "benefit_monitoring_cadence").value).toBe(view.benefitMonitoringCadence);
    expect(rowIds(section(snap, "controls"))).toEqual(view.controlIds);
    expect(rowIds(section(snap, "evidence"))).toEqual(view.evidenceIds);
    expect(rowIds(section(snap, "improvement_items"))).toEqual(view.openImprovementItemIds);
    const items = section(snap, "items");
    expect(items.fields.filter((f: Body) => f.value.value === "missing").map((f: Body) => f.key)).toEqual(
      view.missingItems,
    );
    const evidence = await get(`/api/v1/transformations/${T}/report-snapshots/${snap.id}/evidence`, s.b.s.auditor);
    expect(evidence.items.map((e: Body) => e.evidenceId)).toEqual(view.evidenceIds);
    const keys = (await sourcesOf(T, snap.id, s.b.s.auditor)).map((r: Body) => `${r.recordType}:${r.recordId}`);
    expect(keys).toEqual(
      expect.arrayContaining([
        `bau_handover:${h.id}`,
        `performance_area:${h.areaId}`,
        `control:${h.controlId}`,
        `evidence:${h.evidenceId}`,
      ]),
    );

    const sub = ok(
      await send("POST", `${h.H}/submit`, { session: s.wl.session, headers: ifm(h.version) }),
      200,
      "submit",
    );
    expect((await generated(api, T, "handover", s.wl.session, { subjectId: h.id })).approvalState).toBe("pending");
    const ret = ok(
      await send("POST", `${h.H}/return`, {
        session: s.b.s.bo,
        headers: ifm(sub.version),
        body: { reason: "Synthetic: the data access section needs the warehouse owner" },
      }),
      200,
      "return",
    );
    const returned = await generated(api, T, "handover", s.wl.session, { subjectId: h.id });
    expect(returned.approvalState).toBe("changes_requested");
    expect(field(section(returned, "handover"), "return_reason").value).toBe(
      "Synthetic: the data access section needs the warehouse owner",
    );
    const resub = ok(
      await send("POST", `${h.H}/submit`, { session: s.wl.session, headers: ifm(ret.version) }),
      200,
      "resubmit",
    );
    ok(
      await send("POST", `${h.H}/accept`, { session: s.b.s.bo, headers: ifm(resub.version), body: {} }),
      200,
      "accept (synthetic)",
    );
    const accepted = await generated(api, T, "handover", s.wl.session, { subjectId: h.id });
    expect(accepted.approvalState).toBe("approved");
    expect(field(section(accepted, "handover"), "accepted_by").value).not.toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ executive dashboard

describe("executive_dashboard (REQ-S13-004, REQ-S13-008; ADR-0045 §5)", () => {
  let k: KpiWorld;
  let period: { id: string };
  const kpi = { ok: "", stale: "", unknown: "" };
  const okKpi = { ok: "", stale: "", unknown: "" };

  beforeAll(async () => {
    await ensureDefaultCalendar(api, w, (mm, u, o) => call(api.app, mm, u, o));
    const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const scope = { type: "transformation" as const, id: transformationId };
    const mk = async (...roles: string[]) => {
      const u = await createUser(api.db, w.orgA.id);
      for (const role of roles) await grant(api.db, w.grantor.id, u.id, role, scope, w.orgA.id);
      return u;
    };
    const users = {
      tl: await mk("TL"),
      kds: await mk("KDS"),
      fin: await mk("FIN"),
      finKds: await mk("FIN", "KDS"),
      finTl: await mk("FIN", "TL"),
      sp: await mk("SP"),
      bo: await mk("BO"),
      to: w.office,
      auditor: w.auditor,
      outsider: w.officeB,
      nobody: w.nobody,
    };
    const sessions = Object.fromEntries(
      await Promise.all(Object.entries(users).map(async ([n, u]) => [n, await signIn(api.app, u.subject)] as const)),
    ) as Record<keyof typeof users, Session>;
    await sql`SELECT p4_instantiate_transformation(${transformationId}::uuid, ${users.tl.id}::uuid, 'test:kbe-d2-dashboard', 'api')`.execute(
      api.db,
    );
    k = {
      transformationId,
      outcomeId: "",
      archivedOutcomeId: "",
      users,
      s: sessions,
      base: `/api/v1/transformations/${transformationId}`,
    };
    const { today } = await riyadhToday(api);
    period = await openPeriod(api, w, "monthly", "2026-05", "2026-05-01", "2026-05-31");
    kpi.ok = (await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "percentage", unitLabel: "% of users" })).id;
    kpi.stale = (await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "percentage", unitLabel: "% of users" })).id;
    kpi.unknown = (await ownedKpi(api, k, DIRECT_FLOW, { unitKind: "ratio", unitLabel: null })).id;
    const outcome = ok(
      await send("POST", `${k.base}/outcomes`, {
        session: k.s.tl,
        body: { statement: "Synthetic: raise the self-service share", ownerUserId: k.users.tl.id },
      }),
      201,
      "outcome",
    );
    for (const key of Object.keys(kpi) as (keyof typeof kpi)[])
      okKpi[key] = ok(
        await send("POST", `${k.base}/outcome-kpis`, {
          session: k.s.tl,
          body: { outcomeId: outcome.id, kpiDefinitionId: kpi[key], targetDate: "2026-12-31" },
        }),
        201,
        "outcome kpi",
      ).id;
    for (const [id, dataAsOf] of [
      [kpi.ok, today],
      [kpi.stale, "2020-01-01"],
    ] as const) {
      const r = await submitActual(api, k, id, { reportingPeriodId: period.id, value: "0.12", dataAsOf });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      await runRecalculation(api, r.body.actual.id);
    }
  }, 180_000);

  it("needs a reporting period: 422 report.period_required without one; nothing written", async () => {
    const before = await api.db
      .selectFrom("report_snapshot")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    const r = await generatedStatus(k.transformationId, "executive_dashboard", k.s.tl, {});
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "report.period_required",
      "This output needs a reporting period.",
    ]);
    const live = await send("GET", `${k.base}/reports/executive_dashboard/live`, { session: k.s.auditor });
    expect([live.status, live.body.code]).toEqual([422, "report.period_required"]);
    const after = await api.db
      .selectFrom("report_snapshot")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });

  it("is the DG4 dashboard of the period: same areas, RAGs and items; Unknown and Stale carry no number", async () => {
    const snap = await generated(api, k.transformationId, "executive_dashboard", k.s.tl, {
      reportingPeriodId: period.id,
    });
    expect([snap.approvalState, snap.reportingPeriodId, snap.content.period.id]).toEqual([
      "not_applicable",
      period.id,
      period.id,
    ]);
    const dash = await get(`${k.base}/dashboard?periodId=${period.id}`, k.s.auditor);
    for (const area of dash.areas) {
      const metrics = section(snap, `area_${area.code}`);
      const rag = field(metrics, "rag");
      if (area.rag.status === "unknown" || area.rag.status === "stale")
        expect(rag).toMatchObject({ value: null, validation: area.rag.status, labelKey: null });
      else expect(rag.value).toBe(area.rag.status);
      const items = section(snap, `items_${area.code}`);
      expect(items.rows.map((r: Body) => `${r.recordType}:${r.recordId}`)).toEqual(
        area.items.map((i: Body) => `${i.recordType}:${i.recordId}`),
      );
    }
    // The three outcome KPIs: accepted (validated, its number), Stale and Unknown (no number).
    const outcomes = section(snap, "items_outcomes");
    const valueCell = (id: string) => {
      const row = outcomes.rows.find((r: Body) => r.recordId === id);
      return row.cells.slice(6).find((c: Body) => c.validation !== "not_applicable");
    };
    expect(valueCell(okKpi.ok)).toMatchObject({
      value: "0.12",
      unitKind: "percentage",
      valueBasis: "actual",
      validation: "validated",
    });
    expect(valueCell(okKpi.stale)).toMatchObject({
      value: null,
      unitKind: "percentage",
      validation: "stale",
      reason: "stale",
    });
    expect(valueCell(okKpi.unknown)).toMatchObject({ value: null, unitKind: "ratio", validation: "unknown" });
    // No Unknown or Stale value anywhere carries a number, and no Unknown/Stale RAG carries a colour code.
    const all = values(snap.content.sections);
    expect(all.some((v) => v.validation === "stale")).toBe(true);
    expect(all.some((v) => v.validation === "unknown")).toBe(true);
    for (const v of all) if (v.validation === "unknown" || v.validation === "stale") expect(v.value).toBeNull();
    expect(snap.unknownValueCount).toBeGreaterThanOrEqual(2);
    // Each decimal column holds one unit kind and one value basis; no table carries a report total.
    for (const sec of snap.content.sections) {
      if (sec.kind !== "table") continue;
      expect(sec.totals).toEqual([]);
      sec.columns.forEach((c: Body, j: number) => {
        if (c.valueKind !== "decimal") return;
        expect(new Set(sec.rows.map((r: Body) => r.cells[j].unitKind)).size).toBeLessThanOrEqual(1);
        expect(new Set(sec.rows.map((r: Body) => r.cells[j].valueBasis)).size).toBeLessThanOrEqual(1);
      });
    }
    // The transformation and each item record are source rows (once each).
    const keys = sourceKeys({ sources: await sourcesOf(k.transformationId, snap.id, k.s.auditor) });
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([
        `transformation:${k.transformationId}`,
        ...Object.values(okKpi).map((id) => `outcome_kpi:${id}`),
      ]),
    );
  });
});
