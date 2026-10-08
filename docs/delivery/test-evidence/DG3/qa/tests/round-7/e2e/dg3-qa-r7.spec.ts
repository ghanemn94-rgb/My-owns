// qa-verifier DG3 round 7 (T-DG3-REV-QA-R7; a copy of the round-6 spec dg3-qa-r6.spec.ts with renames only: header, results file dg3-qa-r7-checks-*, synthetic names "R7", screenshot prefix qa-r7-. The round-6 spec is a copy of the round-5 spec with renames only. The round-5 spec is a copy of the round-4 spec dg3-qa-r4.spec.ts with renames only. The round-4 spec is a copy of the round-3 spec dg3-qa-r3.spec.ts, plus A9-R4 formula-repair probes; the round-3 spec is a copy of the round-2 spec dg3-qa-r2.spec.ts, itself copied from round 1 and extended with the
// inherited-approval annotation probes IA1/U3 for the F-DG3-120 repair): independent acceptance probes of the 32 DG3-final requirements, run on
// the REAL stack (e2e/support/qa-stack.sh: disposable PostgreSQL, migrations, seed-dev, built API serving the built SPA;
// no mocks). Each acceptance text in docs/delivery/requirements.csv is checked LITERALLY through the public HTTP API
// with CSRF, Origin, If-Match and Idempotency-Key, as distinct SYNTHETIC users (TL dev.lead, a synthetic SP, a
// synthetic FIN, a synthetic capacity owner BO, the AUD dev.auditor). The UI part checks the same story on screen in
// the project's language (chromium-en English LTR, chromium-ar Arabic RTL) with axe.
//
// The only steps borrowed from the product's own e2e support are the G1-G3 RECORD fixtures (g1Records, defineRecords,
// g2Records, g3Records) and syntheticUser: they create P2 records through the same public API; every DG3 assertion
// below is the QA verifier's own. Every check is recorded (id, requirement, pass, detail) in a JSON results file in
// $QA_RESULTS_DIR so that a single failing literal check never hides the others (expect.soft).
//
// Everything is SYNTHETIC; every business decision here is a demo record that approves nothing real. Product gates
// G1-G6 are business approvals inside the product and never imply any engineering gate DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import {
  defineRecords,
  g1Records,
  g2Records,
  g3Records,
  syntheticUser,
  type SyntheticUser,
} from "../apps/web/e2e/support/p3-journey-setup.ts";
import { apiSession, langOf, signIn, SYN_RETAIL, type ApiSession, type Lang } from "../apps/web/e2e/support/ui.ts";

test.describe.configure({ mode: "serial" });

const BASE = process.env["E2E_BASE_URL"] ?? "http://localhost:3000";
const OUT = process.env["QA_RESULTS_DIR"] ?? join(process.cwd(), "qa-results");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
interface Res {
  status: number;
  body: Body;
  headers: Record<string, string>;
}
interface QaSession {
  userId: string;
  req: APIRequestContext;
  raw(
    method: string,
    path: string,
    data?: unknown,
    o?: { ifMatch?: number | string; noIdem?: boolean },
  ): Promise<Res>;
}

async function qaSession(api: ApiSession): Promise<QaSession> {
  const me = (await (await api.req.get("/api/v1/me")).json()) as { csrfToken: string; user: { id: string } };
  return {
    userId: me.user.id,
    req: api.req,
    async raw(method, path, data, o = {}) {
      const headers: Record<string, string> = { "X-CSRF-Token": me.csrfToken };
      if (o.ifMatch !== undefined) headers["If-Match"] = `"${o.ifMatch}"`;
      if (method === "POST" && o.ifMatch === undefined && !o.noIdem) headers["Idempotency-Key"] = crypto.randomUUID();
      const res = await api.req.fetch(path, { method, headers, ...(data !== undefined ? { data } : {}) });
      const text = await res.text();
      let body: Body = text;
      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        /* non-JSON */
      }
      return { status: res.status(), body, headers: res.headers() };
    },
  };
}

// ------------------------------------------------------------------------------------------------ results

interface Check {
  id: string;
  req: string;
  pass: boolean;
  detail: string;
}
const checks: Check[] = [];
function check(id: string, req: string, pass: boolean, detail: unknown): void {
  const d = typeof detail === "string" ? detail : String(JSON.stringify(detail) ?? "undefined");
  checks.push({ id, req, pass, detail: d.slice(0, 1500) });
  // Record only: the serial chain must keep running so that one failing literal check never hides the others. The
  // final test "Z" fails the run if any recorded check failed (and lists them).
  if (!pass) console.log(`QA-CHECK-FAIL ${id} [${req}] ${d.slice(0, 600)}`);
}
const brief = (r: Res) => ({ status: r.status, type: r.body?.type, code: r.body?.code, detail: r.body?.detail });
const num = (s: unknown) => (s === null || s === undefined ? null : Number(String(s)));

test.afterAll(async ({}, info) => {
  mkdirSync(OUT, { recursive: true });
  const lang = langOf(info);
  writeFileSync(join(OUT, `dg3-qa-r7-checks-${lang}.json`), `${JSON.stringify(checks, null, 2)}\n`);
});

// ------------------------------------------------------------------------------------------------ shared state

let tid = "";
let T = "";
let lead: QaSession;
let leadApi: ApiSession;
let admin: QaSession;
let office: QaSession;
let auditor: QaSession;
let sp: SyntheticUser;
let fin: SyntheticUser;
let bo: SyntheticUser;
let spS: QaSession;
let finS: QaSession;
let boS: QaSession;
let outcome: { outcomeId: string; outcomeKpiId: string } = { outcomeId: "", outcomeKpiId: "" };
const ini: Record<string, { id: string; code: string; name: string }> = {};
let formulaId = "";
let tomGapId = "";
const caseIds = { top: "", kase: "" };
const plainBenefitLines: { caseId: string; lineId: string }[] = [];

const getIni = async (k: string) => (await lead.raw("GET", `/api/v1/initiatives/${ini[k]!.id}`)).body;
const RATIONALE = "Synthetic demo decision by the QA verifier; approves nothing real.";

async function sessionFor(playwright: Parameters<typeof apiSession>[0], username: string) {
  return qaSession(await apiSession(playwright, username));
}

