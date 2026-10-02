// P2 registers against a real PostgreSQL (ADR-0016, ADR-0017; REQ-PB-023..043, REQ-S16-013, REQ-S16-026/032):
// starter structure on create (both modes), charter versioning, North Star, the T01/T03 template rules, optimistic
// concurrency, record-level contributor rules, workshop mode, T04 decisions (owner-only decide), the TOM canvas,
// methodology label edits and the transformation team. Every mutation is checked for its audit event.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

describe("starter structure (ADR-0016 §4; REQ-S12-004, REQ-PB-003)", () => {
  it("both End-to-End and Modular creates get the pin, six T01 rows, ten canvas boxes and six gates, each audited", async () => {
    const office = await signIn(api.app, w.office.subject);
    for (const body of [
      { businessUnitId: w.a2, name: "E2E (synthetic)", mode: "end_to_end" },
      { businessUnitId: w.a2, name: "Modular (synthetic)", mode: "modular", entryPhase: "design" },
    ]) {
      const t = await call(api.app, "POST", "/api/v1/transformations", { session: office, body });
      expect(t.status).toBe(201);
      const counts = await sql<{ pin: string; t01: string; cells: string; gates: string; audits: string }>`
        SELECT (SELECT count(*) FROM transformation_config_pin WHERE transformation_id = ${t.body.id}) AS pin,
               (SELECT count(*) FROM diagnostic_item WHERE transformation_id = ${t.body.id} AND is_seeded) AS t01,
               (SELECT count(*) FROM tom_canvas_cell WHERE transformation_id = ${t.body.id}) AS cells,
               (SELECT count(*) FROM gate_instance WHERE transformation_id = ${t.body.id}) AS gates,
               (SELECT count(*) FROM audit_event WHERE request_id = ${String(t.headers["x-request-id"])}) AS audits`.execute(
        api.db,
      );
      expect(counts.rows[0]).toEqual({ pin: "1", t01: "6", cells: "10", gates: "6", audits: "24" });
      const catalogue = await call(api.app, "GET", `/api/v1/transformations/${t.body.id}/methodology`, {
        session: office,
      });
      expect(catalogue.body.tomDimensions).toHaveLength(10);
      expect(catalogue.body.diagnosticWorkstreams).toHaveLength(6);
      expect(catalogue.body.methodologyVersion.sourceSha256).toBe(
        "2584a35282804e639a697478eae75a55a43cfb8c551345dfc7636b9b34548ad2",
      );
    }
  });
});

