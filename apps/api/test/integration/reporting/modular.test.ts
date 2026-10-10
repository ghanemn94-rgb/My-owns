// Modular entry: missing links, gate labels and labelled inherited records (T-DG4-BE-M2; ADR-0038 §7, §10-§12;
// REQ-PB-005, REQ-S03-005). Proves, against the run's disposable PostgreSQL:
//  - a Modular transformation entering at Design with an inherited G2 approval document: `getMissingLinks` labels G2
//    `inherited` (never `approved`) and lists `baseline_missing` and `outcome_link_missing` (blocking); after a baseline
//    and an outcome KPI are added both disappear; the annotation equals the DG3 gate list's;
//  - inherited evidence and baselines are listed with provenance and the label "Inherited - recorded, not granted in
//    platform", next to the read-only prior_approval entry; an inherited baseline stays unvalidated;
//  - End-to-End → 422 inherited_record.not_modular; kind prior_approval → 422 prior_approval_use_dispensation;
//  - no gate_decision row is created and no gate status changes; AUD (and BO) 403 on every write; scope 404;
//    If-Match 428/409; one audit event per mutation; commit-time re-authorisation; validation 400s.
// All data is SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { INHERITED_LABEL_TEXT, inheritedRecordPage, missingLinks } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  addBaseline,
  addEvidence,
  addInheritedApproval,
  addOutcomeKpi,
  seedModularWorld,
  type ModularWorld,
} from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);

interface Item {
  code: string;
  severity: string;
  recordType: string | null;
  recordId: string | null;
  href: string | null;
}
interface Gate {
  gateCode: string;
  status: string;
  label: string;
  inheritedApproval: { dispensationId: string; counts: boolean; status: string } | null;
}

async function report(mw: ModularWorld, session = mw.s.auditor) {
  const r = await send("GET", `${mw.base}/missing-links`, { session });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  expect(missingLinks.safeParse(r.body).success).toBe(true);
  return r.body as { mode: string; entryPhase: string; gates: Gate[]; items: Item[] };
}

/** Gate statuses, versions and decisions of the transformation (they must never change here). */
async function gateState(mw: ModularWorld) {
  const gates = await api.db
    .selectFrom("gate_instance")
    .select(["gate_code", "status", "version"])
    .where("transformation_id", "=", mw.transformationId)
    .orderBy("gate_code")
    .execute();
  const decisions = await api.db
    .selectFrom("gate_decision")
    .select("id")
    .where("transformation_id", "=", mw.transformationId)
    .execute();
  return { gates, decisions: decisions.length };
}

async function inheritedRows(mw: ModularWorld) {
  return api.db
    .selectFrom("inherited_record")
    .selectAll()
    .where("transformation_id", "=", mw.transformationId)
    .execute();
}

