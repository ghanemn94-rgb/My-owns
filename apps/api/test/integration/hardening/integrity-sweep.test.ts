// REQ-S16-023 integrity sweep (ADR-0052 §9; T-DG6-BE-F; owner backend-workflow-engineer).
// Acceptance (requirements.csv): "deleting an approved gate decision or its evidence returns 409; an illegal status
// transition returns 422 invalid-transition (ADR-0007); a duplicate unique key returns 409".
// The four ADR-0052 §9 parts, in order:
//  1. finalized records: the approved gate decision and its evidence first, then every other finalized type with a
//     destructive operation in the contract; where no DELETE operation exists, the contract has none and the
//     application role mth_app holds no DELETE privilege (a DELETE as mth_app fails with insufficient_privilege);
//  2. illegal status transitions: 422 urn:mth:problem:invalid-transition `invalid_transition`, on every routed P6 state
//     machine (the sensitive grant; the other P6 machines of ADR-0053-0059 have no route at HEAD) and on DG1-DG5 ones;
//  3. duplicate unique keys: 409, on every P6 unique key reachable through the API and on a DG1 one;
//  4. required ownership and canonical references on every P6 table (catalogue), with a dangling reference refused
//     live through the API.
// Every mutation answered here leaves its record unchanged (version and audit trail); every P6 mutation that succeeds
// writes exactly one audit event with its prior and new version (ADR-0052 §8, "the P6 assertion").
// Through the REAL Fastify app on the per-run disposable PostgreSQL (tests/qa/support/with-pg.sh); every response is
// validated against docs/api/openapi.yaml by `call`. All data is SYNTHETIC. The G1 approval below is a synthetic
// in-product business action by a synthetic Sponsor on test data: it approves nothing real, and product gates G1-G6
// never touch the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { extraUser, insertInitiative, seedBenefitWorld } from "../benefits/fixtures.ts";
import {
  coverWithException,
  decideGate,
  missingKeys,
  passGatesNatively,
  plusDays,
  seedNativeGateWorld,
  submitGate,
  type NativeGateWorld,
} from "../../../../../tests/qa/support/gates-native.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const MISSING = "01900000-0000-7000-8000-00000000f00d";

function expectProblem(res: Res<Body>, status: number, type: string, code?: string) {
  expect([res.status, res.body.type], JSON.stringify(res.body)).toEqual([status, `urn:mth:problem:${type}`]);
  if (code !== undefined) expect(res.body.code, JSON.stringify(res.body)).toBe(code);
}

/** The audit rows the request wrote (scope-local, F-DG1-110). */
async function auditFor(api: TestApi, res: Res<Body>) {
  return auditOfRequest(api.db, String(res.headers["x-request-id"]));
}

let api: TestApi;
let w: World;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
});
afterAll(async () => {
  await api.close();
});

/** A DELETE as the application role: it must fail with insufficient_privilege (42501), whatever the row. */
async function deleteAsApp(table: string, id: string): Promise<string | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (api.db as any).deleteFrom(table).where("id", "=", id).execute();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
}

async function appHasDelete(table: string): Promise<boolean> {
  const r = await api.owner.query<{ ok: boolean }>("SELECT has_table_privilege('mth_app', $1, 'DELETE') AS ok", [
    `public.${table}`,
  ]);
  return r.rows[0]!.ok;
}

