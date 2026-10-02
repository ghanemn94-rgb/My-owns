// Product gates G1-G3 (ADR-0015 §2; REQ-PB-016/017/018, REQ-S04-003/004/005, REQ-S13-012, REQ-DLV-034,
// REQ-S10-016 requester != approver). Against a real PostgreSQL: submission blocked by incomplete criteria (and by a
// missing initial charter), filename-only evidence leaves the criterion incomplete, a non-approver and the submitter
// get 403, a decision on a superseded submission gets 409 with nothing written, approval advances the phase, and a
// read-only auditor gets 403. These are BUSINESS gates inside the product: the test data is synthetic, the demo
// decisions approve nothing real, and nothing here touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  grant,
  seedWorld,
  startApi,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const gateUrl = (p: P2World, code = "G1") => `/api/v1/transformations/${p.transformationId}/gates/${code}`;
type Criterion = { key: string; completeness: string; missing: { code: string }[]; unverifiedEvidenceIds: string[] };

async function submit(p: P2World, session = p.lead.session, code = "G1") {
  return call(api.app, "POST", `${gateUrl(p, code)}/submissions`, {
    session,
    headers: ifm(await gateVersion(api, p, code)),
    body: { submissionNote: "Synthetic submission" },
  });
}
const decide = (p: P2World, session: P2World["lead"]["session"], submissionNo: number, outcome = "approved") =>
  call(api.app, "POST", `${gateUrl(p)}/decision`, {
    session,
    body: { submissionNo, outcome, rationale: "Synthetic rationale for a demo decision." },
  });

describe("starter structure and live readiness", () => {
  it("a new transformation has six gate instances (G1-G6), draft, approver SP; G4-G6 are not submittable in P2", async () => {
    const p = await setupP2World(api, w);
    const list = await call<{
      items: {
        gate: { gateCode: string; status: string; approverRoleCode: string };
        submissionEnabled: boolean;
        canSubmit: boolean;
      }[];
    }>(api.app, "GET", `/api/v1/transformations/${p.transformationId}/gates`, { session: p.lead.session });
    expect(list.status).toBe(200);
    expect(
      list.body.items.map((i) => [i.gate.gateCode, i.gate.status, i.gate.approverRoleCode, i.submissionEnabled]),
    ).toEqual([
      ["G1", "draft", "SP", true],
      ["G2", "draft", "SP", true],
      ["G3", "draft", "SP", true],
      ["G4", "draft", "SP", false],
      ["G5", "draft", "SP", false],
      ["G6", "draft", "SP", false],
    ]);
    expect(list.body.items.every((i) => !i.canSubmit)).toBe(true);
    const g4 = await submit(p, p.lead.session, "G4");
    expect([g4.status, g4.body.code]).toEqual([422, "gate_not_enabled"]);
  });

  it("G1 submission without an initial charter is refused (422 gate_criteria_incomplete) and writes nothing", async () => {
    const p = await setupP2World(api, w);
    const res = await submit(p);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("gate_criteria_incomplete");
    expect(res.body.errors.map((e: { pointer: string }) => e.pointer)).toContain("/criteria/g1.initial_charter");
    expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
    const subs = await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(subs).toEqual([]);
  });

  it("REQ-S13-012: evidence that is only a filename (or an inaccessible link) leaves g1.diagnostic incomplete", async () => {
    const p = await setupP2World(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const fileRef = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "file_reference", title: "Study.pdf (synthetic)", fileName: "Study.pdf", ownerUserId: p.lead.id },
    });
    expect(fileRef.status).toBe(201);
    // A filename can never be verified, not even by another reviewer.
    const verify = await call(api.app, "POST", `${T}/evidence/${fileRef.body.id}/review`, {
      session: p.office.session,
      headers: ifm(1),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic" },
    });
    expect([verify.status, verify.body.code]).toEqual([422, "evidence.filename_never_verified"]);
    const link = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: {
        kind: "external_link",
        title: "Intranet page (synthetic)",
        url: "https://intranet.example.invalid/x",
        ownerUserId: p.lead.id,
      },
    });
    await call(api.app, "POST", `${T}/evidence/${link.body.id}/review`, {
      session: p.office.session,
      headers: ifm(1),
      body: { result: "rejected", accessibilityStatus: "inaccessible", note: "Synthetic: link does not open" },
    });
    const items = await call(api.app, "GET", `${T}/diagnostic-items`, { session: p.lead.session });
    for (const item of items.body.items) {
      await call(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
        session: p.lead.session,
        headers: ifm(item.version),
        body: { currentState: "x", rootCause: "y", impactText: "z", confidence: "H" },
      });
      for (const e of [fileRef.body.id, link.body.id])
        expect(
          (
            await call(api.app, "POST", `${T}/evidence-links`, {
              session: p.lead.session,
              body: { evidenceId: e, recordType: "diagnostic_item", recordId: item.id },
            })
          ).status,
        ).toBe(201);
    }
    const view = await call<{ criteria: Criterion[] }>(api.app, "GET", gateUrl(p), { session: p.lead.session });
    const diag = view.body.criteria.find((c) => c.key === "g1.diagnostic")!;
    expect(diag.completeness).toBe("incomplete");
    expect(diag.missing.map((m) => m.code)).toContain("g1.diagnostic.verified_evidence_missing");
    expect(diag.unverifiedEvidenceIds.sort()).toEqual([fileRef.body.id, link.body.id].sort());
  });
});

