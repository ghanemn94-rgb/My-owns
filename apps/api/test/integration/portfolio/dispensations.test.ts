// Gate dispensations (ADR-0021 §4-§6; REQ-PB-004, REQ-PB-005; T-DG3-BE-A) against a real PostgreSQL:
//  - waiver (End-to-End): reason, scope, expiry required; accepted only by the waived gate's configured approver and
//    never by its recorder; it unblocks the launch sequencing of that gate only and can be revoked;
//  - inherited approval (Modular): approving body, date and evidence required; it counts only once its evidence is
//    VERIFIED and it is accepted by a person other than the recorder;
//  - never a gate decision, never a gate status change; every mutation audited, If-Match 428/409, AUD 403;
//  - the gate list and gate view annotate the gate with `inheritedApproval` and keep its status draft (F-DG3-120).
// Synthetic data; the acceptances are demo business decisions that approve nothing real (never DG0-DG7).
import { gateList, gateView } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { setGateStatus, setupModularWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(() => api.close());

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const base = (p: P2World) => `/api/v1/transformations/${p.transformationId}/gate-dispensations`;
type D = { id: string; version: number; status: string; counts: boolean; evidenceVerified: boolean | null };

const create = (p: P2World, body: Record<string, unknown>, session: Session = p.lead.session) =>
  call<D & { code: string; errors: { pointer: string }[] }>(api.app, "POST", base(p), { session, body });
const decideD = (
  p: P2World,
  d: { id: string; version: number },
  result: string,
  session: Session = p.sponsor.session,
) =>
  call<D & { code: string }>(api.app, "POST", `${base(p)}/${d.id}/decision`, {
    session,
    headers: ifm(d.version),
    body: { result, note: "Synthetic demo decision." },
  });
const waiver = (gateCode = "G3", over: Record<string, unknown> = {}) => ({
  kind: "waiver",
  gateCode,
  reason: "Synthetic: the Wave 1 pilot may launch before the target state is approved.",
  expiresOn: inDays(30),
  ...over,
});
const readiness = (p: P2World) =>
  call(api.app, "GET", `/api/v1/transformations/${p.transformationId}/readiness`, { session: p.lead.session });

async function gateState(p: P2World) {
  const decisions = await api.db
    .selectFrom("gate_decision")
    .select("id")
    .where("transformation_id", "=", p.transformationId)
    .execute();
  const gates = await api.db
    .selectFrom("gate_instance")
    .select(["gate_code", "status"])
    .where("transformation_id", "=", p.transformationId)
    .orderBy("gate_code")
    .execute();
  return { decisions: decisions.length, gates: gates.map((g) => `${g.gate_code}:${g.status}`) };
}

describe("waivers (End-to-End launch sequencing)", () => {
  it("create: 201 pending, version 1, audited; reason/expiry required, G1 never waived, no past expiry, AUD 403", async () => {
    const p = await setupP2World(api, w);
    const res = await create(p, waiver());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({ status: "pending", counts: false, version: 1, evidenceVerified: null });
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual(["gate_dispensation.create"]);

    const missing = await create(p, { kind: "waiver", gateCode: "G3" });
    expect([missing.status, missing.body.code]).toEqual([422, "dispensation.waiver_incomplete"]);
    expect(missing.body.errors.map((e) => e.pointer)).toEqual(["/reason", "/expiresOn"]);
    expect((await create(p, waiver("G1"))).body.code).toBe("dispensation.waiver_gate");
    expect((await create(p, waiver("G3", { expiresOn: "2020-01-01" }))).body.code).toBe("dispensation.expired");
    expect((await create(p, waiver("G3", { approvingBody: "Board" }))).body.code).toBe("dispensation.waiver_shape");
    const inherited = await create(p, {
      kind: "inherited_approval",
      gateCode: "G1",
      approvingBody: "Synthetic board",
      approvedOn: "2026-01-15",
      evidenceId: crypto.randomUUID(),
    });
    expect(inherited.body.code).toBe("dispensation.inherited_requires_modular");
    expect((await create(p, waiver("G3", { reason: "  " }))).status).toBe(400);

    const aud = await create(p, waiver(), p.auditor.session);
    expect(aud.status).toBe(403);
    expect(await auditOfRequest(api.db, String(aud.headers["x-request-id"]))).toEqual([
      expect.objectContaining({ action: "authorization.denied" }),
    ]);
    // A user of another organization (no gate.submit anywhere) is refused before the record is looked at.
    const outsider = await create(p, waiver(), await signIn(api.app, w.officeB.subject));
    expect(outsider.status).toBe(403);
  });

  it("decide: 428/409, AUD 403, not the recorder (403), only the gate's approver (403); accepted unblocks launch", async () => {
    const p = await setupP2World(api, w);
    await setGateStatus(api, p, "G1", "approved");
    await setGateStatus(api, p, "G2", "approved");
    const created = (await create(p, waiver())).body;
    const D = `${base(p)}/${created.id}/decision`;
    expect((await call(api.app, "POST", D, { session: p.sponsor.session, body: { result: "accepted" } })).status).toBe(
      428,
    );
    expect(
      (await call(api.app, "POST", D, { session: p.sponsor.session, headers: ifm(7), body: { result: "accepted" } }))
        .status,
    ).toBe(409);
    expect((await decideD(p, created, "accepted", p.auditor.session)).status).toBe(403);
    expect((await decideD(p, created, "accepted", p.lead.session)).status).toBe(403);
    // A Business Owner holds gate.decide but is not G3's configured approver (SP).
    const bo = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, bo.id, "BO", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const byBo = await decideD(p, created, "accepted", await signIn(api.app, bo.subject));
    expect([byBo.status, byBo.body.code]).toEqual([403, "gate.not_approver"]);
    expect((await readiness(p)).body.sequencing.canLaunchInitiatives).toBe(false);

    // ADR-0021 §6 (T-DG3-ARCH-03): a P3 business approval is decided in person; nothing is written (version stays 1).
    const onBehalf = await call<D & { code: string; type: string; errors: { pointer: string }[] }>(api.app, "POST", D, {
      session: p.sponsor.session,
      headers: ifm(created.version),
      body: { result: "accepted", onBehalfOfUserId: p.office.id },
    });
    expect([onBehalf.status, onBehalf.body.type, onBehalf.body.code, onBehalf.body.errors[0]!.pointer]).toEqual([
      422,
      "urn:mth:problem:validation",
      "dispensation.on_behalf_not_supported",
      "/onBehalfOfUserId",
    ]);

    const accepted = await decideD(p, created, "accepted");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ status: "accepted", counts: true, version: 2 });
    expect(accepted.headers["etag"]).toBe('"2"');
    const r = await readiness(p);
    expect(r.body.sequencing).toMatchObject({ canSubmitInitiatives: true, canLaunchInitiatives: true, blockers: [] });
    expect(r.body.gates.find((g: { gateCode: string }) => g.gateCode === "G3").dispensations).toHaveLength(1);
    expect((await decideD(p, accepted.body, "rejected")).body.code).toBe("dispensation.not_pending");
    // A waiver never approves the gate: no gate decision, G3 still draft.
    expect(await gateState(p)).toEqual({
      decisions: 0,
      gates: ["G1:approved", "G2:approved", "G3:draft", "G4:draft", "G5:draft", "G6:draft"],
    });
    expect((await auditOf(api.db, created.id)).map((e) => e.action)).toEqual([
      "gate_dispensation.create",
      "gate_dispensation.decide",
    ]);
  });

  it("separation of duties: the recorder can never accept their own dispensation (403), even holding gate.decide", async () => {
    const p = await setupP2World(api, w);
    // The sponsor also holds TL (gate.submit) here, records a waiver and then tries to accept it.
    await grant(
      api.db,
      w.grantor.id,
      p.sponsor.id,
      "TL",
      { type: "transformation", id: p.transformationId },
      w.orgA.id,
    );
    const sponsor = await signIn(
      api.app,
      (
        await api.db
          .selectFrom("user_identity")
          .select("subject")
          .where("user_id", "=", p.sponsor.id)
          .executeTakeFirstOrThrow()
      ).subject,
    );
    const created = await create(p, waiver(), sponsor);
    expect(created.status).toBe(201);
    const own = await decideD(p, created.body, "accepted", sponsor);
    expect([own.status, own.body.code]).toEqual([403, "dispensation.decider_is_recorder"]);
  });

  it("revoke: only accepted ones, by the approver with a reason; If-Match; AUD 403; the blocker returns", async () => {
    const p = await setupP2World(api, w);
    await setGateStatus(api, p, "G1", "approved");
    await setGateStatus(api, p, "G2", "approved");
    const created = (await create(p, waiver("G3", { initiativeId: undefined }))).body;
    const R = (d: { id: string }) => `${base(p)}/${d.id}/revoke`;
    const pendingRevoke = await call(api.app, "POST", R(created), {
      session: p.sponsor.session,
      headers: ifm(1),
      body: { reason: "Synthetic revoke" },
    });
    expect([pendingRevoke.status, pendingRevoke.body.code]).toEqual([422, "dispensation.not_revocable"]);
    const accepted = (await decideD(p, created, "accepted")).body;
    expect(
      (
        await call(api.app, "POST", R(accepted), {
          session: p.auditor.session,
          headers: ifm(2),
          body: { reason: "No" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(api.app, "POST", R(accepted), { session: p.sponsor.session, body: { reason: "Synthetic" } })).status,
    ).toBe(428);
    expect(
      (await call(api.app, "POST", R(accepted), { session: p.sponsor.session, headers: ifm(2), body: {} })).status,
    ).toBe(400);
    const revoked = await call(api.app, "POST", R(accepted), {
      session: p.sponsor.session,
      headers: ifm(accepted.version),
      body: { reason: "Synthetic: target state work resumed." },
    });
    expect(revoked.status).toBe(200);
    expect(revoked.body).toMatchObject({ status: "revoked", counts: false, version: 3 });
    expect((await readiness(p)).body.sequencing.canLaunchInitiatives).toBe(false);
    expect((await auditOf(api.db, created.id)).map((e) => e.action)).toEqual([
      "gate_dispensation.create",
      "gate_dispensation.decide",
      "gate_dispensation.revoke",
    ]);
  });
});

describe("inherited approvals (Modular entry)", () => {
  it("need body, date and evidence; count only when the evidence is VERIFIED and another person accepted them", async () => {
    const p = await setupModularWorld(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    const incomplete = await create(p, { kind: "inherited_approval", gateCode: "G1" });
    expect([incomplete.status, incomplete.body.code]).toEqual([422, "dispensation.inherited_incomplete"]);
    expect(incomplete.body.errors.map((e) => e.pointer)).toEqual(["/approvingBody", "/approvedOn", "/evidenceId"]);
    expect((await create(p, waiver())).body.code).toBe("dispensation.waiver_requires_end_to_end");

    const evidence = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: {
        kind: "note",
        title: "Synthetic board minutes approving the case for change",
        noteBody: "Synthetic minutes.",
        ownerUserId: p.lead.id,
      },
    });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(201);
    const body = {
      kind: "inherited_approval",
      gateCode: "G1",
      approvingBody: "Synthetic executive committee",
      approvedOn: "2026-01-15",
      evidenceId: evidence.body.id,
    };
    expect((await create(p, { ...body, approvedOn: inDays(10) })).body.code).toBe("dispensation.approved_on_future");
    const created = await create(p, body);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: "pending", counts: false, evidenceVerified: false });
    // Unverified evidence: the inherited approval cannot be accepted, and readiness keeps the G1 blocker.
    const early = await decideD(p, created.body, "accepted");
    expect([early.status, early.body.code]).toEqual([422, "dispensation.evidence_not_verified"]);
    expect((await readiness(p)).body.sequencing.canSubmitInitiatives).toBe(false);

    const review = await call(api.app, "POST", `${T}/evidence/${evidence.body.id}/review`, {
      session: p.office.session,
      headers: ifm(evidence.body.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: minutes read." },
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);
    const accepted = await decideD(p, created.body, "accepted");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(accepted.body).toMatchObject({ status: "accepted", counts: true, evidenceVerified: true });
    const r = await readiness(p);
    expect(r.body).toMatchObject({ mode: "modular", entryPhase: "define" });
    expect(r.body.sequencing.canSubmitInitiatives).toBe(true);
    // Captured as evidence, never a gate decision: G1 is still draft and no gate decision exists.
    expect((await gateState(p)).decisions).toBe(0);
    expect((await gateState(p)).gates[0]).toBe("G1:draft");
    const list = await call(api.app, "GET", `${base(p)}?limit=1`, { session: p.auditor.session });
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
  });
});

describe("the gate list and gate view inheritedApproval annotation (ADR-0021 §5; F-DG3-120)", () => {
  it("pending_verification → accepted (counts) → revoked; G1 stays draft and no gate decision is ever written", async () => {
    const p = await setupModularWorld(api, w);
    const T = `/api/v1/transformations/${p.transformationId}`;
    type Annotation = {
      dispensationId: string;
      status: string;
      counts: boolean;
      approvingBody: string;
      approvedOn: string;
    };
    type View = {
      gate: { gateCode: string; status: string; approvedAt: string | null; inheritedApproval: Annotation | null };
    };
    /** The G1 item of the gate list and the G1 gate view, both checked against the zod mirrors of the contract. */
    async function g1() {
      const list = await call<{ items: View[] }>(api.app, "GET", `${T}/gates`, { session: p.auditor.session });
      expect(list.status).toBe(200);
      expect(gateList.safeParse(list.body).success, JSON.stringify(gateList.safeParse(list.body).error)).toBe(true);
      const one = await call<View>(api.app, "GET", `${T}/gates/G1`, { session: p.lead.session });
      expect(one.status).toBe(200);
      expect(gateView.safeParse(one.body).success).toBe(true);
      const item = list.body.items.find((v) => v.gate.gateCode === "G1")!;
      expect(one.body.gate.inheritedApproval).toEqual(item.gate.inheritedApproval);
      // Only G1 is annotated; every other gate carries null.
      expect(list.body.items.filter((v) => v.gate.gateCode !== "G1").map((v) => v.gate.inheritedApproval)).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
      // The annotation never makes the gate look approved: the gate's own status stays draft, with no approval time.
      expect([item.gate.status, item.gate.approvedAt, one.body.gate.status]).toEqual(["draft", null, "draft"]);
      expect(await gateState(p)).toMatchObject({ decisions: 0 });
      expect((await gateState(p)).gates[0]).toBe("G1:draft");
      return item.gate.inheritedApproval;
    }

    // None recorded yet: null.
    expect(await g1()).toBeNull();

    const evidence = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: {
        kind: "note",
        title: "Synthetic board minutes approving the case for change",
        noteBody: "Synthetic minutes.",
        ownerUserId: p.lead.id,
      },
    });
    expect(evidence.status, JSON.stringify(evidence.body)).toBe(201);
    const review = await call(api.app, "POST", `${T}/evidence/${evidence.body.id}/review`, {
      session: p.office.session,
      headers: ifm(evidence.body.version),
      body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: minutes read." },
    });
    expect(review.status, JSON.stringify(review.body)).toBe(200);

    // Recorded with VERIFIED evidence, not yet accepted: pending verification, does not count.
    const created = await create(p, {
      kind: "inherited_approval",
      gateCode: "G1",
      approvingBody: "Synthetic executive committee",
      approvedOn: "2026-01-15",
      evidenceId: evidence.body.id,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body).toMatchObject({ status: "pending", evidenceVerified: true, counts: false });
    expect(await g1()).toEqual({
      dispensationId: created.body.id,
      status: "pending_verification",
      counts: false,
      approvingBody: "Synthetic executive committee",
      approvedOn: "2026-01-15",
    });

    // The synthetic Sponsor accepts it (a demo business decision that approves nothing real): accepted, counts.
    const accepted = await decideD(p, created.body, "accepted");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
    expect(await g1()).toMatchObject({ dispensationId: created.body.id, status: "accepted", counts: true });
    expect((await readiness(p)).body.sequencing.canSubmitInitiatives).toBe(true);

    // Revoked: revoked, no longer counts; the gate is still the same draft.
    const revoked = await call(api.app, "POST", `${base(p)}/${created.body.id}/revoke`, {
      session: p.sponsor.session,
      headers: ifm(accepted.body.version),
      body: { reason: "Synthetic: the minutes were superseded." },
    });
    expect(revoked.status, JSON.stringify(revoked.body)).toBe(200);
    expect(await g1()).toMatchObject({ dispensationId: created.body.id, status: "revoked", counts: false });
    expect((await readiness(p)).body.sequencing.canSubmitInitiatives).toBe(false);
  });

  it("an End-to-End transformation's gates carry inheritedApproval null (the DG2 shape otherwise unchanged)", async () => {
    const p = await setupP2World(api, w);
    const list = await call<{ items: { gate: { inheritedApproval: unknown } }[] }>(
      api.app,
      "GET",
      `/api/v1/transformations/${p.transformationId}/gates`,
      { session: p.lead.session },
    );
    expect(list.status).toBe(200);
    expect(list.body.items.map((v) => v.gate.inheritedApproval)).toEqual([null, null, null, null, null, null]);
  });
});