describe("REQ-S16-023 part 1: finalized records cannot be destructively deleted (ADR-0052 §9.1)", () => {
  let g: NativeGateWorld;
  let evidenceId: string;
  let linkId: string;
  let gateDecisionId: string;

  beforeAll(async () => {
    g = await seedNativeGateWorld(api, w, "S16-023");
    // Evidence on a seeded diagnostic item, which the G1 evidence facts read (criteria.ts), linked before submission.
    const items = await call<Body>(api.app, "GET", `${g.base}/diagnostic-items?limit=1`, { session: g.tl.session });
    expect(items.status, JSON.stringify(items.body)).toBe(200);
    const itemId = items.body.items[0].id as string;
    const ev = await call<Body>(api.app, "POST", `${g.base}/evidence`, {
      session: g.tl.session,
      body: { kind: "note", title: "Synthetic G1 evidence", ownerUserId: g.tl.id, noteBody: "Synthetic note." },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    evidenceId = ev.body.id;
    const link = await call<Body>(api.app, "POST", `${g.base}/evidence-links`, {
      session: g.tl.session,
      body: { evidenceId, recordType: "diagnostic_item", recordId: itemId },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    linkId = link.body.id;
    await passGatesNatively(api, g, ["G1"], plusDays(new Date().toISOString().slice(0, 10), 60));
    const decision = await api.db
      .selectFrom("gate_decision")
      .select(["id", "outcome"])
      .where("transformation_id", "=", g.transformationId)
      .executeTakeFirstOrThrow();
    expect(decision.outcome).toBe("approved");
    gateDecisionId = decision.id;
  });

  it("the approved G1 decision's submission snapshot holds the evidence item", async () => {
    const sub = await call<Body>(api.app, "GET", `${g.gates}/G1/submissions/1`, { session: g.tl.session });
    expect(sub.status, JSON.stringify(sub.body)).toBe(200);
    expect(JSON.stringify(sub.body)).toContain(evidenceId);
  });

  it("an approved gate decision: the contract has no delete operation, and mth_app cannot DELETE it (42501)", async () => {
    const destructive = operations.filter(
      (o) =>
        /\/gates(\/|$)/.test(o.path) &&
        (o.method === "DELETE" || /^(delete|archive|remove|discard|void|purge)/.test(o.operationId)),
    );
    expect(destructive.map((o) => o.operationId)).toEqual([]);
    for (const table of ["gate_decision", "gate_submission", "gate_submission_criterion", "gate_instance"]) {
      expect([table, await appHasDelete(table)]).toEqual([table, false]);
    }
    expect(await deleteAsApp("gate_decision", gateDecisionId)).toBe("42501");
    const still = await api.db.selectFrom("gate_decision").select("outcome").where("id", "=", gateDecisionId).execute();
    expect(still).toEqual([{ outcome: "approved" }]);
  });

  // T-DG6-BE-F2 (D-199; ADR-0052 §9.1): the two removal operations the contract offers on evidence refuse evidence
  // that supports an approved gate decision with 409 `evidence.finalized` and write nothing. (They were `it.fails`
  // defect pins at T-DG6-BE-F, reported as 200; the failing-before output is in the T-DG6-BE-F2 handback evidence.)
  const FINALIZED = "This evidence supports an approved gate decision and cannot be archived or unlinked.";
  const expectFinalized = (res: Res<Body>) => {
    expectProblem(res, 409, "invalid-transition", "evidence.finalized");
    expect(res.body.detail).toBe(FINALIZED);
  };
  const linkOf = async (id: string) => {
    const links = await call<Body>(api.app, "GET", `${g.base}/evidence-links?recordType=diagnostic_item`, {
      session: g.tl.session,
    });
    expect(links.status, JSON.stringify(links.body)).toBe(200);
    return (links.body.items as Body[]).find((l) => l.id === id);
  };

  it("its evidence: removing the evidence link returns 409 evidence.finalized and changes nothing", async () => {
    const link = await linkOf(linkId);
    const auditBefore = await auditOf(api.db, linkId);
    const res = await call<Body>(api.app, "POST", `${g.base}/evidence-links/${linkId}/remove`, {
      session: g.tl.session,
      headers: ifm(link.version),
      body: { reason: "Synthetic attempt to unlink approved gate evidence" },
    });
    console.info(`[integrity-sweep] removeEvidenceLink on approved-G1 evidence: ${res.status} ${res.body?.code}`);
    expectFinalized(res);
    expect(await auditFor(api, res)).toEqual([]);
    const after = await linkOf(linkId);
    expect([after.status, after.version]).toEqual([link.status, link.version]);
    expect(await auditOf(api.db, linkId)).toEqual(auditBefore);
  });

  it("its evidence: archiving the evidence item returns 409 evidence.finalized and changes nothing", async () => {
    const before = await call<Body>(api.app, "GET", `${g.base}/evidence/${evidenceId}`, { session: g.tl.session });
    const auditBefore = await auditOf(api.db, evidenceId);
    const res = await call<Body>(api.app, "POST", `${g.base}/evidence/${evidenceId}/archive`, {
      session: g.tl.session,
      headers: ifm(before.body.version),
      body: { reason: "Synthetic attempt to remove approved gate evidence" },
    });
    console.info(`[integrity-sweep] archiveEvidence on approved-G1 evidence: ${res.status} ${res.body?.code}`);
    expectFinalized(res);
    expect(await auditFor(api, res)).toEqual([]);
    const after = await call<Body>(api.app, "GET", `${g.base}/evidence/${evidenceId}`, { session: g.tl.session });
    expect([after.body.status, after.body.version]).toEqual([before.body.status, before.body.version]);
    expect(await auditOf(api.db, evidenceId)).toEqual(auditBefore);
  });

  it("its evidence: authorization comes first (the auditor gets 403 forbidden, an outsider 404), never 409", async () => {
    const before = await call<Body>(api.app, "GET", `${g.base}/evidence/${evidenceId}`, { session: g.tl.session });
    const link = await linkOf(linkId);
    const reason = { reason: "Synthetic unauthorized attempt" };
    const archiveAs = (session: Session) =>
      call<Body>(api.app, "POST", `${g.base}/evidence/${evidenceId}/archive`, {
        session,
        headers: ifm(before.body.version),
        body: reason,
      });
    const unlinkAs = (session: Session) =>
      call<Body>(api.app, "POST", `${g.base}/evidence-links/${linkId}/remove`, {
        session,
        headers: ifm(link.version),
        body: reason,
      });
    for (const res of [await archiveAs(g.auditor.session), await unlinkAs(g.auditor.session)])
      expectProblem(res, 403, "forbidden", "forbidden");
    for (const res of [await archiveAs(g.outsider.session), await unlinkAs(g.outsider.session)])
      expectProblem(res, 404, "not-found", "not_found");
    const after = await call<Body>(api.app, "GET", `${g.base}/evidence/${evidenceId}`, { session: g.tl.session });
    expect([after.body.status, after.body.version]).toEqual(["active", before.body.version]);
  });

  it("its evidence: a stale If-Match is still 409 version_conflict (the version check precedes the rule)", async () => {
    const before = await call<Body>(api.app, "GET", `${g.base}/evidence/${evidenceId}`, { session: g.tl.session });
    const res = await call<Body>(api.app, "POST", `${g.base}/evidence/${evidenceId}/archive`, {
      session: g.tl.session,
      headers: ifm(before.body.version + 7),
      body: { reason: "Synthetic stale attempt" },
    });
    expectProblem(res, 409, "version-conflict", "version_conflict");
  });

  it("its evidence: a link of the same item that the approved snapshot does not cite is removed normally (200)", async () => {
    const items = await call<Body>(api.app, "GET", `${g.base}/diagnostic-items?limit=2`, { session: g.tl.session });
    const otherItem = (items.body.items as Body[])[1].id as string;
    const extra = await call<Body>(api.app, "POST", `${g.base}/evidence-links`, {
      session: g.tl.session,
      body: { evidenceId, recordType: "diagnostic_item", recordId: otherItem },
    });
    expect(extra.status, JSON.stringify(extra.body)).toBe(201);
    const res = await call<Body>(api.app, "POST", `${g.base}/evidence-links/${extra.body.id}/remove`, {
      session: g.tl.session,
      headers: ifm(extra.body.version),
      body: { reason: "Synthetic link added after the approval" },
    });
    expect([res.status, res.body.status], JSON.stringify(res.body)).toEqual([200, "removed"]);
    expect((await auditFor(api, res)).length).toBe(1);
  });

  it("evidence cited only by a submission without an approved decision (rejected) is archived and unlinked normally", async () => {
    const r = await seedNativeGateWorld(api, w, "S16-023-rejected");
    const items = await call<Body>(api.app, "GET", `${r.base}/diagnostic-items?limit=1`, { session: r.tl.session });
    const itemId = items.body.items[0].id as string;
    const ev = await call<Body>(api.app, "POST", `${r.base}/evidence`, {
      session: r.tl.session,
      body: { kind: "note", title: "Synthetic G1 evidence (rejected)", ownerUserId: r.tl.id, noteBody: "Synthetic." },
    });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const link = await call<Body>(api.app, "POST", `${r.base}/evidence-links`, {
      session: r.tl.session,
      body: { evidenceId: ev.body.id, recordType: "diagnostic_item", recordId: itemId },
    });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const expiresOn = plusDays(new Date().toISOString().slice(0, 10), 60);
    for (const key of await missingKeys(api, r, "G1")) await coverWithException(api, r, "G1", key, expiresOn);
    const sub = await submitGate(api, r, "G1");
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    expect(JSON.stringify(sub.body)).toContain(ev.body.id);
    const decided = await decideGate(api, r, "G1", r.sp.session, {
      submissionNo: sub.body.submissionNo,
      outcome: "rejected",
      rationale: "Synthetic QA rejection; approves nothing real.",
    });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const unlinked = await call<Body>(api.app, "POST", `${r.base}/evidence-links/${link.body.id}/remove`, {
      session: r.tl.session,
      headers: ifm(link.body.version),
      body: { reason: "Synthetic unlink after a rejection" },
    });
    expect([unlinked.status, unlinked.body.status], JSON.stringify(unlinked.body)).toEqual([200, "removed"]);
    const archived = await call<Body>(api.app, "POST", `${r.base}/evidence/${ev.body.id}/archive`, {
      session: r.tl.session,
      headers: ifm(ev.body.version),
      body: { reason: "Synthetic archive after a rejection" },
    });
    expect([archived.status, archived.body.status], JSON.stringify(archived.body)).toEqual([200, "archived"]);
    const audit = await auditFor(api, archived);
    expect(audit.map((a: Body) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["evidence.archive", ev.body.version, ev.body.version + 1],
    ]);
  });

  it("its evidence: the contract has no DELETE for evidence, and mth_app cannot DELETE evidence rows (42501)", async () => {
    expect(
      operations.filter((o) => o.method === "DELETE" && /evidence/.test(o.path)).map((o) => o.operationId),
    ).toEqual([]);
    for (const table of ["evidence", "evidence_link", "evidence_content"]) {
      expect([table, await appHasDelete(table)]).toEqual([table, false]);
    }
    expect(await deleteAsApp("evidence", evidenceId)).toBe("42501");
    expect(await deleteAsApp("evidence_link", linkId)).toBe("42501");
  });

  it("every DELETE operation of the contract is listed, and no finalized-record table grants DELETE to mth_app", async () => {
    const deletes = operations.filter((o) => o.method === "DELETE").map((o) => o.operationId);
    // retireDependencyType (a catalogue retirement) and deleteSavedView (ADR-0057 §4: a soft delete of one's own saved
    // view, status `deleted`; saved_view grants mth_app no DELETE). Neither is a finalized record.
    expect([...deletes].sort()).toEqual(["deleteSavedView", "retireDependencyType"]);
    const granted = await api.owner.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.role_table_grants
        WHERE grantee = 'mth_app' AND privilege_type = 'DELETE' AND table_schema = 'public' ORDER BY table_name`,
    );
    const finalized = [
      "audit_event",
      "decision",
      "gate_decision",
      "gate_submission",
      "evidence",
      "evidence_link",
      "report_snapshot",
      "finance_validation",
      "record_sensitivity",
      "sensitive_record_grant",
    ];
    const tables = granted.rows.map((r) => r.table_name);
    console.info(`[integrity-sweep] tables with DELETE granted to mth_app: ${tables.join(", ") || "none"}`);
    expect(finalized.filter((t) => tables.includes(t))).toEqual([]);
  });
});

describe("REQ-S16-023 part 2: an illegal status transition returns 422 invalid_transition (ADR-0052 §9.2)", () => {
  it("P6 sensitive grant: revoked -> revoked (revoke again) is 422; the grant keeps version 2 and its two audit events", async () => {
    const s = await sensitiveFixture();
    const created = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: s.office,
      body: s.grantBody,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const reason = { reason: "Synthetic need ended" };
    const revoked = await call<Body>(api.app, "POST", `/api/v1/admin/sensitive-grants/${id}/revoke`, {
      session: s.office,
      headers: ifm(1),
      body: reason,
    });
    expect([revoked.status, revoked.body.status, revoked.body.version]).toEqual([200, "revoked", 2]);
    const again = await call<Body>(api.app, "POST", `/api/v1/admin/sensitive-grants/${id}/revoke`, {
      session: s.office,
      headers: ifm(2),
      body: reason,
    });
    expectProblem(again, 422, "invalid-transition", "invalid_transition");
    expect(await auditFor(api, again)).toEqual([]);
    const events = await auditOf(api.db, id);
    expect(events.map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
      ["sensitive_record_grant.granted", null, 1],
      ["sensitive_record_grant.revoked", 1, 2],
    ]);
  });

  it("DG1 transformation: active -> closed by a status edit is 422; nothing written", async () => {
    const office = await signIn(api.app, w.office.subject);
    const t = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: office,
      body: { businessUnitId: w.a1, name: `Synthetic S16-023 ${uniq("T")}`, mode: "end_to_end" },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const active = await call<Body>(api.app, "PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: ifm(t.body.version),
      body: { status: "active" },
    });
    expect(active.status, JSON.stringify(active.body)).toBe(200);
    const res = await call<Body>(api.app, "PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: ifm(active.body.version),
      body: { status: "closed" },
    });
    expectProblem(res, 422, "invalid-transition", "invalid_transition");
    expect(await auditFor(api, res)).toEqual([]);
  });

  it("DG2 diagnostic finding: confirmed -> archived by a status edit is 422; nothing written", async () => {
    const office = await signIn(api.app, w.office.subject);
    const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    const T = `/api/v1/transformations/${transformationId}`;
    const f = await call<Body>(api.app, "POST", `${T}/diagnostic-findings`, {
      session: office,
      body: { workstreamCode: "customer", kind: "symptom", statement: "Synthetic S16-023 finding" },
    });
    expect(f.status, JSON.stringify(f.body)).toBe(201);
    const confirmed = await call<Body>(api.app, "PATCH", `${T}/diagnostic-findings/${f.body.id}`, {
      session: office,
      headers: ifm(1),
      body: { status: "confirmed" },
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    const res = await call<Body>(api.app, "PATCH", `${T}/diagnostic-findings/${f.body.id}`, {
      session: office,
      headers: ifm(2),
      body: { status: "archived" },
    });
    expectProblem(res, 422, "invalid-transition", "invalid_transition");
    expect(await auditFor(api, res)).toEqual([]);
  });

  it("DG3 T08 dependency: resolved -> at_risk is 422; nothing written", async () => {
    const b = await seedBenefitWorld(api, w);
    const initiativeId = await insertInitiative(api.db, b);
    const dep = await call<Body>(api.app, "POST", "/api/v1/dependencies", {
      session: b.s.tl,
      body: {
        transformationId: b.transformationId,
        description: "Synthetic S16-023 vendor delivery",
        from: { kind: "external", label: "Synthetic vendor" },
        toInitiativeId: initiativeId,
        dependencyType: "vendor",
      },
    });
    expect(dep.status, JSON.stringify(dep.body)).toBe(201);
    const D = `/api/v1/dependencies/${dep.body.id}`;
    const resolved = await call<Body>(api.app, "PATCH", D, {
      session: b.s.tl,
      headers: ifm(dep.body.version),
      body: { status: "resolved" },
    });
    expect([resolved.status, resolved.body.status], JSON.stringify(resolved.body)).toEqual([200, "resolved"]);
    const res = await call<Body>(api.app, "PATCH", D, {
      session: b.s.tl,
      headers: ifm(resolved.body.version),
      body: { status: "at_risk" },
    });
    expectProblem(res, 422, "invalid-transition", "invalid_transition");
    expect(await auditFor(api, res)).toEqual([]);
  });

  it("DG4 stakeholder champion: removed -> removed (remove again) is 422; nothing written", async () => {
    const f = await championFixture();
    const R = `${f.C}/${f.championId}/remove`;
    const removed = await call<Body>(api.app, "POST", R, { session: f.tl, headers: ifm(1) });
    expect([removed.status, removed.body.status], JSON.stringify(removed.body)).toEqual([200, "removed"]);
    const again = await call<Body>(api.app, "POST", R, { session: f.tl, headers: ifm(2) });
    expectProblem(again, 422, "invalid-transition", "invalid_transition");
    expect(await auditFor(api, again)).toEqual([]);
  });
});

/** DG4 (T-DG4-BE-H): a stakeholder group with one active champion, created by the transformation's Lead. */
async function championFixture() {
  const b = await seedBenefitWorld(api, w);
  const wl = await extraUser(api, w, b, "WL");
  const SG = `${b.base}/stakeholder-groups`;
  const group = await call<Body>(api.app, "POST", SG, {
    session: b.s.tl,
    body: {
      name: `Synthetic S16-023 group ${uniq("G")}`,
      impact: "H",
      influence: "L",
      currentStance: "resist",
      requiredBehavior: "Synthetic: use the new ordering journey",
      interventionTypes: ["comms", "training", "involvement", "incentive"],
      ownerUserId: wl.id,
    },
  });
  expect(group.status, JSON.stringify(group.body)).toBe(201);
  const C = `${SG}/${group.body.id}/champions`;
  const champion = await call<Body>(api.app, "POST", C, {
    session: b.s.tl,
    body: { userId: wl.id, note: "Synthetic" },
  });
  expect(champion.status, JSON.stringify(champion.body)).toBe(201);
  return { tl: b.s.tl, C, championId: champion.body.id as string, userId: wl.id };
}

describe("REQ-S16-023 part 3: a duplicate unique key returns 409 (ADR-0052 §9.3)", () => {
  it("P6 sensitive_record_grant_one_active_key: a second active grant is 409 sensitive_grant.duplicate; nothing written", async () => {
    const s = await sensitiveFixture();
    const first = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: s.office,
      body: s.grantBody,
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    // One audit event with prior and new version for the successful P6 mutation.
    expect((await auditFor(api, first)).map((e) => [e.record_id, e.prior_version, e.new_version])).toEqual([
      [first.body.id, null, 1],
    ]);
    const dup = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: s.office,
      body: s.grantBody,
    });
    expectProblem(dup, 409, "duplicate", "sensitive_grant.duplicate");
    expect(await auditFor(api, dup)).toEqual([]);
  });

  it('P6 record_sensitivity_record_key: a second create with If-Match "0" is 409 version_conflict; nothing written', async () => {
    const s = await sensitiveFixture();
    const flag = `/api/v1/transformations/${s.transformationId}/records/benefit/${s.benefitId}/sensitivity`;
    const mark = { isSensitive: true, reason: "Synthetic commercial terms" };
    // The flag was created by the fixture (version 1); a second If-Match "0" create collides with it.
    const res = await call<Body>(api.app, "PUT", flag, { session: s.office, headers: ifm(0), body: mark });
    expectProblem(res, 409, "version-conflict", "version_conflict");
    expect(await auditFor(api, res)).toEqual([]);
  });

  it("DG1 organization_code_key: a second organization with the same code is 409; nothing written", async () => {
    const admin = await signIn(api.app, w.admin.subject);
    const code = uniq("S16");
    const first = await call<Body>(api.app, "POST", "/api/v1/organizations", {
      session: admin,
      body: { code, nameEn: "Synthetic S16-023 org", nameAr: "مؤسسة اصطناعية" },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const dup = await call<Body>(api.app, "POST", "/api/v1/organizations", {
      session: admin,
      body: { code, nameEn: "Synthetic duplicate", nameAr: "مكرر" },
    });
    expect(dup.status, JSON.stringify(dup.body)).toBe(409);
    expect(["urn:mth:problem:duplicate", "urn:mth:problem:version-conflict"]).toContain(dup.body.type);
    expect(await auditFor(api, dup)).toEqual([]);
  });

  it("DG5 automation_rule code key: a second rule with the same code is 409 automation_rule.code_taken; nothing written", async () => {
    const adminUser = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, adminUser.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const admin = await signIn(api.app, adminUser.subject);
    const body = {
      code: `sweep.${uniq("r").toLowerCase()}`,
      nameEn: "Synthetic S16-023 rule",
      nameAr: "قاعدة تجريبية",
      scopeLevel: "organization",
      organizationId: w.orgA.id,
      ownerUserId: adminUser.id,
      content: {
        triggerCodes: ["gate.decided"],
        conditions: [{ field: "gateCode", op: "eq", value: "G3" }],
        actions: [{ type: "notify", parameters: { recipientRole: "TL", messageKey: "automation.message.update_due" } }],
        runAs: "service",
      },
    };
    const first = await call<Body>(api.app, "POST", "/api/v1/admin/automation-rules", { session: admin, body });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const dup = await call<Body>(api.app, "POST", "/api/v1/admin/automation-rules", { session: admin, body });
    expectProblem(dup, 409, "duplicate", "automation_rule.code_taken");
    expect(await auditFor(api, dup)).toEqual([]);
  });

  it("DG4 stakeholder_champion active key: the same person twice is 409 stakeholder_champion.exists; nothing written", async () => {
    const f = await championFixture();
    const dup = await call<Body>(api.app, "POST", f.C, { session: f.tl, body: { userId: f.userId } });
    expectProblem(dup, 409, "duplicate", "stakeholder_champion.exists");
    expect(await auditFor(api, dup)).toEqual([]);
  });
});

describe("REQ-S16-023 part 4: required ownership and canonical references on every P6 table (ADR-0052 §9.4)", () => {
  /** The tables created by the P6 migrations (0098 onward). */
  const P6_TABLES = [
    "connector",
    "connector_change",
    "connector_config_version",
    "deliverable_external_change",
    "deliverable_external_change_event",
    "import_batch",
    "import_batch_event",
    "import_row",
    "import_row_commit",
    "integration_run",
    "integration_run_event",
    "notification_channel",
    "notification_channel_change",
    "notification_delivery",
    "operational_exception",
    "operational_exception_event",
    "operational_exception_kpi",
    "outbound_write",
    "outbound_write_event",
    "record_sensitivity",
    "record_sensitivity_change",
    "sensitive_record_grant",
    "service_identity",
    "service_identity_change",
    "storage_setting",
    "storage_setting_change",
    "upload_policy",
    "upload_policy_change",
    "webhook_endpoint",
    "webhook_endpoint_change",
    "webhook_receipt",
    "worker_heartbeat",
  ];

  /**
   * The uuid *_id columns of P6 tables that carry no foreign key of their own, each guarded another way (0098-0107):
   * trigger-written, append-only histories copy a value whose source column is FK- or record_ref-guarded; the import
   * lineage target is polymorphic and checked by its BEFORE INSERT guard (23503 import_row_commit_target_exists).
   */
  const GUARDED_OTHERWISE: Readonly<Record<string, string>> = {
    "deliverable_external_change_event.evidence_id": "history of deliverable_external_change.evidence_id (FK)",
    "deliverable_external_change_event.outbound_write_id":
      "history of deliverable_external_change.outbound_write_id (FK)",
    "import_row_commit.target_record_id": "import_row_commit_guard (import_row_commit_target_exists)",
    "record_sensitivity_change.record_id": "history of record_sensitivity.record_id (record_ref trigger)",
  };

  it("every P6 table exists, and every uuid *_id column is a foreign key, a trigger-guarded record reference, or a history copy of one", async () => {
    const tables = await api.owner.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)",
      [P6_TABLES],
    );
    expect(tables.rows.map((r) => r.table_name).sort()).toEqual([...P6_TABLES].sort());
    // Every uuid *_id column (not the primary key) of a P6 table: covered by a foreign key, or the table carries a
    // *_record_ref trigger (the polymorphic record references of 0098, probe RS10/GR06), or GUARDED_OTHERWISE. Text
    // *_id columns are external identifiers (source_system_id, source_record_id, delivery_id), not record references.
    const columns = await api.owner.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT c.table_name, c.column_name, c.is_nullable FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = ANY($1) AND c.column_name LIKE '%\\_id' AND c.column_name <> 'id' AND c.data_type = 'uuid'
        ORDER BY c.table_name, c.column_name`,
      [P6_TABLES],
    );
    const fkColumns = await api.owner.query<{ table_name: string; column_name: string }>(
      `SELECT tc.table_name, kcu.column_name FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
        WHERE tc.table_schema = 'public' AND tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY($1)`,
      [P6_TABLES],
    );
    const triggers = await api.owner.query<{ table_name: string; trigger_name: string }>(
      `SELECT event_object_table AS table_name, trigger_name FROM information_schema.triggers
        WHERE trigger_schema = 'public' AND event_object_table = ANY($1)`,
      [P6_TABLES],
    );
    const fk = new Set(fkColumns.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const refTables = new Set(triggers.rows.filter((r) => /record_ref/.test(r.trigger_name)).map((r) => r.table_name));
    const unguarded = columns.rows
      .filter((c) => !fk.has(`${c.table_name}.${c.column_name}`))
      .filter((c) => !(c.column_name === "record_id" && refTables.has(c.table_name)))
      .map((c) => `${c.table_name}.${c.column_name}`);
    console.info(
      `[integrity-sweep] P6 tables: ${P6_TABLES.length}; *_id columns: ${columns.rows.length}; foreign-key columns: ${fk.size}; record_ref-guarded tables: ${[...refTables].sort().join(", ")}; unguarded: ${unguarded.join(", ") || "none"}`,
    );
    expect(unguarded.sort()).toEqual(Object.keys(GUARDED_OTHERWISE).sort());
    // Every P6 row belongs to an organization where the table has one (NOT NULL).
    const orgNullable = columns.rows
      .filter((c) => c.column_name === "organization_id" && c.is_nullable === "YES")
      .map((c) => c.table_name);
    console.info(`[integrity-sweep] P6 tables with a nullable organization_id: ${orgNullable.join(", ") || "none"}`);
  });

  it("a dangling record reference through the API: a grant on a missing record is 404 not_found; nothing written", async () => {
    const s = await sensitiveFixture();
    const res = await call<Body>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: s.office,
      body: { ...s.grantBody, recordId: MISSING },
    });
    expectProblem(res, 404, "not-found", "not_found");
    expect(await auditFor(api, res)).toEqual([]);
  });

  it("a missing owner is refused by the database: a sensitive grant without its grantee fails NOT NULL as mth_app", async () => {
    const s = await sensitiveFixture();
    let code: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (api.db as any)
        .insertInto("sensitive_record_grant")
        .values({
          organization_id: w.orgA.id,
          transformation_id: s.transformationId,
          record_type: "benefit",
          id: crypto.randomUUID(),
          record_id: s.benefitId,
          grantee_user_id: null,
          reason: "Synthetic",
          created_by: w.office.id,
          updated_by: w.office.id,
        })
        .execute();
    } catch (e) {
      code = (e as { code?: string }).code ?? String(e);
    }
    expect(code).toBe("23502");
  });
});

/** A synthetic benefit marked sensitive by the office (TO), with a WL grantee for grants. */
async function sensitiveFixture() {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const bo = await createUser(api.db, w.orgA.id);
  const wl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "BO", scope, w.orgA.id);
  await grant(api.db, w.grantor.id, wl.id, "WL", scope, w.orgA.id);
  const boS: Session = await signIn(api.app, bo.subject);
  const office: Session = await signIn(api.app, w.office.subject);
  const base = `/api/v1/transformations/${transformationId}`;
  const benefit = await call<Body>(api.app, "POST", `${base}/benefits`, {
    session: boS,
    body: {
      title: "Synthetic S16-023 benefit",
      description: "Synthetic.",
      benefitType: "revenue",
      valueClass: "revenue_uplift",
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: "Revenue - prepaid",
    },
  });
  expect(benefit.status, JSON.stringify(benefit.body)).toBe(201);
  const benefitId = benefit.body.id as string;
  const marked = await call<Body>(api.app, "PUT", `${base}/records/benefit/${benefitId}/sensitivity`, {
    session: office,
    headers: ifm(0),
    body: { isSensitive: true, reason: "Synthetic commercial terms" },
  });
  expect([marked.status, marked.body.version], JSON.stringify(marked.body)).toEqual([200, 1]);
  // One audit event with prior and new version for the successful P6 mutation (ADR-0052 §8).
  expect((await auditFor(api, marked)).map((e) => [e.action, e.prior_version, e.new_version])).toEqual([
    ["record_sensitivity.marked", null, 1],
  ]);
  return {
    transformationId,
    benefitId,
    office,
    grantBody: {
      transformationId,
      recordType: "benefit",
      recordId: benefitId,
      granteeUserId: wl.id,
      reason: "Synthetic need",
    },
  };
}
