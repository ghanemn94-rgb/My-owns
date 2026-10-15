// P5 contract exercises of KBE-F (p5-work-split §G.3 and §2 rule 14; T-DG5-KBE-F): the eight slice G operations it
// routes (previewFormula; the optional NPV/ROI/payback extension: getFinancialMetricSettings,
// putFinancialMetricEnablement, putFinancialMetricAssumptions, getBusinessCaseCashFlows, putBusinessCaseCashFlows,
// getBusinessCaseFinancialMetrics, listTransformationFinancialMetrics), each with a success and every declared refusal
// it can reach, through the validating client. Every value is synthetic; nothing here approves anything, and nothing
// touches the engineering gates DG0-DG7. The extension is an extension, not a playbook requirement.
//
// Declared but not reachable here:
//  - previewFormula 403 (session and CSRF only: every signed-in user may preview, AUD included; ADR-0047 §6) and 404
//    (the seeded B0087 example rows of 0023 always exist, and exampleCode is a closed enum);
//  - putFinancialMetricEnablement 422 (the body is one boolean: every refusal is a 400 shape error);
//  - putFinancialMetricAssumptions 422 financial_metrics.assumptions_incomplete (the body requires all three
//    assumptions, so a partial set is a 400; the code is the database's last line in db-errors.ts);
//  - putBusinessCaseCashFlows 422 financial_cash_flows.currency_mismatch (the body carries no currency and the set takes
//    the case's; a business case's currency never changes after create; exercised at the database in
//    financial-metrics.test.ts);
//  - 403 on the reads (a caller who cannot read the transformation gets 404); 429 (the rate limiter's own suite).
//
// Version-0 reads (VERSION_ZERO_READ): getFinancialMetricSettings and getBusinessCaseCashFlows answer version 0 with
// ETag "0" while nothing is stored (the ARCH-R1 ETagOrZero rule), but their contract 200 responses declare `ETag`
// (>= 1). Until the orchestrator applies the proposed ETagOrZero patch (KBE-F handback §5, the BE-L / D-153
// precedent), those two reads are made without the contract assertion; every other call, including both GETs once a
// row exists, goes through the validating client.
import {
  businessCaseCashFlows,
  financialMetrics,
  financialMetricSettings,
  financialMetricsPage,
  formulaPreviewResult,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { call, createUser, grant, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_KBE_F: Readonly<Record<string, z.ZodType>> = {
  previewFormula: formulaPreviewResult,
  getFinancialMetricSettings: financialMetricSettings,
  putFinancialMetricEnablement: financialMetricSettings,
  putFinancialMetricAssumptions: financialMetricSettings,
  getBusinessCaseCashFlows: businessCaseCashFlows,
  putBusinessCaseCashFlows: businessCaseCashFlows,
  getBusinessCaseFinancialMetrics: financialMetrics,
  listTransformationFinancialMetrics: financialMetricsPage,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const PREVIEW = "/api/v1/formula-previews";
const SETTINGS = "/api/v1/benefits/financial-metrics/settings";
const ENABLE = `${SETTINGS}/enablement`;
const ASSUME = `${SETTINGS}/assumptions`;
const ZERO = { "if-match": '"0"' };
const VERSION_ZERO_READ = { contract: false } as const;

/** ADR-0047 §5 fixture: outflow 1000 at t = 0, inflows 300, 400, 500. */
export const FIXTURE_ROWS = [
  { periodIndex: 0, outflow: "1000", inflow: "0" },
  { periodIndex: 1, outflow: "0", inflow: "300" },
  { periodIndex: 2, outflow: "0", inflow: "400" },
  { periodIndex: 3, outflow: "0", inflow: "500" },
];

export async function exerciseP5KbeFOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const p = await setupP2World(api, w);
  const finUser = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, finUser.id, "FIN", { type: "organization", id: w.orgA.id }, w.orgA.id);
  const fin = await signIn(api.app, finUser.subject); // organization-scoped FIN: the organization's assumptions
  // FIN scoped to the transformation (the DG3 financeUser precedent): that transformation's cash flows.
  const caseFinUser = await createUser(api.db, w.orgA.id);
  await grant(
    api.db,
    w.grantor.id,
    caseFinUser.id,
    "FIN",
    { type: "transformation", id: p.transformationId },
    w.orgA.id,
  );
  const caseFin = await signIn(api.app, caseFinUser.subject);
  const admMethod = p.methodologyAdmin.session;
  const auditor = p.auditor.session;
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();

  // previewFormula: 200 (the seeded revenue uplift; an expression with examples); 400 (both sources); 401; 422.
  const seeded = await mirrored("POST", PREVIEW, { session: auditor, body: { exampleCode: "revenue_uplift" } });
  expect(seeded.status).toBe(200);
  expect((seeded.body as Body).unit).toMatchObject({ kind: "currency", currency: "SAR" });
  expect(
    (seeded.body as Body).edgeCases.find((e: Body) => e.variable === "arpu" && e.case === "missing"),
  ).toMatchObject({ status: "not_computable", result: null, reasonCode: "formula.missing_input" });
  const expr = await mirrored("POST", PREVIEW, {
    session: fin,
    body: {
      expression: "volume * unit_saving",
      variables: [
        { name: "volume", kind: "count", period: "year", unit: "tickets", value: "1000" },
        { name: "unit_saving", kind: "currency", period: "none", currency: "SAR", value: "2.5" },
      ],
      examples: [{ label: "Synthetic low case", inputs: { volume: "10" } }],
      edgeCases: false,
    },
  });
  expect(expr.status).toBe(200);
  expect((expr.body as Body).examples).toEqual([
    {
      label: "Synthetic low case",
      inputs: { volume: "10", unit_saving: "2.5" },
      status: "ok",
      result: "25",
      reasonCode: null,
    },
  ]);
  expect(
    (await mirrored("POST", PREVIEW, { session: fin, body: { exampleCode: "revenue_uplift", expression: "1" } }))
      .status,
  ).toBe(400);
  expect((await mirrored("POST", PREVIEW, { session: null, body: { exampleCode: "revenue_uplift" } })).status).toBe(
    401,
  );
  expect(code(await mirrored("POST", PREVIEW, { session: fin, body: { expression: "a +", variables: [] } }))).toEqual([
    422,
    "formula.syntax",
  ]);

  // getFinancialMetricSettings, version 0 (off by default; ETag "0"; see VERSION_ZERO_READ above).
  const none = await call<Body>(api.app, "GET", SETTINGS, { session: auditor, ...VERSION_ZERO_READ });
  expect(none.status).toBe(200);
  expect(none.headers.etag).toBe('"0"');
  expect(none.body).toMatchObject({ enabled: false, version: 0, extension: true, discountRate: null });

  // putFinancialMetricEnablement: 428; 400; 401; 403 (FIN, AUD); 409 (stale before the row exists); 200 ("0" creates).
  const on = { enabled: true };
  expect((await mirrored("PUT", ENABLE, { session: admMethod, body: on })).status).toBe(428);
  expect((await mirrored("PUT", ENABLE, { session: admMethod, headers: ZERO, body: { enabled: "yes" } })).status).toBe(
    400,
  );
  expect((await mirrored("PUT", ENABLE, { session: null, headers: ZERO, body: on })).status).toBe(401);
  expect((await mirrored("PUT", ENABLE, { session: fin, headers: ZERO, body: on })).status).toBe(403);
  expect((await mirrored("PUT", ENABLE, { session: auditor, headers: ZERO, body: on })).status).toBe(403);
  expect((await mirrored("PUT", ENABLE, { session: admMethod, headers: ifm(3), body: on })).status).toBe(409);
  const enabled = await mirrored("PUT", ENABLE, { session: admMethod, headers: ZERO, body: on });
  expect(enabled.status).toBe(200);
  expect(enabled.headers.etag).toBe('"1"');

  // getFinancialMetricSettings: 200 (version 1); 400; 401.
  const settings = await mirrored("GET", SETTINGS, { session: auditor });
  expect(settings.status).toBe(200);
  expect(settings.body).toMatchObject({ enabled: true, version: 1, extension: true });
  expect((await mirrored("GET", `${SETTINGS}?x=1`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", SETTINGS, { session: null })).status).toBe(401);

  // putFinancialMetricAssumptions: 428; 400; 401; 403 (ADM_METHOD, AUD); 409 ("0" once the row exists); 422; 200.
  const assumptions = {
    methodologyNote: "Synthetic: discounted net cash flow of the Finance-entered cash flows, annual periods.",
    timing: "beginning_of_period",
    periodBasis: "annual",
    discountRate: "0.100000",
  };
  expect((await mirrored("PUT", ASSUME, { session: fin, body: assumptions })).status).toBe(428);
  expect(
    (await mirrored("PUT", ASSUME, { session: fin, headers: ifm(1), body: { ...assumptions, timing: "mid" } })).status,
  ).toBe(400);
  expect((await mirrored("PUT", ASSUME, { session: null, headers: ifm(1), body: assumptions })).status).toBe(401);
  expect((await mirrored("PUT", ASSUME, { session: admMethod, headers: ifm(1), body: assumptions })).status).toBe(403);
  expect((await mirrored("PUT", ASSUME, { session: auditor, headers: ifm(1), body: assumptions })).status).toBe(403);
  expect((await mirrored("PUT", ASSUME, { session: fin, headers: ZERO, body: assumptions })).status).toBe(409);
  expect(
    code(
      await mirrored("PUT", ASSUME, { session: fin, headers: ifm(1), body: { ...assumptions, discountRate: "1.5" } }),
    ),
  ).toEqual([422, "financial_metrics.discount_rate_invalid"]);
  const assumed = await mirrored("PUT", ASSUME, { session: fin, headers: ifm(1), body: assumptions });
  expect(assumed.status).toBe(200);
  expect(assumed.body).toMatchObject({ version: 2, discountRate: "0.100000", enabled: true });

  // A synthetic transformation-level business case (SAR, the default currency).
  const created = await mirrored("POST", "/api/v1/business-cases", {
    session: p.lead.session,
    body: { transformationId: p.transformationId, level: "transformation", title: "Synthetic case with cash flows" },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const caseId = (created.body as Body).id as string;
  const CF = `/api/v1/business-cases/${caseId}/cash-flows`;
  const M = `/api/v1/business-cases/${caseId}/financial-metrics`;

  // getBusinessCaseCashFlows: 200 (none: version 0, a VERSION_ZERO_READ); 400; 401; 404 (unknown; cannot read).
  const empty = await call<Body>(api.app, "GET", CF, { session: auditor, ...VERSION_ZERO_READ });
  expect(empty.status).toBe(200);
  expect(empty.headers.etag).toBe('"0"');
  expect(empty.body).toMatchObject({ revision: 0, version: 0, rows: [], currency: "SAR" });
  expect((await mirrored("GET", "/api/v1/business-cases/nope/cash-flows", { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", CF, { session: null })).status).toBe(401);
  expect((await mirrored("GET", `/api/v1/business-cases/${missing}/cash-flows`, { session: auditor })).status).toBe(
    404,
  );
  expect((await mirrored("GET", CF, { session: nobody })).status).toBe(404);

  // getBusinessCaseFinancialMetrics before cash flows: cash_flows_missing (200).
  const before = await mirrored("GET", M, { session: auditor });
  expect(before.status).toBe(200);
  expect(before.body).toMatchObject({ status: "cash_flows_missing", npv: null, npvReason: "not_shown" });

  // putBusinessCaseCashFlows: 428; 400 (a negative amount); 401; 403 (AUD); 404; 409; 422 (a gap); 200 ("0" creates).
  const flows = { basisNote: "Synthetic Finance estimate", rows: FIXTURE_ROWS };
  expect((await mirrored("PUT", CF, { session: caseFin, body: flows })).status).toBe(428);
  expect(
    (
      await mirrored("PUT", CF, {
        session: caseFin,
        headers: ZERO,
        body: { rows: [{ periodIndex: 0, outflow: "-1", inflow: "0" }] },
      })
    ).status,
  ).toBe(400);
  expect((await mirrored("PUT", CF, { session: null, headers: ZERO, body: flows })).status).toBe(401);
  expect((await mirrored("PUT", CF, { session: auditor, headers: ZERO, body: flows })).status).toBe(403);
  expect(
    (
      await mirrored("PUT", `/api/v1/business-cases/${missing}/cash-flows`, {
        session: caseFin,
        headers: ZERO,
        body: flows,
      })
    ).status,
  ).toBe(404);
  expect((await mirrored("PUT", CF, { session: caseFin, headers: ifm(2), body: flows })).status).toBe(409);
  expect(
    code(
      await mirrored("PUT", CF, {
        session: caseFin,
        headers: ZERO,
        body: { rows: [FIXTURE_ROWS[0], { ...FIXTURE_ROWS[1], periodIndex: 2 }] },
      }),
    ),
  ).toEqual([422, "financial_cash_flows.periods_invalid"]);
  const put = await mirrored("PUT", CF, { session: caseFin, headers: ZERO, body: flows });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  expect(put.headers.etag).toBe('"1"');
  expect((put.body as Body).rows).toHaveLength(4);
  const stored = await mirrored("GET", CF, { session: auditor });
  expect(stored.status).toBe(200);
  expect(stored.body).toMatchObject({ revision: 1, version: 1, basisNote: "Synthetic Finance estimate" });

  // getBusinessCaseFinancialMetrics: 200 (the fixture at 10 %, beginning of period: NPV -21.04); 400; 401; 404.
  const shown = await mirrored("GET", M, { session: auditor });
  expect(shown.status).toBe(200);
  expect(shown.body).toMatchObject({
    status: "shown",
    currency: "SAR",
    npv: "-21.04",
    roi: "0.200000",
    paybackPeriodIndex: 3,
    extension: true,
    cashFlowRevision: 1,
  });
  expect((await mirrored("GET", "/api/v1/business-cases/nope/financial-metrics", { session: auditor })).status).toBe(
    400,
  );
  expect((await mirrored("GET", M, { session: null })).status).toBe(401);
  expect((await mirrored("GET", M, { session: nobody })).status).toBe(404);

  // listTransformationFinancialMetrics: 200; 400 (bad cursor); 401; 404.
  const LIST = `/api/v1/transformations/${p.transformationId}/benefits/financial-metrics`;
  const list = await mirrored("GET", LIST, { session: auditor });
  expect(list.status).toBe(200);
  expect((list.body as Body).items.map((i: Body) => i.businessCaseId)).toEqual([caseId]);
  expect((await mirrored("GET", `${LIST}?cursor=bogus`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", LIST, { session: null })).status).toBe(401);
  expect((await mirrored("GET", LIST, { session: nobody })).status).toBe(404);
  expect(
    (await mirrored("GET", `/api/v1/transformations/${missing}/benefits/financial-metrics`, { session: auditor }))
      .status,
  ).toBe(404);
}