async function createInitiative(key: string, name: string, extra: Record<string, unknown> = {}) {
  const r = await lead.raw("POST", "/api/v1/initiatives", { transformationId: tid, name, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  ini[key] = { id: r.body.id, code: r.body.code, name };
  return r.body;
}

async function contribute(key: string) {
  const r = await lead.raw("POST", `/api/v1/initiatives/${ini[key]!.id}/outcome-contributions`, {
    outcomeId: outcome.outcomeId,
    outcomeKpiId: outcome.outcomeKpiId,
    contributionStatement: "Synthetic: contributes to first-time-right bills.",
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

async function submitInitiative(key: string) {
  const cur = await getIni(key);
  return lead.raw("POST", `/api/v1/initiatives/${ini[key]!.id}/submit`, {}, { ifMatch: cur.version });
}

async function scoreAll(key: string, values: Record<string, number>) {
  for (const [criterionCode, score] of Object.entries(values)) {
    const r = await lead.raw("POST", `/api/v1/initiatives/${ini[key]!.id}/scores`, { criterionCode, score });
    expect(r.status, `${key} ${criterionCode}: ${JSON.stringify(r.body)}`).toBe(201);
  }
}

async function gateView(code: string, s: QaSession = lead) {
  return (await s.raw("GET", `${T}/gates/${code}`)).body;
}

async function submitGate(code: string, s: QaSession = lead) {
  const v = await gateView(code, s);
  return s.raw("POST", `${T}/gates/${code}/submissions`, { submissionNote: `Synthetic ${code} submission` }, {
    ifMatch: v.gate.version,
  });
}

async function decideGate(code: string, s: QaSession, submissionNo: number, extra: Record<string, unknown> = {}) {
  const v = await gateView(code, lead);
  return s.raw(
    "POST",
    `${T}/gates/${code}/decision`,
    { submissionNo, outcome: "approved", rationale: RATIONALE, ...extra },
    { ifMatch: v.gate.version },
  );
}

// ================================================================================================ API acceptance

test("A0 setup: End-to-End transformation; distinct synthetic SP, FIN and capacity owner (BO)", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  leadApi = await apiSession(playwright, "dev.lead");
  lead = await qaSession(leadApi);
  const adminApi = await apiSession(playwright, "dev.admin");
  admin = await qaSession(adminApi);
  office = await sessionFor(playwright, "dev.office");
  auditor = await sessionFor(playwright, "dev.auditor");
  const t = await lead.raw("POST", "/api/v1/transformations", {
    businessUnitId: SYN_RETAIL,
    name: `Synthetic QA DG3 R7 ${lang.toUpperCase()}`,
    mode: "end_to_end",
  });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  tid = t.body.id;
  T = `/api/v1/transformations/${tid}`;
  const me = (await admin.raw("GET", "/api/v1/me")).body;
  const stamp = `${Date.now().toString(36)}${lang}`;
  sp = await syntheticUser(adminApi, me.organization.id, tid, `qa.sp.${stamp}`, `QA Sponsor ${lang}`, "SP", lang);
  fin = await syntheticUser(adminApi, me.organization.id, tid, `qa.fin.${stamp}`, `QA Finance ${lang}`, "FIN", lang);
  bo = await syntheticUser(adminApi, me.organization.id, tid, `qa.bo.${stamp}`, `QA Owner ${lang}`, "BO", lang);
  spS = await sessionFor(playwright, sp.username);
  finS = await sessionFor(playwright, fin.username);
  boS = await sessionFor(playwright, bo.username);
  check("A0-distinct-users", "REQ-DLV-035", new Set([lead.userId, sp.id, fin.id, bo.id]).size === 4, {
    lead: lead.userId,
    sp: sp.id,
    fin: fin.id,
    bo: bo.id,
  });
});

test("A1 sequencing before G1 (REQ-PB-007, REQ-PB-022): draft allowed, submit 422 invalid-transition, readiness lists missing areas", async () => {
  // T05: all 14 source fields (direct fields here; deliverables, gap link, contribution, dependencies, milestones and
  // decisions are linked records checked below).
  const fields = {
    executiveOwnerUserId: lead.userId,
    workstreamLeadUserId: lead.userId,
    problemStatement: "Synthetic: billing errors at order entry.",
    objective: "Synthetic: validate orders before billing.",
    scopeIn: "Synthetic: retail consumer orders.",
    scopeOut: "Synthetic: wholesale.",
    financialBenefitSummary: "Synthetic: lower rework cost.",
    customerBenefitSummary: "Synthetic: fewer complaints.",
    risksSummary: "Synthetic: vendor delay.",
    plannedStart: "2026-11-01",
    plannedEnd: "2027-03-31",
  };
  const x = await createInitiative("X", "Synthetic QA order validation", fields);
  check("A1-draft-created-before-G1", "REQ-PB-007", x.status === "draft", { status: x.status });
  const sub = await submitInitiative("X");
  check(
    "A1-submit-before-G1-422",
    "REQ-PB-007/REQ-PB-022",
    sub.status === 422 &&
      sub.body.type === "urn:mth:problem:invalid-transition" &&
      sub.body.code === "initiative.g1_not_approved",
    brief(sub),
  );
  check("A1-still-draft", "REQ-PB-007", (await getIni("X")).status === "draft", (await getIni("X")).status);
  const rd = await lead.raw("GET", `${T}/readiness`);
  check(
    "A1-readiness-missing-areas",
    "REQ-PB-007",
    rd.status === 200 &&
      Array.isArray(rd.body.missingDiagnosticAreas) &&
      rd.body.missingDiagnosticAreas.length === 5 &&
      rd.body.sequencing.canSubmitInitiatives === false &&
      rd.body.sequencing.blockers.some((b: Body) => b.code === "initiative.g1_not_approved"),
    { status: rd.status, missing: rd.body.missingDiagnosticAreas, seq: rd.body.sequencing },
  );
  // T05 persists the 14 source fields (direct ones round-trip exactly).
  const got = await getIni("X");
  const mismatched = Object.entries(fields).filter(([k, v]) => got[k] !== v);
  check("A1-T05-direct-fields-persist", "REQ-PB-045", mismatched.length === 0 && got.name === ini["X"]!.name, {
    mismatched,
  });
});

test("A2 G1: approval without the three agreements is refused; with them approved (REQ-PB-022)", async () => {
  await g1Records(T, leadApi, await apiSessionLike(office), sp.id);
  const s = await submitGate("G1");
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  const no = s.body.submissionNo as number;
  const without = await decideGate("G1", spS, no);
  check(
    "A2-G1-without-agreements-refused",
    "REQ-PB-022",
    without.status === 422 && without.body.code === "gate.g1_agreements_required",
    brief(without),
  );
  const partial = await decideGate("G1", spS, no, { agreements: { problem: true, baseline: true } });
  check("A2-G1-two-of-three-refused", "REQ-PB-022", partial.status === 400 || partial.status === 422, brief(partial));
  const ok = await decideGate("G1", spS, no, {
    agreements: { problem: true, baseline: true, materialValuePools: true },
  });
  check("A2-G1-with-agreements-approved", "REQ-PB-022", ok.status === 201, brief(ok));
  const rd = (await lead.raw("GET", `${T}/readiness`)).body;
  check("A2-readiness-after-G1", "REQ-PB-007", rd.sequencing.canSubmitInitiatives === true, rd.sequencing);
});

/** Adapts a QaSession to the ApiSession the borrowed record fixtures expect (throws on non-2xx, like the original). */
async function apiSessionLike(s: QaSession): Promise<ApiSession> {
  return {
    req: s.req,
    userId: s.userId,
    async call(method, path, data, options = {}) {
      const r = await s.raw(method, path, data, options.ifMatch !== undefined ? { ifMatch: options.ifMatch } : {});
      if (options.expect !== undefined) expect(r.status, `${method} ${path}`).toBe(options.expect);
      else expect(r.status < 300, `${method} ${path} -> ${r.status}: ${JSON.stringify(r.body)}`).toBe(true);
      return r.body as never;
    },
  };
}

test("A3 outcome hierarchy and 'Outcome before activity' (REQ-PB-006, REQ-PB-032, REQ-PB-040)", async () => {
  outcome = await defineRecords(T, leadApi);
  // Contribution without an outcome link is refused.
  const noOutcome = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/outcome-contributions`, {
    contributionStatement: "Synthetic: no outcome named.",
  });
  check("A3-contribution-without-outcome-refused", "REQ-PB-032", [400, 422].includes(noOutcome.status), brief(noOutcome));
  // Submitting with no outcome/KPI link: validation error naming 'Outcome before activity'.
  const refused = await submitInitiative("X");
  check(
    "A3-outcome-before-activity",
    "REQ-PB-006",
    refused.status === 422 &&
      refused.body.type === "urn:mth:problem:validation" &&
      JSON.stringify(refused.body).includes("Outcome before activity"),
    brief(refused),
  );
  await contribute("X");
  const accepted = await submitInitiative("X");
  check("A3-with-link-accepted", "REQ-PB-006", accepted.status === 200 && accepted.body.status === "submitted", brief(accepted));
  // TOM: an initiative attached as G3 TOM evidence is refused; it links to one or more TOM gaps.
  const g3 = await g3Records(T, leadApi);
  tomGapId = g3.tomGapId;
  const gap2 = await lead.raw("POST", `${T}/tom-gaps`, {
    dimensionCode: "technology",
    gap: "Synthetic second gap",
    ownerUserId: lead.userId,
  });
  const g3Before = (await gateView("G3")).criteria;
  const tomEvidence = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/gap-links`, {
    targetType: "tom_canvas",
    targetId: tomGapId,
  });
  check(
    "A3-initiative-not-TOM-evidence",
    "REQ-PB-040",
    tomEvidence.status === 422 || tomEvidence.status === 400,
    brief(tomEvidence),
  );
  const ev = await lead.raw("POST", `${T}/evidence-links`, {
    evidenceId: ini["X"]!.id,
    recordType: "initiative",
    recordId: ini["X"]!.id,
  });
  check("A3-evidence-link-to-initiative-refused", "REQ-PB-040", ev.status >= 400 && ev.status < 500, brief(ev));
  const gl = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/gap-links`, {
    targetType: "tom_gap",
    targetId: tomGapId,
  });
  const gl2 = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/gap-links`, {
    targetType: "tom_gap",
    targetId: gap2.body.id,
  });
  const links = await lead.raw("GET", `/api/v1/initiatives/${ini["X"]!.id}/gap-links`);
  check(
    "A3-initiative-links-two-gaps",
    "REQ-PB-040",
    gl.status === 201 && gl2.status === 201 && links.body.items.length === 2,
    { gl: gl.status, gl2: gl2.status, n: links.body.items?.length },
  );
  const g3After = (await gateView("G3")).criteria;
  check(
    "A3-G3-completeness-unchanged-by-initiative",
    "REQ-PB-040",
    JSON.stringify(g3Before.map((c: Body) => c.completeness)) ===
      JSON.stringify(g3After.map((c: Body) => c.completeness)),
    { before: g3Before.map((c: Body) => c.completeness), after: g3After.map((c: Body) => c.completeness) },
  );
  // Five levels: North Star -> outcomes -> KPIs -> targets -> contributions; the North Star is recorded with G2 (A6),
  // where the five-level check is completed.
  const h = await lead.raw("GET", `${T}/outcome-hierarchy`);
  const o = h.body.outcomes?.find((x: Body) => x.outcome.id === outcome.outcomeId);
  const k = o?.kpis?.find((x: Body) => x.outcomeKpiId === outcome.outcomeKpiId);
  check(
    "A3-hierarchy-outcome-kpi-target-contribution",
    "REQ-PB-032",
    h.status === 200 &&
      !!o &&
      !!k &&
      k.targetValue !== null &&
      k.targetDate !== null &&
      k.contributions.some((c: Body) => c.initiativeId === ini["X"]!.id),
    { outcome: !!o, kpi: k ? { t: k.targetValue, d: k.targetDate, c: k.contributions.length } : null },
  );
});

test("A4 T05 deliverables 3-7 warning (REQ-PB-045) and REQ-S16-016 create+read with authorization", async () => {
  const D = `/api/v1/initiatives/${ini["X"]!.id}/deliverables`;
  const add = (n: number) => lead.raw("POST", D, { title: `Synthetic deliverable ${n}` });
  const d1 = await add(1);
  await add(2);
  const two = (await lead.raw("GET", D)).body;
  check("A4-two-deliverables-warning", "REQ-PB-045", two.countWarning?.code === "initiative.deliverable_count", two.countWarning);
  await add(3);
  const three = (await lead.raw("GET", D)).body;
  check("A4-three-no-warning", "REQ-PB-045", three.countWarning === null, three.countWarning);
  for (let n = 4; n <= 8; n++) await add(n);
  const eight = (await lead.raw("GET", D)).body;
  check("A4-eight-warning", "REQ-PB-045", eight.countWarning?.code === "initiative.deliverable_count" && eight.items.length === 8, {
    w: eight.countWarning,
    n: eight.items.length,
  });
  const warnOnCard = (await getIni("X")).warnings;
  check("A4-card-warning", "REQ-PB-045", warnOnCard.some((w: Body) => w.code === "initiative.deliverable_count"), warnOnCard);
  // archive down to 7 (warning disappears)
  const dv = (await lead.raw("GET", `/api/v1/deliverables/${d1.body.id}`)).body;
  const arch = await lead.raw("PATCH", `/api/v1/deliverables/${d1.body.id}`, { archiveReason: "Synthetic: merged." }, {
    ifMatch: dv.version,
  });
  const seven = (await lead.raw("GET", D)).body;
  check("A4-seven-no-warning", "REQ-PB-045", arch.status === 200 && seven.countWarning === null, { a: arch.status, w: seven.countWarning });
  // REQ-S16-016: unauthorized writes (AUD read-only; dev.nobody without a role) are refused; reads by AUD work.
  const audWrite = await auditor.raw("POST", D, { title: "Synthetic AUD attempt" });
  const audRead = await auditor.raw("GET", `/api/v1/deliverables/${d1.body.id}`);
  check("A4-S16-deliverable-authz", "REQ-S16-016", audWrite.status === 403 && audRead.status === 200, {
    w: audWrite.status,
    r: audRead.status,
  });
  const audIni = await auditor.raw("POST", "/api/v1/initiatives", { transformationId: tid, name: "Synthetic AUD" });
  const audIniRead = await auditor.raw("GET", `/api/v1/initiatives/${ini["X"]!.id}`);
  check("A4-S16-initiative-authz", "REQ-S16-016", audIni.status === 403 && audIniRead.status === 200, {
    w: audIni.status,
    r: audIniRead.status,
  });
});

test("A5 T06 scoring, weights, ranking history, overrides (REQ-PB-047/048/049, REQ-S09-001/005, REQ-DLV-035)", async () => {
  const P = `${T}/prioritization`;
  // Y and Z submitted too (G1 approved, with an outcome link).
  for (const [k, name] of [
    ["Y", "Synthetic QA billing analytics"],
    ["Z", "Synthetic QA invoice redesign"],
  ] as const) {
    await createInitiative(k, name, {
      executiveOwnerUserId: lead.userId,
      workstreamLeadUserId: lead.userId,
      objective: `Synthetic objective ${name}`,
      plannedStart: "2027-01-01",
      plannedEnd: "2027-09-30",
    });
    await contribute(k);
    expect((await submitInitiative(k)).status).toBe(200);
  }
  await scoreAll("X", { strategic_fit: 5, financial_value: 4, customer_impact: 3, feasibility: 2, time_to_value: 1 });
  const sheet = (await auditor.raw("GET", `/api/v1/initiatives/${ini["X"]!.id}/scores`)).body;
  check(
    "A5-54321-is-3.30",
    "REQ-PB-048/REQ-DLV-035",
    sheet.result?.weightedScore === "3.3000" && sheet.result?.weightedScoreDisplay === "3.30" && sheet.result?.weightSetVersionNo === 1,
    sheet.result,
  );
  check(
    "A5-display100-57.5",
    "REQ-S09-001",
    sheet.result?.display100 === "57.5" && sheet.result?.conversion === "(score-1)/4*100",
    sheet.result,
  );
  const view = (await lead.raw("GET", P)).body;
  check("A5-conversion-label", "REQ-S09-001", typeof view.conversionLabel === "string" && view.conversionLabel.length > 0, view.conversionLabel);
  // read-only weighted score
  const inj = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/scores`, {
    criterionCode: "risk_compliance",
    score: 3,
    weightedScore: "5",
  });
  check("A5-weighted-score-read-only", "REQ-PB-047", inj.status === 400, brief(inj));
  // score 6 refused
  const six = await lead.raw("POST", `/api/v1/initiatives/${ini["Y"]!.id}/scores`, { criterionCode: "strategic_fit", score: 6 });
  check("A5-score-6-refused", "REQ-PB-048", six.status === 400 || six.status === 422, brief(six));
  // missing score -> incomplete, not a number
  await scoreAll("Y", { strategic_fit: 1, financial_value: 4 });
  const ySheet = (await lead.raw("GET", `/api/v1/initiatives/${ini["Y"]!.id}/scores`)).body;
  check(
    "A5-missing-score-incomplete",
    "REQ-PB-048",
    ySheet.result.completeness === "incomplete" && ySheet.result.weightedScore === null && ySheet.result.display100 === null,
    ySheet.result,
  );
  await scoreAll("Y", { customer_impact: 3, feasibility: 2, time_to_value: 3, risk_compliance: 5 });
  await scoreAll("X", { risk_compliance: 1 });
  await scoreAll("Z", { strategic_fit: 2, financial_value: 2, customer_impact: 2, feasibility: 2, time_to_value: 2, risk_compliance: 2 });
  // weights 95 / 105 refused, nothing written
  const before = (await lead.raw("GET", `${P}/weight-sets`)).body.items.length;
  const w = (sf: string, rc?: string) => [
    { criterionCode: "strategic_fit", weightPercent: sf },
    { criterionCode: "financial_value", weightPercent: "25" },
    { criterionCode: "customer_impact", weightPercent: "20" },
    { criterionCode: "feasibility", weightPercent: "15" },
    { criterionCode: "time_to_value", weightPercent: "15" },
    ...(rc ? [{ criterionCode: "risk_compliance", weightPercent: rc }] : []),
  ];
  const r95 = await lead.raw("POST", `${P}/weight-sets`, { rationale: "Synthetic 95", weights: w("20") });
  const r105 = await lead.raw("POST", `${P}/weight-sets`, { rationale: "Synthetic 105", weights: w("30") });
  const after = (await lead.raw("GET", `${P}/weight-sets`)).body.items.length;
  check(
    "A5-weights-95-105-refused-nothing-written",
    "REQ-PB-049/REQ-DLV-035",
    r95.status === 422 && r105.status === 422 && before === after,
    { r95: brief(r95), r105: brief(r105), before, after },
  );
  // snapshot 1 under v1
  const s1 = await lead.raw("POST", `${P}/rankings`, { note: "Synthetic QA proposal 1" });
  const r1 = new Map((s1.body.entries ?? []).map((e: Body) => [e.initiativeId, e]));
  check(
    "A5-snapshot1-v1",
    "REQ-PB-049",
    s1.status === 201 && s1.body.snapshot.weightSetVersionNo === 1 && (r1.get(ini["X"]!.id) as Body)?.rank === 1,
    { status: s1.status, entries: s1.body.entries?.map((e: Body) => [e.initiativeId === ini["X"]!.id ? "X" : e.initiativeId === ini["Y"]!.id ? "Y" : "Z", e.rank, e.weightedScore]) },
  );
  // v2: risk/compliance 10, strategic fit 15
  const v2 = await lead.raw("POST", `${P}/weight-sets`, {
    rationale: "Synthetic QA: regulated context, risk/compliance replaces part of strategic fit (B0077).",
    weights: w("15", "10"),
  });
  check("A5-v2-accepted", "REQ-PB-049", v2.status === 201 && v2.body.versionNo === 2, brief(v2));
  const selfApprove = await lead.raw("POST", `${P}/weight-sets/2/approve`, { note: "Synthetic self" }, { ifMatch: v2.body.version });
  const ap = await spS.raw("POST", `${P}/weight-sets/2/approve`, { note: "Synthetic demo approval" }, { ifMatch: v2.body.version });
  check("A5-v2-approved-by-sponsor-not-proposer", "REQ-PB-049", selfApprove.status === 403 && ap.status === 200, {
    self: brief(selfApprove),
    sp: brief(ap),
  });
  const xSheet2 = (await lead.raw("GET", `/api/v1/initiatives/${ini["X"]!.id}/scores`)).body.result;
  check("A5-rescoring-uses-v2", "REQ-PB-049", xSheet2.weightSetVersionNo === 2 && xSheet2.weightedScore === "2.9000", xSheet2);
  const s2 = await lead.raw("POST", `${P}/rankings`, { note: "Synthetic QA proposal 2" });
  const ey = (s2.body.entries ?? []).find((e: Body) => e.initiativeId === ini["Y"]!.id);
  check(
    "A5-snapshot2-v2-rank-change",
    "REQ-PB-049",
    s2.status === 201 && s2.body.snapshot.weightSetVersionNo === 2 && ey?.rank === 1 && ey?.causeLabels?.includes("weight version 2"),
    { status: s2.status, ey },
  );
  const old = (await auditor.raw("GET", `${P}/rankings/1`)).body;
  const ox = old.entries?.find((e: Body) => e.initiativeId === ini["X"]!.id);
  check(
    "A5-v1-results-keep-v1-reference",
    "REQ-PB-049",
    old.snapshot?.weightSetVersionNo === 1 && ox?.weightedScore === "3.3000",
    { snap: old.snapshot, ox },
  );
  const hist = (await auditor.raw("GET", `${P}/ranking-history?initiativeId=${ini["Y"]!.id}`)).body;
  check(
    "A5-history-weight-version-2",
    "REQ-S09-005/REQ-PB-049",
    hist.items?.[0]?.entry?.causeLabels?.includes("weight version 2") === true,
    hist.items?.[0],
  );
  // override without reason refused (missing / blank / too short); nothing written
  const ovBefore = (await lead.raw("GET", `${P}/overrides`)).body.items.length;
  const noReason = await lead.raw("POST", `${P}/overrides`, { initiativeId: ini["Z"]!.id, overrideRank: 1 });
  const blank = await lead.raw("POST", `${P}/overrides`, { initiativeId: ini["Z"]!.id, overrideRank: 1, reason: "   " });
  const ovAfter = (await lead.raw("GET", `${P}/overrides`)).body.items.length;
  check(
    "A5-override-without-reason-refused",
    "REQ-S09-005",
    [400, 422].includes(noReason.status) && [400, 422].includes(blank.status) && ovBefore === ovAfter,
    { noReason: brief(noReason), blank: brief(blank), ovBefore, ovAfter },
  );
});

test("A6 selection, 'Selected - unfunded', launch sequencing (REQ-S09-003, REQ-PB-004)", async () => {
  const sel = async (k: string) => {
    const cur = await getIni(k);
    return spS.raw("POST", `/api/v1/initiatives/${ini[k]!.id}/select`, { rationale: RATIONALE }, { ifMatch: cur.version });
  };
  const sx = await sel("X");
  const sy = await sel("Y");
  expect(sx.status, JSON.stringify(sx.body)).toBe(200);
  expect(sy.status, JSON.stringify(sy.body)).toBe(200);
  const x = await getIni("X");
  check(
    "A6-selected-unfunded",
    "REQ-S09-003",
    x.status === "selected" && x.fundingState === "unfunded" && x.displayStatus === "initiative.status.selected_unfunded",
    { status: x.status, f: x.fundingState, d: x.displayStatus },
  );
  const l1 = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/launch`, {}, { ifMatch: x.version });
  check(
    "A6-unfunded-cannot-launch",
    "REQ-S09-003",
    l1.status === 422 && JSON.stringify(l1.body.errors ?? []).includes("initiative.selected_unfunded"),
    { ...brief(l1), errors: l1.body.errors },
  );
  // FIN funds X (business approval, synthetic)
  const f = await finS.raw("POST", "/api/v1/funding-decisions", {
    initiativeId: ini["X"]!.id,
    outcome: "approved",
    amount: "250000.00",
    currency: "SAR",
    rationale: RATIONALE,
  });
  check("A6-funding-recorded-by-FIN", "REQ-S16-016", f.status === 201 && f.body.decidedBy === fin.id, brief(f));
  const fr = await auditor.raw("GET", `/api/v1/funding-decisions/${f.body.id}`);
  const leadFund = await lead.raw("POST", "/api/v1/funding-decisions", {
    initiativeId: ini["Y"]!.id,
    outcome: "approved",
    currency: "SAR",
    rationale: RATIONALE,
  });
  check("A6-S16-funding-authz", "REQ-S16-016", fr.status === 200 && leadFund.status === 403, { read: fr.status, leadWrite: brief(leadFund) });
  const x2 = await getIni("X");
  const l2 = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/launch`, {}, { ifMatch: x2.version });
  check(
    "A6-E2E-launch-before-G2G3-422",
    "REQ-PB-004",
    l2.status === 422 &&
      l2.body.type === "urn:mth:problem:invalid-transition" &&
      l2.body.detail === "North Star, outcomes and target state not yet approved",
    brief(l2),
  );
  // G2 then G3 approved by the synthetic Sponsor
  await g2Records(T, leadApi, await apiSessionLike(spS), outcome.outcomeKpiId);
  const h = (await auditor.raw("GET", `${T}/outcome-hierarchy`)).body;
  const ho = h.outcomes?.find((x: Body) => x.outcome.id === outcome.outcomeId);
  const hk = ho?.kpis?.find((x: Body) => x.outcomeKpiId === outcome.outcomeKpiId);
  check(
    "A6-hierarchy-five-levels",
    "REQ-PB-032",
    h.northStar !== null &&
      typeof h.northStar?.statement === "string" &&
      !!ho &&
      !!hk &&
      hk.targetValue !== null &&
      hk.contributions.some((c: Body) => c.initiativeId === ini["X"]!.id),
    { northStar: h.northStar?.statement, outcome: !!ho, kpi: hk ? [hk.targetValue, hk.targetDate, hk.contributions.length] : null },
  );
  for (const g of ["G2", "G3"]) {
    const v = await gateView(g);
    const inc = v.criteria.filter((c: Body) => c.completeness !== "complete");
    expect(inc, `${g} criteria`).toEqual([]);
    const s = await submitGate(g);
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    if (g === "G2") {
      const x3 = await getIni("X");
      const mid = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/launch`, {}, { ifMatch: x3.version });
      check("A6-launch-with-G2-pending-still-422", "REQ-PB-004", mid.status === 422, brief(mid));
    }
    const d = await decideGate(g, spS, s.body.submissionNo);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    if (g === "G2") {
      const x4 = await getIni("X");
      const mid2 = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/launch`, {}, { ifMatch: x4.version });
      check(
        "A6-launch-after-G2-only-still-422",
        "REQ-PB-004",
        mid2.status === 422 && mid2.body.detail === "North Star, outcomes and target state not yet approved",
        brief(mid2),
      );
    }
  }
  const x5 = await getIni("X");
  const l3 = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/launch`, {}, { ifMatch: x5.version });
  check("A6-launch-after-G2G3-succeeds", "REQ-PB-004", l3.status === 200 && l3.body.status === "launched", brief(l3));
  // REQ-S09-003 with the sequencing satisfied: Y is selected without funding -> 'Selected - unfunded' is THE reason.
  const y = await getIni("Y");
  const ly = await lead.raw("POST", `/api/v1/initiatives/${ini["Y"]!.id}/launch`, {}, { ifMatch: y.version });
  const y2 = await getIni("Y");
  check(
    "A6-selected-unfunded-cannot-launch-after-G2G3",
    "REQ-S09-003",
    y.displayStatus === "initiative.status.selected_unfunded" &&
      ly.status === 422 &&
      ly.body.code === "initiative.selected_unfunded" &&
      String(ly.body.detail).startsWith("Selected - unfunded") &&
      y2.status === "selected",
    { display: y.displayStatus, launch: brief(ly), after: y2.status },
  );
});

