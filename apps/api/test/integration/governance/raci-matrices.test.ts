// T12 RACI, governance-matrix approval and Transform readiness (ADR-0026 §7, §9; T-DG4-BE-C) against a real PostgreSQL:
//  - REQ-PB-067 "seeded RACI matches B0101 exactly; a cell value 'X' is rejected; 'A/R' is accepted";
//  - REQ-S10-009 "a RACI row with two A entries is rejected; 'A/R' for BAU Handover counts as one accountable";
//  - REQ-S10-007 "changing a transformation's RACI does not change the seeded default or other transformations", and
//    "versioned, approved changes": the matrix header's version moves with every edit, a submitted version is frozen and
//    approved by the Sponsor-mapped person through the approval service;
//  - REQ-PB-008 "readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready'
//    once they are completed"; the DG3 readiness operation is unchanged;
//  - every mutation: authorization (positive and negative, re-checked at commit time), validation, If-Match 428/409 and
//    its audit event.
// All data is SYNTHETIC; the matrix approvals decided here are demo BUSINESS approvals by a synthetic Sponsor; they
// approve nothing real and have nothing to do with the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { mapParty, setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";

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

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = (q: ApprovalWorld = p) => `/api/v1/transformations/${q.transformationId}`;

/** B0101, verbatim: deliverable, then Sponsor, Transformation Lead, Business Owner, Workstream Lead, Finance, Tech/Data. */
const B0101 = [
  ["Charter", "A", "R", "C", "I", "C", "I"],
  ["Target Operating Model", "C", "R", "A", "C", "C", "C"],
  ["Business Case", "A", "R", "C", "C", "R", "C"],
  ["Initiative Delivery", "I", "C", "A", "R", "C", "C"],
  ["Benefits Validation", "I", "C", "A", "C", "R", "I"],
  ["BAU Handover", "I", "C", "A/R", "R", "C", "C"],
];

async function raciOf(q: ApprovalWorld = p) {
  const res = await send("GET", `${T(q)}/raci`, { session: q.auditor.session });
  expect(res.status).toBe(200);
  return res.body;
}
const deliverable = (raci: Body, key: string) => raci.deliverables.find((d: Body) => d.templateKey === key);
const grid = (deliverables: Body[], label: string) =>
  deliverables.map((d: Body) => [d[label], ...d.cells.map((c: Body) => c.value)]);

async function patchCells(q: ApprovalWorld, key: string, body: Record<string, unknown>, session = q.lead.session) {
  const d = deliverable(await raciOf(q), key);
  return send("PATCH", `${T(q)}/raci/deliverables/${d.id}`, { session, headers: ifm(d.version), body });
}

describe("REQ-PB-067: T12 seeded from B0101; cell values", () => {
  it("the template and every transformation's copy match B0101 exactly (columns SP, TL, BO, WL, FIN, TD)", async () => {
    const template = await send("GET", "/api/v1/raci-template", { session: p.auditor.session });
    expect(template.status).toBe(200);
    expect(template.body.parties).toEqual(["SP", "TL", "BO", "WL", "FIN", "TD"]);
    expect(grid(template.body.deliverables, "sourceDeliverableEn")).toEqual(B0101);
    expect(template.body.deliverables.every((d: Body) => d.sourceRef === "B0101")).toBe(true);
    const own = await raciOf();
    expect(own.parties).toEqual(["SP", "TL", "BO", "WL", "FIN", "TD"]);
    expect(grid(own.deliverables, "labelEn")).toEqual(B0101);
    expect(own.matrix).toMatchObject({ kind: "raci", status: "draft", approvedVersion: null, openApprovalId: null });
  });

  it("a cell value 'X' is rejected (422 raci.invalid_value); 'A/R' is accepted; a value longer than 3 is a 400", async () => {
    const x = await patchCells(p, "charter", { cells: [{ partyCode: "TL", value: "X" }] });
    expect([x.status, x.body.code, x.body.detail]).toEqual([
      422,
      "raci.invalid_value",
      "A RACI cell accepts A, R, C, I or A/R.",
    ]);
    expect((await patchCells(p, "charter", { cells: [{ partyCode: "TL", value: "ABCD" }] })).status).toBe(400);
    const ar = await patchCells(p, "charter", { cells: [{ partyCode: "SP", value: "A/R" }] });
    expect(ar.status, JSON.stringify(ar.body)).toBe(200);
    expect(ar.body.cells.find((c: Body) => c.partyCode === "SP").value).toBe("A/R");
    const back = await patchCells(p, "charter", { cells: [{ partyCode: "SP", value: "A" }] });
    expect(back.status).toBe(200);
    const unknownParty = await patchCells(p, "charter", { cells: [{ partyCode: "NOPE", value: "I" }] });
    expect([unknownParty.status, unknownParty.body.code]).toEqual([422, "raci.party_unknown"]);
  });
});

