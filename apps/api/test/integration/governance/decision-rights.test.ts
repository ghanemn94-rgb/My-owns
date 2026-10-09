// T11 Decision Rights Matrix and routing (ADR-0026 §5; D-089 Q6, Q7; T-DG4-BE-C) against a real PostgreSQL:
//  - REQ-PB-065 "four rows seeded verbatim; a change request of type Business scope change routes approval to the
//    Sponsor": the template and every new transformation's copy equal B0099; POST /transformations instantiates them
//    (p4_instantiate_transformation); routeByDecisionRight('business_scope_change') and a decision_request approval on
//    that row are assigned to the person mapped to SP (slice H's change request calls the same function);
//  - REQ-PB-066 "a Business scope change raised Thursday gets a due date 5 working days later skipping the configured
//    weekend days and holidays": the preview and the approval due date use the organization's business calendar; the
//    other SLA types (next SteerCo or urgent route, release plan) resolve or stay Unknown, never guessed;
//  - every mutation: authorization (positive and negative, re-checked at commit time), validation, If-Match 428/409,
//    its audit event, and the template unchanged.
// All data is SYNTHETIC; the approvals here are demo BUSINESS approvals that approve nothing real and have nothing to do
// with the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  computeDecisionRightDue,
  NO_FORUM_DATES,
  routeByDecisionRight,
  setNextForumDateProvider,
} from "../../../src/modules/governance/decision-rights.ts";
import {
  auditOf,
  call,
  createUser,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { requestBody, setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";
import { createInitiative } from "../contract/p3-exercises-be-b.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
}, 120_000);
afterAll(() => api.close());

const T = () => `/api/v1/transformations/${p.transformationId}`;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

/** B0099, verbatim (the four rows of Template 11, with the parties and SLA types of ADR-0026 §5). */
const B0099 = [
  [
    "business_scope_change",
    "Business scope change",
    "Transformation Lead",
    "Sponsor",
    "Business owners / Finance",
    "Workstreams",
    "5 working days",
    "SP",
    "working_days",
    5,
    ["SP"],
  ],
  [
    "funding_reallocation",
    "Funding reallocation",
    "Transformation Lead + Finance",
    "SteerCo",
    "Initiative owners",
    "PMO",
    "Next SteerCo / urgent route",
    "STEERCO",
    "next_steerco_or_urgent",
    null,
    ["STEERCO", "SP"],
  ],
  [
    "target_state_design",
    "Target-state design",
    "Design owner",
    "Business owner",
    "Tech / Ops / CX / Finance",
    "Transformation Office",
    "10 working days",
    "BO",
    "working_days",
    10,
    ["BO", "SP"],
  ],
  [
    "go_live_scale",
    "Go-live / scale",
    "Initiative owner",
    "Business owner",
    "Risk / Tech / CX",
    "SteerCo",
    "Per release plan",
    "BO",
    "release_plan",
    null,
    ["BO", "SP"],
  ],
] as const;

const rowBody = (over: Record<string, unknown> = {}) => ({
  decisionEn: "Synthetic vendor change",
  decisionAr: "تغيير مورد اصطناعي",
  recommendLabel: "Transformation Lead",
  approveLabel: "Business owner",
  consultLabel: "Finance",
  informLabel: "PMO",
  slaLabel: "3 working days",
  recommendParties: ["TL"],
  approvePartyCode: "BO",
  consultParties: ["FIN"],
  informParties: ["PMO"],
  slaType: "working_days",
  slaWorkingDays: 3,
  escalationChain: ["BO", "SP"],
  ...over,
});

