// Business cases (ADR-0024 §1-§5; REQ-PB-053, REQ-PB-054, REQ-PB-055 part, REQ-S05-005; T-DG3-KBE-B) against a real
// PostgreSQL. All data is SYNTHETIC; Finance validations are demo decisions by synthetic users and approve nothing
// real. Product gates G1-G6 are business approvals inside the product; nothing here touches DG0-DG7.
//  - the ten B0085 sections persist; missingSections per level (the lighter initiative set);
//  - exactly one class per line: two classes -> 400; class/kind or class/value-basis mismatch -> 422;
//  - roll-up by reference: editing an initiative case line changes the transformation totals, never duplicated; the
//    total equals the distinct lines, each counted once; gross / cost / net separate, per currency, Unknown not 0;
//  - Finance validation of the baseline: FIN only, never the author (403), hash stored, Stale after a baseline edit;
//  - every mutation: AUD 403 (audited), If-Match 428/409, an audit event, authorization re-checked at commit time.
import { insertAuditEvent, sql } from "@mth/db";
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
import { financeUser, insertInitiative } from "../contract/p3-exercises-kbe-b.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close(), 60_000);

const B = "/api/v1/business-cases";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const TEN_SECTIONS = {
  strategicRationale: "Synthetic: roaming revenue declines while competitors grow.",
  baselineSummary: "Synthetic baseline: roaming attach 10% of 100000 eligible customers (FY2025).",
  valuePoolsSummary: "Synthetic: attach uplift and unit-cost reduction pools.",
  interventionsSummary: "Synthetic: bundle redesign and digital self-service.",
  investmentSummary: "Synthetic: platform capex and vendor costs.",
  benefitsSummary: "Synthetic: revenue uplift and cost reduction.",
  benefitRamp: "Q1-Q4",
  recurrenceSummary: "Recurring from year 2.",
  implementationHorizon: "18 months",
  keyAssumptions: "Synthetic: ARPU stable at 50 SAR.",
  downsideCase: "Synthetic downside: attach +1 pp only.",
  upsideCase: "Synthetic upside: attach +3 pp.",
  decisionAskTypes: ["funding", "resource"],
  decisionAskText: "Synthetic: fund Wave 1 and assign two FTE.",
};

const createCase = (session: Session, body: Record<string, unknown>) =>
  call<Body>(api.app, "POST", B, { session, body });
const createLine = (session: Session, caseId: string, body: Record<string, unknown>) =>
  call<Body>(api.app, "POST", `${B}/${caseId}/lines`, { session, body });
const totals = (session: Session, caseId: string) => call<Body>(api.app, "GET", `${B}/${caseId}/totals`, { session });
const capex = (amount: string | null, over: Record<string, unknown> = {}) => ({
  lineKind: "investment",
  class: "capex",
  valueBasis: "cash",
  title: "Synthetic platform",
  amount,
  currency: "SAR",
  ...over,
});
const revenue = (amount: string | null, over: Record<string, unknown> = {}) => ({
  lineKind: "benefit",
  class: "revenue",
  valueBasis: "revenue_uplift",
  title: "Synthetic attach uplift",
  amount,
  currency: "SAR",
  ...over,
});

async function transformationCase(p: P2World, over: Record<string, unknown> = {}) {
  const res = await createCase(p.lead.session, {
    transformationId: p.transformationId,
    level: "transformation",
    title: "Synthetic transformation case",
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Body;
}

async function initiativeCase(p: P2World, initiativeId: string, session: Session = p.lead.session) {
  const res = await createCase(session, {
    transformationId: p.transformationId,
    level: "initiative",
    initiativeId,
    title: "Synthetic initiative case",
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Body;
}

async function insertFormula(p: P2World): Promise<string> {
  const id = crypto.randomUUID();
  await api.db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("benefit_formula")
      .values({
        id,
        organization_id: t.organization_id,
        transformation_id: p.transformationId,
        code: `BF-${String(Math.floor(Math.random() * 9000) + 1000)}`,
        benefit_name: "Synthetic revenue uplift",
        created_by: p.lead.id,
        updated_by: p.lead.id,
      })
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "user", actorUserId: p.lead.id, requestId: `fixture-${id}`, source: "api" },
      {
        action: "benefit_formula.create",
        recordType: "benefit_formula",
        recordId: id,
        organizationId: t.organization_id,
        transformationId: p.transformationId,
        newVersion: 1,
      },
    );
  });
  return id;
}