describe("REQ-S10-009: exactly one accountable per deliverable", () => {
  it("two A entries are rejected; zero is rejected; moving the A in one save passes; nothing is written on a refusal", async () => {
    const before = deliverable(await raciOf(), "charter");
    const two = await patchCells(p, "charter", { cells: [{ partyCode: "TL", value: "A" }] });
    expect([two.status, two.body.code, two.body.detail]).toEqual([
      422,
      "raci.accountable_count",
      "Each deliverable needs exactly one accountable (A or A/R), unless a documented governance rule permits otherwise. Charter has 2.",
    ]);
    const zero = await patchCells(p, "charter", { cells: [{ partyCode: "SP", value: "C" }] });
    expect([zero.status, zero.body.code]).toEqual([422, "raci.accountable_count"]);
    expect(deliverable(await raciOf(), "charter")).toEqual(before);
    const moved = await patchCells(p, "charter", {
      cells: [
        { partyCode: "SP", value: "R" },
        { partyCode: "TL", value: "A" },
      ],
    });
    expect([moved.status, moved.body.version]).toEqual([200, before.version + 1]);
    const restored = await patchCells(p, "charter", {
      cells: [
        { partyCode: "SP", value: "A" },
        { partyCode: "TL", value: "R" },
      ],
    });
    expect(restored.status).toBe(200);
  });

  it("'A/R' for BAU Handover counts as one accountable; adding another A there is rejected", async () => {
    const bau = deliverable(await raciOf(), "bau_handover");
    expect(bau.cells.filter((c: Body) => c.value === "A" || c.value === "A/R")).toEqual([
      { partyCode: "BO", value: "A/R" },
    ]);
    const twice = await patchCells(p, "bau_handover", { cells: [{ partyCode: "WL", value: "A" }] });
    expect([twice.status, twice.body.code]).toEqual([422, "raci.accountable_count"]);
    // A save that leaves the A/R alone passes (it is the one accountable).
    const ok = await patchCells(p, "bau_handover", { cells: [{ partyCode: "TD", value: "I" }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it("a documented governance rule (accountability exception) permits two; a new deliverable needs one otherwise", async () => {
    const D = `${T()}/raci/deliverables`;
    const two = [
      { partyCode: "SP", value: "A" },
      { partyCode: "BO", value: "A" },
    ];
    const refused = await send("POST", D, {
      session: p.lead.session,
      body: { labelEn: "Synthetic joint", labelAr: "مشترك", cells: two },
    });
    expect([refused.status, refused.body.code]).toEqual([422, "raci.accountable_count"]);
    const shortReason = await send("POST", D, {
      session: p.lead.session,
      body: { labelEn: "Synthetic joint", labelAr: "مشترك", cells: two, accountabilityException: "short" },
    });
    expect(shortReason.status).toBe(400);
    const allowed = await send("POST", D, {
      session: p.lead.session,
      body: {
        labelEn: "Synthetic joint deliverable",
        labelAr: "مخرج مشترك",
        cells: two,
        accountabilityException: "Synthetic governance rule GR-7: joint accountability of Sponsor and Business Owner.",
      },
    });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect([allowed.body.templateKey, allowed.body.version, allowed.body.ordinal]).toEqual([null, 1, 7]);
    // Removing the exception while two A remain is refused.
    const removed = await send("PATCH", `${D}/${allowed.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { accountabilityException: null },
    });
    expect([removed.status, removed.body.code]).toEqual([422, "raci.accountable_count"]);
  });
});

describe("REQ-S10-007: independent copies; edits are authorized, versioned and audited", () => {
  it("changing one transformation's RACI changes neither the template nor another transformation", async () => {
    const q = await setupApprovalWorld(api, w);
    const templateBefore = await api.db
      .selectFrom("raci_template_cell")
      .selectAll()
      .orderBy("deliverable_key")
      .orderBy("party_code")
      .execute();
    const otherBefore = await raciOf(q);
    const changed = await patchCells(p, "target_operating_model", { cells: [{ partyCode: "TD", value: "I" }] });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(
      await api.db
        .selectFrom("raci_template_cell")
        .selectAll()
        .orderBy("deliverable_key")
        .orderBy("party_code")
        .execute(),
    ).toEqual(templateBefore);
    expect((await raciOf(q)).deliverables).toEqual(otherBefore.deliverables);
    const tom = deliverable(await raciOf(), "target_operating_model");
    expect(tom.cells.find((c: Body) => c.partyCode === "TD").value).toBe("I");
  });

  it("AUD, BO and outsiders are refused; If-Match 428/409; each changed cell and the deliverable are audited", async () => {
    const d = deliverable(await raciOf(), "initiative_delivery");
    const U = `${T()}/raci/deliverables/${d.id}`;
    const body = { cells: [{ partyCode: "TD", value: "I" }] };
    expect((await send("PATCH", U, { session: p.auditor.session, headers: ifm(d.version), body })).status).toBe(403);
    expect((await send("PATCH", U, { session: p.bo.session, headers: ifm(d.version), body })).status).toBe(403);
    const outsider = await signIn(api.app, (await createUser(api.db, w.orgA.id)).subject);
    expect((await send("PATCH", U, { session: outsider, headers: ifm(d.version), body })).status).toBe(404);
    expect((await send("PATCH", U, { session: p.lead.session, body })).status).toBe(428);
    const stale = await send("PATCH", U, { session: p.lead.session, headers: ifm(d.version + 5), body });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, d.version]);
    const ok = await send("PATCH", U, { session: p.office.session, headers: ifm(d.version), body }); // TO holds raci.edit
    expect([ok.status, ok.body.version]).toEqual([200, d.version + 1]);
    expect((await auditOf(api.db, d.id)).map((e) => [e.action, e.new_version])).toEqual([
      ["transformation_raci_deliverable.create", 1],
      ["transformation_raci_deliverable.update", d.version + 1],
    ]);
    const cell = await api.db
      .selectFrom("transformation_raci_assignment")
      .select("id")
      .where("deliverable_id", "=", d.id)
      .where("party_code", "=", "TD")
      .executeTakeFirstOrThrow();
    expect((await auditOf(api.db, cell.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
      ["transformation_raci_assignment.create", p.lead.id],
      ["transformation_raci_assignment.update", w.office.id],
    ]);
  });

  it("commit-time authorization: a raci.edit right revoked while the request waits is refused, nothing written", async () => {
    const q = await setupApprovalWorld(api, w);
    const d = deliverable(await raciOf(q), "charter");
    const res = await afterIdentity(
      api,
      q.lead.id,
      () =>
        call(api.app, "PATCH", `${T(q)}/raci/deliverables/${d.id}`, {
          session: q.lead.session,
          headers: ifm(d.version),
          body: { labelEn: "Synthetic revoked" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, q.lead.id),
    );
    expect(res.status).toBe(403);
    expect(deliverable(await raciOf(q), "charter")).toEqual(d);
  });
});

describe("governance matrix approval (REQ-S10-007 'versioned, approved changes'; REQ-PB-067 'approve: SP')", () => {
  it("submit freezes the version and routes it to the Sponsor; the Sponsor approves it; a later edit returns it to draft", async () => {
    const q = await setupApprovalWorld(api, w);
    const S = `${T(q)}/governance-matrices/raci/submit`;
    const list0 = await send("GET", `${T(q)}/governance-matrices`, { session: q.auditor.session });
    expect(list0.body.items.map((m: Body) => [m.kind, m.status])).toEqual([
      ["decision_rights", "draft"],
      ["raci", "draft"],
    ]);
    const header = list0.body.items.find((m: Body) => m.kind === "raci");
    const title = { title: "Synthetic RACI for the Sponsor's business approval" };
    expect(
      (await send("POST", S, { session: q.auditor.session, headers: ifm(header.version), body: title })).status,
    ).toBe(403);
    expect((await send("POST", S, { session: q.bo.session, headers: ifm(header.version), body: title })).status).toBe(
      403,
    );
    expect((await send("POST", S, { session: q.lead.session, body: title })).status).toBe(428);
    expect(
      (await send("POST", S, { session: q.lead.session, headers: ifm(header.version + 1), body: title })).status,
    ).toBe(409);
    const submitted = await send("POST", S, { session: q.lead.session, headers: ifm(header.version), body: title });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect(submitted.headers["location"]).toBe(`/api/v1/approvals/${submitted.body.id}`);
    expect(submitted.body).toMatchObject({
      approvalType: "governance_matrix_change",
      subjectType: "governance_matrix",
      subjectId: header.id,
      subjectVersion: header.version + 1,
      status: "pending",
      assignee: { partyCode: "SP", userId: q.sponsor.id, groupId: null },
      dueDate: null,
      dueUnknownReason: "no_sla",
    });
    const inApproval = (await raciOf(q)).matrix;
    expect([inApproval.status, inApproval.version, inApproval.openApprovalId]).toEqual([
      "in_approval",
      header.version + 1,
      submitted.body.id,
    ]);
    // Rows are frozen while in approval; a second submit is not a draft.
    const frozen = await patchCells(q, "charter", { labelEn: "Synthetic frozen" });
    expect([frozen.status, frozen.body.code, frozen.body.detail]).toEqual([
      422,
      "governance_matrix.in_approval",
      "This matrix is waiting for approval. It can change again once the approval is decided or withdrawn.",
    ]);
    const again = await send("POST", S, { session: q.lead.session, headers: ifm(header.version + 1), body: title });
    expect([again.status, again.body.code]).toEqual([422, "governance_matrix.not_draft"]);
    // The Sponsor (a named person) decides; the requester cannot (separation of duties, BE-B's service).
    const decide = (session: Body) =>
      send("POST", `/api/v1/approvals/${submitted.body.id}/decisions`, {
        session,
        headers: ifm(1),
        body: {
          outcome: "approve",
          rationale: "Synthetic: the RACI matches our governance.",
          subjectVersion: header.version + 1,
        },
      });
    expect((await decide(q.lead.session)).status).toBe(403);
    const approved = await decide(q.sponsor.session);
    expect([approved.status, approved.body.status]).toEqual([200, "approved"]);
    const after = (await raciOf(q)).matrix;
    expect(after).toMatchObject({
      status: "approved",
      approvedVersion: header.version + 1,
      approvedBy: q.sponsor.id,
      openApprovalId: null,
    });
    expect((await auditOf(api.db, header.id)).map((e) => e.action).slice(-2)).toEqual([
      "governance_matrix.submit",
      "governance_matrix.approve",
    ]);
    // An edit to the approved matrix sets it back to draft; the approval stays in the history.
    const edited = await patchCells(q, "charter", { labelEn: "Synthetic charter, revised" });
    expect(edited.status).toBe(200);
    const draft = (await raciOf(q)).matrix;
    expect([draft.status, draft.approvedVersion]).toEqual(["draft", header.version + 1]);
  });

  it("T11: TL submits (decision_right.configure); a rejection returns the matrix to draft and unfreezes the rows", async () => {
    const q = await setupApprovalWorld(api, w);
    const list = await send("GET", `${T(q)}/governance-matrices`, { session: q.lead.session });
    const header = list.body.items.find((m: Body) => m.kind === "decision_rights");
    const submitted = await send("POST", `${T(q)}/governance-matrices/decision_rights/submit`, {
      session: q.lead.session,
      headers: ifm(header.version),
      body: { title: "Synthetic T11 matrix", requestNote: "Synthetic note" },
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    const row = `${T(q)}/decision-rights/${q.rights["business_scope_change"]}`;
    const v = (await send("GET", row, { session: q.lead.session })).body.version;
    const frozen = await send("PATCH", row, { session: q.lead.session, headers: ifm(v), body: { slaWorkingDays: 6 } });
    expect([frozen.status, frozen.body.code]).toEqual([422, "governance_matrix.in_approval"]);
    const rejected = await send("POST", `/api/v1/approvals/${submitted.body.id}/decisions`, {
      session: q.sponsor.session,
      headers: ifm(1),
      body: { outcome: "reject", rationale: "Synthetic: keep the playbook SLA.", subjectVersion: header.version + 1 },
    });
    expect([rejected.status, rejected.body.status]).toEqual([200, "rejected"]);
    const m = (await send("GET", `${T(q)}/governance-matrices`, { session: q.lead.session })).body.items.find(
      (x: Body) => x.kind === "decision_rights",
    );
    expect([m.status, m.approvedVersion, m.openApprovalId]).toEqual(["draft", null, null]);
    expect(
      (await send("PATCH", row, { session: q.lead.session, headers: ifm(v), body: { slaWorkingDays: 6 } })).status,
    ).toBe(200);
  });

  it("an unmapped Sponsor blocks the submit with a visible routing error; nothing is written", async () => {
    const q = await setupApprovalWorld(api, w);
    const sp = await api.db
      .selectFrom("role_mapping")
      .select(["id", "version"])
      .where("transformation_id", "=", q.transformationId)
      .where("party_code", "=", "SP")
      .executeTakeFirstOrThrow();
    await send("POST", `${T(q)}/role-mappings/${sp.id}/end`, {
      session: q.lead.session,
      headers: ifm(sp.version),
      body: { reason: "Synthetic" },
    });
    const header = (await raciOf(q)).matrix;
    const res = await send("POST", `${T(q)}/governance-matrices/raci/submit`, {
      session: q.lead.session,
      headers: ifm(header.version),
      body: { title: "Synthetic" },
    });
    expect([res.status, res.body.code]).toEqual([422, "routing.role_unmapped"]);
    expect((await raciOf(q)).matrix).toEqual(header);
    expect(
      await api.db.selectFrom("approval").select("id").where("transformation_id", "=", q.transformationId).execute(),
    ).toEqual([]);
  });
});

describe("REQ-PB-008: Transform readiness (operating model before execution)", () => {
  it("not ready when the charter decision rights or T11 are empty; ready once they are completed; DG3 readiness unchanged", async () => {
    const q = await setupApprovalWorld(api, w);
    const R = `${T(q)}/readiness/transform`;
    const first = await send("GET", R, { session: q.auditor.session });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      transformationId: q.transformationId,
      phase: "transform",
      status: "not_ready",
      checks: [
        { code: "charter_decision_rights", passed: false, missing: ["charter.decision_rights"] },
        { code: "t11_seeded_decisions", passed: true, missing: [] },
        { code: "t11_approvers_mapped", passed: false, missing: ["STEERCO"] },
        { code: "t12_accountable", passed: true, missing: [] },
      ],
    });
    const charter = await send("POST", `${T(q)}/charter`, {
      session: q.lead.session,
      body: { decisionRights: "Synthetic: decisions follow the T11 matrix; the Sponsor approves scope changes." },
    });
    expect(charter.status, JSON.stringify(charter.body)).toBe(201);
    const steerco = await createUser(api.db, w.orgA.id);
    await mapParty((m, u, o) => send(m, u, o), q, "STEERCO", steerco.id);
    const ready = await send("GET", R, { session: q.auditor.session });
    expect([ready.body.status, ready.body.checks.every((c: Body) => c.passed)]).toEqual(["ready", true]);
    // T11 emptied (the seeded rows retired): not ready, naming the missing decisions.
    for (const key of ["business_scope_change", "funding_reallocation", "target_state_design", "go_live_scale"]) {
      const row = `${T(q)}/decision-rights/${q.rights[key]}`;
      const v = (await send("GET", row, { session: q.lead.session })).body.version;
      expect(
        (await send("PATCH", row, { session: q.lead.session, headers: ifm(v), body: { status: "retired" } })).status,
      ).toBe(200);
    }
    const empty = await send("GET", R, { session: q.auditor.session });
    expect(empty.body.status).toBe("not_ready");
    expect(empty.body.checks[1]).toEqual({
      code: "t11_seeded_decisions",
      passed: false,
      missing: ["business_scope_change", "funding_reallocation", "target_state_design", "go_live_scale"],
    });
    // The DG3 readiness operation keeps its own shape (D-090).
    const dg3 = await send("GET", `${T(q)}/readiness`, { session: q.auditor.session });
    expect(dg3.status).toBe(200);
    expect(Object.keys(dg3.body).sort()).toEqual(
      [
        "currentPhase",
        "diagnostic",
        "entryPhase",
        "gates",
        "missingDiagnosticAreas",
        "mode",
        "sequencing",
        "transformationId",
      ].sort(),
    );
    const outsider = await signIn(api.app, (await createUser(api.db, w.orgA.id)).subject);
    expect((await send("GET", R, { session: outsider })).status).toBe(404);
  });
});