describe("REQ-PB-065: the four T11 rows, seeded verbatim (B0099)", () => {
  it("the template lists the four rows exactly as the playbook writes them", async () => {
    const res = await send("GET", "/api/v1/decision-right-templates", { session: p.auditor.session });
    expect(res.status).toBe(200);
    expect(
      res.body.items.map((r: Body) => [
        r.key,
        r.sourceDecisionEn,
        r.sourceRecommendEn,
        r.sourceApproveEn,
        r.sourceConsultEn,
        r.sourceInformEn,
        r.sourceSlaEn,
        r.approvePartyCode,
        r.slaType,
        r.slaWorkingDays,
        r.escalationChain,
      ]),
    ).toEqual(B0099.map((r) => [...r]));
    expect(res.body.items.every((r: Body) => r.sourceRef === "B0099")).toBe(true);
  });

  it("POST /transformations copies the four rows verbatim, both matrix headers and the six T12 deliverables (36 cells)", async () => {
    const outsider = await signIn(api.app, (await createUser(api.db, w.orgA.id)).subject);
    // The P2 world's lead holds TL on the business unit; create a second transformation through the API with it.
    const t = await send("POST", "/api/v1/transformations", {
      session: p.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic P4 instantiation", mode: "end_to_end" },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const id = t.body.id as string;
    const rows = await send("GET", `/api/v1/transformations/${id}/decision-rights`, { session: p.lead.session });
    expect(rows.status).toBe(200);
    expect(
      rows.body.items.map((r: Body) => [
        r.templateKey,
        r.decisionEn,
        r.recommendLabel,
        r.approveLabel,
        r.consultLabel,
        r.informLabel,
        r.slaLabel,
        r.approvePartyCode,
        r.slaType,
        r.slaWorkingDays,
        r.escalationChain,
      ]),
    ).toEqual(B0099.map((r) => [...r]));
    const matrices = await api.db
      .selectFrom("governance_matrix")
      .select(["kind", "status"])
      .where("transformation_id", "=", id)
      .orderBy("kind")
      .execute();
    expect(matrices).toEqual([
      { kind: "decision_rights", status: "draft" },
      { kind: "raci", status: "draft" },
    ]);
    const cells = await api.db
      .selectFrom("transformation_raci_assignment")
      .select("id")
      .where("transformation_id", "=", id)
      .execute();
    expect(cells).toHaveLength(36);
    // A person without any grant cannot read it (404, the read gate).
    expect((await send("GET", `/api/v1/transformations/${id}/decision-rights`, { session: outsider })).status).toBe(
      404,
    );
  });

  it("routeByDecisionRight('business_scope_change') resolves the Sponsor-mapped person; a decision_request is assigned to them", async () => {
    const route = await routeByDecisionRight(api.db, p.transformationId, "business_scope_change");
    expect(route.approvePartyCode).toBe("SP");
    expect(route.assignee.target).toMatchObject({ kind: "user", userId: p.sponsor.id });
    expect(route.escalationChain).toEqual(["SP"]);
    const req = await send("POST", `${T()}/approvals`, {
      session: p.lead.session,
      body: requestBody(p.decisionId, p.rights["business_scope_change"]!),
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    expect(req.body.assignee).toEqual({ partyCode: "SP", userId: p.sponsor.id, groupId: null });
    expect(req.body.decisionRightId).toBe(p.rights["business_scope_change"]);
    await send("POST", `/api/v1/approvals/${req.body.id}/withdraw`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: routing proven" },
    });
  });

  it("an unmapped Approve party is a visible routing error (422 routing.role_unmapped), never a fallback", async () => {
    const q = await setupApprovalWorld(api, w);
    const sp = await api.db
      .selectFrom("role_mapping")
      .select(["id", "version"])
      .where("transformation_id", "=", q.transformationId)
      .where("party_code", "=", "SP")
      .executeTakeFirstOrThrow();
    const ended = await send("POST", `/api/v1/transformations/${q.transformationId}/role-mappings/${sp.id}/end`, {
      session: q.lead.session,
      headers: ifm(sp.version),
      body: { reason: "Synthetic: the Sponsor leaves" },
    });
    expect(ended.status).toBe(200);
    await expect(routeByDecisionRight(api.db, q.transformationId, "business_scope_change")).rejects.toMatchObject({
      status: 422,
      code: "routing.role_unmapped",
    });
    const req = await send("POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["business_scope_change"]!),
    });
    expect([req.status, req.body.code]).toEqual([422, "routing.role_unmapped"]);
    const written = await api.db
      .selectFrom("approval")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .execute();
    expect(written).toEqual([]);
  });
});

describe("REQ-PB-066: SLA due dates by type (D-089 Q6)", () => {
  const preview = (rowId: string, qs: string) =>
    send("GET", `${T()}/decision-rights/${rowId}/due-date?${qs}`, { session: p.auditor.session });

  it("a Business scope change raised Thursday is due 5 working days later, skipping the configured weekend and holidays", async () => {
    const bsc = p.rights["business_scope_change"]!;
    const plain = await preview(bsc, "raisedOn=2026-10-08");
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    // Sunday-Thursday workweek (Asia/Riyadh default): Sun 11, Mon 12, Tue 13, Wed 14, Thu 15.
    expect([plain.body.slaType, plain.body.dueDate, plain.body.unknownReason]).toEqual([
      "working_days",
      "2026-10-15",
      null,
    ]);
    expect(plain.body.calendarId).not.toBeNull();
    // A configured holiday on Monday 12 October moves it to Sunday 18 (Fri 16 and Sat 17 are weekend days).
    const admin = await signIn(api.app, w.admin.subject);
    const cal = await api.db
      .selectFrom("business_calendar")
      .select("id")
      .where("organization_id", "=", w.orgA.id)
      .where("is_default", "=", true)
      .executeTakeFirstOrThrow();
    const h = await send("POST", `/api/v1/calendars/${cal.id}/holidays`, {
      session: admin,
      body: { dateFrom: "2026-10-12", dateTo: "2026-10-12", nameEn: "Synthetic holiday", nameAr: "عطلة اصطناعية" },
    });
    expect(h.status, JSON.stringify(h.body)).toBe(201);
    const withHoliday = await preview(bsc, "raisedOn=2026-10-08");
    expect(withHoliday.body.dueDate).toBe("2026-10-18");
    // Target-state design: 10 working days.
    const tsd = await preview(p.rights["target_state_design"]!, "raisedOn=2026-10-08");
    expect(tsd.body.dueDate).toBe("2026-10-25");
  });

  it("an approval request stores the working-day due date of its request business date (never elapsed days)", async () => {
    const req = await send("POST", `${T()}/approvals`, {
      session: p.lead.session,
      body: requestBody(p.decisionId, p.rights["business_scope_change"]!),
    });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const exp = await preview(p.rights["business_scope_change"]!, `raisedOn=${req.body.requestBusinessDate}`);
    expect(req.body.dueDate).toBe(exp.body.dueDate);
    expect(req.body.dueDate).not.toBeNull();
    expect(req.body.slaType).toBe("working_days");
    await send("POST", `/api/v1/approvals/${req.body.id}/withdraw`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: due date proven" },
    });
  });

  it("next SteerCo: Unknown until a meeting is scheduled (the provider), the meeting date once it is; urgent needs a configured route", async () => {
    const fr = p.rights["funding_reallocation"]!;
    const none = await preview(fr, "raisedOn=2026-10-08");
    expect([none.body.dueDate, none.body.unknownReason]).toEqual([null, "no_steerco_scheduled"]);
    setNextForumDateProvider({
      nextSteerCoDate: async (_db, tid, on) =>
        tid === p.transformationId && on === "2026-10-08" ? "2026-10-20" : null,
    });
    try {
      const next = await preview(fr, "raisedOn=2026-10-08");
      expect([next.body.dueDate, next.body.unknownReason]).toEqual(["2026-10-20", null]);
    } finally {
      setNextForumDateProvider(null);
    }
    expect(NO_FORUM_DATES).toBeDefined();
    const notConfigured = await preview(fr, "raisedOn=2026-10-08&urgent=true");
    expect([notConfigured.status, notConfigured.body.code]).toEqual([422, "decision_right.urgent_not_configured"]);
    const v = (await send("GET", `${T()}/decision-rights/${fr}`, { session: p.lead.session })).body.version;
    const configured = await send("PATCH", `${T()}/decision-rights/${fr}`, {
      session: p.lead.session,
      headers: ifm(v),
      body: { urgentWorkingDays: 2 },
    });
    expect(configured.status, JSON.stringify(configured.body)).toBe(200);
    const urgent = await preview(fr, "raisedOn=2026-10-08&urgent=true");
    expect(urgent.body.dueDate).toBe("2026-10-13"); // Sun 11, Tue 13 (Mon 12 is the synthetic holiday above)
    // On an approval request, urgent needs a reason.
    const noReason = await send("POST", `${T()}/approvals`, {
      session: p.lead.session,
      body: requestBody(p.decisionId, fr, 1, { urgent: true }),
    });
    expect([noReason.status, noReason.body.code]).toEqual([422, "decision_right.urgent_reason_required"]);
  });

  it("per release plan: the linked milestone's approved date, Unknown without one", async () => {
    const gl = p.rights["go_live_scale"]!;
    const none = await preview(gl, "raisedOn=2026-10-08");
    expect([none.body.dueDate, none.body.unknownReason]).toEqual([null, "no_release_date"]);
    const initiative = await createInitiative((m, u, o) => send(m, u, o), p);
    const ms = await send("POST", `/api/v1/initiatives/${initiative.id}/milestones`, {
      session: p.lead.session,
      body: { title: "Synthetic release", forecastDate: "2026-11-01" },
    });
    expect(ms.status, JSON.stringify(ms.body)).toBe(201);
    const unapproved = await preview(gl, `raisedOn=2026-10-08&releaseMilestoneId=${ms.body.id}`);
    expect([unapproved.body.dueDate, unapproved.body.unknownReason]).toEqual([null, "no_release_date"]);
    const approved = await send("POST", `/api/v1/milestones/${ms.body.id}/approve-date`, {
      session: p.lead.session,
      headers: ifm(ms.body.version),
      body: { approvedDate: "2026-11-05", reason: "Synthetic baseline" },
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const dated = await preview(gl, `raisedOn=2026-10-08&releaseMilestoneId=${ms.body.id}`);
    expect([dated.body.dueDate, dated.body.unknownReason]).toEqual(["2026-11-05", null]);
  });

  it("no default calendar: a working-days SLA is Unknown (calendar_not_configured), never counted in elapsed days", async () => {
    // Organization B of the seeded world has no business calendar (the fixture inserts organizations directly).
    const calendars = await api.db
      .selectFrom("business_calendar")
      .select("id")
      .where("organization_id", "=", w.orgB.id)
      .execute();
    expect(calendars).toEqual([]);
    const due = await computeDecisionRightDue(
      api.db,
      { sla_type: "working_days", sla_working_days: 5, urgent_working_days: null },
      {
        organizationId: w.orgB.id,
        transformationId: p.transformationId,
        raisedOn: "2026-10-08",
        urgent: false,
        urgentReason: undefined,
        releaseMilestoneId: null,
      },
    );
    expect([due.dueDate, due.unknownReason]).toEqual([null, "calendar_not_configured"]);
  });
});

describe("T11 edits (ADR-0026 §5; S-4)", () => {
  it("TL adds and edits a row; AUD, BO and outsiders are refused; If-Match 428/409; audited; the template never changes", async () => {
    const templateBefore = await api.db.selectFrom("decision_right_template").selectAll().orderBy("key").execute();
    expect((await send("POST", `${T()}/decision-rights`, { session: p.auditor.session, body: rowBody() })).status).toBe(
      403,
    );
    expect((await send("POST", `${T()}/decision-rights`, { session: p.bo.session, body: rowBody() })).status).toBe(403);
    const outsider = await signIn(api.app, (await createUser(api.db, w.orgA.id)).subject);
    expect((await send("POST", `${T()}/decision-rights`, { session: outsider, body: rowBody() })).status).toBe(404);
    // Validation: 400 for the shape, 422 for the business rules (exact codes).
    expect(
      (await send("POST", `${T()}/decision-rights`, { session: p.lead.session, body: rowBody({ decisionEn: " " }) }))
        .status,
    ).toBe(400);
    const party = await send("POST", `${T()}/decision-rights`, {
      session: p.lead.session,
      body: rowBody({ escalationChain: ["BO", "NOPE"] }),
    });
    expect([party.status, party.body.code, party.body.detail]).toEqual([
      422,
      "decision_right.party_unknown",
      "NOPE is not a known governance role.",
    ]);
    const sla = await send("POST", `${T()}/decision-rights`, {
      session: p.lead.session,
      body: rowBody({ slaType: "release_plan", slaWorkingDays: 3 }),
    });
    expect([sla.status, sla.body.code, sla.body.detail]).toEqual([
      422,
      "decision_right.sla_invalid",
      "A working-days SLA needs a number of working days between 1 and 250; other SLA types take none.",
    ]);
    const urgentOnWorking = await send("POST", `${T()}/decision-rights`, {
      session: p.lead.session,
      body: rowBody({ urgentWorkingDays: 2 }),
    });
    expect([urgentOnWorking.status, urgentOnWorking.body.code]).toEqual([422, "decision_right.sla_invalid"]);
    const header0 = await api.db
      .selectFrom("governance_matrix")
      .select("version")
      .where("transformation_id", "=", p.transformationId)
      .where("kind", "=", "decision_rights")
      .executeTakeFirstOrThrow();
    const created = await send("POST", `${T()}/decision-rights`, { session: p.lead.session, body: rowBody() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.headers["etag"]).toBe('"1"');
    expect([created.body.templateKey, created.body.version, created.body.status]).toEqual([null, 1, "active"]);
    const R = `${T()}/decision-rights/${created.body.id}`;
    expect((await send("PATCH", R, { session: p.lead.session, body: { slaWorkingDays: 4 } })).status).toBe(428);
    const stale = await send("PATCH", R, { session: p.lead.session, headers: ifm(2), body: { slaWorkingDays: 4 } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect(
      (await send("PATCH", R, { session: p.auditor.session, headers: ifm(1), body: { slaWorkingDays: 4 } })).status,
    ).toBe(403);
    // Changing the SLA type clears the working days it no longer takes.
    const moved = await send("PATCH", R, {
      session: p.lead.session,
      headers: ifm(1),
      body: { slaType: "release_plan", slaLabel: "Per release plan" },
    });
    expect([moved.status, moved.body.slaType, moved.body.slaWorkingDays, moved.body.version]).toEqual([
      200,
      "release_plan",
      null,
      2,
    ]);
    expect((await auditOf(api.db, created.body.id)).map((e) => [e.action, e.new_version, e.actor_user_id])).toEqual([
      ["transformation_decision_right.create", 1, p.lead.id],
      ["transformation_decision_right.update", 2, p.lead.id],
    ]);
    const header1 = await api.db
      .selectFrom("governance_matrix")
      .select("version")
      .where("transformation_id", "=", p.transformationId)
      .where("kind", "=", "decision_rights")
      .executeTakeFirstOrThrow();
    expect(header1.version).toBe(header0.version + 2);
    // Editing a seeded copy leaves the template unchanged.
    const bsc = `${T()}/decision-rights/${p.rights["business_scope_change"]}`;
    const v = (await send("GET", bsc, { session: p.lead.session })).body.version;
    const relabel = await send("PATCH", bsc, {
      session: p.lead.session,
      headers: ifm(v),
      body: { slaWorkingDays: 7, slaLabel: "7 working days" },
    });
    expect(relabel.status).toBe(200);
    expect(await api.db.selectFrom("decision_right_template").selectAll().orderBy("key").execute()).toEqual(
      templateBefore,
    );
  });

  it("commit-time authorization: a configure right revoked while the request waits is refused, nothing written", async () => {
    const q = await setupApprovalWorld(api, w);
    const before = await api.db
      .selectFrom("transformation_decision_right")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .execute();
    const res = await afterIdentity(
      api,
      q.lead.id,
      () =>
        call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/decision-rights`, {
          session: q.lead.session,
          body: rowBody(),
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, q.lead.id),
    );
    expect(res.status).toBe(403);
    const after = await api.db
      .selectFrom("transformation_decision_right")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .execute();
    expect(after.length).toBe(before.length);
  });
});
