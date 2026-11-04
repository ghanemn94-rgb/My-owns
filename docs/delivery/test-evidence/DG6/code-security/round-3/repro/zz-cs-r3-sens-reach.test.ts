// code-security-reviewer DG6 round 3: the round-2 reproduction (unchanged tests) PLUS P-CALC-2 (AUD; explicit grant;
// revocation; a stand-alone T09 lineage row stays listed). Derived from round-2/repro/zz-cs-r2-sens-reach.test.ts.
// Original header: code-security-reviewer DG6 round 2 reproduction (re-verification of F-DG6-121, F-DG6-122, F-DG6-123, plus new probes).
// NOT part of the candidate; copied into a disposable clone's tests/qa/integration by checks.sh and removed afterwards.
// Demo data is SYNTHETIC.
//
// Every expectation states the CORRECT behaviour (ADR-0051 §2: "the record and its individual value are never shown";
// "Lists, search, exports, assistant retrieval: the row is absent"). A pass means the leak is closed; a failure names
// the leak. The same scenario as round 1 (zz-cs-r1-audit-sensitivity / zz-cs-r1-form-record-sensitivity):
//   1. a TO (sensitive_record.grant at the organization) marks a demo benefit sensitive through the API;
//   2. the benefit's owner (a named party) records a measurement with amount 987654.32;
//   3. a TL of the transformation and an AUD of the organization, neither admitted, read.
// New probe (P-CALC): a FORMULA-backed sensitive benefit; the calculation lineage of its measurements is listed by
//   GET /api/v1/benefit-formulas/{formulaId}/versions/{n}/calculations (transformation.read only).
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo, sql } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const AMOUNT = "987654.32";

let scratch = "";
let api: TestApi;
let aud: Session;
let tl: Session;
let tlUserId = "";
let calcFormula: { formula_id: string; version_no: number; calc_id: string; benefit_id: string } | null = null;
let to: Session;
let benefitId = "";
let measurementId = "";

async function sessionOfUser(userId: string): Promise<Session> {
  // A demo user signs in through a dev-issuer identity added for the test (the demo seed's identities belong to the
  // demo IdP), exactly as round 1 did.
  const g = await createUser(api.db, ORG);
  const devIssuer = (
    await sql<{ issuer: string }>`SELECT issuer FROM user_identity WHERE user_id = ${g.id}::uuid`.execute(api.db)
  ).rows[0]!.issuer;
  const subject = `cs-r2-${userId.slice(-8)}-${Math.random().toString(16).slice(2, 8)}`;
  await sql`INSERT INTO user_identity (id, user_id, issuer, subject) VALUES (${crypto.randomUUID()}::uuid, ${userId}::uuid, ${devIssuer}, ${subject})`.execute(
    api.db,
  );
  return signIn(api.app, subject);
}

async function mark(id: string): Promise<void> {
  const r = await call<Loose>(api.app, "PUT", `/api/v1/transformations/${T}/records/benefit/${id}/sensitivity`, {
    session: to,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic: commercially sensitive figure (cs-r2)." },
  });
  console.log("mark", id, r.status, JSON.stringify(r.body).slice(0, 200));
  expect(r.status).toBe(200);
}