describe("REQ-PB-005 / REQ-S03-005: Modular entry at Design with an inherited G2 approval", () => {
  it("G2 is labelled inherited (never approved); baseline and outcome link are missing until supplied", async () => {
    const mw = await seedModularWorld(api, w);
    const before = await gateState(mw);
    const evidenceId = await addEvidence(send, mw);
    const dispensationId = await addInheritedApproval(send, mw, evidenceId);

    const r1 = await report(mw);
    expect([r1.mode, r1.entryPhase]).toEqual(["modular", "design"]);
    const g2 = r1.gates.find((g) => g.gateCode === "G2")!;
    expect(g2).toMatchObject({ status: "draft", label: "inherited" });
    expect(g2.inheritedApproval).toMatchObject({ dispensationId, counts: true, status: "accepted" });
    expect(r1.gates.map((g) => g.label)).not.toContain("approved");
    expect(r1.gates.map((g) => g.gateCode)).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    const blocking = r1.items.filter((i) => i.severity === "blocking");
    expect(blocking.map((i) => i.code)).toEqual(["baseline_missing", "outcome_link_missing"]);
    expect(blocking.map((i) => i.href)).toEqual([`${mw.base}/baselines`, `${mw.base}/outcome-kpis`]);
    // The world's outcome has no KPI row: listed per record, with the outcome's read operation as href (200).
    const perOutcome = r1.items.find((i) => i.code === "outcome_kpi_missing")!;
    expect([perOutcome.recordType, perOutcome.recordId]).toEqual(["outcome", mw.outcomeId]);
    expect((await send("GET", perOutcome.href!, { session: mw.s.auditor })).status).toBe(200);

    // The annotation is the DG3 gate list's (same facts, same selection rule).
    const list = await send("GET", `${mw.base}/gates`, { session: mw.s.auditor });
    expect(list.status).toBe(200);
    for (const g of r1.gates) {
      const dg3 = (
        list.body.items as { gate: { gateCode: string; status: string; inheritedApproval: unknown } }[]
      ).find((v) => v.gate.gateCode === g.gateCode)!;
      expect([g.status, g.inheritedApproval], g.gateCode).toEqual([dg3.gate.status, dg3.gate.inheritedApproval]);
    }

    // A baseline WITHOUT a value does not clear baseline_missing; one with a value and an outcome KPI clear both.
    await addBaseline(send, mw, null);
    expect((await report(mw)).items.map((i) => i.code)).toContain("baseline_missing");
    await addBaseline(send, mw);
    await addOutcomeKpi(api.db, mw);
    const r2 = await report(mw, mw.s.tl);
    expect(r2.items.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(r2.items.map((i) => i.code)).not.toContain("outcome_kpi_missing");
    expect(r2.gates.find((g) => g.gateCode === "G2")!.label).toBe("inherited");

    // Nothing here decided a gate or changed one.
    expect(await gateState(mw)).toEqual(before);
    expect(before.decisions).toBe(0);
  });

  it("a pending inherited approval is inherited_pending_verification and an inherited_approval_unverified warning", async () => {
    const mw = await seedModularWorld(api, w);
    const evidenceId = await addEvidence(send, mw);
    const dispensationId = await addInheritedApproval(send, mw, evidenceId, false);
    const r = await report(mw);
    expect(r.gates.find((g) => g.gateCode === "G2")!.label).toBe("inherited_pending_verification");
    const warn = r.items.find((i) => i.code === "inherited_approval_unverified")!;
    expect([warn.severity, warn.recordType, warn.recordId, warn.href]).toEqual([
      "warning",
      "gate_dispensation",
      dispensationId,
      `${mw.base}/gate-dispensations`,
    ]);
    expect(r.gates.map((g) => g.label)).not.toContain("approved");
  });

  it("a gate approved by the platform is the only `approved` label", async () => {
    const mw = await seedModularWorld(api, w, undefined, "end_to_end");
    const r = await report(mw);
    expect(r.mode).toBe("end_to_end");
    expect(r.gates.map((g) => g.label)).toEqual(["draft", "draft", "draft", "draft", "draft", "draft"]);
  });

  it("scope: another organization's TO gets 404; a malformed id is 400", async () => {
    const mw = await seedModularWorld(api, w);
    expect((await send("GET", `${mw.base}/missing-links`, { session: mw.s.outsider })).status).toBe(404);
    expect((await send("GET", `${mw.base}/inherited-records`, { session: mw.s.outsider })).status).toBe(404);
    expect((await send("GET", "/api/v1/transformations/not-a-uuid/missing-links", { session: mw.s.tl })).status).toBe(
      400,
    );
  });
});

describe("REQ-S03-005: labelled inherited records", () => {
  it("inherited evidence and baseline are listed with provenance and the inherited label, beside the prior approval", async () => {
    const mw = await seedModularWorld(api, w);
    const before = await gateState(mw);
    const approvalEvidence = await addEvidence(send, mw);
    const dispensationId = await addInheritedApproval(send, mw, approvalEvidence);
    const evidenceId = await addEvidence(send, mw, false);
    const baselineId = await addBaseline(send, mw);
    const R = `${mw.base}/inherited-records`;
    const ev = await send("POST", R, {
      session: mw.s.tl,
      body: {
        kind: "evidence",
        evidenceId,
        sourceDescription: "Synthetic: prior programme archive, folder 7",
        originalOwner: "Synthetic PMO",
        originalDate: "2025-11-30",
      },
    });
    expect([ev.status, ev.headers["etag"], ev.headers["location"]], JSON.stringify(ev.body)).toEqual([
      201,
      '"1"',
      `${R}/${ev.body.id}`,
    ]);
    expect(ev.body).toMatchObject({
      kind: "evidence",
      label: "inherited",
      evidenceId,
      baselineId: null,
      gateDispensationId: null,
      sourceDescription: "Synthetic: prior programme archive, folder 7",
      originalOwner: "Synthetic PMO",
      originalDate: "2025-11-30",
      recordedBy: mw.users.tl.id,
      status: "active",
      version: 1,
    });
    const bl = await send("POST", R, {
      session: mw.s.to,
      body: { kind: "baseline", baselineId, sourceDescription: "Synthetic: 2025 operations report" },
    });
    expect(bl.status, JSON.stringify(bl.body)).toBe(201);
    expect(bl.body).toMatchObject({ kind: "baseline", baselineId, label: "inherited", recordedBy: mw.users.to.id });

    const list = await send("GET", R, { session: mw.s.auditor });
    expect(list.status).toBe(200);
    expect(inheritedRecordPage.safeParse(list.body).success).toBe(true);
    const items = list.body.items as { kind: string; label: string; id: string; [k: string]: unknown }[];
    expect(items.map((i) => i.kind)).toEqual(["prior_approval", "evidence", "baseline"]);
    expect(items.every((i) => i.label === "inherited")).toBe(true);
    expect(items[0]).toMatchObject({
      id: dispensationId,
      gateDispensationId: dispensationId,
      gateCode: "G2",
      approvingBody: "Synthetic prior programme board",
      originalDate: "2026-01-15",
      evidenceId: approvalEvidence,
      status: "accepted",
    });
    // The render text of the label (REQ-S03-005 procedure, verbatim; translated at render time, S-6).
    expect(INHERITED_LABEL_TEXT.en).toBe("Inherited - recorded, not granted in platform");

    // Inheriting a baseline does not validate it; referencing never copies the canonical rows.
    const baseline = await api.db
      .selectFrom("baseline")
      .select(["validation_status"])
      .where("id", "=", baselineId)
      .executeTakeFirstOrThrow();
    expect(baseline.validation_status).toBe("unvalidated");
    expect(
      (await api.db.selectFrom("evidence").select("id").where("transformation_id", "=", mw.transformationId).execute())
        .length,
    ).toBe(2);

    // Pagination: one item per page, in the same order, then the end.
    const p1 = await send("GET", `${R}?limit=1`, { session: mw.s.auditor });
    const p2 = await send("GET", `${R}?limit=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`, {
      session: mw.s.auditor,
    });
    expect([p1.body.items[0].id, p2.body.items[0].id]).toEqual([items[0]!.id, items[1]!.id]);

    // Withdrawal: provenance unchanged; hidden by default, shown with includeRemoved.
    const wd = await send("POST", `${R}/${ev.body.id}/withdraw`, {
      session: mw.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic: superseded by a newer archive copy" },
    });
    expect([wd.status, wd.headers["etag"]], JSON.stringify(wd.body)).toEqual([200, '"2"']);
    expect(wd.body).toMatchObject({
      status: "withdrawn",
      withdrawnBy: mw.users.tl.id,
      withdrawReason: "Synthetic: superseded by a newer archive copy",
      sourceDescription: "Synthetic: prior programme archive, folder 7",
      originalOwner: "Synthetic PMO",
    });
    expect((await send("GET", R, { session: mw.s.auditor })).body.items.map((i: { kind: string }) => i.kind)).toEqual([
      "prior_approval",
      "baseline",
    ]);
    const all = await send("GET", `${R}?includeRemoved=true`, { session: mw.s.auditor });
    expect(all.body.items.length).toBe(3);
    // A withdrawn record frees the slot: the same evidence can be recorded again (a new row).
    const again = await send("POST", R, {
      session: mw.s.tl,
      body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: re-recorded" },
    });
    expect(again.status).toBe(201);
    expect((await inheritedRows(mw)).length).toBe(3);

    // No gate decision, no gate change.
    expect(await gateState(mw)).toEqual(before);
  });

  it("End-to-End → 422 inherited_record.not_modular; prior_approval → 422 use_dispensation; nothing written", async () => {
    const e2e = await seedModularWorld(api, w, undefined, "end_to_end");
    const evidenceId = await addEvidence(send, e2e, false);
    const res = await send("POST", `${e2e.base}/inherited-records`, {
      session: e2e.s.tl,
      body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: archive" },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "inherited_record.not_modular",
      "Inherited records can be recorded only for a transformation in Modular entry.",
    ]);
    expect(await inheritedRows(e2e)).toEqual([]);

    const mw = await seedModularWorld(api, w);
    const before = await gateState(mw);
    const prior = await send("POST", `${mw.base}/inherited-records`, {
      session: mw.s.tl,
      body: {
        kind: "prior_approval",
        sourceDescription: "Synthetic: the old board approved the design",
        evidenceId: await addEvidence(send, mw),
      },
    });
    expect([prior.status, prior.body.code, prior.body.detail, prior.body.errors[0].pointer]).toEqual([
      422,
      "inherited_record.prior_approval_use_dispensation",
      "Record a prior approval as an inherited gate approval; it is never stored as a platform approval.",
      "/kind",
    ]);
    expect(await inheritedRows(mw)).toEqual([]);
    expect(
      (
        await api.db
          .selectFrom("gate_dispensation")
          .select("id")
          .where("transformation_id", "=", mw.transformationId)
          .execute()
      ).length,
    ).toBe(0);
    expect(await gateState(mw)).toEqual(before);
  });

  it("validation: 400 for a missing id or blank text; 422 for a record outside the transformation; 409 duplicate", async () => {
    const mw = await seedModularWorld(api, w);
    const other = await seedModularWorld(api, w);
    const R = `${mw.base}/inherited-records`;
    const post = (body: unknown) => send("POST", R, { session: mw.s.tl, body });
    const missing = await post({ kind: "evidence", sourceDescription: "Synthetic" });
    expect([missing.status, missing.body.errors.map((e: { pointer: string }) => e.pointer)]).toEqual([
      400,
      ["/evidenceId"],
    ]);
    expect((await post({ kind: "baseline", baselineId: "x", sourceDescription: "Synthetic" })).status).toBe(400);
    expect((await post({ kind: "evidence", evidenceId: mw.outcomeId, sourceDescription: "  ‏ " })).status).toBe(400);
    expect((await post({ kind: "other", sourceDescription: "Synthetic" })).status).toBe(400);
    const foreignEvidence = await addEvidence(send, other, false);
    const foreign = await post({ kind: "evidence", evidenceId: foreignEvidence, sourceDescription: "Synthetic" });
    expect([foreign.status, foreign.body.code, foreign.body.errors[0].pointer]).toEqual([
      422,
      "inherited_record.record_not_found",
      "/evidenceId",
    ]);
    const baselineId = await addBaseline(send, mw);
    expect((await post({ kind: "baseline", baselineId, sourceDescription: "Synthetic" })).status).toBe(201);
    const dup = await post({ kind: "baseline", baselineId, sourceDescription: "Synthetic again" });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "inherited_record.duplicate",
      "This record is already recorded as inherited.",
    ]);
    expect((await inheritedRows(mw)).length).toBe(1);
  });
});

