// code-security-reviewer DG3 round-2 probe D (T-DG3-REV-SEC-R2). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-r2/. All data is synthetic; the acceptance is a demo business decision
// that approves nothing real (never DG0-DG7).
// The F-DG3-120 inheritedApproval annotation on GateInstance (listGates, getGate, configureGate):
//   D1 read under the same authorization as the gate list/view: users who cannot read the transformation (same-org
//      user without grants, a TL of a sibling business unit, the other organization's TO) get 404 on list, view and
//      PATCH, and the response never carries the dispensation id or the approving body;
//   D2 reads only: a sequence of list/view reads by several readers changes no row of gate_instance, gate_decision,
//      gate_submission, gate_dispensation and writes no audit event; the gate stays draft with approvedAt null even
//      while the annotation counts;
//   D3 configureGate (PATCH, gate.configure) returns the annotation, read after the write transaction, and the write
//      changes only the approver columns (status unchanged);
//   D4 the evidence-verification guard: an accepted inherited approval whose evidence is NOT verified never counts.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, type P2World } from "../../support/p2-fixtures.ts";
import { setupModularWorld } from "../portfolio/fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
let dispensationId: string;
const BODY = "Synthetic SEC-R2 executive committee";

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupModularWorld(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  const ev = await call(api.app, "POST", `${T}/evidence`, {
    session: p.lead.session,
    body: { kind: "note", title: "Synthetic minutes (SEC-R2)", noteBody: "Synthetic.", ownerUserId: p.lead.id },
  });
  if (ev.status !== 201) throw new Error(`evidence ${ev.status} ${JSON.stringify(ev.body)}`);
  const rv = await call(api.app, "POST", `${T}/evidence/${ev.body.id}/review`, {
    session: p.office.session,
    headers: ifm(ev.body.version),
    body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic." },
  });
  if (rv.status !== 200) throw new Error(`review ${rv.status} ${JSON.stringify(rv.body)}`);
  const d = await call(api.app, "POST", `${T}/gate-dispensations`, {
    session: p.lead.session,
    body: { kind: "inherited_approval", gateCode: "G1", approvingBody: BODY, approvedOn: "2026-01-15", evidenceId: ev.body.id },
  });
  if (d.status !== 201) throw new Error(`dispensation ${d.status} ${JSON.stringify(d.body)}`);
  const a = await call(api.app, "POST", `${T}/gate-dispensations/${d.body.id}/decision`, {
    session: p.sponsor.session,
    headers: ifm(d.body.version),
    body: { result: "accepted", note: "Synthetic demo decision." },
  });
  if (a.status !== 200) throw new Error(`accept ${a.status} ${JSON.stringify(a.body)}`);
  dispensationId = d.body.id;
});
afterAll(() => api.close());

async function snapshot() {
  const r = await sql<{ t: string; h: string }>`
    select 'gate_instance' t, md5(coalesce(string_agg(x::text, '|' order by x.id), '')) h from gate_instance x where transformation_id = ${p.transformationId}
    union all select 'gate_decision', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from gate_decision x where transformation_id = ${p.transformationId}
    union all select 'gate_submission', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from gate_submission x where transformation_id = ${p.transformationId}
    union all select 'gate_dispensation', md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from gate_dispensation x where transformation_id = ${p.transformationId}
    union all select 'audit_event_count', count(*)::text from audit_event`.execute(api.db);
  return Object.fromEntries(r.rows.map((x) => [x.t, x.h]));
}

describe("D1 the annotation is read under the transformation read authorization", () => {
  it("a reader sees it (accepted, counts) while the gate stays draft", async () => {
    const list = await call(api.app, "GET", `${T}/gates`, { session: p.auditor.session });
    expect(list.status).toBe(200);
    const g1 = list.body.items.find((v: { gate: { gateCode: string } }) => v.gate.gateCode === "G1");
    expect(g1.gate.inheritedApproval).toEqual({
      dispensationId,
      status: "accepted",
      counts: true,
      approvingBody: BODY,
      approvedOn: "2026-01-15",
    });
    expect([g1.gate.status, g1.gate.approvedAt]).toEqual(["draft", null]);
  });

  const outsiders = async () => {
    const tlA2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tlA2.id, "TL", { type: "business_unit", id: w.a2 }, w.orgA.id);
    return [
      ["same-org user without grants", await signIn(api.app, w.nobody.subject)],
      ["TL of the sibling business unit a2", await signIn(api.app, tlA2.subject)],
      ["TO of the other organization", await signIn(api.app, w.officeB.subject)],
    ] as const;
  };

  it("outsiders get 404 on list, view and PATCH, and never see the dispensation", async () => {
    for (const [who, session] of await outsiders()) {
      const list = await call(api.app, "GET", `${T}/gates`, { session });
      const view = await call(api.app, "GET", `${T}/gates/G1`, { session });
      const patch = await call(api.app, "PATCH", `${T}/gates/G1`, {
        session,
        headers: ifm(1),
        body: { approverRoleCode: "SP" },
      });
      for (const [what, r] of [["list", list], ["view", view], ["patch", patch]] as const) {
        expect([403, 404]).toContain(r.status);
        const text = JSON.stringify(r.body);
        expect(text.includes(dispensationId), `${who} ${what} leaks the dispensation id`).toBe(false);
        expect(text.includes(BODY), `${who} ${what} leaks the approving body`).toBe(false);
      }
      console.log(`[SEC-R2 D1] ${who}: list ${list.status}, view ${view.status}, patch ${patch.status}`);
    }
  });
});