describe("charter (ADR-0017; REQ-PB-029/030/031/035)", () => {
  let q: P2World;
  let C: string;
  beforeAll(async () => {
    q = await setupP2World(api, w);
    C = `/api/v1/transformations/${q.transformationId}/charter`;
  });

  it("404 charter_not_found until created; create writes version 1 and its snapshot; a second create is 409", async () => {
    expect((await call(api.app, "GET", C, { session: q.lead.session })).body.code).toBe("charter_not_found");
    const created = await call(api.app, "POST", C, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", thesisChange: "If we change bundles", baselineDate: "2026-01-31" },
    });
    expect(created.status).toBe(201);
    expect(created.headers["etag"]).toBe('"1"');
    expect(created.body.charter.version).toBe(1);
    // 0 top outcomes: the 3-5 warning is computed, never blocking. The thesis has only its first part, so the three
    // empty parts are flagged (F-DG2-203, REQ-PB-030).
    expect(created.body.warnings.map((x: { code: string; pointer?: string }) => [x.code, x.pointer])).toEqual([
      ["charter.top_outcomes_count", "/topOutcomes"],
      ["charter.thesis_incomplete", "/charter/thesisOutcomes"],
      ["charter.thesis_incomplete", "/charter/thesisBenefits"],
      ["charter.thesis_incomplete", "/charter/thesisBecause"],
    ]);
    expect(created.body.scopeCheckPrechecks.map((x: { code: string; result: string }) => [x.code, x.result])).toEqual([
      ["outcome_linkage", "not_applicable"],
      ["problem_traceability", "unknown"],
      ["exclusions_documented", "unknown"],
      ["baseline_measurable", "unknown"],
      ["executive_decisions_visible", "unknown"],
    ]);
    expect((await call(api.app, "POST", C, { session: q.lead.session, body: {} })).status).toBe(409);
    const versions = await call(api.app, "GET", `${C}/versions`, { session: q.lead.session });
    expect(versions.body.items.map((v: { versionNo: number }) => v.versionNo)).toEqual([1]);
  });

  it("an invalid baseline date is 400; a horizon without its unit is 400/422; nothing is written", async () => {
    const bad = await call(api.app, "PATCH", C, {
      session: q.lead.session,
      headers: ifm(1),
      body: { baselineDate: "2026-02-30" },
    });
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].pointer).toBe("/baselineDate");
    const half = await call(api.app, "PATCH", C, {
      session: q.lead.session,
      headers: ifm(1),
      body: { targetHorizonValue: 18 },
    });
    expect([half.status, half.body.code]).toEqual([422, "charter.target_horizon_pair"]);
  });

  it("every save is a new immutable version; a stale If-Match is 409; both versions stay retrievable", async () => {
    for (const statement of ["A", "B", "C"])
      await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/outcomes`, {
        session: q.lead.session,
        body: { statement: `Top outcome ${statement}`, isTopOutcome: true },
      });
    const saved = await call(api.app, "PATCH", C, {
      session: q.lead.session,
      headers: ifm(1),
      body: { thesisChange: "If we redesign bundles", changeSummary: "Sharper thesis" },
    });
    expect(saved.status).toBe(200);
    expect(saved.body.charter.version).toBe(2);
    // Three top outcomes: no 3-5 warning. The thesis is still partial (F-DG2-203): only its empty parts are flagged.
    expect(saved.body.warnings.map((x: { code: string }) => x.code)).toEqual([
      "charter.thesis_incomplete",
      "charter.thesis_incomplete",
      "charter.thesis_incomplete",
    ]);
    const stale = await call(api.app, "PATCH", C, {
      session: q.lead.session,
      headers: ifm(1),
      body: { thesisChange: "x" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    const v1 = await call(api.app, "GET", `${C}/versions/1`, { session: q.lead.session });
    const v2 = await call(api.app, "GET", `${C}/versions/2`, { session: q.lead.session });
    expect([v1.body.thesisChange, v2.body.thesisChange, v2.body.changeSummary]).toEqual([
      "If we change bundles",
      "If we redesign bundles",
      "Sharper thesis",
    ]);
    expect(v2.body.topOutcomesSnapshot).toHaveLength(3);
    const charterId = saved.body.charter.id as string;
    expect((await auditOf(api.db, charterId)).map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["charter.create", null, 1],
      ["charter.update", 1, 2],
    ]);
    // The snapshot is append-only, even for the owner role.
    await expect(
      api.owner.query("UPDATE charter_version SET change_summary = 'x' WHERE charter_id = $1", [charterId]),
    ).rejects.toThrow(/append-only/);
  });

  it("a read-only auditor gets 403 on charter create/update and on the North Star", async () => {
    for (const [method, url] of [
      ["POST", C],
      ["PATCH", C],
      ["PUT", `/api/v1/transformations/${q.transformationId}/north-star`],
    ] as const) {
      const res = await call(api.app, method, url, { session: q.auditor.session, headers: ifm(1), body: {} });
      expect(res.status, `${method} ${url}`).toBe(403);
    }
  });
});

describe("North Star (REQ-PB-033)", () => {
  it("one sentence, no line break; refining supersedes (never overwrites); If-Match rules", async () => {
    const q = await setupP2World(api, w);
    const N = `/api/v1/transformations/${q.transformationId}/north-star`;
    expect(
      (await call(api.app, "PUT", N, { session: q.lead.session, body: { statement: "Two lines\nhere" } })).status,
    ).toBe(400);
    expect((await call(api.app, "PUT", N, { session: q.lead.session, body: { statement: "One. Two." } })).status).toBe(
      400,
    );
    expect(
      (await call(api.app, "PUT", N, { session: q.lead.session, headers: ifm(1), body: { statement: "First" } }))
        .status,
    ).toBe(409);
    const first = await call(api.app, "PUT", N, {
      session: q.lead.session,
      body: { statement: "Lead regional roaming." },
    });
    expect(first.status).toBe(200);
    expect(
      (await call(api.app, "PUT", N, { session: q.lead.session, body: { statement: "No If-Match" } })).status,
    ).toBe(428);
    const second = await call(api.app, "PUT", N, {
      session: q.lead.session,
      headers: ifm(1),
      body: { statement: "Lead GCC roaming." },
    });
    expect(second.body).toMatchObject({ status: "current", version: 1 });
    const history = await call(api.app, "GET", `${N}/history`, { session: q.lead.session });
    expect(history.body.items.map((n: { statement: string; status: string }) => [n.statement, n.status])).toEqual([
      ["Lead GCC roaming.", "current"],
      ["Lead regional roaming.", "superseded"],
    ]);
  });
});

describe("T01 / T03 template rules and record-level rules", () => {
  it("T01: confidence outside H/M/L is 400; amount without currency 422; seeded rows cannot be archived", async () => {
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    const seeded = items.body.items[0];
    expect(items.body.items).toHaveLength(6);
    const bad = await call(api.app, "PATCH", `${T}/diagnostic-items/${seeded.id}`, {
      session: p.lead.session,
      headers: ifm(seeded.version),
      body: { confidence: "X" },
    });
    expect([bad.status, bad.body.errors[0].pointer]).toEqual([400, "/confidence"]);
    const noCurrency = await call(api.app, "PATCH", `${T}/diagnostic-items/${seeded.id}`, {
      session: p.lead.session,
      headers: ifm(seeded.version),
      body: { impactAmount: "1000" },
    });
    expect([noCurrency.status, noCurrency.body.code]).toEqual([422, "t01.impact_currency_required"]);
    const archive = await call(api.app, "POST", `${T}/diagnostic-items/${seeded.id}/archive`, {
      session: p.lead.session,
      headers: ifm(seeded.version),
      body: { reason: "Try to drop a seeded row" },
    });
    expect([archive.status, archive.body.code]).toEqual([422, "t01.seeded_not_archivable"]);
    const unknownDim = await call(api.app, "POST", `${T}/diagnostic-items`, {
      session: p.lead.session,
      body: { dimensionCode: "nope" },
    });
    expect([unknownDim.status, unknownDim.body.code]).toEqual([422, "validation.unknown_code"]);
  });

  it("T03: a gap without a TOM dimension is 422 (pointer /dimensionCode); the design decision must be T04 of this transformation", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { gap: "Missing dimension" },
    });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].pointer).toBe("/dimensionCode");
    const wrongDecision = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", designDecisionId: "01920000-0000-7000-8000-0000000000ff" },
    });
    expect([wrongDecision.status, wrongDecision.body.code]).toEqual([422, "t03.design_decision"]);
  });

  it("a contributor (WL) creates and edits only their own rows; status transitions are enforced", async () => {
    const own = await call(api.app, "POST", `${T}/diagnostic-findings`, {
      session: p.contributor.session,
      body: { workstreamCode: "customer", kind: "symptom", statement: "WL finding (synthetic)" },
    });
    expect(own.status).toBe(201);
    const leadFinding = await call(api.app, "POST", `${T}/diagnostic-findings`, {
      session: p.lead.session,
      body: { workstreamCode: "customer", kind: "symptom", statement: "TL finding (synthetic)" },
    });
    const notOwn = await call(api.app, "PATCH", `${T}/diagnostic-findings/${leadFinding.body.id}`, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { statement: "edited by WL" },
    });
    expect(notOwn.status).toBe(403);
    const ok = await call(api.app, "PATCH", `${T}/diagnostic-findings/${own.body.id}`, {
      session: p.contributor.session,
      headers: ifm(1),
      body: { status: "confirmed" },
    });
    expect(ok.status).toBe(200);
    const viaPatch = await call(api.app, "PATCH", `${T}/diagnostic-findings/${own.body.id}`, {
      session: p.contributor.session,
      headers: ifm(2),
      body: { status: "archived" },
    });
    expect([viaPatch.status, viaPatch.body.code]).toEqual([422, "invalid_transition"]);
  });

  it("an archived transformation is read-only for its registers (422)", async () => {
    const q = await setupP2World(api, w);
    const office = await signIn(api.app, w.office.subject);
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/archive`, {
      session: office,
      headers: ifm(1),
      body: { reason: "Synthetic archive" },
    });
    const res = await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/strategic-guardrails`, {
      session: q.lead.session,
      body: { title: "x", category: "risk", statement: "y" },
    });
    expect([res.status, res.body.code]).toEqual([422, "transformation.archived"]);
  });
});

describe("decisions (T04) and workshop mode", () => {
  it("D-nn codes per transformation; only the owner (or a delegate) decides; the decided record is final", async () => {
    const make = (title: string) =>
      call(api.app, "POST", "/api/v1/decisions", {
        session: p.lead.session,
        body: {
          transformationId: p.transformationId,
          title,
          ownerUserId: p.sponsor.id,
          options: [{ title: "A" }, { title: "B" }],
        },
      });
    const d1 = await make("First (synthetic)");
    const d2 = await make("Second (synthetic)");
    expect(Number(d2.body.code.slice(2))).toBe(Number(d1.body.code.slice(2)) + 1);
    expect(d1.body.options.map((o: { label: string }) => o.label)).toEqual(["A", "B"]);
    const byLead = await call(api.app, "POST", `/api/v1/decisions/${d1.body.id}/decide`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { chosenOptionId: d1.body.options[0].id, outcomeText: "Not mine to decide" },
    });
    expect([byLead.status, byLead.body.code]).toEqual([403, "decision.not_owner"]);
    const bySponsor = await call(api.app, "POST", `/api/v1/decisions/${d1.body.id}/decide`, {
      session: p.sponsor.session,
      headers: ifm(1),
      body: { chosenOptionId: d1.body.options[1].id, outcomeText: "Option B (synthetic)" },
    });
    expect(bySponsor.body).toMatchObject({
      status: "decided",
      decidedBy: p.sponsor.id,
      chosenOptionId: d1.body.options[1].id,
    });
    const edit = await call(api.app, "PATCH", `/api/v1/decisions/${d1.body.id}`, {
      session: p.lead.session,
      headers: ifm(2),
      body: { title: "Changed" },
    });
    expect(edit.status).toBe(422);
    const aud = await call(api.app, "POST", `/api/v1/decisions/${d2.body.id}/decide`, {
      session: p.auditor.session,
      headers: ifm(1),
      body: {},
    });
    expect(aud.status).toBe(403);
  });

  it("an unresolved workshop item blocks closing until it is converted into an owned action (one transaction)", async () => {
    const ws = await call(api.app, "POST", `${T}/tom-workshops`, {
      session: p.lead.session,
      body: {
        title: "Workshop (synthetic)",
        workshopDate: "2026-11-09",
        durationMinutes: 90,
        facilitatorUserId: p.lead.id,
      },
    });
    const W = `${T}/tom-workshops/${ws.body.id}`;
    const item = await call(api.app, "POST", `${W}/items`, {
      session: p.lead.session,
      body: { kind: "unresolved", body: "Open question" },
    });
    expect(item.body.status).toBe("open");
    const close = await call(api.app, "PATCH", W, {
      session: p.lead.session,
      headers: ifm(1),
      body: { status: "closed" },
    });
    expect([close.status, close.body.code]).toEqual([422, "workshop.unresolved_items"]);
    const converted = await call(api.app, "POST", `${W}/items/${item.body.id}/convert`, {
      session: p.lead.session,
      headers: ifm(1),
      body: {
        target: "action",
        title: "Answer the open question",
        ownerUserId: p.contributor.id,
        dueDate: "2026-12-01",
      },
    });
    expect(converted.body).toMatchObject({ status: "converted", ownerUserId: p.contributor.id });
    const action = await call(api.app, "GET", `${T}/actions/${converted.body.convertedActionId}`, {
      session: p.lead.session,
    });
    expect(action.body).toMatchObject({
      ownerUserId: p.contributor.id,
      sourceWorkshopItemId: item.body.id,
      status: "open",
    });
    const trail = (await auditOfRequest(api.db, String(converted.headers["x-request-id"]))).map((e) => e.action).sort();
    expect(trail).toEqual(["action_item.create", "tom_workshop_item.convert"]);
    expect(
      (await call(api.app, "PATCH", W, { session: p.lead.session, headers: ifm(1), body: { status: "closed" } }))
        .status,
    ).toBe(200);
    // The action's owner (WL, action.update_own) may update it; someone else's action is 403 for them.
    expect(
      (
        await call(api.app, "PATCH", `${T}/actions/${action.body.id}`, {
          session: p.contributor.session,
          headers: ifm(1),
          body: { status: "in_progress" },
        })
      ).status,
    ).toBe(200);
    const other = await call(api.app, "POST", `${T}/actions`, {
      session: p.lead.session,
      body: { title: "Lead's action", ownerUserId: p.lead.id },
    });
    expect(
      (
        await call(api.app, "PATCH", `${T}/actions/${other.body.id}`, {
          session: p.contributor.session,
          headers: ifm(1),
          body: { status: "done" },
        })
      ).status,
    ).toBe(403);
  });
});

describe("TOM canvas, methodology labels and the team", () => {
  it("the canvas aggregates the gaps, design decisions, dependencies and evidence of a dimension; ready needs target+owner", async () => {
    await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "data_analytics", gap: "No CDP" },
    });
    await call(api.app, "POST", `${T}/dependencies`, {
      session: p.lead.session,
      body: {
        description: "CDP vendor",
        fromKind: "tom_dimension",
        toKind: "external",
        toLabel: "Vendor",
        dependencyType: "vendor",
        tomDimensionCode: "data_analytics",
      },
    });
    const cell = await call(api.app, "GET", `${T}/tom-canvas/data_analytics`, { session: p.lead.session });
    expect(cell.body.gaps).toHaveLength(1);
    expect(cell.body.dependencies[0].code).toMatch(/^DEP-\d{2,}$/);
    expect(cell.body.dimension.sourceCanvasBoxEn.length).toBeGreaterThan(0);
    const notReady = await call(api.app, "PATCH", `${T}/tom-canvas/data_analytics`, {
      session: p.lead.session,
      headers: ifm(cell.body.cell.version),
      body: { status: "ready" },
    });
    expect([notReady.status, notReady.body.code]).toEqual([422, "tom_canvas.ready_incomplete"]);
    const canvas = await call(api.app, "GET", `${T}/tom-canvas`, { session: p.auditor.session });
    expect(canvas.body.cells).toHaveLength(10);
  });

  it("methodology labels: only label/translation fields, versioned and audited; others get 403", async () => {
    const before = await call(api.app, "GET", `${T}/methodology`, { session: p.lead.session });
    const dim = before.body.tomDimensions.find((d: { code: string }) => d.code === "organization");
    const denied = await call(api.app, "PATCH", "/api/v1/methodology/tom-dimensions/organization", {
      session: p.auditor.session,
      headers: ifm(dim.version),
      body: { labelAr: "x" },
    });
    expect(denied.status).toBe(403);
    const sourceEdit = await call(api.app, "PATCH", "/api/v1/methodology/tom-dimensions/organization", {
      session: p.methodologyAdmin.session,
      headers: ifm(dim.version),
      body: { sourceNameEn: "Hacked" },
    });
    expect(sourceEdit.status).toBe(400);
    const ok = await call(api.app, "PATCH", "/api/v1/methodology/tom-dimensions/organization", {
      session: p.methodologyAdmin.session,
      headers: ifm(dim.version),
      body: { labelAr: dim.labelAr },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(dim.version + 1);
    expect(ok.body.sourceNameEn).toBe(dim.sourceNameEn);
  });

  it("team: accountabilities (B0018 verbatim for source roles); team.assign only non-approver roles, never self", async () => {
    const acc = await call(api.app, "GET", "/api/v1/role-accountabilities", { session: p.contributor.session });
    const sp = acc.body.items.find((a: { roleCode: string }) => a.roleCode === "SP");
    expect(sp).toMatchObject({ isSourceText: true, sourceRef: "B0018" });
    const member = await createUser(api.db, w.orgA.id);
    const sponsorRole = await call(api.app, "POST", `${T}/scoped-assignments`, {
      session: p.lead.session,
      body: { userId: member.id, roleCode: "SP", reason: "Try to create an approver" },
    });
    expect(sponsorRole.status).toBe(400);
    const self = await call(api.app, "POST", `${T}/scoped-assignments`, {
      session: p.lead.session,
      body: { userId: p.lead.id, roleCode: "WL", reason: "Self grant" },
    });
    expect([self.status, self.body.code]).toEqual([422, "access.self_grant"]);
    const ok = await call(api.app, "POST", `${T}/scoped-assignments`, {
      session: p.lead.session,
      body: { userId: member.id, roleCode: "TD", reason: "Technology input (synthetic)" },
    });
    expect(ok.body).toMatchObject({ roleCode: "TD", scope: { type: "transformation", id: p.transformationId } });
    const team = await call(api.app, "GET", `${T}/scoped-assignments?limit=100`, { session: p.lead.session });
    const td = team.body.items.find((i: { assignment: { userId: string } }) => i.assignment.userId === member.id);
    expect(td).toMatchObject({ inherited: false, accountability: { roleCode: "TD", isSourceText: false } });
    // The organization-level TO (inherits downward) appears as inherited team membership.
    expect(
      team.body.items.some(
        (i: { inherited: boolean; assignment: { roleCode: string } }) => i.inherited && i.assignment.roleCode === "TO",
      ),
    ).toBe(true);
    expect(
      (await call(api.app, "POST", `${T}/scoped-assignments`, { session: p.auditor.session, body: {} })).status,
    ).toBe(403);
  });
});

describe("outcomes: the good outcome test (B0051, REQ-PB-036), computed server-side on every Outcome response", () => {
  type Result = { criterionCode: string; ordinal: number; result: string; reason: string | null };
  const byCode = (test: Result[]) => new Map(test.map((r) => [r.criterionCode, r]));
  let q: P2World;
  let Q: string;
  beforeAll(async () => {
    q = await setupP2World(api, w);
    Q = `/api/v1/transformations/${q.transformationId}`;
  });

  it("A01: 'Launch new app' with no KPI fails the test with reasons (create, get and list agree); it is not stored", async () => {
    const created = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.lead.session,
      body: { statement: "Launch new app" },
    });
    expect(created.status).toBe(201);
    expect(created.body.goodOutcomePass).toBe(false);
    const test = created.body.goodOutcomeTest as Result[];
    // All five catalogue criteria (migration 0011), in ordinal order.
    expect(test.map((r) => [r.ordinal, r.criterionCode, r.result])).toEqual([
      [1, "specific", "fail"],
      [2, "measurable", "fail"],
      [3, "strategically_relevant", "unknown"],
      [4, "owned_by_business_leader", "fail"],
      [5, "causal_chain", "unknown"],
    ]);
    const c = byCode(test);
    expect(c.get("specific")!.reason).toMatch(/not specific.*"launch"/);
    expect(c.get("measurable")!.reason).toBe("No KPI linked: the outcome has no active Outcome & KPI Tree row.");
    expect(c.get("owned_by_business_leader")!.reason).toMatch(/No owner set/);
    expect(c.get("strategically_relevant")!.reason).toMatch(/not recorded/);
    expect(c.get("causal_chain")!.reason).toMatch(/no causal chain/);

    // The read-only auditor sees the same computed result on get and list.
    const got = await call(api.app, "GET", `${Q}/outcomes/${created.body.id}`, { session: q.auditor.session });
    expect(got.status).toBe(200);
    expect(got.body.goodOutcomeTest).toEqual(test);
    const list = await call(api.app, "GET", `${Q}/outcomes`, { session: q.auditor.session });
    const listed = list.body.items.find((o: { id: string }) => o.id === created.body.id);
    expect(listed).toMatchObject({ goodOutcomePass: false, goodOutcomeTest: test });

    // Computed, never stored: the audit diff has no such field; the table has no such column.
    const audit = await auditOf(api.db, created.body.id);
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).not.toMatch(/goodOutcome|good_outcome/);
    const cols = await sql<{ n: string }>`SELECT count(*) AS n FROM information_schema.columns
      WHERE table_name = 'outcome' AND column_name LIKE '%good_outcome%'`.execute(api.db);
    expect(cols.rows[0]!.n).toBe("0");
  });

  it("the computed fields are not writable: create and update with goodOutcomeTest/goodOutcomePass are 400, nothing written", async () => {
    const bad = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.lead.session,
      body: { statement: "Raise NPS (synthetic)", goodOutcomePass: true },
    });
    expect(bad.status).toBe(400);
    expect(await auditOfRequest(api.db, String(bad.headers["x-request-id"]))).toEqual([]);
    const o = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.lead.session,
      body: { statement: "Raise NPS (synthetic)" },
    });
    const patched = await call(api.app, "PATCH", `${Q}/outcomes/${o.body.id}`, {
      session: q.lead.session,
      headers: ifm(1),
      body: { goodOutcomeTest: [] },
    });
    expect(patched.status).toBe(400);
  });

  it("pass: confirmations, an active owner, a causal chain and a linked KPI; update and archive of the KPI re-evaluate", async () => {
    const created = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.lead.session,
      body: {
        statement: "Raise the digital self-service share of postpaid top-ups from 40% to 65% (synthetic)",
        ownerUserId: q.sponsor.id,
        isTopOutcome: true,
        topRank: 1,
        specificConfirmed: true,
        strategicallyRelevantConfirmed: true,
        causalChain: "Simpler app journey -> fewer drop-offs -> higher self-service share (synthetic)",
      },
    });
    expect(created.status).toBe(201);
    // Everything recorded except the KPI: measurable fails, so the test does not pass.
    expect(byCode(created.body.goodOutcomeTest).get("measurable")!.result).toBe("fail");
    expect(created.body.goodOutcomePass).toBe(false);

    const kpi = await call(api.app, "POST", `${Q}/kpi-definitions`, {
      session: q.lead.session,
      body: { name: "Self-service top-up share (synthetic)", unitKind: "percentage", polarity: "higher_is_better" },
    });
    expect(kpi.status, JSON.stringify(kpi.body)).toBe(201);
    const row = await call(api.app, "POST", `${Q}/outcome-kpis`, {
      session: q.lead.session,
      body: { outcomeId: created.body.id, kpiDefinitionId: kpi.body.id, targetDate: "2027-12-31" },
    });
    expect(row.status, JSON.stringify(row.body)).toBe(201);

    const passing = await call(api.app, "GET", `${Q}/outcomes/${created.body.id}`, { session: q.lead.session });
    expect(passing.body.goodOutcomePass).toBe(true);
    expect((passing.body.goodOutcomeTest as Result[]).every((r) => r.result === "pass")).toBe(true);
    expect(byCode(passing.body.goodOutcomeTest).get("measurable")!.reason).toMatch(/1 KPI\(s\) linked/);

    // The charter view's top outcomes carry the same computed fields.
    const charter = await call(api.app, "POST", `${Q}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic good-outcome charter" },
    });
    expect(charter.status).toBe(201);
    expect(charter.body.topOutcomes).toEqual([expect.objectContaining({ id: created.body.id, goodOutcomePass: true })]);
    // REQ-PB-035 still holds: one top outcome -> the 3-5 warning (the empty thesis is flagged too, F-DG2-203).
    expect(
      charter.body.warnings
        .map((x: { code: string }) => x.code)
        .filter((c: string) => c !== "charter.thesis_incomplete"),
    ).toEqual(["charter.top_outcomes_count"]);

    // An update that withdraws an attestation: the update response itself re-evaluates (unknown, not a pass).
    const updated = await call(api.app, "PATCH", `${Q}/outcomes/${created.body.id}`, {
      session: q.lead.session,
      headers: ifm(1),
      body: { strategicallyRelevantConfirmed: null },
    });
    expect(updated.status).toBe(200);
    expect(byCode(updated.body.goodOutcomeTest).get("strategically_relevant")!.result).toBe("unknown");
    expect(updated.body.goodOutcomePass).toBe(false);
    // A stale If-Match is still 409 (the computed fields change nothing about concurrency).
    const stale = await call(api.app, "PATCH", `${Q}/outcomes/${created.body.id}`, {
      session: q.lead.session,
      headers: ifm(1),
      body: { strategicallyRelevantConfirmed: true },
    });
    expect(stale.status).toBe(409);
    const restored = await call(api.app, "PATCH", `${Q}/outcomes/${created.body.id}`, {
      session: q.lead.session,
      headers: ifm(2),
      body: { strategicallyRelevantConfirmed: true },
    });
    expect(restored.body.goodOutcomePass).toBe(true);

    // Archiving the only T02 row: no active KPI link -> measurable fails again.
    const archived = await call(api.app, "POST", `${Q}/outcome-kpis/${row.body.id}/archive`, {
      session: q.lead.session,
      headers: ifm(row.body.version),
      body: { reason: "Synthetic: KPI replaced" },
    });
    expect(archived.status, JSON.stringify(archived.body)).toBe(200);
    const after = await call(api.app, "GET", `${Q}/outcomes/${created.body.id}`, { session: q.lead.session });
    expect(byCode(after.body.goodOutcomeTest).get("measurable")!.result).toBe("fail");
    expect(after.body.goodOutcomePass).toBe(false);
  });

  it("explicit negatives fail; activity wording fails 'specific' even when attested; the read-only auditor gets 403", async () => {
    const o = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.lead.session,
      body: {
        statement: "Implement the new CRM (synthetic)",
        specificConfirmed: true,
        strategicallyRelevantConfirmed: false,
        ownerUserId: q.lead.id,
        causalChain: "CRM -> better targeting (synthetic)",
      },
    });
    expect(o.status).toBe(201);
    const c = byCode(o.body.goodOutcomeTest);
    expect(c.get("specific")!.result).toBe("fail");
    expect(c.get("strategically_relevant")).toMatchObject({
      result: "fail",
      reason: "Not confirmed as strategically relevant.",
    });
    expect(c.get("owned_by_business_leader")!.result).toBe("pass");
    expect(c.get("causal_chain")!.result).toBe("pass");
    const denied = await call(api.app, "POST", `${Q}/outcomes`, {
      session: q.auditor.session,
      body: { statement: "Raise NPS (synthetic)" },
    });
    expect(denied.status).toBe(403);
  });
});