describe("S-4: authorization, If-Match and audit on every write", () => {
  it("AUD and BO get 403 on create and withdraw; nothing written", async () => {
    const mw = await seedModularWorld(api, w);
    const evidenceId = await addEvidence(send, mw, false);
    const R = `${mw.base}/inherited-records`;
    for (const session of [mw.s.auditor, mw.s.bo, mw.s.sp]) {
      const res = await send("POST", R, {
        session,
        body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: not allowed" },
      });
      expect(res.status).toBe(403);
    }
    expect(await inheritedRows(mw)).toEqual([]);
    const ok = await send("POST", R, {
      session: mw.s.tl,
      body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: allowed" },
    });
    expect(ok.status).toBe(201);
    for (const session of [mw.s.auditor, mw.s.bo]) {
      const res = await send("POST", `${R}/${ok.body.id}/withdraw`, {
        session,
        headers: ifm(1),
        body: { reason: "Synthetic: not allowed" },
      });
      expect(res.status).toBe(403);
    }
    expect((await inheritedRows(mw))[0]).toMatchObject({ status: "active", version: 1 });
    // Another organization's TO cannot reach it: the commit-time read gate refuses (403, the atCommit pattern of
    // access/request.ts commitTimeDenial), and nothing is written.
    const out = await send("POST", `${R}/${ok.body.id}/withdraw`, {
      session: mw.s.outsider,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect(out.status).toBe(403);
    expect((await inheritedRows(mw))[0]).toMatchObject({ status: "active", version: 1 });
  });

  it("withdraw: 428 without If-Match, 409 stale, 404 unknown id, 422 when already withdrawn", async () => {
    const mw = await seedModularWorld(api, w);
    const R = `${mw.base}/inherited-records`;
    const created = await send("POST", R, {
      session: mw.s.tl,
      body: { kind: "baseline", baselineId: await addBaseline(send, mw), sourceDescription: "Synthetic" },
    });
    const W = `${R}/${created.body.id}/withdraw`;
    const body = { reason: "Synthetic: superseded" };
    expect((await send("POST", W, { session: mw.s.tl, body })).status).toBe(428);
    const stale = await send("POST", W, { session: mw.s.tl, headers: ifm(2), body });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect(
      (await send("POST", `${R}/${mw.outcomeId}/withdraw`, { session: mw.s.tl, headers: ifm(1), body })).status,
    ).toBe(404);
    expect((await send("POST", W, { session: mw.s.tl, headers: ifm(1), body: { reason: "" } })).status).toBe(400);
    expect((await send("POST", W, { session: mw.s.tl, headers: ifm(1), body })).status).toBe(200);
    const again = await send("POST", W, { session: mw.s.tl, headers: ifm(2), body });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "inherited_record.not_active",
      "This inherited record has already been withdrawn.",
    ]);
  });

  it("one audit event per mutation, in the write's transaction", async () => {
    const mw = await seedModularWorld(api, w);
    const R = `${mw.base}/inherited-records`;
    const created = await send("POST", R, {
      session: mw.s.tl,
      body: { kind: "evidence", evidenceId: await addEvidence(send, mw, false), sourceDescription: "Synthetic" },
    });
    expect(created.status).toBe(201);
    let events = await auditOf(api.db, created.body.id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["inherited_record.create", null, 1],
    ]);
    // Refused writes leave no success event behind.
    await send("POST", `${R}/${created.body.id}/withdraw`, { session: mw.s.auditor, headers: ifm(1), body: {} });
    await send("POST", `${R}/${created.body.id}/withdraw`, {
      session: mw.s.tl,
      headers: ifm(9),
      body: { reason: "Synthetic" },
    });
    const wd = await send("POST", `${R}/${created.body.id}/withdraw`, {
      session: mw.s.tl,
      headers: ifm(1),
      body: { reason: "Synthetic: withdrawn" },
    });
    expect(wd.status).toBe(200);
    events = await auditOf(api.db, created.body.id);
    const ok = events.filter((e) => e.action.startsWith("inherited_record."));
    expect(ok.map((e) => [e.action, e.prior_version, e.new_version, e.reason])).toEqual([
      ["inherited_record.create", null, 1, null],
      ["inherited_record.withdraw", 1, 2, "Synthetic: withdrawn"],
    ]);
  });

  it("commit-time: a grant revoked while the create waited is 403; nothing written", async () => {
    const mw = await seedModularWorld(api, w);
    const evidenceId = await addEvidence(send, mw, false);
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TL", { type: "transformation", id: mw.transformationId }, w.orgA.id);
    const session = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `${mw.base}/inherited-records`, {
          session,
          body: { kind: "evidence", evidenceId, sourceDescription: "Synthetic: late" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await inheritedRows(mw)).toEqual([]);
  });
});