describe("D2 reads only", () => {
  it("20 list/view reads by the lead, auditor and sponsor change no gate row and write no audit event", async () => {
    const before = await snapshot();
    for (let i = 0; i < 5; i++)
      for (const s of [p.lead.session, p.auditor.session, p.sponsor.session, p.office.session]) {
        expect((await call(api.app, "GET", `${T}/gates`, { session: s })).status).toBe(200);
        expect((await call(api.app, "GET", `${T}/gates/G1`, { session: s })).status).toBe(200);
      }
    const after = await snapshot();
    console.log(`[SEC-R2 D2] before ${JSON.stringify(before)}\n[SEC-R2 D2] after  ${JSON.stringify(after)}`);
    expect(after).toEqual(before);
    const g = await api.db.selectFrom("gate_instance").select(["status", "approved_at"]).where("transformation_id", "=", p.transformationId).where("gate_code", "=", "G1").executeTakeFirstOrThrow();
    expect([g.status, g.approved_at]).toEqual(["draft", null]);
    const decisions = await api.db.selectFrom("gate_decision").select("id").where("transformation_id", "=", p.transformationId).execute();
    expect(decisions).toEqual([]);
  });
});

describe("D3 configureGate returns the annotation; the write touches only the approver", () => {
  it("PATCH by a gate.configure holder: 200, annotation present, status still draft", async () => {
    const to = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, to.id, "TO", { type: "transformation", id: p.transformationId }, w.orgA.id);
    const s = await signIn(api.app, to.subject);
    const cur = await call(api.app, "GET", `${T}/gates/G1`, { session: s });
    expect(cur.status).toBe(200);
    const r = await call(api.app, "PATCH", `${T}/gates/G1`, {
      session: s,
      headers: ifm(cur.body.gate.version),
      body: { approverRoleCode: cur.body.gate.approverRoleCode },
    });
    console.log(`[SEC-R2 D3] PATCH ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
    expect(r.status).toBe(200);
    expect(r.body.gate.inheritedApproval).toMatchObject({ dispensationId, status: "accepted", counts: true });
    expect([r.body.gate.status, r.body.gate.approvedAt]).toEqual(["draft", null]);
  });
});

describe("D4 unverified evidence never counts, even when accepted", () => {
  it("an accepted G2 inherited approval on unverified evidence is shown with counts=false", async () => {
    const ev = await call(api.app, "POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "note", title: "Synthetic unverified minutes (SEC-R2)", noteBody: "Synthetic.", ownerUserId: p.lead.id },
    });
    expect(ev.status).toBe(201);
    const d = await call(api.app, "POST", `${T}/gate-dispensations`, {
      session: p.lead.session,
      body: { kind: "inherited_approval", gateCode: "G2", approvingBody: BODY, approvedOn: "2026-02-01", evidenceId: ev.body.id },
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const a = await call(api.app, "POST", `${T}/gate-dispensations/${d.body.id}/decision`, {
      session: p.sponsor.session,
      headers: ifm(d.body.version),
      body: { result: "accepted", note: "Synthetic demo decision." },
    });
    console.log(`[SEC-R2 D4] accept on unverified evidence: ${a.status} ${JSON.stringify(a.body).slice(0, 200)}`);
    const list = await call(api.app, "GET", `${T}/gates`, { session: p.lead.session });
    const g2 = list.body.items.find((v: { gate: { gateCode: string } }) => v.gate.gateCode === "G2");
    console.log(`[SEC-R2 D4] G2 annotation ${JSON.stringify(g2.gate.inheritedApproval)} status ${g2.gate.status}`);
    expect(g2.gate.inheritedApproval.counts).toBe(false);
    expect(g2.gate.status).not.toBe("approved");
  });
});