test("A7 roadmap: four waves verbatim, overlap accepted, milestone move, conflict (REQ-PB-050, REQ-S09-006)", async () => {
  const waves = (await lead.raw("GET", `${T}/waves`)).body.items as Body[];
  const want = [
    ["Wave 0 — Mobilize", "Baseline, governance, design decisions", "0-6 weeks", "Sponsor + charter", "Approved case, owners, stage gates"],
    ["Wave 1 — Prove", "Quick wins / pilots / de-risking", "1-3 months", "Prioritized initiatives", "Measured pilot results"],
    ["Wave 2 — Scale", "Scale validated changes", "3-9 months", "Evidence + capacity", "Adoption + KPI movement"],
    ["Wave 3 — Embed", "BAU integration / optimization", "6-18 months", "Stable solution", "Benefits sustained, ownership transferred"],
  ];
  const seeded = waves.filter((x) => x.isSourceSeeded).sort((a, b) => a.ordinal - b.ordinal);
  const got = seeded.map((x) => [x.nameEn, x.purposeEn, x.horizonEn, x.entryCriteriaEn, x.exitEvidenceEn]);
  check("A7-four-waves-verbatim", "REQ-PB-050", JSON.stringify(got) === JSON.stringify(want), got);
  const ar = seeded.every((x) => /[؀-ۿ]/.test(x.nameAr) && /[؀-ۿ]/.test(x.purposeAr));
  check("A7-waves-arabic", "REQ-PB-050", ar, seeded.map((x) => x.nameAr));
  // overlapping horizons accepted: wave 1 and wave 2 planned dates overlap
  const w1 = seeded[1]!;
  const w2 = seeded[2]!;
  const p1 = await lead.raw("PATCH", `${T}/waves/${w1.id}`, { plannedStart: "2027-01-01", plannedEnd: "2027-06-30" }, { ifMatch: w1.version });
  const p2 = await lead.raw("PATCH", `${T}/waves/${w2.id}`, { plannedStart: "2027-04-01", plannedEnd: "2027-12-31" }, { ifMatch: w2.version });
  check("A7-overlap-accepted", "REQ-PB-050", p1.status === 200 && p2.status === 200, { p1: brief(p1), p2: brief(p2) });
  const ro = await lead.raw("PATCH", `${T}/waves/${seeded[0]!.id}`, { horizonEn: "1-2 weeks" } as Body, { ifMatch: seeded[0]!.version });
  check("A7-source-text-immutable", "REQ-PB-050", ro.status === 400 || ro.status === 422, brief(ro));
  // milestone moved: roadmap read model (timeline, table, board) changes
  const ms = await lead.raw("POST", `/api/v1/initiatives/${ini["Y"]!.id}/milestones`, {
    title: "Synthetic QA pilot live",
    forecastDate: "2027-03-31",
    waveId: w1.id,
  });
  expect(ms.status, JSON.stringify(ms.body)).toBe(201);
  const moved = await lead.raw("PATCH", `/api/v1/milestones/${ms.body.id}`, { forecastDate: "2027-05-15" }, { ifMatch: ms.body.version });
  const rm = (await auditor.raw("GET", `${T}/roadmap`)).body;
  const inView = rm.milestones?.find((m: Body) => m.id === ms.body.id);
  check("A7-milestone-move-in-roadmap", "REQ-S09-006", moved.status === 200 && inView?.forecastDate === "2027-05-15", {
    moved: brief(moved),
    inView: inView?.forecastDate,
  });
  const stale = await lead.raw("PATCH", `/api/v1/milestones/${ms.body.id}`, { forecastDate: "2027-06-01" }, { ifMatch: ms.body.version });
  const after = (await lead.raw("GET", `/api/v1/milestones/${ms.body.id}`)).body;
  check(
    "A7-concurrent-edit-409",
    "REQ-S09-006",
    stale.status === 409 && after.forecastDate === "2027-05-15",
    { stale: brief(stale), after: after.forecastDate },
  );
  // S16: AUD cannot create milestones / waves
  const audMs = await auditor.raw("POST", `/api/v1/initiatives/${ini["Y"]!.id}/milestones`, { title: "Synthetic AUD" });
  const audWave = await auditor.raw("GET", `${T}/waves/${w1.id}`);
  check("A7-S16-milestone-wave-authz", "REQ-S16-016", audMs.status === 403 && audWave.status === 200, { w: audMs.status, r: audWave.status });
});

