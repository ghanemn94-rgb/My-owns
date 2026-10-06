// code-security-reviewer DG2 round-3 probes (T-DG2-REV-SEC-R3): D-063 blank-text hardening, regression of authz /
// If-Match / audit around the charter Out of scope + exclusions pre-check. NOT part of the candidate: copied into a
// disposable clone at apps/api/test/integration/ and run against a disposable PostgreSQL 16. All data SYNTHETIC.
// Assertions encode the SECURE expectation (a failing assertion = a defect). G1 is a PRODUCT gate, unrelated to DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, auditOfRequest, call, seedWorld, startApi, type Res, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const rid = (r: Res) => String(r.headers["x-request-id"]);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

async function blank400(res: Res, pointer: string, tag: string) {
  const errs = (res.body?.errors ?? []) as { pointer: string; code: string }[];
  const audit = await auditOfRequest(api.db, rid(res));
  log(tag, [res.status, res.body?.code, errs.map((e) => `${e.pointer}:${e.code}`), audit.length]);
  expect(res.status).toBe(400);
  expect(errs).toContainEqual(expect.objectContaining({ pointer, code: "validation.blank" }));
  expect(audit).toEqual([]);
}

// Unicode White_Space that JS String.prototype.trim DOES strip (NBSP, ideographic space, LS/PS, BOM, figure/math spaces).
const UNICODE_BLANKS = [" ", "　 ", "﻿ ", "   ", "  "];