describe("transformation case: the ten B0085 sections (REQ-PB-053)", () => {
  it("all ten sections persist and read back; missingSections clears once lines and owners exist", async () => {
    const p = await setupP2World(api, w);
    const fin = await financeUser(api, w, p);
    const created = await transformationCase(p, {
      sections: {
        ...TEN_SECTIONS,
        benefitOwnerUserId: p.sponsor.id,
        initiativeOwnerUserId: p.contributor.id,
        financeValidatorUserId: fin.id,
      },
    });
    expect(created).toMatchObject({ code: "BC-01", level: "transformation", currency: "SAR", version: 1 });
    expect(created.sections).toMatchObject({
      ...TEN_SECTIONS,
      benefitOwnerUserId: p.sponsor.id,
      initiativeOwnerUserId: p.contributor.id,
      financeValidatorUserId: fin.id,
    });
    // Investment and benefits also need >= 1 active line of their kind.
    expect(created.missingSections).toEqual(["investment", "benefits"]);
    expect((await auditOf(api.db, created.id)).map((e) => e.action)).toEqual(["business_case.create"]);

    await createLine(p.lead.session, created.id, capex("1000"));
    await createLine(p.lead.session, created.id, revenue("5000"));
    const read = await call<Body>(api.app, "GET", `${B}/${created.id}`, { session: p.auditor.session });
    expect([read.status, read.headers["etag"]]).toEqual([200, '"1"']);
    expect(read.body.sections).toEqual({ ...created.sections });
    expect(read.body.missingSections).toEqual([]);

    // A bare case misses all ten; null clears a section again.
    const p2 = await setupP2World(api, w);
    const bare = await transformationCase(p2);
    expect(bare.missingSections).toEqual([
      "strategic_rationale",
      "baseline",
      "value_pools",
      "interventions",
      "investment",
      "benefits",
      "timing",
      "risks",
      "ownership",
      "decision_ask",
    ]);
    const cleared = await call<Body>(api.app, "PATCH", `${B}/${created.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { sections: { upsideCase: null } },
    });
    expect([cleared.status, cleared.body.sections.upsideCase, cleared.body.missingSections]).toEqual([
      200,
      null,
      ["risks"],
    ]);
  });

  it("one active transformation case per transformation (409); configurable currency; blank text 400", async () => {
    const p = await setupP2World(api, w);
    const first = await transformationCase(p, { currency: "USD" });
    expect(first.currency).toBe("USD");
    const second = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "transformation",
      title: "Second",
    });
    expect([second.status, second.body.code]).toEqual([409, "business_case.transformation_case_exists"]);
    const blank = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "transformation",
      title: "   ",
    });
    expect(blank.status).toBe(400);
    const unknownSection = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "transformation",
      title: "x",
      sections: { npv: "1" },
    });
    expect(unknownSection.status).toBe(400);
  });
});

describe("initiative cases and the roll-up (REQ-PB-054, REQ-S05-005)", () => {
  it("an initiative case links to the one transformation case and fills the lighter set", async () => {
    const p = await setupP2World(api, w);
    const ini = await insertInitiative(api.db, p);
    const before = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "initiative",
      initiativeId: ini,
      title: "Too early",
    });
    expect([before.status, before.body.code]).toEqual([422, "business_case.transformation_case_required"]);
    const top = await transformationCase(p);
    const child = await initiativeCase(p, ini);
    expect(child).toMatchObject({ level: "initiative", initiativeId: ini, parentCaseId: top.id, code: "BC-02" });
    expect(child.missingSections).toEqual([
      "strategic_rationale",
      "interventions",
      "investment",
      "benefits",
      "timing",
      "ownership",
    ]);
    const dup = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "initiative",
      initiativeId: ini,
      title: "Again",
    });
    expect([dup.status, dup.body.code]).toEqual([409, "business_case.initiative_case_exists"]);
    const noIni = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "initiative",
      title: "No initiative",
    });
    expect([noIni.status, noIni.body.code]).toEqual([422, "business_case.initiative_required"]);
    const foreign = await createCase(p.lead.session, {
      transformationId: p.transformationId,
      level: "initiative",
      initiativeId: crypto.randomUUID(),
      title: "Unknown initiative",
    });
    expect([foreign.status, foreign.body.code]).toEqual([422, "validation.reference"]);
    // Archiving the transformation case is refused while initiative cases link to it.
    const arch = await call<Body>(api.app, "POST", `${B}/${top.id}/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic archive" },
    });
    expect([arch.status, arch.body.code]).toEqual([422, "business_case.has_initiative_cases"]);
  });

  it("the total equals the distinct lines once; editing an initiative line changes the roll-up without duplication", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p);
    const iniA = await initiativeCase(p, await insertInitiative(api.db, p));
    const iniB = await initiativeCase(p, await insertInitiative(api.db, p));
    // Transformation office cost owned by no initiative; each initiative its own lines (synthetic B0087 amounts).
    await createLine(p.lead.session, top.id, capex("200", { class: "opex", title: "Transformation office" }));
    const aBenefit = (await createLine(p.lead.session, iniA.id, revenue("100000"))).body;
    await createLine(p.lead.session, iniA.id, capex("30000"));
    await createLine(
      p.lead.session,
      iniB.id,
      revenue("500000", { class: "cost_reduction", valueBasis: "cash_saving", title: "Unit cost" }),
    );

    const t1 = (await totals(p.auditor.session, top.id)).body;
    expect(t1.includedCaseIds).toEqual([top.id, iniA.id, iniB.id]);
    expect(t1.grossBenefits).toEqual([{ currency: "SAR", amount: "600000", unknownLineCount: 0, lineCount: 2 }]);
    expect(t1.implementationCost).toEqual([{ currency: "SAR", amount: "30200", unknownLineCount: 0, lineCount: 2 }]);
    expect(t1.netValue).toEqual([{ currency: "SAR", amount: "569800", unknownLineCount: 0, lineCount: 4 }]);
    expect(t1.grossBenefitsByValueBasis).toEqual({
      cash_saving: [{ currency: "SAR", amount: "500000", unknownLineCount: 0, lineCount: 1 }],
      revenue_uplift: [{ currency: "SAR", amount: "100000", unknownLineCount: 0, lineCount: 1 }],
    });
    // The total = the sum of the distinct lines of the included cases, read straight from the table.
    const distinct = await sql<{ n: string; s: string }>`
      SELECT count(DISTINCT id)::text AS n, sum(amount)::text AS s FROM business_case_line
      WHERE business_case_id IN (${top.id}, ${iniA.id}, ${iniB.id}) AND status = 'active' AND line_kind = 'benefit'`.execute(
      api.db,
    );
    expect(distinct.rows[0]).toEqual({ n: "2", s: "600000.0000" });

    // Edit the initiative line: the roll-up follows on the next read, by reference, counted once.
    const edited = await call<Body>(api.app, "PATCH", `${B}/${iniA.id}/lines/${aBenefit.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { amount: "150000.25" },
    });
    expect([edited.status, edited.body.amount, edited.body.version]).toEqual([200, "150000.2500", 2]);
    const t2 = (await totals(p.auditor.session, top.id)).body;
    expect(t2.grossBenefits).toEqual([{ currency: "SAR", amount: "650000.25", unknownLineCount: 0, lineCount: 2 }]);
    expect(t2.netValue[0].amount).toBe("619800.25");
    const lineRows = await api.db
      .selectFrom("business_case_line")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(lineRows).toHaveLength(4); // nothing copied into the transformation case
    // The initiative's own totals stay its own.
    const tA = (await totals(p.lead.session, iniA.id)).body;
    expect([tA.includedCaseIds, tA.grossBenefits[0].amount, tA.implementationCost[0].amount]).toEqual([
      [iniA.id],
      "150000.25",
      "30000",
    ]);
    // Archiving the initiative line removes it from the roll-up.
    const arch = await call<Body>(api.app, "POST", `${B}/${iniA.id}/lines/${aBenefit.id}/archive`, {
      session: p.lead.session,
      headers: ifm(2),
      body: { reason: "Synthetic: dropped" },
    });
    expect(arch.status).toBe(200);
    expect((await totals(p.auditor.session, top.id)).body.grossBenefits[0].amount).toBe("500000");
  });

  it("Unknown is never 0; per currency; revenue vs margin and non-financial kept apart", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p);
    await createLine(p.lead.session, top.id, revenue(null));
    const t1 = (await totals(p.auditor.session, top.id)).body;
    expect(t1.grossBenefits).toEqual([{ currency: "SAR", amount: null, unknownLineCount: 1, lineCount: 1 }]);
    expect(t1.netValue).toEqual([{ currency: "SAR", amount: null, unknownLineCount: 1, lineCount: 1 }]);
    await createLine(p.lead.session, top.id, revenue("10", { valueBasis: "margin_uplift", title: "Margin" }));
    await createLine(p.lead.session, top.id, revenue("7", { currency: "USD", title: "USD revenue" }));
    await createLine(p.lead.session, top.id, {
      lineKind: "benefit",
      class: "strategic_non_financial",
      valueBasis: "non_financial",
      title: "Brand trust",
      currency: "SAR",
    });
    const t2 = (await totals(p.auditor.session, top.id)).body;
    expect(t2.grossBenefits).toEqual([
      { currency: "SAR", amount: "10", unknownLineCount: 1, lineCount: 2 },
      { currency: "USD", amount: "7", unknownLineCount: 0, lineCount: 1 },
    ]);
    expect(t2.nonFinancialBenefitCount).toBe(1);
    expect(t2.warnings.map((x: { code: string }) => x.code)).toEqual(["business_case.revenue_and_margin"]);
  });
});

describe("lines: exactly one class (REQ-PB-053, REQ-S05-005)", () => {
  it("two classes -> 400 at /class; class/kind and class/value-basis mismatch -> 422; value rules", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p);
    const twoArray = await createLine(p.lead.session, top.id, capex("1", { class: ["capex", "revenue"] }));
    expect(twoArray.status).toBe(400);
    expect(twoArray.body.errors.map((e: { pointer: string }) => e.pointer)).toContain("/class");
    const twoProps = await createLine(p.lead.session, top.id, {
      ...capex("1"),
      class: undefined,
      investmentClass: "capex",
      benefitClass: "revenue",
    });
    expect(twoProps.status).toBe(400);
    expect(twoProps.body.errors.map((e: { pointer: string }) => e.pointer)).toContain("/class");

    const kind = await createLine(p.lead.session, top.id, capex("1", { class: "revenue" }));
    expect([kind.status, kind.body.code, kind.body.errors[0].pointer]).toEqual([
      422,
      "business_case.line_class_mismatch",
      "/class",
    ]);
    const basis = await createLine(
      p.lead.session,
      top.id,
      revenue("1", { class: "cost_avoidance", valueBasis: "cash_saving" }),
    );
    expect([basis.status, basis.body.code, basis.body.errors[0].pointer]).toEqual([
      422,
      "business_case.value_basis_mismatch",
      "/valueBasis",
    ]);
    const fteCash = await createLine(p.lead.session, top.id, capex("1", { class: "internal_fte" }));
    expect(fteCash.body.code).toBe("business_case.value_basis_mismatch");
    const nonFin = await createLine(p.lead.session, top.id, {
      lineKind: "benefit",
      class: "strategic_non_financial",
      valueBasis: "non_financial",
      title: "Brand",
      amount: "100",
      currency: "SAR",
    });
    expect(nonFin.body.code).toBe("business_case.non_financial_amount");
    expect((await createLine(p.lead.session, top.id, capex("-5"))).body.code).toBe("business_case.amount_negative");
    expect((await createLine(p.lead.session, top.id, capex("1.12345"))).status).toBe(400); // numeric(20,4)
    expect((await createLine(p.lead.session, top.id, capex("12", { amount: 12 }))).status).toBe(400); // never a number
    expect((await createLine(p.lead.session, top.id, capex("1", { fte: "2" }))).body.code).toBe(
      "business_case.fte_only_internal",
    );
    const period = await createLine(
      p.lead.session,
      top.id,
      capex("1", { periodStart: "2026-05-01", periodEnd: "2026-01-01" }),
    );
    expect(period.body.code).toBe("business_case.period_range");

    const fte = await createLine(p.lead.session, top.id, {
      lineKind: "investment",
      class: "internal_fte",
      valueBasis: "non_cash",
      title: "Two analysts",
      amount: "360000.5",
      fte: "2.50",
      currency: "SAR",
    });
    expect(fte.status, JSON.stringify(fte.body)).toBe(201);
    expect(fte.body).toMatchObject({ class: "internal_fte", amount: "360000.5000", fte: "2.50", version: 1 });
    expect(fte.headers["etag"]).toBe('"1"');
    expect((await auditOf(api.db, fte.body.id)).map((e) => e.action)).toEqual(["business_case_line.create"]);
    // The database holds exactly one class column.
    const stored = await api.db
      .selectFrom("business_case_line")
      .select(["investment_class", "benefit_class"])
      .where("id", "=", fte.body.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ investment_class: "internal_fte", benefit_class: null });
    // Kind and class cannot change on update (400: not in the update schema).
    const reclass = await call<Body>(api.app, "PATCH", `${B}/${top.id}/lines/${fte.body.id}`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { class: "capex" },
    });
    expect(reclass.status).toBe(400);
  });

  it("one benefit formula backs at most one active line in the transformation (409)", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p);
    const ini = await initiativeCase(p, await insertInitiative(api.db, p));
    const formula = await insertFormula(p);
    const first = await createLine(p.lead.session, ini.id, revenue("100000", { benefitFormulaId: formula }));
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await createLine(p.lead.session, top.id, revenue("100000", { benefitFormulaId: formula }));
    expect([second.status, second.body.code]).toEqual([409, "business_case.formula_already_linked"]);
    const onCost = await createLine(p.lead.session, top.id, capex("1", { benefitFormulaId: formula }));
    expect(onCost.body.code).toBe("business_case.formula_only_benefit");
  });
});

describe("Finance validation of the baseline (REQ-PB-055 part)", () => {
  it("FIN validates; the author is refused 403; the hash is stored; a baseline change shows Stale", async () => {
    const p = await setupP2World(api, w);
    const fin = await financeUser(api, w, p);
    // A FIN + TL user who authors the case can never validate it.
    const finTl = await createUser(api.db, w.orgA.id);
    const scope = { type: "transformation" as const, id: p.transformationId };
    await grant(api.db, w.grantor.id, finTl.id, "FIN", scope, w.orgA.id);
    await grant(api.db, w.grantor.id, finTl.id, "TL", scope, w.orgA.id);
    const finTlSession = await signIn(api.app, finTl.subject);
    const kase = (
      await createCase(finTlSession, {
        transformationId: p.transformationId,
        level: "transformation",
        title: "Authored by FIN+TL",
        sections: { baselineSummary: TEN_SECTIONS.baselineSummary },
      })
    ).body;
    const V = `${B}/${kase.id}/baseline-validation`;
    const body = { result: "validated", note: "Synthetic: baseline checked against FY2025 ledger." };
    const own = await call<Body>(api.app, "POST", V, { session: finTlSession, headers: ifm(1), body });
    expect([own.status, own.body.code]).toEqual([403, "finance.validator_is_author"]);
    expect(await auditOfRequest(api.db, String(own.headers["x-request-id"]))).toEqual([
      expect.objectContaining({ action: "authorization.denied" }),
    ]);
    // TL without finance.validate: 403.
    expect((await call<Body>(api.app, "POST", V, { session: p.lead.session, headers: ifm(1), body })).status).toBe(403);
    expect((await call<Body>(api.app, "POST", V, { session: p.auditor.session, headers: ifm(1), body })).status).toBe(
      403,
    );
    expect((await call<Body>(api.app, "POST", V, { session: fin.session, body })).status).toBe(428);
    expect((await call<Body>(api.app, "POST", V, { session: fin.session, headers: ifm(5), body })).status).toBe(409);
    expect(
      (
        await call<Body>(api.app, "POST", V, {
          session: fin.session,
          headers: ifm(1),
          body: { result: "ok", note: "x" },
        })
      ).status,
    ).toBe(400);

    const ok = await call<Body>(api.app, "POST", V, { session: fin.session, headers: ifm(1), body });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ baselineValidation: "validated", baselineValidatedBy: fin.id, version: 2 });
    const row = await api.db
      .selectFrom("business_case")
      .select(["baseline_validated_sha256", "baseline_summary"])
      .where("id", "=", kase.id)
      .executeTakeFirstOrThrow();
    const { createHash } = await import("node:crypto");
    expect(row.baseline_validated_sha256).toBe(createHash("sha256").update(row.baseline_summary!).digest("hex"));
    const events = await auditOf(api.db, kase.id);
    expect(events.map((e) => e.action)).toEqual(["business_case.create", "business_case.baseline_validate"]);

    // A non-baseline edit keeps it validated; a baseline edit makes it Stale (never validated, never green).
    const titled = await call<Body>(api.app, "PATCH", `${B}/${kase.id}`, {
      session: finTlSession,
      headers: ifm(2),
      body: { title: "Renamed", sections: { strategicRationale: "Synthetic rationale" } },
    });
    expect(titled.body.baselineValidation).toBe("validated");
    const stale = await call<Body>(api.app, "PATCH", `${B}/${kase.id}`, {
      session: finTlSession,
      headers: ifm(3),
      body: { sections: { baselineSummary: "Synthetic baseline restated: attach 9%." } },
    });
    expect([stale.status, stale.body.baselineValidation]).toEqual([200, "stale"]);
    expect(
      (await call<Body>(api.app, "GET", `${B}/${kase.id}`, { session: fin.session })).body.baselineValidation,
    ).toBe("stale");
    // Revalidation on the new baseline makes it current again; a rejection reads as rejected.
    const re = await call<Body>(api.app, "POST", V, { session: fin.session, headers: ifm(4), body });
    expect(re.body.baselineValidation).toBe("validated");
    const rej = await call<Body>(api.app, "POST", V, {
      session: fin.session,
      headers: ifm(5),
      body: { result: "rejected", note: "Synthetic: source missing." },
    });
    expect(rej.body.baselineValidation).toBe("rejected");

    // An empty baseline cannot be validated.
    const p2 = await setupP2World(api, w);
    const fin2 = await financeUser(api, w, p2);
    const empty = await transformationCase(p2);
    const none = await call<Body>(api.app, "POST", `${B}/${empty.id}/baseline-validation`, {
      session: fin2.session,
      headers: ifm(1),
      body,
    });
    expect([none.status, none.body.code]).toEqual([422, "business_case.baseline_missing"]);
  });
});

describe("every mutation: AUD 403, If-Match 428/409, audit, WL record-level", () => {
  it("the read-only auditor gets 403 (audited) on all seven mutations, whatever the body", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p, { sections: { baselineSummary: "Synthetic baseline" } });
    const line = (await createLine(p.lead.session, top.id, capex("1"))).body;
    const aud = p.auditor.session;
    const attempts: [string, string, Record<string, unknown>, Record<string, string>?][] = [
      ["POST", B, { transformationId: p.transformationId, level: "transformation", title: "x" }],
      ["POST", B, { nonsense: true }],
      ["PATCH", `${B}/${top.id}`, { title: "x" }, ifm(1)],
      ["POST", `${B}/${top.id}/archive`, { reason: "Synthetic" }, ifm(1)],
      ["POST", `${B}/${top.id}/baseline-validation`, { result: "validated", note: "x" }, ifm(1)],
      ["POST", `${B}/${top.id}/lines`, capex("1")],
      ["PATCH", `${B}/${top.id}/lines/${line.id}`, { amount: "2" }, ifm(1)],
      ["POST", `${B}/${top.id}/lines/${line.id}/archive`, { reason: "Synthetic" }, ifm(1)],
    ];
    for (const [method, url, body, headers] of attempts) {
      const res = await call<Body>(api.app, method, url, { session: aud, body, ...(headers ? { headers } : {}) });
      expect(res.status, `${method} ${url}`).toBe(403);
      if (!("nonsense" in body))
        expect(await auditOfRequest(api.db, String(res.headers["x-request-id"])), `${method} ${url}`).toEqual([
          expect.objectContaining({ action: "authorization.denied" }),
        ]);
    }
    // Nothing changed.
    expect((await call<Body>(api.app, "GET", `${B}/${top.id}`, { session: aud })).body.version).toBe(1);
  });

  it("If-Match: 428 without, 409 stale, on update/archive of cases and lines; each success audited", async () => {
    const p = await setupP2World(api, w);
    const top = await transformationCase(p);
    const line = (await createLine(p.lead.session, top.id, capex("1"))).body;
    const s = p.lead.session;
    for (const [method, url, body] of [
      ["PATCH", `${B}/${top.id}`, { title: "x" }],
      ["POST", `${B}/${top.id}/archive`, { reason: "Synthetic" }],
      ["PATCH", `${B}/${top.id}/lines/${line.id}`, { amount: "2" }],
      ["POST", `${B}/${top.id}/lines/${line.id}/archive`, { reason: "Synthetic" }],
    ] as const) {
      expect((await call<Body>(api.app, method, url, { session: s, body })).status, url).toBe(428);
      expect((await call<Body>(api.app, method, url, { session: s, body, headers: ifm(7) })).status, url).toBe(409);
    }
    const upd = await call<Body>(api.app, "PATCH", `${B}/${top.id}/lines/${line.id}`, {
      session: s,
      headers: ifm(1),
      body: { amount: "2", title: "Renamed" },
    });
    expect(upd.headers["etag"]).toBe('"2"');
    const events = await auditOf(api.db, line.id);
    expect(events.map((e) => e.action)).toEqual(["business_case_line.create", "business_case_line.update"]);
    expect(events[1]!.changes).toMatchObject({ amount: { from: "1.0000", to: "2.0000" } });
    const archived = await call<Body>(api.app, "POST", `${B}/${top.id}/archive`, {
      session: s,
      headers: ifm(1),
      body: { reason: "Synthetic archive" },
    });
    expect([archived.status, archived.body.status]).toEqual([200, "archived"]);
    expect((await auditOf(api.db, top.id)).map((e) => e.action)).toEqual([
      "business_case.create",
      "business_case.archive",
    ]);
    const onArchived = await createLine(s, top.id, capex("1"));
    expect([onArchived.status, onArchived.body.code]).toEqual([422, "business_case.archived"]);
    // Archived cases are listed only with includeArchived.
    const list = await call<Body>(api.app, "GET", `${B}?transformationId=${p.transformationId}`, { session: s });
    expect(list.body.items).toEqual([]);
    const all = await call<Body>(api.app, "GET", `${B}?transformationId=${p.transformationId}&includeArchived=true`, {
      session: s,
    });
    expect(all.body.items.map((c: { id: string }) => c.id)).toEqual([top.id]);
  });

  it("WL edits only the initiative cases of initiatives they lead (record-level, 403 otherwise)", async () => {
    const p = await setupP2World(api, w); // p.contributor is WL on the transformation
    const wl = p.contributor.session;
    const own = await insertInitiative(api.db, p, { workstreamLeadUserId: p.contributor.id });
    const other = await insertInitiative(api.db, p);
    const topByWl = await createCase(wl, { transformationId: p.transformationId, level: "transformation", title: "x" });
    expect([topByWl.status, topByWl.body.code]).toEqual([403, "business_case.not_initiative_lead"]);
    const top = await transformationCase(p);
    const mine = await initiativeCase(p, own, wl);
    expect(mine.createdBy).toBe(p.contributor.id);
    const notMine = await createCase(wl, {
      transformationId: p.transformationId,
      level: "initiative",
      initiativeId: other,
      title: "x",
    });
    expect(notMine.status).toBe(403);
    expect((await createLine(wl, mine.id, capex("5"))).status).toBe(201);
    expect((await createLine(wl, top.id, capex("5"))).status).toBe(403);
  });

  // The request is authenticated (session and grants resolved in preValidation), then its handler blocks on a table
  // lock held by the test; meanwhile the caller's only grant is revoked. The write transaction re-resolves the principal
  // (openWrite atCommit, BE18A) and refuses with 403; a snapshot taken when the request started would still allow it
  // (control run without atCommit: 201, handback evidence). Create-case authorises before it reads any business_case
  // row, so it cannot be raced this way; it uses the same openWrite atCommit call.
  const RACES: [string, string, string, (c: { id: string }, l: { id: string }) => [string, unknown, number?]][] = [
    ["update case", "TL", "PATCH", (c) => [`${B}/${c.id}`, { title: "Racing" }, 1]],
    ["archive case", "TL", "POST", (c) => [`${B}/${c.id}/archive`, { reason: "Racing" }, 1]],
    [
      "validate baseline",
      "FIN",
      "POST",
      (c) => [`${B}/${c.id}/baseline-validation`, { result: "validated", note: "x" }, 1],
    ],
    ["create line", "TL", "POST", (c) => [`${B}/${c.id}/lines`, capex("42")]],
    ["update line", "TL", "PATCH", (c, l) => [`${B}/${c.id}/lines/${l.id}`, { amount: "43" }, 1]],
    ["archive line", "TL", "POST", (c, l) => [`${B}/${c.id}/lines/${l.id}/archive`, { reason: "Racing" }, 1]],
  ];
  it.each(RACES)(
    "authorization is re-checked at commit time (%s): a grant revoked after authentication -> 403, nothing written",
    async (_name, role, method, target) => {
      const p = await setupP2World(api, w);
      const kase = await transformationCase(p, { sections: { baselineSummary: "Synthetic baseline" } });
      const line = (await createLine(p.lead.session, kase.id, capex("1"))).body;
      const user = await createUser(api.db, w.orgA.id);
      const assignment = await grant(
        api.db,
        w.grantor.id,
        user.id,
        role,
        { type: "transformation", id: p.transformationId },
        w.orgA.id,
      );
      const session = await signIn(api.app, user.subject);
      const [url, body, version] = target(kase, line);
      const locker = await api.owner.connect();
      let res: Awaited<ReturnType<typeof call<Body>>>;
      try {
        await locker.query("BEGIN");
        await locker.query("LOCK TABLE business_case IN ACCESS EXCLUSIVE MODE");
        const pending = call<Body>(api.app, method, url, {
          session,
          body,
          ...(version !== undefined ? { headers: ifm(version) } : {}),
        });
        let blocked = false;
        for (let i = 0; i < 250 && !blocked; i++) {
          const r = await api.owner.query<{ n: number }>(
            `select count(*)::int as n from pg_locks where relation = 'business_case'::regclass and not granted`,
          );
          blocked = r.rows[0]!.n > 0;
          if (!blocked) await new Promise((r2) => setTimeout(r2, 20));
        }
        expect(blocked).toBe(true);
        const revoked = await api.owner.query(
          `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic commit-time probe' where id = $2`,
          [w.grantor.id, assignment],
        );
        expect(revoked.rowCount).toBe(1);
        await locker.query("COMMIT");
        res = await pending;
      } finally {
        locker.release();
      }
      expect(res.status, JSON.stringify(res.body)).toBe(403);
      expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([
        expect.objectContaining({ action: "authorization.denied" }),
      ]);
      // Nothing written: the case and its one line are unchanged.
      const after = await api.db
        .selectFrom("business_case")
        .select("version")
        .where("id", "=", kase.id)
        .executeTakeFirstOrThrow();
      const lines = await api.db
        .selectFrom("business_case_line")
        .select(["id", "version"])
        .where("business_case_id", "=", kase.id)
        .execute();
      expect([after.version, lines]).toEqual([1, [{ id: line.id, version: 1 }]]);
    },
    30_000,
  );
});