test("A8 T08 dependencies (REQ-PB-051/052, REQ-S09-008, REQ-S09-004, REQ-DLV-035)", async ({ playwright: pw }) => {
  const types = (await lead.raw("GET", "/api/v1/dependency-types")).body.items as Body[];
  const sys = types.filter((t) => t.isSystem).map((t) => t.labelEn);
  check(
    "A8-four-source-types",
    "REQ-PB-052",
    ["Decision", "Tech", "Data", "Vendor"].every((l) => sys.includes(l)),
    types.map((t) => [t.code, t.labelEn, t.isSystem]),
  );
  // dependency_type.configure belongs to ADM_METHOD (organization scope): a synthetic methodology administrator.
  const me = (await admin.raw("GET", "/api/v1/me")).body;
  const uname = `qa.adm.${Date.now().toString(36)}`;
  const u = await admin.raw("POST", "/api/v1/users", {
    organizationId: me.organization.id,
    displayName: "QA Methodology Admin",
    preferredLocale: "en",
    identity: { issuer: "urn:mth:dev-local", subject: uname },
  });
  const ra = await admin.raw("POST", "/api/v1/role-assignments", {
    userId: u.body.id,
    roleCode: "ADM_METHOD",
    scope: { type: "organization", id: me.organization.id },
    reason: "Synthetic methodology admin for the QA probe (approves nothing real)",
  });
  expect([u.status, ra.status], JSON.stringify([u.body, ra.body])).toEqual([201, 201]);
  const methodAdmin = await qaSession(await apiSession(pw, uname));
  const del: Res[] = [];
  for (const t of types.filter((x) => x.isSystem && ["Decision", "Tech", "Data", "Vendor"].includes(x.labelEn)))
    del.push(await methodAdmin.raw("DELETE", `/api/v1/dependency-types/${t.code}`, undefined, { ifMatch: t.version }));
  const after = (await lead.raw("GET", "/api/v1/dependency-types")).body.items as Body[];
  check(
    "A8-system-types-undeletable",
    "REQ-PB-052",
    del.length === 4 &&
      del.every((r) => r.status === 422 && r.body.code === "dependency_type.system_undeletable") &&
      after.filter((t) => t.isSystem && t.status === "active").length >= 4,
    del.map(brief),
  );
  const dep = (body: Record<string, unknown>) =>
    lead.raw("POST", "/api/v1/dependencies", { transformationId: tid, dependencyType: "tech", ...body });
  const unknown = await dep({ description: "Synthetic unknown", from: { kind: "external", label: "X" }, toInitiativeId: ini["Y"]!.id, dependencyType: "telepathy" });
  check("A8-unknown-type-refused", "REQ-PB-052", unknown.status === 422 && unknown.body.code === "dependency.unknown_type", brief(unknown));
  // all 7 columns, From External
  const ext = await dep({
    description: "Synthetic vendor API delivery",
    from: { kind: "external", label: "Synthetic vendor" },
    toInitiativeId: ini["Y"]!.id,
    dependencyType: "vendor",
    neededBy: "2027-02-01",
    ownerUserId: lead.userId,
    mitigation: "Synthetic weekly checkpoint",
  });
  const got = (await lead.raw("GET", `/api/v1/dependencies/${ext.body.id}`)).body;
  check(
    "A8-seven-columns-external",
    "REQ-PB-051",
    ext.status === 201 &&
      /^DEP-\d+$/.test(got.code) &&
      got.description === "Synthetic vendor API delivery" &&
      got.fromKind === "external" &&
      got.fromLabel === "Synthetic vendor" &&
      got.toInitiativeId === ini["Y"]!.id &&
      got.dependencyType === "vendor" &&
      got.neededBy === "2027-02-01" &&
      got.ownerUserId === lead.userId &&
      got.status === "open" &&
      got.mitigation === "Synthetic weekly checkpoint",
    got,
  );
  // cycles: A->B->A and A->B->C->A, named
  const ab = await dep({ description: "Synthetic Y needs Z", from: { kind: "initiative", initiativeId: ini["Y"]!.id }, toInitiativeId: ini["Z"]!.id });
  const ba = await dep({ description: "Synthetic Z needs Y", from: { kind: "initiative", initiativeId: ini["Z"]!.id }, toInitiativeId: ini["Y"]!.id });
  check(
    "A8-cycle-A-B-A-reported",
    "REQ-PB-051",
    ab.status === 201 && ba.status === 422 && JSON.stringify(ba.body).includes(ini["Y"]!.code) && JSON.stringify(ba.body).includes(ini["Z"]!.code),
    { ab: ab.status, ba: { ...brief(ba), errors: ba.body.errors } },
  );
  await createInitiative("W", "Synthetic QA customer portal", {
    executiveOwnerUserId: lead.userId,
    workstreamLeadUserId: lead.userId,
    plannedStart: "2027-01-01",
    plannedEnd: "2027-04-30",
  });
  const bc = await dep({ description: "Synthetic Z needs W", from: { kind: "initiative", initiativeId: ini["Z"]!.id }, toInitiativeId: ini["W"]!.id });
  const ca = await dep({ description: "Synthetic W needs Y", from: { kind: "initiative", initiativeId: ini["W"]!.id }, toInitiativeId: ini["Y"]!.id });
  const named = [ini["Y"]!.code, ini["Z"]!.code, ini["W"]!.code].every((c) => JSON.stringify(ca.body).includes(c));
  check(
    "A8-cycle-A-B-C-A-refused-naming-cycle",
    "REQ-S09-008/REQ-DLV-035",
    bc.status === 201 && ca.status === 422 && named,
    { bc: bc.status, ca: { ...brief(ca), errors: ca.body.errors } },
  );
  // needed-by conflict: predecessor Z (ends 2027-09-30) needed by W on 2027-03-01
  const nb = await dep({
    description: "Synthetic W needs Y by March",
    from: { kind: "initiative", initiativeId: ini["Y"]!.id },
    toInitiativeId: ini["W"]!.id,
    neededBy: "2027-03-01",
  });
  const nbGot = (await lead.raw("GET", `/api/v1/dependencies/${nb.body.id}`)).body;
  check(
    "A8-needed-by-conflict-flagged",
    "REQ-S09-008",
    nb.status === 201 && (nbGot.flags ?? []).length > 0,
    { status: nb.status, flags: nbGot.flags },
  );
  // sequenced before predecessor: W starts 2027-01-01, its predecessor Y ends 2027-09-30
  const w = await getIni("W");
  const rm = (await lead.raw("GET", `${T}/roadmap`)).body;
  const wInView = rm.initiatives.find((i: Body) => i.id === ini["W"]!.id);
  const flagCodes = [...(w.flags ?? []), ...(wInView?.flags ?? [])].map((f: Body) => f.code);
  check(
    "A8-sequenced-before-predecessor-flagged",
    "REQ-S09-004",
    flagCodes.length > 0,
    { cardFlags: w.flags, roadmapFlags: wInView?.flags, depFlags: nbGot.flags },
  );
});