describe("charter Out of scope: Unicode-whitespace rejected; authz / If-Match / audit unchanged", () => {
  let C: string;
  let charterId: string;
  beforeAll(async () => {
    C = `${T}/charter`;
    const created = await call(api.app, "POST", C, {
      session: p.lead.session,
      body: { transformationName: "Synthetic", inScope: "Retail (synthetic)", outOfScope: "Enterprise (synthetic)" },
    });
    expect(created.status).toBe(201);
    charterId = created.body.charter.id;
  });

  it("Unicode whitespace-only outOfScope / changeSummary -> 400 validation.blank, no write, no audit", async () => {
    const before = await auditOf(api.db, charterId);
    for (const b of UNICODE_BLANKS) {
      await blank400(
        await call(api.app, "PATCH", C, { session: p.lead.session, headers: ifm(1), body: { outOfScope: b, changeSummary: "x (synthetic)" } }),
        "/outOfScope",
        `unicode.outOfScope.${JSON.stringify(b)}`,
      );
      await blank400(
        await call(api.app, "PATCH", C, { session: p.lead.session, headers: ifm(1), body: { outOfScope: "ok (synthetic)", changeSummary: b } }),
        "/changeSummary",
        `unicode.changeSummary.${JSON.stringify(b)}`,
      );
    }
    const v = await call(api.app, "GET", C, { session: p.lead.session });
    expect([v.body.charter.version, v.body.charter.outOfScope]).toEqual([1, "Enterprise (synthetic)"]);
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("read-only auditor PATCH -> 403 with a denial audit, no write", async () => {
    const r = await call(api.app, "PATCH", C, { session: p.auditor.session, headers: ifm(1), body: { outOfScope: null, changeSummary: "auditor (synthetic)" } });
    const a = await auditOfRequest(api.db, rid(r));
    log("authz.auditor", [r.status, r.body.code, a.map((x) => [x.action, x.outcome])]);
    expect(r.status).toBe(403);
    expect(a.length).toBe(1);
    expect((await call(api.app, "GET", C, { session: p.lead.session })).body.charter.version).toBe(1);
  });

  it("an outsider (other transformation's lead) cannot read or write this charter", async () => {
    const q = await setupP2World(api, w);
    const g = await call(api.app, "GET", C, { session: q.lead.session });
    const w2 = await call(api.app, "PATCH", C, { session: q.lead.session, headers: ifm(1), body: { outOfScope: null, changeSummary: "x (synthetic)" } });
    log("authz.outsider", [g.status, w2.status]);
    expect([403, 404]).toContain(g.status);
    expect([403, 404]).toContain(w2.status);
  });

  it("stale If-Match -> 409, missing If-Match -> 428, nothing written", async () => {
    const before = await auditOf(api.db, charterId);
    const stale = await call(api.app, "PATCH", C, { session: p.lead.session, headers: ifm(7), body: { outOfScope: null, changeSummary: "stale (synthetic)" } });
    const none = await call(api.app, "PATCH", C, { session: p.lead.session, body: { outOfScope: null, changeSummary: "none (synthetic)" } });
    log("ifmatch", [stale.status, stale.body.code, none.status, none.body.code]);
    expect(stale.status).toBe(409);
    expect(none.status).toBe(428);
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("null clears Out of scope -> audited once; pre-check 'attention'; G1 lists /charter/outOfScope", async () => {
    const r = await call(api.app, "PATCH", C, { session: p.lead.session, headers: ifm(1), body: { outOfScope: null, changeSummary: "clear (synthetic)" } });
    expect(r.status).toBe(200);
    const a = await auditOfRequest(api.db, rid(r));
    const v = await call(api.app, "GET", C, { session: p.lead.session });
    const ex = v.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented");
    const g1 = await call(api.app, "GET", `${T}/gates/G1`, { session: p.lead.session });
    const ic = g1.body.criteria.find((c: { key: string }) => c.key === "g1.initial_charter");
    log("clear", [r.body.charter.version, a.map((x) => [x.action, x.new_version]), ex?.result, ic?.missing?.map((m: { pointer: string }) => m.pointer)]);
    expect(a.map((x) => [x.action, x.new_version])).toEqual([["charter.update", 2]]);
    expect(ex.result).toBe("attention");
    expect(ic.missing.some((m: { pointer: string }) => m.pointer === "/charter/outOfScope")).toBe(true);
    // the auditor can still read the view (read-only) and sees the same pre-check
    const av = await call(api.app, "GET", C, { session: p.auditor.session });
    expect(av.status).toBe(200);
    expect(av.body.scopeCheckPrechecks.find((x: { code: string }) => x.code === "exclusions_documented").result).toBe("attention");
  });
});

describe("other P2 inputs not covered by the implementer's blank-text suite", () => {
  it("journey: blank nested step name / actor / systems[] -> 400 at the nested pointer; no journey written", async () => {
    const base = { name: "Synthetic journey", kind: "journey", state: "current" };
    const step = (extra: object) => ({ key: randomUUID(), ordinal: 1, name: "Step (synthetic)", ...extra });
    const n0 = (await api.db.selectFrom("journey").select("id").where("transformation_id", "=", p.transformationId).execute()).length;
    await blank400(await call(api.app, "POST", `${T}/journeys`, { session: p.lead.session, body: { ...base, steps: [step({ name: " " })] } }), "/steps/0/name", "journey.step.name");
    await blank400(await call(api.app, "POST", `${T}/journeys`, { session: p.lead.session, body: { ...base, steps: [step({ actor: " \t" })] } }), "/steps/0/actor", "journey.step.actor");
    await blank400(await call(api.app, "POST", `${T}/journeys`, { session: p.lead.session, body: { ...base, steps: [step({ systems: ["CRM", "  "] })] } }), "/steps/0/systems/1", "journey.step.systems");
    await blank400(await call(api.app, "POST", `${T}/journeys`, { session: p.lead.session, body: { ...base, failureDemand: "　" } }), "/failureDemand", "journey.failureDemand");
    const n1 = (await api.db.selectFrom("journey").select("id").where("transformation_id", "=", p.transformationId).execute()).length;
    expect(n1).toBe(n0);
    // control: empty actor "" is allowed (freeText(0,200)) and stored as given
    const ok = await call(api.app, "POST", `${T}/journeys`, { session: p.lead.session, body: { ...base, steps: [step({ actor: "" })] } });
    log("journey.control", [ok.status]);
    expect(ok.status).toBe(201);
    // PATCH (partial merge) with a blank field
    const j = ok.body;
    const before = await auditOf(api.db, j.id);
    await blank400(await call(api.app, "PATCH", `${T}/journeys/${j.id}`, { session: p.lead.session, headers: ifm(j.version), body: { description: "\n" } }), "/description", "journey.patch.description");
    expect(await auditOf(api.db, j.id)).toEqual(before);
  });

  it("evidence review note blank -> 400, evidence stays unreviewed, no audit", async () => {
    const e = await call(api.app, "POST", `${T}/evidence`, { session: p.contributor.session, body: { kind: "note", title: "Synthetic", ownerUserId: p.contributor.id, noteBody: "Synthetic body" } });
    expect(e.status).toBe(201);
    const before = await auditOf(api.db, e.body.id);
    await blank400(
      await call(api.app, "POST", `${T}/evidence/${e.body.id}/review`, { session: p.lead.session, headers: ifm(e.body.version), body: { result: "verified", accessibilityStatus: "accessible", note: "　" } }),
      "/note",
      "evidence.review.note",
    );
    const after = await call(api.app, "GET", `${T}/evidence/${e.body.id}`, { session: p.lead.session });
    log("evidence.after", [after.body.reviewStatus, after.body.version]);
    expect(after.body.version).toBe(e.body.version);
    expect(await auditOf(api.db, e.body.id)).toEqual(before);
  });

  it("gate G1 submission note blank -> 400, no submission row, no audit", async () => {
    const g = await call(api.app, "GET", `${T}/gates/G1`, { session: p.lead.session });
    const ver = g.body.gate.version;
    const n0 = (await api.db.selectFrom("gate_submission").select("id").execute()).length;
    const r = await call(api.app, "POST", `${T}/gates/G1/submissions`, { session: p.lead.session, headers: ifm(ver), body: { submissionNote: "   " } });
    await blank400(r, "/submissionNote", "gate.submission.note");
    expect((await api.db.selectFrom("gate_submission").select("id").execute()).length).toBe(n0);
  });

  it("decision PATCH: blank title on a partial update -> 400; options blank label -> 400", async () => {
    const d = await call(api.app, "POST", "/api/v1/decisions", { session: p.lead.session, body: { transformationId: p.transformationId, title: "Synthetic decision" } });
    expect(d.status).toBe(201);
    await blank400(await call(api.app, "PATCH", `/api/v1/decisions/${d.body.id}`, { session: p.lead.session, headers: ifm(1), body: { title: " " } }), "/title", "decision.patch.title");
    const o = await call(api.app, "POST", `/api/v1/decisions/${d.body.id}/options`, { session: p.lead.session, headers: ifm(1), body: { title: "  " } });
    log("decision.option", [o.status, o.body.code, (o.body.errors ?? []).map((e: { pointer: string; code: string }) => `${e.pointer}:${e.code}`)]);
    expect(o.status).toBe(400);
  });
});