describe("submission and decision (business approval by a person)", () => {
  let p: P2World;
  beforeAll(async () => {
    p = await setupP2World(api, w);
    await makeG1Ready(api, p);
  });

  it("all G1 criteria are complete live; AUD cannot submit (403) and nothing is written", async () => {
    const view = await call<{ criteria: Criterion[]; canSubmit: boolean }>(api.app, "GET", gateUrl(p), {
      session: p.lead.session,
    });
    expect(view.body.criteria.map((c) => [c.key, c.completeness])).toEqual([
      ["g1.diagnostic", "complete"],
      ["g1.baseline", "complete"],
      ["g1.root_causes", "complete"],
      ["g1.value_pools", "complete"],
      ["g1.case_for_change", "complete"],
      ["g1.initial_charter", "complete"],
    ]);
    expect(view.body.canSubmit).toBe(true);
    const aud = await submit(p, p.auditor.session);
    expect(aud.status).toBe(403);
    const writes = (await auditOfRequest(api.db, String(aud.headers["x-request-id"]))).map((e) => e.action);
    expect(writes).toEqual(["authorization.denied"]);
  });

  it("stale If-Match on submit is 409; a valid submit freezes submission 1 with its criteria and charter version", async () => {
    const stale = await call(api.app, "POST", `${gateUrl(p)}/submissions`, {
      session: p.lead.session,
      headers: ifm(99),
      body: {},
    });
    expect(stale.status).toBe(409);
    const res = await submit(p);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ submissionNo: 1, status: "pending", charterVersionNo: 1, approverRoleCode: "SP" });
    expect(res.body.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    const view = await call(api.app, "GET", `${gateUrl(p)}/submissions/1`, { session: p.lead.session });
    expect(view.body.criteria).toHaveLength(6);
    expect(view.body.criteria.every((c: { completeness: string }) => c.completeness === "complete")).toBe(true);
    expect(view.body.decision).toBeNull();
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual(["gate_submission.create"]);
  });

  it("a non-configured approver (TO, technical admin, auditor) gets 403 gate.not_approver; nothing is written", async () => {
    for (const session of [p.office.session, p.auditor.session]) {
      const res = await decide(p, session, 1);
      expect([res.status, res.body.code]).toEqual([403, "gate.not_approver"]);
      const writes = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
      expect(writes).toEqual(["authorization.denied"]);
    }
  });

  it("the submitter cannot decide, even when they hold the approver role (403 gate.submitter_cannot_decide)", async () => {
    const q = await setupP2World(api, w);
    await makeG1Ready(api, q);
    // The sponsor also holds TL here, so they can submit - and then must not decide their own submission.
    await grant(
      api.db,
      w.grantor.id,
      q.sponsor.id,
      "TL",
      { type: "transformation", id: q.transformationId },
      w.orgA.id,
    );
    const sub = await submit(q, q.sponsor.session);
    expect(sub.status).toBe(201);
    const res = await decide(q, q.sponsor.session, 1);
    expect([res.status, res.body.code]).toEqual([403, "gate.submitter_cannot_decide"]);
    const gate = await call(api.app, "GET", gateUrl(q), { session: q.sponsor.session });
    expect(gate.body.gate.status).toBe("submitted");
    expect(gate.body.canDecide).toBe(false);
  });

  it("a decision on a superseded submission is 409 (gate.submission_superseded) and writes nothing", async () => {
    const second = await submit(p);
    expect([second.status, second.body.submissionNo]).toEqual([201, 2]);
    const first = await call(api.app, "GET", `${gateUrl(p)}/submissions/1`, { session: p.lead.session });
    expect(first.body.submission).toMatchObject({ status: "superseded", supersededBySubmissionId: second.body.id });
    const stale = await decide(p, p.sponsor.session, 1);
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      type: "urn:mth:problem:version-conflict",
      code: "gate.submission_superseded",
      currentVersion: 2,
    });
    expect(await auditOfRequest(api.db, String(stale.headers["x-request-id"]))).toEqual([]);
    const decisions = await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(decisions).toEqual([]);
  });

  it("the configured approver (SP) approves the current submission: decision recorded, G1 approved, phase -> define", async () => {
    const before = await call(api.app, "GET", `/api/v1/transformations/${p.transformationId}`, {
      session: p.lead.session,
    });
    expect(before.body.currentPhase).toBe("diagnose");
    const res = await decide(p, p.sponsor.session, 2);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      gateCode: "G1",
      submissionNo: 2,
      outcome: "approved",
      decidedBy: p.sponsor.id,
      approverBasis: "default_role",
      approverRoleCode: "SP",
      decisionKind: "gate",
    });
    const gate = await call(api.app, "GET", gateUrl(p), { session: p.lead.session });
    expect(gate.body.gate.status).toBe("approved");
    expect(gate.body.gate.approvedAt).not.toBeNull();
    const after = await call(api.app, "GET", `/api/v1/transformations/${p.transformationId}`, {
      session: p.lead.session,
    });
    expect(after.body.currentPhase).toBe("define");
    // The canonical decision row (one decision model): kind gate, GD-nn, listed by the decision register.
    const register = await call(api.app, "GET", `/api/v1/decisions?transformationId=${p.transformationId}&kind=gate`, {
      session: p.lead.session,
    });
    expect(register.body.items.map((d: { code: string; status: string }) => [d.code, d.status])).toEqual([
      ["GD-01", "decided"],
    ]);
    const trail = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action).sort();
    expect(trail).toEqual(
      [
        "decision.create",
        "gate_decision.create",
        "gate_instance.decide",
        "gate_submission.decide",
        "transformation.phase_advance",
      ].sort(),
    );
    // A decided submission cannot be decided again, and an approved gate cannot be resubmitted.
    expect((await decide(p, p.sponsor.session, 2)).status).toBe(409);
    expect((await submit(p)).body.code).toBe("gate.already_approved");
  });

  it("configuring the approver: allowed roles only, refused while a submission is pending, needs gate.configure", async () => {
    const q = await setupP2World(api, w);
    const url = gateUrl(q, "G2");
    const v = await gateVersion(api, q, "G2");
    const notAllowed = await call(api.app, "PATCH", url, {
      session: q.office.session,
      headers: ifm(v),
      body: { approverRoleCode: "WL" },
    });
    expect([notAllowed.status, notAllowed.body.code]).toEqual([422, "gate.approver_role_not_allowed"]);
    const byLead = await call(api.app, "PATCH", url, {
      session: q.lead.session,
      headers: ifm(v),
      body: { approverRoleCode: "SP" },
    });
    expect(byLead.status).toBe(403);
    const named = await call(api.app, "PATCH", url, {
      session: q.office.session,
      headers: ifm(v),
      body: { approverRoleCode: "SP", approverUserId: q.sponsor.id },
    });
    expect(named.status).toBe(200);
    expect(named.body.gate).toMatchObject({ approverUserId: q.sponsor.id, version: v + 1 });
    const notHolder = await call(api.app, "PATCH", url, {
      session: q.office.session,
      headers: ifm(v + 1),
      body: { approverRoleCode: "SP", approverUserId: q.contributor.id },
    });
    expect([notHolder.status, notHolder.body.code]).toEqual([422, "gate.approver_not_role_holder"]);
  });
});