test("A9 business case and T09 formulas (REQ-PB-053/054/056/057, REQ-S05-005, REQ-S08-007)", async () => {
  const sections = {
    strategicRationale: "Synthetic rationale.",
    baselineSummary: "Synthetic baseline: 1.2m SAR rework per year.",
    valuePoolsSummary: "Synthetic value pools.",
    interventionsSummary: "Synthetic interventions.",
    investmentSummary: "Synthetic investment.",
    benefitsSummary: "Synthetic benefits.",
    benefitRamp: "Synthetic ramp 25/75/100.",
    recurrenceSummary: "Synthetic recurring.",
    implementationHorizon: "Synthetic 12 months.",
    keyAssumptions: "Synthetic assumptions.",
    downsideCase: "Synthetic downside.",
    upsideCase: "Synthetic upside.",
    benefitOwnerUserId: sp.id,
    initiativeOwnerUserId: sp.id,
    financeValidatorUserId: fin.id,
    decisionAskTypes: ["funding"],
    decisionAskText: "Synthetic: fund the pilot.",
  };
  const top = await lead.raw("POST", "/api/v1/business-cases", { transformationId: tid, level: "transformation", title: "Synthetic QA transformation case", sections });
  const got = (await auditor.raw("GET", `/api/v1/business-cases/${top.body.id}`)).body;
  const lost = Object.entries(sections).filter(([k, v]) => JSON.stringify(got.sections?.[k]) !== JSON.stringify(v));
  // investment and benefits also need at least one line of their kind (ADR-0024 §1): re-checked after the lines below.
  check("A9-ten-sections-persist", "REQ-PB-053", top.status === 201 && lost.length === 0, { lost, missing: got.missingSections });
  const kase = await lead.raw("POST", "/api/v1/business-cases", {
    transformationId: tid,
    level: "initiative",
    initiativeId: ini["X"]!.id,
    title: "Synthetic QA initiative case",
    sections,
  });
  check("A9-initiative-case-links-transformation-case", "REQ-PB-054", kase.status === 201 && kase.body.parentCaseId === top.body.id, {
    s: kase.status,
    parent: kase.body.parentCaseId,
    top: top.body.id,
  });
  const L = (id: string) => `/api/v1/business-cases/${id}/lines`;
  const two = await lead.raw("POST", L(top.body.id), {
    lineKind: "investment",
    class: ["capex", "opex"],
    valueBasis: "cash",
    title: "Synthetic two classes",
    amount: "100",
    currency: "SAR",
  });
  const twoB = await lead.raw("POST", L(top.body.id), {
    lineKind: "investment",
    class: "capex",
    classes: ["opex"],
    valueBasis: "cash",
    title: "Synthetic two classes B",
    amount: "100",
    currency: "SAR",
  });
  const none = await lead.raw("POST", L(top.body.id), { lineKind: "investment", valueBasis: "cash", title: "Synthetic no class", amount: "1", currency: "SAR" });
  check("A9-two-classes-refused", "REQ-S05-005/REQ-PB-053", [two, twoB, none].every((r) => r.status === 400 || r.status === 422), [brief(two), brief(twoB), brief(none)]);
  const line = (id: string, body: Record<string, unknown>) => lead.raw("POST", L(id), { currency: "SAR", ...body });
  const a = await line(top.body.id, { lineKind: "benefit", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic A", amount: "1000.10" });
  const bLine = await line(top.body.id, { lineKind: "benefit", class: "cost_reduction", valueBasis: "cash_saving", title: "Synthetic B", amount: "2000.20" });
  await line(top.body.id, { lineKind: "investment", class: "capex", valueBasis: "cash", title: "Synthetic C", amount: "500.05" });
  const k1 = await line(kase.body.id, { lineKind: "benefit", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic K1", amount: "300.30" });
  const lineOf = async (caseId: string, lineId: string) =>
    ((await lead.raw("GET", L(caseId))).body.items as Body[]).find((x) => x.id === lineId);
  const decimalStored = await lineOf(top.body.id, a.body.id);
  check("A9-SAR-decimal", "REQ-PB-053", !!decimalStored && /^1000\.10*$/.test(String(decimalStored.amount)) && decimalStored.currency === "SAR", decimalStored?.amount);
  const got2 = (await auditor.raw("GET", `/api/v1/business-cases/${top.body.id}`)).body;
  check("A9-no-missing-section-with-lines", "REQ-PB-053", Array.isArray(got2.missingSections) && got2.missingSections.length === 0, got2.missingSections);
  caseIds.top = top.body.id;
  caseIds.kase = kase.body.id;
  plainBenefitLines.push({ caseId: top.body.id, lineId: a.body.id }, { caseId: top.body.id, lineId: bLine.body.id }, { caseId: kase.body.id, lineId: k1.body.id });
  const totals = async (id: string) => (await auditor.raw("GET", `/api/v1/business-cases/${id}/totals`)).body;
  const t1 = await totals(top.body.id);
  const gross1 = t1.grossBenefits?.find((m: Body) => m.currency === "SAR");
  check(
    "A9-total-distinct-lines-once",
    "REQ-S05-005/REQ-PB-054",
    num(gross1?.amount) === 3300.6 && gross1?.lineCount === 3 && t1.includedCaseIds?.includes(kase.body.id),
    { gross1, included: t1.includedCaseIds, cost: t1.implementationCost, net: t1.netValue },
  );
  const lk = await lineOf(kase.body.id, k1.body.id);
  const ed = await lead.raw("PATCH", `${L(kase.body.id)}/${k1.body.id}`, { amount: "400.40" }, { ifMatch: lk.version });
  const t2 = await totals(top.body.id);
  const gross2 = t2.grossBenefits?.find((m: Body) => m.currency === "SAR");
  check(
    "A9-edit-initiative-case-changes-rollup-no-dup",
    "REQ-PB-054",
    ed.status === 200 && num(gross2?.amount) === 3400.7 && gross2?.lineCount === 3,
    { ed: brief(ed), gross2 },
  );
  // T09
  const ex = (await lead.raw("GET", "/api/v1/benefit-formula-examples")).body;
  const conf = await lead.raw("POST", "/api/v1/benefit-formulas", { transformationId: tid, benefitName: "Synthetic", confidence: "X" });
  check("A9-confidence-outside-HML-refused", "REQ-PB-056", conf.status === 400 || conf.status === 422, brief(conf));
  const V = (name: string, kind: string, value: string | null, period = "none", extra: Record<string, unknown> = {}) => ({
    name,
    kind,
    period,
    value,
    ...extra,
  });
  const check1 = (expression: string, variables: unknown[]) => lead.raw("POST", "/api/v1/benefit-formulas/validate", { expression, variables });
  const undef = await check1("customers * arpu * ghost", [V("customers", "count", "100000"), V("arpu", "currency", "50", "month", { currency: "SAR" })]);
  check("A9-undefined-variable-refused", "REQ-PB-056", undef.status === 422 || (undef.status === 200 && undef.body.valid === false), { ...brief(undef), body: undef.body });
  const rev = await check1("(attach_new - attach_old) * customers * arpu", [
    V("attach_old", "fraction", "0.10"),
    V("attach_new", "fraction", "0.12"),
    V("customers", "count", "100000"),
    V("arpu", "currency", "50", "month", { currency: "SAR" }),
  ]);
  check(
    "A9-revenue-0.10-0.12-100000-SAR",
    "REQ-PB-057/REQ-S08-007",
    rev.status === 200 && rev.body.valid === true && num(rev.body.result) === 100000 && /^100000(\.0+)?$/.test(String(rev.body.result)) && rev.body.resultCurrency === "SAR",
    rev.body,
  );
  const s08 = await check1("delta * customers * arpu", [
    V("delta", "fraction_delta", "0.02"),
    V("customers", "count", "100000"),
    V("arpu", "currency", "50", "month", { currency: "SAR" }),
  ]);
  check("A9-0.02x100000x50", "REQ-S08-007", s08.status === 200 && /^100000(\.0+)?$/.test(String(s08.body.result)), s08.body);
  const cost = await check1("volume * (unit_cost_old - unit_cost_new)", [
    V("volume", "count", "123457"),
    V("unit_cost_old", "currency", "12.35", "none", { currency: "SAR" }),
    V("unit_cost_new", "currency", "11.12", "none", { currency: "SAR" }),
  ]);
  check(
    "A9-cost-example-exact",
    "REQ-PB-057",
    cost.status === 200 && /^151852\.11(0*)$/.test(String(cost.body.result)),
    cost.body,
  );
  const mism = await check1("customers * arpu", [
    V("customers", "count", "100000", "year"),
    V("arpu", "currency", "50", "month", { currency: "SAR" }),
  ]);
  check(
    "A9-monthly-ARPU-x-annual-population-refused",
    "REQ-S08-007",
    mism.status === 422 || (mism.status === 200 && mism.body.valid === false),
    { ...brief(mism), body: mism.body },
  );
  // ROUND 4 (T-DG3-KBE-F, F-DG3-100 repair seen from the acceptance side): the engine now rethrows EvalError; every
  // ordinary invalid formula must still be a 422 problem from the API (never 500), and none of them may be the
  // engine's "internal" fallback ("the formula could not be processed"): an invalid formula is a user error with its
  // own code. Hostile spellings (constructor, __proto__, prototype paths, deep nesting) included.
  const INTERNAL = /could not be processed/;
  const r4Vars = [V("a", "count", "2"), V("b", "count", "3")];
  const r4Bad = [
    "1 +",
    "((a",
    "a b",
    "a * * b",
    "constructor",
    "a.constructor",
    "__proto__ * a",
    "this",
    'a + "x"',
    "Function('return 1')()",
    "a[0]",
    `${"(".repeat(400)}a${")".repeat(400)}`,
    "",
  ];
  const r4Res: { expr: string; status: number; code: unknown; valid: unknown; internal: boolean }[] = [];
  for (const expr of r4Bad) {
    const r = await check1(expr, r4Vars);
    r4Res.push({ expr: expr.slice(0, 40), status: r.status, code: r.body?.code, valid: r.body?.valid, internal: INTERNAL.test(JSON.stringify(r.body)) });
  }
  check(
    "A9-R4-invalid-formulas-422-not-internal",
    "REQ-PB-056",
    r4Res.every((x) => (x.status === 422 || x.status === 400) && !x.internal),
    r4Res,
  );
  const r4Create = await lead.raw("POST", "/api/v1/benefit-formulas", {
    transformationId: tid,
    benefitName: "Synthetic R4 syntax error",
    initialVersion: { expression: "a * * b", variables: r4Vars },
  });
  check(
    "A9-R4-create-syntax-error-422",
    "REQ-PB-056",
    r4Create.status === 422 && r4Create.body.code === "formula.syntax" && !INTERNAL.test(JSON.stringify(r4Create.body)),
    brief(r4Create),
  );
  const r4ok = await check1("a * b", r4Vars);
  check("A9-R4-valid-formula-still-200", "REQ-PB-056", r4ok.status === 200 && r4ok.body.valid === true && num(r4ok.body.result) === 6, r4ok.body);
  // T09 six columns persist; examples are labelled illustrative
  const f = await lead.raw("POST", "/api/v1/benefit-formulas", {
    transformationId: tid,
    benefitName: "Synthetic QA attach uplift",
    baselineDriver: "Customers x attach rate x ARPU",
    changeAssumption: "Attach +2 pp",
    ramp: "Q1-Q4",
    confidence: "M",
    initialVersion: {
      expression: "(attach_new - attach_old) * customers * arpu",
      variables: [
        V("attach_old", "fraction", "0.10"),
        V("attach_new", "fraction", "0.12"),
        V("customers", "count", "100000"),
        V("arpu", "currency", "50", "month", { currency: "SAR" }),
      ],
    },
  });
  formulaId = f.body.id;
  const fg = (await auditor.raw("GET", `/api/v1/benefit-formulas/${formulaId}`)).body;
  check(
    "A9-T09-six-columns",
    "REQ-PB-056",
    f.status === 201 &&
      fg.benefitName === "Synthetic QA attach uplift" &&
      fg.baselineDriver === "Customers x attach rate x ARPU" &&
      fg.changeAssumption === "Attach +2 pp" &&
      fg.ramp === "Q1-Q4" &&
      fg.confidence === "M" &&
      fg.currentVersion?.expression === "(attach_new - attach_old) * customers * arpu" &&
      num(fg.currentVersion?.previewResult) === 100000,
    { s: f.status, fg: { ...fg, currentVersion: fg.currentVersion?.previewResult } },
  );
  const badCreate = await lead.raw("POST", "/api/v1/benefit-formulas", {
    transformationId: tid,
    benefitName: "Synthetic undefined",
    initialVersion: { expression: "customers * ghost", variables: [V("customers", "count", "1")] },
  });
  check("A9-formula-undefined-variable-create-refused", "REQ-PB-056", badCreate.status === 422 || badCreate.status === 400, brief(badCreate));
  check("A9-examples-illustrative", "REQ-PB-057", JSON.stringify(ex).includes("revenue_uplift"), JSON.stringify(ex).slice(0, 300));
  // benefit line on the initiative case, linked to the (unvalidated) formula
  await line(kase.body.id, { lineKind: "benefit", class: "revenue", valueBasis: "revenue_uplift", title: "Synthetic formula line", amount: "100000", benefitFormulaId: formulaId });
  // FIN validates both baselines (the author cannot)
  const selfVal = await lead.raw("POST", `/api/v1/business-cases/${top.body.id}/baseline-validation`, { result: "validated", note: "Synthetic" }, { ifMatch: (await lead.raw("GET", `/api/v1/business-cases/${top.body.id}`)).body.version });
  check("A9-author-cannot-validate", "REQ-PB-055", selfVal.status === 403, brief(selfVal));
  for (const id of [top.body.id, kase.body.id]) {
    const c = (await finS.raw("GET", `/api/v1/business-cases/${id}`)).body;
    const r = await finS.raw("POST", `/api/v1/business-cases/${id}/baseline-validation`, { result: "validated", note: "Synthetic demo validation; approves nothing real." }, { ifMatch: c.version });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
});

test("A10 capacity and G4 (REQ-PB-059, REQ-S09-004, REQ-PB-019, REQ-PB-046, REQ-PB-055, REQ-S04-006, REQ-DLV-035)", async () => {
  const role = await lead.raw("POST", `${T}/resource-roles`, { code: "qa_analyst", labelEn: "Synthetic QA analyst", labelAr: "محلل اصطناعي" });
  const cap = await lead.raw("POST", "/api/v1/capacity", {
    transformationId: tid,
    resourceRoleId: role.body.id,
    periodMonth: "2027-02-01",
    availableFte: "1.00",
    ownerUserId: bo.id,
  });
  const dem = await lead.raw("POST", "/api/v1/resource-demands", { initiativeId: ini["X"]!.id, resourceRoleId: role.body.id, periodMonth: "2027-02-01", demandFte: "1.50" });
  const plan = (await auditor.raw("GET", `${T}/capacity-plan`)).body;
  const cell = plan.cells?.find((c: Body) => c.resourceRoleId === role.body.id && String(c.periodMonth).startsWith("2027-02"));
  check(
    "A10-demand-above-capacity-conflict",
    "REQ-PB-059/REQ-S09-004",
    cap.status === 201 && dem.status === 201 && cell?.flag === "capacity.over_allocated" && num(cell?.shortfallFte) === 0.5,
    { cap: cap.status, dem: dem.status, cell },
  );
  const unk = plan.cells?.find((c: Body) => c.availableFte === null);
  check("A10-unknown-capacity-not-zero", "REQ-PB-059", unk === undefined || unk.flag === "capacity.unknown", unk ?? "no unknown cell");
  const audCap = await auditor.raw("POST", "/api/v1/capacity", { transformationId: tid, resourceRoleId: role.body.id, periodMonth: "2027-03-01", availableFte: "1.00" });
  const audDem = await auditor.raw("GET", `/api/v1/resource-demands/${dem.body.id}`);
  const audCapR = await auditor.raw("GET", `/api/v1/capacity/${cap.body.id}`);
  check("A10-S16-capacity-demand-authz", "REQ-S16-016", audCap.status === 403 && audDem.status === 200 && audCapR.status === 200, {
    w: audCap.status,
    rd: audDem.status,
    rc: audCapR.status,
  });
  // G4 refusal: Y selected, no funding, no capacity commitment, no gap link; X without workstream lead; formula unvalidated
  const xv = await getIni("X");
  const clr = await lead.raw("PATCH", `/api/v1/initiatives/${ini["X"]!.id}`, { workstreamLeadUserId: null }, { ifMatch: xv.version });
  expect(clr.status, JSON.stringify(clr.body)).toBe(200);
  const before = await gateView("G4");
  const r = await submitGate("G4");
  const text = JSON.stringify(r.body.errors ?? []);
  const byKey = new Map<string, Body>((r.body.errors ?? []).map((e: Body) => [String(e.pointer).replace("/criteria/", ""), e]));
  check("A10-G4-refused-422", "REQ-PB-019", r.status === 422 && r.body.code === "gate_criteria_incomplete", brief(r));
  check(
    "A10-G4-owners-named",
    "REQ-PB-019/REQ-PB-059",
    String(byKey.get("g4.owners")?.message ?? "").includes("Owners") && String(byKey.get("g4.owners")?.message ?? "").includes(ini["X"]!.code),
    byKey.get("g4.owners"),
  );
  check(
    "A10-G4-no-gap-link-named",
    "REQ-PB-046",
    text.includes(`Gap link missing: ${ini["Y"]!.code} ${ini["Y"]!.name}`),
    byKey.get("g4.initiative_cards"),
  );
  check(
    "A10-G4-no-funding-named",
    "REQ-S04-006",
    text.includes(ini["Y"]!.code) && String(byKey.get("g4.funding")?.message ?? "").includes(ini["Y"]!.code),
    byKey.get("g4.funding"),
  );
  check(
    "A10-G4-no-capacity-commitment-named",
    "REQ-S04-006",
    String(byKey.get("g4.capacity")?.message ?? "").includes(ini["Y"]!.code) || String(byKey.get("g4.capacity")?.message ?? "").includes("Capacity"),
    byKey.get("g4.capacity"),
  );
  check(
    "A10-G4-finance-validation-listed",
    "REQ-PB-055",
    String(byKey.get("g4.finance_validation")?.message ?? "").includes("Finance validation"),
    byKey.get("g4.finance_validation"),
  );
  const after = await gateView("G4");
  check("A10-G4-refusal-writes-nothing", "REQ-PB-019", after.gate.version === before.gate.version && after.gate.status === before.gate.status, {
    b: before.gate.version,
    a: after.gate.version,
  });
  // repair: deselect Y (out of scope), restore owner, validate formula, commit demand within capacity
  const yv = await getIni("Y");
  const ds = await spS.raw("POST", `/api/v1/initiatives/${ini["Y"]!.id}/deselect`, { rationale: RATIONALE }, { ifMatch: yv.version });
  expect(ds.status, JSON.stringify(ds.body)).toBe(200);
  const xv2 = await getIni("X");
  await lead.raw("PATCH", `/api/v1/initiatives/${ini["X"]!.id}`, { workstreamLeadUserId: lead.userId, waveId: (await lead.raw("GET", `${T}/waves`)).body.items.find((w: Body) => w.ordinal === 1)?.id }, { ifMatch: xv2.version });
  const dv = (await lead.raw("GET", `/api/v1/resource-demands/${dem.body.id}`)).body;
  await lead.raw("PATCH", `/api/v1/resource-demands/${dem.body.id}`, { demandFte: "1.00" }, { ifMatch: dv.version });
  const dv2 = (await lead.raw("GET", `/api/v1/resource-demands/${dem.body.id}`)).body;
  const leadCommit = await lead.raw("POST", `/api/v1/resource-demands/${dem.body.id}/commit`, {}, { ifMatch: dv2.version });
  const commit = await boS.raw("POST", `/api/v1/resource-demands/${dem.body.id}/commit`, { note: "Synthetic commitment" }, { ifMatch: dv2.version });
  check("A10-commit-by-capacity-owner-only", "REQ-PB-059", leadCommit.status === 403 && commit.status === 200, {
    lead: brief(leadCommit),
    bo: brief(commit),
  });
  // Every financial benefit line must be formula-backed and Finance-validated for G4: the probe's plain lines (no
  // formula) are archived, and the initiative case gets its investment line.
  for (const pl of plainBenefitLines) {
    const cur = ((await lead.raw("GET", `/api/v1/business-cases/${pl.caseId}/lines`)).body.items as Body[]).find((x) => x.id === pl.lineId);
    const arch = await lead.raw("POST", `/api/v1/business-cases/${pl.caseId}/lines/${pl.lineId}/archive`, { reason: "Synthetic: superseded by the formula line." }, { ifMatch: cur.version });
    expect(arch.status, JSON.stringify(arch.body)).toBe(200);
  }
  const inv = await lead.raw("POST", `/api/v1/business-cases/${caseIds.kase}/lines`, { lineKind: "investment", class: "opex", valueBasis: "cash", title: "Synthetic pilot cost", amount: "40000", currency: "SAR" });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  // milestone with an approved date (roadmap criterion)
  const ms = await lead.raw("POST", `/api/v1/initiatives/${ini["X"]!.id}/milestones`, { title: "Synthetic QA X live", forecastDate: "2027-03-31" });
  await lead.raw("POST", `/api/v1/milestones/${ms.body.id}/approve-date`, { approvedDate: "2027-03-31", reason: "Synthetic baseline date." }, { ifMatch: ms.body.version });
  const mid = await gateView("G4");
  const missing1 = mid.criteria.filter((c: Body) => c.completeness !== "complete").map((c: Body) => [c.key, c.missing]);
  // formula still unvalidated: the only item left must be 'Finance validation'
  const r2 = await submitGate("G4");
  check(
    "A10-G4-unvalidated-formula-lists-finance-validation",
    "REQ-PB-055",
    r2.status === 422 && JSON.stringify(r2.body.errors).includes("Finance validation"),
    { status: r2.status, errors: r2.body.errors, missing1 },
  );
  const fv = await finS.raw("POST", `/api/v1/benefit-formulas/${formulaId}/versions/1/validation`, { result: "validated", note: "Synthetic demo validation; approves nothing real." }, { ifMatch: 1 });
  expect(fv.status, JSON.stringify(fv.body)).toBe(200);
  const ready = await gateView("G4");
  const missing2 = ready.criteria.filter((c: Body) => c.completeness !== "complete").map((c: Body) => [c.key, c.missing]);
  check("A10-G4-ready", "REQ-DLV-035", missing2.length === 0, missing2);
  // decisions: superseded 409, non-approver 403, submitter 403, then approved by SP
  const sub1 = await submitGate("G4");
  check("A10-G4-submitted", "REQ-DLV-035", sub1.status === 201, brief(sub1));
  const grantTl = await admin.raw("POST", "/api/v1/role-assignments", {
    userId: sp.id,
    roleCode: "TL",
    scope: { type: "transformation", id: tid },
    reason: "Synthetic: the Sponsor also leads, to probe self-decision (approves nothing real)",
  });
  expect(grantTl.status, JSON.stringify(grantTl.body)).toBe(201);
  const sub2 = await submitGate("G4", spS);
  expect(sub2.status, JSON.stringify(sub2.body)).toBe(201);
  const self = await decideGate("G4", spS, sub2.body.submissionNo);
  check("A10-G4-submitter-403", "REQ-S04-006", self.status === 403 && self.body.code === "gate.submitter_cannot_decide", brief(self));
  // Observation: while the Sponsor is the submitter of the CURRENT submission, any decision attempt by them (also on a
  // superseded one) is answered 403 first (separation of duties before the version check). Recorded, not asserted.
  const sepFirst = await decideGate("G4", spS, sub1.body.submissionNo);
  checks.push({ id: "A10-G4-order-observation", req: "info", pass: true, detail: JSON.stringify(brief(sepFirst)) });
  const sub3 = await submitGate("G4");
  expect(sub3.status, JSON.stringify(sub3.body)).toBe(201);
  const sup1 = await decideGate("G4", spS, sub1.body.submissionNo);
  const sup2 = await decideGate("G4", spS, sub2.body.submissionNo);
  check(
    "A10-G4-superseded-409",
    "REQ-S04-006",
    [sup1, sup2].every((x) => x.status === 409 && x.body.code === "gate.submission_superseded"),
    [brief(sup1), brief(sup2)],
  );
  const na: Res[] = [];
  for (const s of [finS, boS, auditor, office]) na.push(await decideGate("G4", s, sub3.body.submissionNo));
  const leadSelf = await decideGate("G4", lead, sub3.body.submissionNo);
  check(
    "A10-G4-non-approver-403",
    "REQ-S04-006",
    na.every((x) => x.status === 403 && x.body.code === "gate.not_approver") && leadSelf.status === 403,
    { nonApprovers: na.map(brief), leadSubmitter: brief(leadSelf) },
  );
  const ok = await decideGate("G4", spS, sub3.body.submissionNo);
  const t = (await lead.raw("GET", T)).body;
  const g = await gateView("G4");
  check(
    "A10-G4-approved-end-to-end",
    "REQ-DLV-035/REQ-S04-006",
    ok.status === 201 && g.gate.status === "approved" && t.currentPhase === "transform",
    { ok: brief(ok), gate: g.gate.status, phase: t.currentPhase },
  );
  const twice = await decideGate("G4", spS, sub3.body.submissionNo);
  check("A10-G4-double-decision-refused", "REQ-S04-006", twice.status === 409 || twice.status === 422, brief(twice));
});

// ================================================================================================ UI (EN / AR)

// ================================================================================================ F-DG3-120 repair
// Round 2 (T-DG3-ARCH-05, ea8e2de): the inheritedApproval annotation on the gate list and the gate view (ADR-0021 §5).
// Two SYNTHETIC Modular transformations cover every state: M1 G1 accepted+counts (after a rejected and with a newer
// pending one), G2 revoked, G3 accepted but no longer counting (its evidence edited after acceptance, so unverified);
// M2 G1 pending_verification, G2 rejected, G3 none (null). Every acceptance/rejection is a demo business decision
// that approves nothing real.

const mt: Record<"m1" | "m2", { tid: string; T: string }> = { m1: { tid: "", T: "" }, m2: { tid: "", T: "" } };
const IA_KEYS = ["approvedOn", "approvingBody", "counts", "dispensationId", "status"];
const iaDisp: Record<string, string> = {};

test("IA1 inheritedApproval annotation: null, pending_verification, accepted, rejected, revoked; gate stays draft, no decision, AUD read-only (F-DG3-120, REQ-PB-004, REQ-PB-007, REQ-S16-016)", async ({
  playwright,
}, info) => {
  const lang = langOf(info);
  const adminApi = await apiSession(playwright, "dev.admin");
  const me = (await admin.raw("GET", "/api/v1/me")).body;
  const stamp = `${Date.now().toString(36)}${lang}`;
  for (const k of ["m1", "m2"] as const) {
    const t = await lead.raw("POST", "/api/v1/transformations", {
      businessUnitId: SYN_RETAIL,
      name: `Synthetic QA DG3 R7 Modular ${k.toUpperCase()} ${lang.toUpperCase()}`,
      mode: "modular",
      entryPhase: "define",
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    mt[k] = { tid: t.body.id, T: `/api/v1/transformations/${t.body.id}` };
  }
  const sp2 = await syntheticUser(adminApi, me.organization.id, mt.m1.tid, `qa.sp2.${stamp}`, `QA Sponsor M1 ${lang}`, "SP", lang);
  const sp3 = await syntheticUser(adminApi, me.organization.id, mt.m2.tid, `qa.sp3.${stamp}`, `QA Sponsor M2 ${lang}`, "SP", lang);
  const sp2S = await sessionFor(playwright, sp2.username);
  const sp3S = await sessionFor(playwright, sp3.username);
  const spOf = { m1: sp2S, m2: sp3S };

  /** List item + view of one gate, as `who` sees them; asserts the gate itself is untouched (draft, no submission). */
  async function ann(k: "m1" | "m2", code: string, who: QaSession = lead) {
    const { T } = mt[k];
    const list = await who.raw("GET", `${T}/gates`);
    const view = await who.raw("GET", `${T}/gates/${code}`);
    const item = (list.body.items ?? []).find((v: Body) => v.gate.gateCode === code);
    const subs = await who.raw("GET", `${T}/gates/${code}/submissions`);
    return {
      listStatus: list.status,
      viewStatus: view.status,
      fromList: item?.gate.inheritedApproval,
      fromView: view.body?.gate?.inheritedApproval,
      hasKey: item ? "inheritedApproval" in item.gate : false,
      gate: item
        ? {
            status: item.gate.status,
            approvedAt: item.gate.approvedAt,
            currentSubmissionId: item.gate.currentSubmissionId,
            latestSubmissionNo: item.gate.latestSubmissionNo,
          }
        : null,
      viewGateStatus: view.body?.gate?.status,
      submissions: subs.status === 200 ? (subs.body.items ?? []).length : `HTTP ${subs.status}`,
      allNullOthers: (list.body.items ?? []).filter((v: Body) => v.gate.gateCode !== code).map((v: Body) => v.gate.inheritedApproval),
    };
  }
  const untouched = (a: Awaited<ReturnType<typeof ann>>) =>
    a.listStatus === 200 &&
    a.viewStatus === 200 &&
    a.hasKey &&
    JSON.stringify(a.fromList) === JSON.stringify(a.fromView) &&
    a.gate?.status === "draft" &&
    a.viewGateStatus === "draft" &&
    a.gate?.approvedAt === null &&
    a.gate?.currentSubmissionId === null &&
    a.gate?.latestSubmissionNo === 0 &&
    a.submissions === 0;
  const shape = (x: Body) => x !== null && typeof x === "object" && JSON.stringify(Object.keys(x).sort()) === JSON.stringify(IA_KEYS);

  // 0. Nothing recorded: every gate of both Modular transformations, and of the End-to-End one, carries null.
  for (const k of ["m1", "m2"] as const) {
    const l = await lead.raw("GET", `${mt[k].T}/gates`);
    const items = l.body.items ?? [];
    check(
      `IA1-${k}-null-before`,
      "REQ-PB-007",
      l.status === 200 && items.length === 6 && items.every((v: Body) => "inheritedApproval" in v.gate && v.gate.inheritedApproval === null && v.gate.status === "draft"),
      items.map((v: Body) => [v.gate.gateCode, v.gate.status, v.gate.inheritedApproval]),
    );
  }
  const e2eList = await lead.raw("GET", `${T}/gates`);
  check(
    "IA1-end-to-end-null",
    "REQ-PB-007",
    e2eList.status === 200 && (e2eList.body.items ?? []).every((v: Body) => "inheritedApproval" in v.gate && v.gate.inheritedApproval === null),
    (e2eList.body.items ?? []).map((v: Body) => [v.gate.gateCode, v.gate.status, v.gate.inheritedApproval]),
  );

  // Evidence helpers (the lead records; dev.office, a different person, verifies).
  async function note(k: "m1" | "m2", title: string, verify: boolean) {
    const e = await lead.raw("POST", `${mt[k].T}/evidence`, {
      kind: "note",
      title,
      noteBody: "Synthetic minutes of an earlier approval (QA).",
      ownerUserId: lead.userId,
    });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    if (verify) {
      const r = await office.raw(
        "POST",
        `${mt[k].T}/evidence/${e.body.id}/review`,
        { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: minutes read (QA)." },
        { ifMatch: e.body.version },
      );
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body;
    }
    return e.body;
  }
  async function record(k: "m1" | "m2", gateCode: string, evidenceId: string, body = "Synthetic executive committee") {
    return lead.raw("POST", `${mt[k].T}/gate-dispensations`, {
      kind: "inherited_approval",
      gateCode,
      approvingBody: body,
      approvedOn: "2026-01-15",
      evidenceId,
    });
  }
  async function decide(k: "m1" | "m2", d: Body, result: "accepted" | "rejected", who: QaSession = spOf[k]) {
    return who.raw("POST", `${mt[k].T}/gate-dispensations/${d.id}/decision`, { result, note: "Synthetic demo decision (QA); approves nothing real." }, { ifMatch: d.version });
  }

  // Negative: an End-to-End transformation cannot record one; G4 is not a dispensable gate.
  const ev0 = await note("m1", "Synthetic minutes E0", true);
  const e2eRec = await lead.raw("POST", `${T}/gate-dispensations`, {
    kind: "inherited_approval",
    gateCode: "G1",
    approvingBody: "Synthetic board",
    approvedOn: "2026-01-15",
    evidenceId: ev0.id,
  });
  check("IA1-neg-end-to-end-refused", "REQ-PB-007", e2eRec.status === 422 && e2eRec.body.code === "dispensation.inherited_requires_modular", brief(e2eRec));
  const g4Rec = await record("m1", "G4", ev0.id);
  check("IA1-neg-G4-refused", "REQ-PB-007", g4Rec.status === 400 || g4Rec.status === 422, brief(g4Rec));
  const e2eAfter = await lead.raw("GET", `${T}/gates`);
  check("IA1-neg-end-to-end-still-null", "REQ-PB-007", (e2eAfter.body.items ?? []).every((v: Body) => v.gate.inheritedApproval === null), (e2eAfter.body.items ?? []).map((v: Body) => v.gate.inheritedApproval));

  // ---- M1 G1: pending (unverified evidence) -> rejected -> a second one pending -> accepted (counts) -> a newer pending.
  const ev1 = await note("m1", "Synthetic minutes E1 (unverified)", false);
  const d1 = await record("m1", "G1", ev1.id);
  check("IA1-m1-d1-created-pending", "REQ-PB-007", d1.status === 201 && d1.body.status === "pending" && d1.body.counts === false, { status: d1.status, s: d1.body.status, c: d1.body.counts });
  let a = await ann("m1", "G1");
  check(
    "IA1-m1-G1-pending_verification",
    "REQ-PB-007",
    untouched(a) && shape(a.fromList) && a.fromList.status === "pending_verification" && a.fromList.counts === false && a.fromList.dispensationId === d1.body.id && a.fromList.approvingBody === "Synthetic executive committee" && a.fromList.approvedOn === "2026-01-15" && a.allNullOthers.every((x: unknown) => x === null),
    a,
  );
  // AUD: sees the same annotation, read-only; every write refused.
  const audA = await ann("m1", "G1", auditor);
  check("IA1-aud-sees-annotation", "REQ-S16-016", untouched(audA) && JSON.stringify(audA.fromList) === JSON.stringify(a.fromList), audA);
  const audCreate = await auditor.raw("POST", `${mt.m1.T}/gate-dispensations`, { kind: "inherited_approval", gateCode: "G2", approvingBody: "x", approvedOn: "2026-01-15", evidenceId: ev0.id });
  const audDecide = await decide("m1", d1.body, "accepted", auditor);
  check("IA1-aud-writes-403", "REQ-S16-016", audCreate.status === 403 && audDecide.status === 403, { audCreate: brief(audCreate), audDecide: brief(audDecide) });
  // The recorder cannot decide it; unverified evidence cannot be accepted.
  const own = await decide("m1", d1.body, "accepted", lead);
  check("IA1-recorder-cannot-decide", "REQ-PB-007", own.status === 403, brief(own));
  const early = await decide("m1", d1.body, "accepted");
  check("IA1-unverified-cannot-be-accepted", "REQ-PB-007", early.status === 422 && early.body.code === "dispensation.evidence_not_verified", brief(early));
  const rej1 = await decide("m1", d1.body, "rejected");
  a = await ann("m1", "G1");
  check(
    "IA1-m1-G1-rejected",
    "REQ-PB-007",
    rej1.status === 200 && untouched(a) && a.fromList?.status === "rejected" && a.fromList.counts === false && a.fromList.dispensationId === d1.body.id,
    { rej: brief(rej1), a },
  );
  const ev2 = await note("m1", "Synthetic minutes E2 (verified)", true);
  const d2 = await record("m1", "G1", ev2.id);
  a = await ann("m1", "G1");
  check(
    "IA1-m1-G1-newer-pending-shown-over-rejected",
    "REQ-PB-007",
    d2.status === 201 && untouched(a) && a.fromList?.status === "pending_verification" && a.fromList.dispensationId === d2.body.id,
    a,
  );
  const acc2 = await decide("m1", d2.body, "accepted");
  a = await ann("m1", "G1");
  check(
    "IA1-m1-G1-accepted-counts",
    "REQ-PB-007",
    acc2.status === 200 && untouched(a) && a.fromList?.status === "accepted" && a.fromList.counts === true && a.fromList.dispensationId === d2.body.id,
    { acc: brief(acc2), a },
  );
  const rd = await lead.raw("GET", `${mt.m1.T}/readiness`);
  check("IA1-m1-readiness-sequencing-counts", "REQ-PB-004", rd.status === 200 && rd.body.sequencing?.canSubmitInitiatives === true, rd.body.sequencing);
  const d3 = await record("m1", "G1", ev2.id, "Synthetic newer committee");
  a = await ann("m1", "G1");
  check(
    "IA1-m1-G1-counting-one-shown-over-newer-pending",
    "REQ-PB-007",
    d3.status === 201 && untouched(a) && a.fromList?.dispensationId === d2.body.id && a.fromList.status === "accepted",
    { d3: d3.status, a },
  );
  const rej3 = await decide("m1", d3.body, "rejected");
  check("IA1-m1-d3-rejected", "REQ-PB-007", rej3.status === 200, brief(rej3));
  iaDisp["m1-G1"] = d2.body.id;

  // ---- M1 G2: accepted -> revoked (If-Match required; AUD 403).
  const d4 = await record("m1", "G2", ev2.id, "Synthetic steering board");
  const acc4 = await decide("m1", d4.body, "accepted");
  const audRevoke = await auditor.raw("POST", `${mt.m1.T}/gate-dispensations/${d4.body.id}/revoke`, { reason: "Synthetic (QA)" }, { ifMatch: acc4.body.version });
  const noIfMatch = await sp2S.raw("POST", `${mt.m1.T}/gate-dispensations/${d4.body.id}/revoke`, { reason: "Synthetic (QA)" }, { noIdem: true });
  const rev4 = await sp2S.raw("POST", `${mt.m1.T}/gate-dispensations/${d4.body.id}/revoke`, { reason: "Synthetic: superseded minutes (QA)." }, { ifMatch: acc4.body.version });
  a = await ann("m1", "G2");
  check(
    "IA1-m1-G2-revoked",
    "REQ-PB-007",
    acc4.status === 200 && audRevoke.status === 403 && noIfMatch.status === 428 && rev4.status === 200 && untouched(a) && shape(a.fromList) && a.fromList.status === "revoked" && a.fromList.counts === false && a.fromList.dispensationId === d4.body.id,
    { acc4: acc4.status, audRevoke: audRevoke.status, noIfMatch: noIfMatch.status, rev4: brief(rev4), a },
  );

  // ---- M1 G3: accepted, then its evidence is edited (review reset to unverified) -> accepted, does not count now.
  const ev5 = await note("m1", "Synthetic minutes E5 (verified, then edited)", true);
  const d5 = await record("m1", "G3", ev5.id, "Synthetic programme board");
  const acc5 = await decide("m1", d5.body, "accepted");
  a = await ann("m1", "G3");
  const before5 = a.fromList;
  const edit = await lead.raw("PATCH", `${mt.m1.T}/evidence/${ev5.id}`, { noteBody: "Synthetic minutes, edited after acceptance (QA)." }, { ifMatch: ev5.version });
  a = await ann("m1", "G3");
  check(
    "IA1-m1-G3-accepted-not-counting-after-evidence-edit",
    "REQ-PB-007",
    acc5.status === 200 && before5?.counts === true && edit.status === 200 && edit.body.reviewStatus === "unverified" && untouched(a) && a.fromList?.status === "accepted" && a.fromList.counts === false,
    { acc5: acc5.status, before5, edit: { status: edit.status, reviewStatus: edit.body?.reviewStatus, b: edit.status === 200 ? undefined : brief(edit) }, a },
  );

  // ---- M2: G1 pending_verification (verified evidence, not yet accepted), G2 rejected, G3 none.
  const ev6 = await note("m2", "Synthetic minutes E6 (verified)", true);
  const d6 = await record("m2", "G1", ev6.id);
  const d7 = await record("m2", "G2", ev6.id, "Synthetic steering board");
  const rej7 = await decide("m2", d7.body, "rejected");
  const m2 = await lead.raw("GET", `${mt.m2.T}/gates`);
  const byCode = Object.fromEntries((m2.body.items ?? []).map((v: Body) => [v.gate.gateCode, v.gate]));
  check(
    "IA1-m2-pending-rejected-null",
    "REQ-PB-007",
    d6.status === 201 && rej7.status === 200 &&
      byCode["G1"]?.inheritedApproval?.status === "pending_verification" && byCode["G1"].inheritedApproval.counts === false &&
      byCode["G2"]?.inheritedApproval?.status === "rejected" && byCode["G2"].inheritedApproval.counts === false &&
      ["G3", "G4", "G5", "G6"].every((c) => byCode[c]?.inheritedApproval === null) &&
      Object.values(byCode).every((g: Body) => g.status === "draft" && g.approvedAt === null && g.latestSubmissionNo === 0),
    Object.values(byCode).map((g: Body) => [g.gateCode, g.status, g.inheritedApproval]),
  );

  // No gate decision and no gate submission was ever written in either Modular transformation (audit trail).
  for (const k of ["m1", "m2"] as const) {
    // Every page of the audit trail (the API's maximum page size is 100).
    let au = await auditor.raw("GET", `${mt[k].T}/audit?limit=100`);
    const actions: string[] = (au.body.items ?? []).map((e: Body) => e.action as string);
    while (au.status === 200 && au.body.nextCursor) {
      au = await auditor.raw("GET", `${mt[k].T}/audit?limit=100&cursor=${encodeURIComponent(au.body.nextCursor)}`);
      actions.push(...(au.body.items ?? []).map((e: Body) => e.action as string));
    }
    // gate_instance.create (x6) is written when the transformation is created; anything else on a gate is a gate write.
    const gateWrites = actions.filter((x: string) => /^gate\.|gate_decision|gate_submission|gate_instance\.(?!create$)/.test(x));
    const created = actions.filter((x: string) => x === "gate_instance.create").length;
    check(`IA1-${k}-no-gate-decision-in-audit`, "REQ-PB-007", au.status === 200 && actions.length > 0 && gateWrites.length === 0 && created === 6, { status: au.status, actions: [...new Set(actions)], gateWrites, gateInstanceCreate: created });
  }
});

async function axeClean(page: Page, name: string): Promise<void> {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  check(`UI-axe-${name}`, "REQ-DLV-035", serious.length === 0, serious.map((v) => `${v.id}:${v.nodes.length}`));
}

async function shotTo(page: Page, lang: Lang, name: string) {
  mkdirSync(join(OUT, "screens", lang), { recursive: true });
  await page.screenshot({ path: join(OUT, "screens", lang, `${name}.png`), fullPage: true });
}

test("U1 the approved G4, prioritization and roadmap render in the project's language (dir, lang), axe-clean", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
  check("U1-dir-lang", "REQ-DLV-035", lang === "ar" ? dir[0] === "rtl" && dir[1].startsWith("ar") : dir[0] !== "rtl" && dir[1].startsWith("en"), dir);
  const pages: [string, string][] = [
    ["gates", `/transformations/${tid}/gates/G4`],
    ["prioritization", `/transformations/${tid}/prioritization`],
    ["roadmap", `/transformations/${tid}/roadmap`],
    ["portfolio", `/transformations/${tid}/portfolio`],
    ["capacity", `/transformations/${tid}/capacity`],
    ["business-cases", `/transformations/${tid}/business-cases`],
  ];
  for (const [name, url] of pages) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const body = await page.locator("main").innerText().catch(() => "");
    const latin = (body.match(/[A-Za-z]{4,}/g) ?? []).filter((w) => !/^(Synthetic|QA|SAR|INI|DEP|BC|BF|FTE|KPI|Mobily|TOM)$/i.test(w));
    check(`U1-${name}-renders`, "REQ-DLV-035", body.length > 20 && !/not found|404/i.test(body.slice(0, 200)), body.slice(0, 200));
    if (lang === "ar")
      checks.push({ id: `U1-${name}-latin-words-ar`, req: "info", pass: true, detail: JSON.stringify([...new Set(latin)].slice(0, 40)) });
    await shotTo(page, lang, `qa-${name}`);
    await axeClean(page, `${name}-${lang}`);
  }
  await page.goto(`/transformations/${tid}/prioritization`);
  await page.waitForLoadState("networkidle");
  const toggle = page.getByRole("button", { name: lang === "ar" ? "إظهار عرض 0–100" : "Show the 0–100 view" });
  await toggle.click();
  // X (INI of 'order validation') now scores 2.90 under weight version 2 -> 0-100 view 47.5; Y 3.00 -> 50.
  const row = page.getByRole("row").filter({ hasText: ini["X"]!.code });
  await expect(row.first()).toBeVisible();
  const rowText = await row.first().innerText();
  check("U1-0-100-view-under-v2", "REQ-S09-001", /47[.,٫]5|٤٧٫٥/.test(rowText), rowText);
  const pageText = await page.locator("body").innerText();
  check(
    "U1-conversion-label-visible",
    "REQ-S09-001",
    /\(.*1.*\).*4.*100/.test(pageText.replace(/\s+/g, " ")) || pageText.includes("÷ 4"),
    pageText.match(/.{0,60}100.{0,60}/g)?.slice(0, 5) ?? [],
  );
  await shotTo(page, lang, "qa-prioritization-100");
});

test("U2 the read-only auditor: G4 and P3 screens show no enabled write control and send only GETs", async ({ page }, info) => {
  const lang = langOf(info);
  // Tracking starts AFTER sign-in: the shared signIn helper sets the UI language with PUT /me/preferences (a personal
  // preference of the signed-in user, not a business write).
  await signIn(page, lang, "dev.auditor");
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !r.url().includes("/auth/")) writes.push(`${r.method()} ${r.url()}`);
  });
  for (const p of ["gates/G4", "prioritization", "roadmap", "portfolio", "capacity", "business-cases", "dependencies"]) {
    await page.goto(`/transformations/${tid}/${p}`);
    await page.waitForLoadState("networkidle");
    const enabled = await page
      .locator("main button:not([disabled]):not([aria-disabled='true'])")
      .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).filter((t) => t.length > 0));
    checks.push({ id: `U2-${p}-enabled-buttons`, req: "info", pass: true, detail: JSON.stringify(enabled.slice(0, 30)) });
  }
  check("U2-aud-sends-no-writes", "REQ-S16-016", writes.length === 0, writes);
});

test("U3 the Gates list and gate view show the inherited-approval badge next to the unchanged status, in the project's language, axe-clean; AUD read-only (F-DG3-120)", async ({ page }, info) => {
  const lang = langOf(info);
  const L = lang === "ar"
    ? { label: "اعتماد موروث", notApprove: "لا يعتمد هذه البوابة", body: "Synthetic executive committee", view: "عرض إعفاءات البوابات" }
    : { label: "Inherited approval", notApprove: "does not approve this gate", body: "Synthetic executive committee", view: "View gate dispensations" };
  for (const who of ["dev.lead", "dev.auditor"]) {
    await signIn(page, lang, who);
    const writes: string[] = [];
    const onReq = (r: { url(): string; method(): string }) => {
      if (r.url().includes("/api/") && !["GET", "HEAD", "OPTIONS"].includes(r.method()) && !r.url().includes("/auth/")) writes.push(`${r.method()} ${r.url()}`);
    };
    page.on("request", onReq);
    const tag = who === "dev.lead" ? "lead" : "aud";
    for (const k of ["m1", "m2"] as const) {
      await page.goto(`/transformations/${mt[k].tid}/gates`);
      await page.waitForLoadState("networkidle");
      const badges = await page.locator("[data-inherited-approval]").evaluateAll((els) =>
        els.map((e) => ({ s: e.getAttribute("data-inherited-approval"), c: e.getAttribute("data-counts"), cls: e.className, text: (e.textContent ?? "").trim() })),
      );
      const sources = await page.locator("[data-inherited-approval-source]").allInnerTexts();
      const want = k === "m1"
        ? [["accepted", "true"], ["revoked", "false"], ["accepted", "false"]]
        : [["pending_verification", "false"], ["rejected", "false"]];
      const got = badges.map((b) => [b.s, b.c]);
      check(
        `U3-${tag}-${k}-list-badges-${lang}`,
        "REQ-PB-007",
        JSON.stringify(got) === JSON.stringify(want) &&
          badges.every((b) => b.text.includes(L.notApprove) && b.text.includes(L.label) && /status-chip--unknown/.test(b.cls) && !/approved|on-track/.test(b.cls)) &&
          sources.length === want.length && sources.every((s) => s.includes("Synthetic")),
        { badges, sources },
      );
      // The gate's own status chip stays "not submitted"/draft for every gate.
      const html = await page.locator("main").innerText();
      checks.push({ id: `U3-${tag}-${k}-list-text-${lang}`, req: "info", pass: true, detail: html.slice(0, 1200) });
      await shotTo(page, lang, `qa-r7-${tag}-${k}-gates-list`);
      await axeClean(page, `${tag}-${k}-gates-list-${lang}`);
    }
    // Gate view: M1 G1 (accepted, counts) and M2 G1 (pending verification); M2 G3 has no row.
    for (const [k, code, want] of [["m1", "G1", "accepted"], ["m2", "G1", "pending_verification"], ["m2", "G3", null]] as const) {
      await page.goto(`/transformations/${mt[k].tid}/gates/${code}`);
      await page.waitForLoadState("networkidle");
      const row = page.locator("[data-inherited-approval-row]");
      const n = await row.count();
      const rowText = n ? await row.first().innerText() : "";
      const badge = n ? await row.locator("[data-inherited-approval]").first().getAttribute("data-inherited-approval") : null;
      const link = n ? await row.getByRole("link", { name: L.view }).getAttribute("href") : null;
      check(
        `U3-${tag}-${k}-${code}-view-${lang}`,
        "REQ-PB-007",
        want === null ? n === 0 : n === 1 && badge === want && rowText.includes(L.notApprove) && rowText.includes(L.body) && link === `/transformations/${mt[k].tid}/dispensations`,
        { n, badge, link, rowText },
      );
      await shotTo(page, lang, `qa-r7-${tag}-${k}-${code}-view`);
      await axeClean(page, `${tag}-${k}-${code}-view-${lang}`);
    }
    const dir = await page.evaluate(() => [document.documentElement.dir, document.documentElement.lang]);
    check(`U3-${tag}-dir-lang-${lang}`, "REQ-DLV-035", lang === "ar" ? dir[0] === "rtl" && dir[1].startsWith("ar") : dir[0] !== "rtl" && dir[1].startsWith("en"), dir);
    if (who === "dev.auditor") {
      const enabled = await page
        .locator("main button:not([disabled]):not([aria-disabled='true'])")
        .evaluateAll((els) => els.map((e) => (e.textContent ?? "").trim()).filter((t) => t.length > 0));
      checks.push({ id: `U3-aud-gate-view-enabled-buttons-${lang}`, req: "info", pass: true, detail: JSON.stringify(enabled) });
      check(`U3-aud-sends-no-writes-${lang}`, "REQ-S16-016", writes.length === 0, writes);
    }
    page.off("request", onReq);
    await page.context().clearCookies();
  }
});

test("Z every recorded acceptance check passed", async () => {
  const failed = checks.filter((c) => !c.pass);
  expect(failed.map((c) => `${c.id} [${c.req}] ${c.detail.slice(0, 400)}`)).toEqual([]);
});

// F-DG3-180 (round 2, qa-verifier): a LAYOUT probe kept outside `checks` (and so outside "Z") on purpose, so that its
// result is its own test. It asserts that every inherited-approval badge lies inside its gate card (list) or inside
// its field (gate view), at the default Desktop Chrome viewport (1280x720). It is the LAST test of the serial file, so its failure never skips another test. It FAILS on the candidate: .status-chip is
// `white-space: nowrap`, so the long badge text runs outside the card, under the neighbouring card or past the
// container, and in the gate view over the next column. The measurements are written to f180-layout-<lang>.json.
test("F180 layout probe: the inherited-approval badge stays inside its gate card and field (F-DG3-180)", async ({ page }, info) => {
  const lang = langOf(info);
  await signIn(page, lang, "dev.lead");
  const out: { where: string; gate: string | null; status: string | null; badge: number[]; box: number[]; inside: boolean }[] = [];
  const measure = async (where: string, boxSelector: string) =>
    page.locator("[data-inherited-approval]").evaluateAll(
      (els, sel) =>
        els.map((e) => {
          const box = e.closest(sel) as HTMLElement | null;
          const b = e.getBoundingClientRect();
          const c = box ? box.getBoundingClientRect() : b;
          const r = (x: DOMRect) => [Math.round(x.left), Math.round(x.right), Math.round(x.top), Math.round(x.bottom)];
          return {
            gate: (e.closest("[data-gate]") as HTMLElement | null)?.dataset["gate"] ?? null,
            status: e.getAttribute("data-inherited-approval"),
            badge: r(b),
            box: r(c),
            inside: b.left >= c.left - 1 && b.right <= c.right + 1,
          };
        }),
      boxSelector,
    ).then((rows) => rows.map((x) => ({ where, ...x })));
  for (const k of ["m1", "m2"] as const) {
    await page.goto(`/transformations/${mt[k].tid}/gates`);
    await page.waitForLoadState("networkidle");
    out.push(...(await measure(`${k}-list`, "li.gate-card")));
    await page.goto(`/transformations/${mt[k].tid}/gates/G1`);
    await page.waitForLoadState("networkidle");
    out.push(...(await measure(`${k}-G1-view`, "dd")));
    await shotTo(page, lang, `f180-${k}-G1-view`);
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `f180-layout-${lang}.json`), `${JSON.stringify(out, null, 2)}\n`);
  expect(out.length).toBe(7);
  expect(out.filter((x) => !x.inside)).toEqual([]);
});