async function allPages(session: Session, path: string): Promise<Loose[]> {
  const out: Loose[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 300; i += 1) {
    const sep = path.includes("?") ? "&" : "?";
    const q: string = cursor ? `${sep}limit=100&cursor=${encodeURIComponent(cursor)}` : `${sep}limit=100`;
    const r = await call<Loose>(api.app, "GET", `${path}${q}`, { session });
    expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 300)}`).toBe(200);
    out.push(...r.body.items);
    cursor = r.body.nextCursor;
    if (!cursor) break;
  }
  return out;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r2_reach");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const a = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, a.id, "AUD", { type: "organization", id: ORG } as never, ORG);
  aud = await signIn(api.app, a.subject);
  const l = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, l.id, "TL", { type: "transformation", id: T } as never, ORG);
  tl = await signIn(api.app, l.subject);
  tlUserId = l.id;
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("cs-r2: the reach of a sensitive benefit", () => {
  it("setup: mark a measured, NON-formula demo benefit sensitive; its owner records a measurement", async () => {
    const c = await sql<{ benefit_id: string }>`
      SELECT m.benefit_id FROM audit_event e JOIN benefit_measurement m ON m.id = e.record_id
        JOIN benefit b ON b.id = m.benefit_id
       WHERE e.record_type = 'benefit_measurement' AND e.transformation_id = ${T}::uuid AND b.benefit_formula_id IS NULL
       GROUP BY m.benefit_id ORDER BY count(*) DESC LIMIT 1`.execute(api.db);
    benefitId = c.rows[0]?.benefit_id ?? "01995000-4401-7000-8000-000000000001";
    console.log("benefit", benefitId);
    await mark(benefitId);
    const ownerId = (
      await sql<{ id: string }>`SELECT owner_user_id AS id FROM benefit WHERE id = ${benefitId}::uuid`.execute(api.db)
    ).rows[0]!.id;
    const owner = await sessionOfUser(ownerId);
    const m = await call<Loose>(api.app, "POST", `/api/v1/transformations/${T}/benefits/${benefitId}/measurements`, {
      session: owner,
      body: { periodStart: "2026-09-01", periodEnd: "2026-09-30", amount: AMOUNT, attribution: "Synthetic cs-r2." },
    });
    console.log("owner measurement", m.status, JSON.stringify(m.body).slice(0, 200));
    expect(m.status).toBe(201);
    measurementId = m.body.id;
    const tlGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, { session: tl });
    const audGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, { session: aud });
    const toGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${benefitId}`, { session: to });
    console.log("record GET: TL", tlGet.status, "AUD", audGet.status, "TO (admitted)", toGet.status);
    expect(tlGet.status).toBe(404);
    expect(audGet.status).toBe(404);
    expect(toGet.status).toBe(200);
  }, 180_000);

  it("F-DG6-121: TL per-transformation audit trail carries no value or reason of the benefit or its children", async () => {
    const trail = await allPages(tl, `/api/v1/transformations/${T}/audit`);
    const measurementIds = (
      await sql<{ id: string }>`SELECT id FROM benefit_measurement WHERE benefit_id = ${benefitId}::uuid`.execute(api.db)
    ).rows.map((r) => r.id);
    const own = trail.filter((e) => e.recordType === "benefit" && e.recordId === benefitId);
    const kids = trail.filter((e) => measurementIds.includes(e.recordId));
    const sens = trail.filter((e) => e.recordType === "record_sensitivity");
    const leak = [...own, ...kids, ...sens].filter((e) => e.changes !== null || e.reason !== null);
    const amountAnywhere = trail.filter((e) => JSON.stringify(e).includes("987654.32"));
    console.log("TL trail:", trail.length, "own", own.length, "children", kids.length, "sensitivity", sens.length);
    console.log("TL trail leaking entries", leak.length, JSON.stringify(leak[0] ?? null).slice(0, 500));
    console.log("TL trail entries containing the amount", amountAnywhere.length, JSON.stringify(amountAnywhere[0] ?? null).slice(0, 500));
    expect(own.length).toBeGreaterThan(0);
    expect(kids.length).toBeGreaterThan(0);
    expect(leak).toEqual([]);
    expect(amountAnywhere).toEqual([]);
    // Control: the admitted TO still sees the values (no blanket over-redaction).
    const toTrail = await allPages(to, `/api/v1/transformations/${T}/audit`);
    const toKid = toTrail.find((e) => e.recordId === measurementId);
    console.log("TO (admitted) sees the new measurement event with changes:", JSON.stringify(toKid ?? null).slice(0, 300));
    expect(toKid?.changes).not.toBeNull();
  }, 300_000);

  it("F-DG6-122: AUD /audit-events and the single-event read redact the children's events", async () => {
    const list = await allPages(aud, `/api/v1/audit-events?organizationId=${ORG}&transformationId=${T}&recordType=benefit_measurement`);
    const measurementIds = (
      await sql<{ id: string }>`SELECT id FROM benefit_measurement WHERE benefit_id = ${benefitId}::uuid`.execute(api.db)
    ).rows.map((r) => r.id);
    const ofSensitive = list.filter((e) => measurementIds.includes(e.recordId));
    const unredacted = ofSensitive.filter((e) => e.redacted !== true || e.changes !== null || e.reason !== null);
    console.log("AUD measurement events of the sensitive benefit", ofSensitive.length, "unredacted", unredacted.length, JSON.stringify(unredacted[0] ?? null).slice(0, 400));
    expect(ofSensitive.length).toBeGreaterThan(0);
    expect(unredacted).toEqual([]);
    const sens = await allPages(aud, `/api/v1/audit-events?organizationId=${ORG}&transformationId=${T}&recordType=record_sensitivity`);
    const sensLeak = sens.filter((e) => e.redacted !== true || e.reason !== null);
    console.log("AUD record_sensitivity events", sens.length, "unredacted", sensLeak.length, JSON.stringify(sensLeak[0] ?? null).slice(0, 300));
    expect(sensLeak).toEqual([]);
    // The single event read of the new measurement's event.
    const ev = await sql<{ id: string }>`SELECT id FROM audit_event WHERE record_type = 'benefit_measurement' AND record_id = ${measurementId}::uuid LIMIT 1`.execute(api.db);
    const one = await call<Loose>(api.app, "GET", `/api/v1/audit-events/${ev.rows[0]!.id}`, { session: aud });
    console.log("AUD single event", one.status, JSON.stringify(one.body).slice(0, 400));
    expect([200, 404]).toContain(one.status);
    if (one.status === 200) {
      expect(one.body.redacted).toBe(true);
      expect(one.body.changes).toBeNull();
    }
  }, 300_000);

  it("F-DG6-123: the form-record sub-resources of the T14 benefit answer 404 to the TL", async () => {
    const FR = `/api/v1/transformations/${T}/form-records/T14/${benefitId}`;
    const toComment = await call<Loose>(api.app, "POST", `${FR}/comments`, {
      session: to,
      body: { body: "Synthetic: restricted - the final rebate figure is 5.1 MSAR (cs-r2)." },
    });
    console.log("TO comment", toComment.status);
    expect(toComment.status).toBe(201);
    const res: Record<string, number> = {};
    for (const [k, m, p, body] of [
      ["versions", "GET", `${FR}/versions`, undefined],
      ["comments", "GET", `${FR}/comments`, undefined],
      ["attachments", "GET", `${FR}/attachments`, undefined],
      ["custom-fields", "GET", `${FR}/custom-fields`, undefined],
      ["compare", "GET", `${FR}/compare?fromVersion=1&toVersion=2`, undefined],
      ["post-comment", "POST", `${FR}/comments`, { body: "Synthetic: TL writes on a record it cannot open." }],
    ] as const) {
      const r = await call<Loose>(api.app, m, p, { session: tl, contract: false, ...(body ? { body } : {}) });
      res[k] = r.status;
      if (r.status !== 404) console.log("TL", k, r.status, JSON.stringify(r.body).slice(0, 300));
    }
    console.log("TL form-record statuses", JSON.stringify(res));
    // Control: the admitted TO reads the comments.
    const toComments = await call<Loose>(api.app, "GET", `${FR}/comments`, { session: to });
    console.log("TO comments", toComments.status, (toComments.body.items ?? []).length);
    expect(toComments.status).toBe(200);
    expect(res).toEqual({
      versions: 404,
      comments: 404,
      attachments: 404,
      "custom-fields": 404,
      compare: 404,
      "post-comment": 404,
    });
    // The form export of T14 (a list): the row is absent for the TL.
    const exp = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/form-records/T14/export?format=csv`, {
      session: tl,
      contract: false,
    });
    const text = typeof exp.body === "string" ? exp.body : JSON.stringify(exp.body);
    console.log("TL T14 export", exp.status, "contains the benefit id:", text.includes(benefitId));
    if (exp.status === 200) expect(text.includes(benefitId)).toBe(false);
  }, 180_000);

  it("P-CALC: the calculation lineage of a sensitive FORMULA benefit is not listed to the TL", async () => {
    const f = await sql<{ benefit_id: string; formula_id: string; version_no: number; calc_id: string; result: string; amount: string }>`
      SELECT b.id AS benefit_id, v.formula_id::text AS formula_id, v.version_no, c.id::text AS calc_id,
             c.result::text AS result, m.amount::text AS amount
        FROM benefit_measurement m JOIN benefit b ON b.id = m.benefit_id
        JOIN benefit_calculation c ON c.id = m.benefit_calculation_id
        JOIN benefit_formula_version v ON v.id = c.formula_version_id
       WHERE m.transformation_id = ${T}::uuid AND b.id <> ${benefitId}::uuid
       ORDER BY m.recorded_at DESC NULLS LAST LIMIT 1`.execute(api.db).catch(async () =>
      sql<{ benefit_id: string; formula_id: string; version_no: number; calc_id: string; result: string; amount: string }>`
      SELECT b.id AS benefit_id, v.formula_id::text AS formula_id, v.version_no, c.id::text AS calc_id,
             c.result::text AS result, m.amount::text AS amount
        FROM benefit_measurement m JOIN benefit b ON b.id = m.benefit_id
        JOIN benefit_calculation c ON c.id = m.benefit_calculation_id
        JOIN benefit_formula_version v ON v.id = c.formula_version_id
       WHERE m.transformation_id = ${T}::uuid AND b.id <> ${benefitId}::uuid LIMIT 1`.execute(api.db),
    );
    console.log("formula-backed measured benefit", JSON.stringify(f.rows[0] ?? null));
    expect(f.rows.length).toBe(1);
    const row = f.rows[0]!;
    calcFormula = row;
    // Before the marking, the TL reads the lineage (normal).
    const before = await call<Loose>(api.app, "GET", `/api/v1/benefit-formulas/${row.formula_id}/versions/${row.version_no}/calculations?limit=100`, { session: tl });
    console.log("TL calculations before marking", before.status, (before.body.items ?? []).length);
    await mark(row.benefit_id);
    const tlGet = await call<Loose>(api.app, "GET", `/api/v1/transformations/${T}/benefits/${row.benefit_id}`, { session: tl });
    console.log("TL GET formula benefit after marking", tlGet.status);
    expect(tlGet.status).toBe(404);
    const items = await allPages(tl, `/api/v1/benefit-formulas/${row.formula_id}/versions/${row.version_no}/calculations`);
    const hit = items.find((c) => c.id === row.calc_id);
    console.log("TL calculations after marking", items.length, "the sensitive measurement's calculation:", JSON.stringify(hit ?? null).slice(0, 600));
    console.log("measurement amount", row.amount, "calculation result", row.result);
    // ADR-0051 §2: the sensitive benefit's individual value is never shown to a reader who is not admitted.
    expect(hit).toBeUndefined();
  }, 180_000);
  it("P-CALC-2: AUD does not list it; an explicit grant admits the TL; revoking it hides the row again", async () => {
    expect(calcFormula).not.toBeNull();
    const row = calcFormula!;
    const path = `/api/v1/benefit-formulas/${row.formula_id}/versions/${row.version_no}/calculations`;
    const audItems = await allPages(aud, path);
    console.log("AUD lists the sensitive calculation:", audItems.some((c) => c.id === row.calc_id), "of", audItems.length);
    expect(audItems.some((c) => c.id === row.calc_id)).toBe(false);
    const toItems = await allPages(to, path);
    console.log("TO (sensitive_record.grant) lists it:", toItems.some((c) => c.id === row.calc_id));
    expect(toItems.some((c) => c.id === row.calc_id)).toBe(true);
    const g = await call<Loose>(api.app, "POST", "/api/v1/admin/sensitive-grants", {
      session: to,
      body: { transformationId: T, recordType: "benefit", recordId: row.benefit_id, granteeUserId: tlUserId, reason: "Synthetic grant (cs-r3)." },
    });
    console.log("grant", g.status, JSON.stringify(g.body).slice(0, 200));
    expect(g.status).toBe(201);
    const granted = await allPages(tl, path);
    console.log("TL lists it after the grant:", granted.some((c) => c.id === row.calc_id));
    expect(granted.some((c) => c.id === row.calc_id)).toBe(true);
    const rv = await call<Loose>(api.app, "POST", `/api/v1/admin/sensitive-grants/${g.body.id}/revoke`, {
      session: to,
      headers: { "if-match": `"${g.body.version}"` },
      body: { reason: "Synthetic revoke (cs-r3)." },
    });
    console.log("revoke", rv.status);
    expect(rv.status).toBe(200);
    const revoked = await allPages(tl, path);
    console.log("TL lists it after the revocation:", revoked.some((c) => c.id === row.calc_id), "of", revoked.length);
    expect(revoked.some((c) => c.id === row.calc_id)).toBe(false);
    // A lineage row no measurement references (a T09 run on the formula alone) is not hidden: no over-filtering.
    const lone = await sql<{ n: string }>`SELECT count(*)::text AS n FROM benefit_calculation c JOIN benefit_formula_version v ON v.id = c.formula_version_id
      WHERE v.formula_id = ${row.formula_id}::uuid AND v.version_no = ${row.version_no}
        AND NOT EXISTS (SELECT 1 FROM benefit_measurement m WHERE m.benefit_calculation_id = c.id)`.execute(api.db);
    console.log("stand-alone lineage rows of the version:", lone.rows[0]!.n, "listed to the TL:", revoked.length);
  }, 180_000);
});