// F-DG3-180 (round 3, qa-verifier): the widths and states that neither the round-2 probe above (1280 px only) nor the
// product spec p3-inherited-approval.spec.ts (the 'accepted' badge on G1 only, at 1024/1366/1920/390) covers. Every
// badge state of IA1 (accepted+counts, revoked, accepted-not-counting on M1; pending_verification, rejected on M2), on
// the Gates list and the G1 gate view, at 320 (WCAG 1.4.10 reflow), 390, 768, 900/901 (the app.css narrow-layout
// breakpoint), 1024, 1280, 1366 and 1920 px, plus 200% root text size at 1280 and 390 (WCAG 1.4.4). For each badge:
//   - the badge box lies inside its gate card (list) / its <dd> (view), horizontally AND vertically;
//   - the rendered rectangles of the clause "(does not approve this gate)" / "(لا يعتمد هذه البوابة)" lie inside the
//     card/field and the viewport (the clause itself is visible, not just the chip's box);
//   - the badge is not clipped (scrollWidth <= clientWidth) and overlaps no other text-bearing element of its card/row;
//   - the document does not scroll horizontally.
// Regression: every OTHER .status-chip on the page (no --wrap) keeps white-space: nowrap (the fix is scoped).
// Kept outside `checks`/Z like F180; measurements go to f180b-layout-<lang>.json.
test("F180b extended layout probe: every badge state at 320-1920 px and at 200% text, clause inside, no overlap, other chips still nowrap (F-DG3-180)", async ({ page }, info) => {
  test.setTimeout(600_000);
  const lang = langOf(info);
  const clause = lang === "ar" ? "لا يعتمد هذه البوابة" : "does not approve this gate";
  await signIn(page, lang, "dev.lead");
  const views = [320, 390, 768, 900, 901, 1024, 1280, 1366, 1920].map((w) => ({ w, zoom: false }));
  views.push({ w: 1280, zoom: true }, { w: 390, zoom: true });
  const out: Body[] = [];
  for (const v of views) {
    await page.setViewportSize({ width: v.w, height: 900 });
    for (const k of ["m1", "m2"] as const) {
      for (const [where, path, boxSel] of [
        ["list", `/transformations/${mt[k].tid}/gates`, "li.gate-card"],
        ["G1-view", `/transformations/${mt[k].tid}/gates/G1`, "dd"],
      ] as const) {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.locator("[data-inherited-approval]").first().waitFor();
        // 200% root text through the CSSOM (the app's CSP style-src 'self' refuses an injected <style>, as it should;
        // a CSSOM property set by script is not inline markup and is allowed).
        const rootFontPx = await page.evaluate((zoom) => {
          if (zoom) document.documentElement.style.setProperty("font-size", "200%", "important");
          return parseFloat(getComputedStyle(document.documentElement).fontSize);
        }, v.zoom);
        await page.waitForTimeout(50);
        const rows = await page.evaluate(
          ({ sel, clause }) => {
            const R = (x: DOMRect) => [Math.round(x.left), Math.round(x.right), Math.round(x.top), Math.round(x.bottom)];
            const within = (a: DOMRect, c: DOMRect) =>
              a.left >= c.left - 1 && a.right <= c.right + 1 && a.top >= c.top - 1 && a.bottom <= c.bottom + 1;
            const iw = window.innerWidth;
            const badges = [...document.querySelectorAll<HTMLElement>("[data-inherited-approval]")];
            const otherChips = [...document.querySelectorAll<HTMLElement>(".status-chip:not(.status-chip--wrap)")];
            return badges.map((e) => {
              const box = (e.closest(sel) as HTMLElement | null) ?? e;
              const b = e.getBoundingClientRect();
              const c = box.getBoundingClientRect();
              // The clause's own rendered rectangles.
              const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
              const clauseRects: DOMRect[] = [];
              let found = false;
              for (let n = walker.nextNode(); n; n = walker.nextNode()) {
                const i = (n.textContent ?? "").indexOf(clause);
                if (i >= 0) {
                  found = true;
                  const range = document.createRange();
                  range.setStart(n, i);
                  range.setEnd(n, i + clause.length);
                  clauseRects.push(...[...range.getClientRects()].filter((r) => r.width > 0));
                }
              }
              const clauseInside = found && clauseRects.length > 0 && clauseRects.every((r) => within(r, c) && r.left >= -1 && r.right <= iw + 1);
              // Overlap with any other text-bearing element of the same card/row (not the badge, not its ancestors).
              const overlaps: string[] = [];
              for (const o of box.querySelectorAll<HTMLElement>("*")) {
                if (o === e || o.contains(e) || e.contains(o)) continue;
                const hasText = [...o.childNodes].some((cn) => cn.nodeType === 3 && (cn.textContent ?? "").trim().length > 0);
                if (!hasText && !o.matches(".status-chip, .lifecycle-chip, a, button")) continue;
                const r = o.getBoundingClientRect();
                if (r.width === 0 || r.height === 0) continue;
                const ix = Math.min(b.right, r.right) - Math.max(b.left, r.left);
                const iy = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
                if (ix > 1 && iy > 1) overlaps.push(`${o.tagName.toLowerCase()}.${o.className}: ${(o.textContent ?? "").trim().slice(0, 40)}`);
              }
              return {
                gate: (e.closest("[data-gate]") as HTMLElement | null)?.dataset["gate"] ?? null,
                status: e.getAttribute("data-inherited-approval"),
                counts: e.getAttribute("data-counts"),
                whiteSpace: getComputedStyle(e).whiteSpace,
                badge: R(b),
                box: R(c),
                clauseRects: clauseRects.map(R),
                inside: within(b, c),
                clauseFound: found,
                clauseInside,
                notClipped: e.scrollWidth <= e.clientWidth,
                overlaps,
                docScrollWidth: document.documentElement.scrollWidth,
                innerWidth: iw,
                noHScroll: document.documentElement.scrollWidth <= iw,
                otherChips: otherChips.length,
                otherChipsNowrap: otherChips.every((x) => getComputedStyle(x).whiteSpace === "nowrap"),
              };
            });
          },
          { sel: boxSel, clause },
        );
        out.push(...rows.map((x) => ({ width: v.w, zoom200: v.zoom, rootFontPx, where: `${k}-${where}`, ...x })));
        // Written after every page, so the measurements survive any later error.
        mkdirSync(OUT, { recursive: true });
        writeFileSync(join(OUT, `f180b-layout-${lang}.json`), `${JSON.stringify(out, null, 2)}\n`);
        if (v.w === 320 || v.zoom) await shotTo(page, lang, `f180b-${k}-${where}-${v.w}${v.zoom ? "-zoom200" : ""}`);
      }
    }
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `f180b-layout-${lang}.json`), `${JSON.stringify(out, null, 2)}\n`);
  const bad = out.filter(
    (x) => !x.inside || !x.clauseFound || !x.clauseInside || !x.notClipped || x.overlaps.length > 0 || !x.noHScroll || !x.otherChipsNowrap || x.whiteSpace === "nowrap",
  );
  console.log(`F180b ${lang}: ${out.length} badge measurements, ${bad.length} failing`);
  expect(out.length).toBe(views.length * 7);
  expect(out.some((x) => x.otherChips > 0)).toBe(true);
  // The 200% state really doubled the root text size.
  expect(out.filter((x) => x.zoom200).every((x) => x.rootFontPx >= 2 * out.find((y) => !y.zoom200).rootFontPx - 0.5)).toBe(true);
  expect(bad).toEqual([]);
});
