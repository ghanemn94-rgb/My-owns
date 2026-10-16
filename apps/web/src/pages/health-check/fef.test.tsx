// FE-F screens (T-DG5-FE-F; slices G and H) with STUBBED responses, in English (LTR) and Arabic (RTL). The live paths
// against the real API are e2e/p5-launch-health-kpi.spec.ts. SYNTHETIC data; nothing here is a business approval.
//  - REQ-S14-002 / S14-001 / PB-091 / PB-092: 24 answers show "Incomplete (24/25)" and no band (never a 0 score); 25
//    answers with 17 Yes show 17 / 25 and the band "16-20" with its text verbatim; the scoring method is shown as an
//    implementation assumption; submitting without three actions is the translated 422.
//  - REQ-PB-086 / S14-004: tasks are listed by window with "Blocked by" their incomplete predecessor and the
//    non-working-day warning; changing the start date sends If-Match of the plan.
//  - REQ-PB-087: the six questions verbatim; "Incomplete (5/6)"; completing is the translated 422.
//  - REQ-S08-005: the revenue-uplift unit is SAR (never "SAR per customer") and a missing ARPU is "Not computable".
//  - REQ-S08-019: "Extension, not a playbook requirement"; no discount rate → NPV "Not shown: no discount rate".
//  - REQ-S07-016: a Stale reconciliation side carries no number; the decision refusal is translated; the requester has
//    no decision form.
//  - Problem texts: every refusal row of ADR-0047 §8 and ADR-0048 §9 has its exact English text and an Arabic text.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { catalogues, createI18n } from "../../i18n/index.ts";
import {
  ORG_ID,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
} from "../../test/fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Lang = "en" | "ar";
const LANGS: readonly Lang[] = ["en", "ar"];
const L = (lang: Lang) => catalogues[lang].launchHealthP5;
const ALL: Permission[] = [
  "organization.read",
  "transformation.read",
  "launch_plan.edit",
  "day_ninety_test.respond",
  "health_check.assess",
  "kpi_restatement.request",
  "kpi_restatement.approve",
  "financial_metrics.define",
  "financial_metrics.enable",
];
const meRoute = (lang: Lang, permissions: Permission[] = ALL) =>
  route("GET", /\/api\/v1\/me$/, () => ({
    status: 200,
    body: makeMe([{ scope: { type: "organization" as const, id: ORG_ID }, inheritsDownward: true, permissions }], {
      preferredLocale: lang,
    }),
  }));
const trRoute = route("GET", new RegExp(`/api/v1/transformations/${TR_ID}$`), () => ({
  status: 200,
  body: makeTransformation(),
}));
const ok = (body: unknown) => () => ({ status: 200, body });
const found = (selector: string) =>
  waitFor(() => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`not found: ${selector}`);
    return el as HTMLElement;
  });

const uuid = (n: number) => `01920000-0000-7000-9000-${String(n).padStart(12, "0")}`;
const SCHEME_ID = uuid(9001);
const NOW = "2026-10-16T10:00:00Z";
const BANDS = [
  {
    key: "b21",
    minScore: "21",
    rangeLabel: "21-25",
    textEn: "Strong transformation foundation; focus on scaling and sustainment.",
    textAr: "أساس قوي",
    origin: "source",
  },
  {
    key: "b16",
    minScore: "16",
    rangeLabel: "16-20",
    textEn: "Good progress; address gaps before major scaling.",
    textAr: "تقدم جيد",
    origin: "source",
  },
  {
    key: "b10",
    minScore: "10",
    rangeLabel: "10-15",
    textEn: "Material governance or value-tracking gaps; correct before next gate.",
    textAr: "فجوات جوهرية",
    origin: "source",
  },
  {
    key: "b0",
    minScore: "0",
    rangeLabel: "0-9",
    textEn: "High risk of activity without outcomes; reset charter and value model.",
    textAr: "مخاطر عالية",
    origin: "source",
  },
];
const SCHEME = {
  versionId: SCHEME_ID,
  key: "health-check",
  versionNo: 1,
  titleEn: "Health check scoring",
  titleAr: "تسجيل فحص السلامة",
  scoreBasis: "points",
  questionCount: 25,
  implementationAssumption: true,
  responses: [
    { key: "yes", credit: "1", labelEn: null, labelAr: null },
    { key: "no", credit: "0", labelEn: null, labelAr: null },
  ],
  bands: BANDS,
  publishedAt: NOW,
};
const QUESTIONS = Array.from({ length: 25 }, (_, i) => ({
  code: `q${String(i + 1).padStart(2, "0")}`,
  ordinal: i + 1,
  textEn: `Synthetic verbatim question ${i + 1}?`,
  textAr: `سؤال اصطناعي ${i + 1}؟`,
  sourceRef: "B0150",
}));
function assessment(answered: number, yes: number, extra: Record<string, unknown> = {}) {
  const complete = answered === 25;
  return {
    id: uuid(8001),
    transformationId: TR_ID,
    sequenceNo: 1,
    schemeVersionId: SCHEME_ID,
    schemeVersionNo: 1,
    assessmentDate: "2026-10-16",
    ownerUserId: USER_ID,
    status: "draft",
    completion: { answered, total: 25, complete },
    score: complete ? String(yes) : null,
    scoreMax: complete ? "25" : null,
    band: complete ? (BANDS.find((b) => Number(b.minScore) <= yes) ?? null) : null,
    scoringAssumption: true,
    previousAssessmentId: null,
    submittedAt: null,
    submittedBy: null,
    version: 3,
    createdAt: NOW,
    updatedAt: NOW,
    answers: QUESTIONS.slice(0, answered).map((q, i) => ({
      questionCode: q.code,
      response: i < yes ? "yes" : "no",
      evidenceNote: null,
      evidenceId: null,
      ownerUserId: null,
      actionNote: null,
      answeredBy: USER_ID,
      updatedAt: NOW,
    })),
    actions: [],
    ...extra,
  };
}
const healthRoutes = (a: ReturnType<typeof assessment>) => [
  route("GET", /\/health-check-questions$/, ok({ items: QUESTIONS })),
  route("GET", new RegExp(`/admin/health-check-schemes/${SCHEME_ID}$`), ok(SCHEME)),
  route(
    "GET",
    /\/health-checks\?|\/health-checks$/,
    ok({ items: [{ ...a, answers: undefined, actions: undefined }], nextCursor: null }),
  ),
  route("GET", new RegExp(`/health-checks/${a.id}$`), ok(a)),
];

describe.each(LANGS)("REQ-S14-001/002, PB-091/092: the health check (%s)", (lang) => {
  it("24 answers: Incomplete (24/25), no score and no band; the scoring assumption is shown", async () => {
    mockApi(meRoute(lang), trRoute, ...healthRoutes(assessment(24, 17)));
    renderApp(`/transformations/${TR_ID}/health-check`, { i18n: createI18n(lang) });
    const facts = await found("[data-assessment-status='draft']");
    const label = L(lang).completion.incomplete.replace("{{answered}}", "24").replace("{{total}}", "25");
    expect(within(facts).getByText(label, { exact: false })).toBeTruthy();
    expect(facts.querySelector("[data-band='none']")!.textContent).toBe(L(lang).health.noBand);
    expect(facts.querySelector("[data-score='none']")).toBeTruthy();
    expect(facts.textContent).not.toMatch(/\b0 \/ 25\b/);
    expect(document.querySelector("[data-state='scoring-assumption']")!.textContent).toContain(
      L(lang).health.scoringAssumption,
    );
    expect(document.querySelectorAll("[data-question]")).toHaveLength(25);
    expect(document.querySelector("[data-question='q25']")!.getAttribute("data-answered")).toBe("false");
    expect(document.documentElement.dir).toBe(lang === "ar" ? "rtl" : "ltr");
  });

  it("25 answers with 17 Yes: 17 / 25 and the band 16-20 with its source text", async () => {
    mockApi(meRoute(lang), trRoute, ...healthRoutes(assessment(25, 17)));
    renderApp(`/transformations/${TR_ID}/health-check`, { i18n: createI18n(lang) });
    const score = await found("[data-field='score'] [data-score='17']");
    expect(score.textContent).toContain("17");
    expect(score.textContent).toContain("25");
    const band = document.querySelector("[data-field='band'] [data-band='16-20']")!;
    expect(band.textContent).toContain(lang === "en" ? BANDS[1]!.textEn : BANDS[1]!.textAr);
  });

  it("submitting without three actions shows the translated 422", async () => {
    const a = assessment(25, 17);
    const { requests } = mockApi(
      meRoute(lang),
      trRoute,
      ...healthRoutes(a),
      route("POST", /\/submit$/, () => problem(422, "health_check.actions_required")),
    );
    renderApp(`/transformations/${TR_ID}/health-check`, { i18n: createI18n(lang) });
    fireEvent.click(await screen.findByRole("button", { name: L(lang).health.submit }));
    const alert = await found("[data-problem='health_check.actions_required']");
    expect(alert.textContent).toContain(catalogues[lang].problems.health_check__actions_required);
    expect(requests.find((r) => r.method === "POST")!.headers["if-match"]).toBe('"3"');
  });
});

const TASK = (n: number, extra: Record<string, unknown> = {}) => ({
  id: uuid(7000 + n),
  planId: uuid(7000),
  ordinal: n,
  templateItemCode: null,
  windowCode: "days_31_60",
  taskKind: "action",
  title: `Synthetic task ${n}`,
  sourceTextEn: null,
  notes: null,
  startDate: "2026-11-01",
  dueDate: "2026-11-30",
  nonWorkingDay: false,
  ownerUserId: null,
  status: "not_started",
  completedAt: null,
  completedBy: null,
  outputRecordType: null,
  outputRecordId: null,
  predecessors: [],
  blockedBy: [],
  version: 1,
  updatedAt: NOW,
  ...extra,
});

describe.each(LANGS)("REQ-PB-086, S14-004: the launch plan (%s)", (lang) => {
  it("lists tasks with 'Blocked by' and the non-working-day warning; a new start date sends If-Match", async () => {
    const ref = { taskId: uuid(7001), ordinal: 1, title: "Synthetic task 1", status: "in_progress" };
    const { requests } = mockApi(
      meRoute(lang),
      trRoute,
      route("GET", /\/launch-plan-template$/, ok({ windows: [], sourceRef: "B0134" })),
      route(
        "GET",
        /\/launch-plan\/tasks/,
        ok({
          items: [
            TASK(1, { status: "in_progress" }),
            TASK(2, { predecessors: [ref], blockedBy: [ref], nonWorkingDay: true, dueDate: "2026-11-27" }),
          ],
          nextCursor: null,
        }),
      ),
      route(
        "GET",
        /\/launch-plan$/,
        ok({
          id: uuid(7000),
          transformationId: TR_ID,
          startDate: "2026-10-01",
          templateRef: "B0134",
          generatedVia: "request",
          lastShiftDays: null,
          taskCount: 2,
          completedCount: 0,
          version: 4,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      ),
      route("PATCH", /\/launch-plan$/, () => ({ status: 200, body: {} })),
    );
    renderApp(`/transformations/${TR_ID}/launch-plan`, { i18n: createI18n(lang) });
    const blocked = await found("[data-blocked-by='1']");
    expect(blocked.textContent).toContain(L(lang).launch.blockedBy.replace("{{tasks}}", "#1 Synthetic task 1"));
    expect(document.querySelector("[data-status='non-working-day']")!.textContent).toContain(
      L(lang).launch.nonWorkingDay,
    );
    fireEvent.change(screen.getByLabelText(L(lang).launch.changeStart), { target: { value: "2026-10-08" } });
    fireEvent.click(screen.getByRole("button", { name: L(lang).launch.redate }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ startDate: "2026-10-08" });
    expect(patch.headers["if-match"]).toBe('"4"');
  });

  it("no plan yet: says so and offers to generate it from a start date", async () => {
    mockApi(
      meRoute(lang),
      trRoute,
      route("GET", /\/launch-plan-template$/, ok({ windows: [], sourceRef: "B0134" })),
      route("GET", /\/launch-plan$/, () => problem(404, "not_found")),
    );
    renderApp(`/transformations/${TR_ID}/launch-plan`, { i18n: createI18n(lang) });
    expect(await screen.findByText(L(lang).launch.noPlan)).toBeTruthy();
    expect(screen.getByRole("button", { name: L(lang).launch.generate })).toBeTruthy();
  });
});

describe.each(LANGS)("REQ-PB-087: the Day-90 leadership test (%s)", (lang) => {
  it("five of six answered: Incomplete (5/6); completing is the translated 422", async () => {
    const qs = Array.from({ length: 6 }, (_, i) => ({
      code: `q${i + 1}`,
      ordinal: i + 1,
      textEn: `Synthetic leadership question ${i + 1}?`,
      textAr: `سؤال قيادي اصطناعي ${i + 1}؟`,
      sourceRef: `B013${6 + i}`,
      response: i < 5 ? { answer: "yes", comment: null, evidenceId: null, respondedBy: USER_ID, updatedAt: NOW } : null,
      evidenceSuggestions: [],
    }));
    mockApi(
      meRoute(lang),
      trRoute,
      route(
        "GET",
        /\/day-90-test$/,
        ok({
          id: uuid(6001),
          planId: uuid(7000),
          scheduledDate: "2026-12-30",
          status: "open",
          completion: { answered: 5, total: 6, complete: false },
          questions: qs,
          completedAt: null,
          completedBy: null,
          version: 6,
        }),
      ),
      route("POST", /\/day-90-test\/complete$/, () => problem(422, "day_ninety_test.incomplete")),
    );
    renderApp(`/transformations/${TR_ID}/day-90-test`, { i18n: createI18n(lang) });
    const facts = await found("[data-test-status='open']");
    expect(facts.textContent).toContain(
      L(lang).completion.incomplete.replace("{{answered}}", "5").replace("{{total}}", "6"),
    );
    expect(document.querySelectorAll("[data-question]")).toHaveLength(6);
    expect(document.querySelector("[data-question='q1'] h3")!.textContent).toContain(
      lang === "en" ? qs[0]!.textEn : qs[0]!.textAr,
    );
    fireEvent.click(screen.getByRole("button", { name: L(lang).day90.complete }));
    const alert = await found("[data-problem='day_ninety_test.incomplete']");
    expect(alert.textContent).toContain(catalogues[lang].problems.day_ninety_test__incomplete);
  });
});

describe.each(LANGS)("REQ-S08-005: the formula preview (%s)", (lang) => {
  it("the revenue uplift is in SAR, never 'SAR per customer', and a missing ARPU is Not computable", async () => {
    const formula = {
      id: uuid(5001),
      organizationId: ORG_ID,
      transformationId: TR_ID,
      code: "BF-01",
      benefitName: "Synthetic uplift",
      baselineDriver: null,
      changeAssumption: null,
      ramp: null,
      confidence: null,
      ownerUserId: null,
      currentVersionNo: null,
      currentVersion: null,
      isIllustrative: true,
      exampleCode: "revenue_uplift",
      status: "active",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      version: 1,
      createdAt: NOW,
      createdBy: USER_ID,
      updatedAt: NOW,
    };
    const { requests } = mockApi(
      meRoute(lang),
      trRoute,
      route("GET", /\/benefit-formulas\/[^/]+$/, ok(formula)),
      route(
        "POST",
        /\/formula-previews$/,
        ok({
          valid: true,
          errors: [],
          unit: { kind: "currency", currency: "SAR", period: "year", unitLabel: "per customer" },
          examples: [
            { label: "Source example", inputs: { arpu: "40" }, status: "ok", result: "1200000", reasonCode: null },
          ],
          edgeCases: [
            {
              variable: "arpu",
              case: "missing",
              status: "not_computable",
              result: null,
              reasonCode: "formula.missing_input",
            },
          ],
          engineVersion: "1.0.0",
        }),
      ),
    );
    renderApp(`/transformations/${TR_ID}/benefit-formulas/${formula.id}/preview`, { i18n: createI18n(lang) });
    const unit = await found("[data-field='unit'] [data-unit-currency='SAR']");
    expect(unit.textContent).toContain("SAR");
    expect(document.body.textContent).not.toMatch(/per customer/i);
    const edge = document.querySelector("[data-edge='arpu:missing']")!;
    expect(edge.textContent).toContain(L(lang).notComputable);
    expect(edge.textContent).not.toMatch(/\b0\b/);
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({ exampleCode: "revenue_uplift", edgeCases: true });
  });
});

describe.each(LANGS)("REQ-S08-019: the optional financial metrics (%s)", (lang) => {
  it("labelled an extension; with no discount rate NPV is not shown and is never 0", async () => {
    mockApi(
      meRoute(lang),
      trRoute,
      route(
        "GET",
        /\/financial-metrics\/settings$/,
        ok({
          enabled: true,
          methodology: "discounted_net_cash_flow",
          methodologyNote: "Synthetic statement",
          timing: "end_of_period",
          periodBasis: "annual",
          discountRate: null,
          assumptionsSetBy: USER_ID,
          assumptionsSetAt: NOW,
          enabledChangedBy: USER_ID,
          enabledChangedAt: NOW,
          extension: true,
          version: 2,
        }),
      ),
      route(
        "GET",
        /\/benefits\/financial-metrics/,
        ok({
          items: [
            {
              businessCaseId: uuid(4001),
              status: "shown",
              currency: "SAR",
              npv: null,
              npvReason: "discount_rate_missing",
              roi: "0.200000",
              roiReason: null,
              paybackPeriodIndex: 3,
              paybackReason: null,
              assumptions: {
                methodologyNote: "Synthetic statement",
                timing: "end_of_period",
                periodBasis: "annual",
                discountRate: null,
              },
              cashFlowRevision: 1,
              extension: true,
            },
          ],
          nextCursor: null,
        }),
      ),
      route("GET", /\/business-cases\?/, ok({ items: [], nextCursor: null })),
    );
    renderApp(`/transformations/${TR_ID}/financial-metrics`, { i18n: createI18n(lang) });
    const npv = await found("[data-npv='']");
    expect(npv.textContent).toBe(L(lang).finance.reason.discount_rate_missing);
    expect(document.querySelector("[data-state='extension']")!.textContent).toContain(L(lang).finance.extension);
    expect(document.querySelector("[data-payback='3']")!.textContent).toContain("3");
    expect(document.querySelector("[data-named-assumptions='true']")).toBeTruthy();
  });
});

describe.each(LANGS)("REQ-S07-016: KPI restatement (%s)", (lang) => {
  const R = (extra: Record<string, unknown> = {}) => ({
    id: uuid(3001),
    transformationId: TR_ID,
    kpiDefinitionId: uuid(3100),
    kpiVersionId: uuid(3101),
    changeRequestId: null,
    reason: "Synthetic correction",
    status: "submitted",
    periods: [{ reportingPeriodId: uuid(3200), periodLabel: "2026-Q1" }],
    requestedBy: uuid(3999),
    submittedAt: NOW,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    authorityPermission: null,
    authorityRoleCode: null,
    calculationRunId: null,
    appliedAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    version: 2,
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  });
  const REC = {
    restatementId: uuid(3001),
    retained: true,
    rows: [
      {
        reportingPeriodId: uuid(3200),
        periodLabel: "2026-Q1",
        scopeKind: "transformation",
        scopeId: TR_ID,
        valueBasis: "period",
        before: {
          evaluationId: null,
          kpiVersionId: null,
          value: null,
          valueStatus: "stale",
          rag: "stale",
          target: null,
        },
        after: { value: "12.500000", valueStatus: "ok", rag: "amber", target: "15" },
        difference: null,
        currency: null,
        unitKind: "count",
      },
    ],
  };
  it("a Stale side has no number; the decision refusal is translated and sends If-Match", async () => {
    const { requests } = mockApi(
      meRoute(lang),
      trRoute,
      route("GET", /\/kpi-restatements\/[^/]+\/reconciliation$/, ok(REC)),
      route("GET", /\/kpi-restatements\/[^/]+$/, ok(R())),
      route("POST", /\/decision$/, () => problem(403, "kpi_restatement.no_authority")),
    );
    renderApp(`/transformations/${TR_ID}/kpi-restatements/${uuid(3001)}`, { i18n: createI18n(lang) });
    const stale = await found("[data-value-status='stale']");
    expect(stale.textContent).toContain(L(lang).restatement.valueStatus.stale);
    expect(stale.textContent).not.toMatch(/\d/);
    expect(document.querySelector("[data-table='reconciliation']")!.getAttribute("data-retained")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: L(lang).restatement.recordDecision }));
    const alert = await found("[data-problem='kpi_restatement.no_authority']");
    expect(alert.textContent).toContain(catalogues[lang].problems.kpi_restatement__no_authority);
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ decision: "approve" });
    expect(post.headers["if-match"]).toBe('"2"');
  });
  it("the requester sees no decision form, only that it awaits a decision", async () => {
    mockApi(
      meRoute(lang),
      trRoute,
      route("GET", /\/kpi-restatements\/[^/]+\/reconciliation$/, ok(REC)),
      route("GET", /\/kpi-restatements\/[^/]+$/, ok(R({ requestedBy: USER_ID }))),
    );
    renderApp(`/transformations/${TR_ID}/kpi-restatements/${uuid(3001)}`, { i18n: createI18n(lang) });
    expect(await screen.findByText(L(lang).restatement.awaiting)).toBeTruthy();
    expect(screen.queryByRole("button", { name: L(lang).restatement.recordDecision })).toBeNull();
  });
});

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}

describe("ADR-0047 §8 and ADR-0048 §9 problem texts", () => {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const rows = new Map<string, string>();
  for (const n of ["0047", "0048"]) {
    const file = readdirSync(dir).find((f) => f.startsWith(`ADR-${n}-`))!;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      const m = /^\|\s*4\d\d\s*\|\s*`([a-z_][a-z0-9_.]*)`\s*\|\s*(.*?)\s*\|\s*$/.exec(line);
      if (m) rows.set(m[1]!, m[2]!.replace(/\s*\*\(DG4 code; new text, §3\)\*$/, ""));
    }
  }
  it("reads both tables", () => {
    expect(rows.size).toBeGreaterThanOrEqual(37);
  });
  it("every code has its exact English text and an Arabic text, in a catalogue without duplicate keys", () => {
    const en = catalogues.en.problems as unknown as Record<string, string>;
    const ar = catalogues.ar.problems as unknown as Record<string, string>;
    for (const [code, detail] of rows) {
      const k = code.replace(/\./g, "__");
      expect(en[k], code).toBe(detail);
      expect(ar[k], code).toMatch(/[؀-ۿ]/);
      expect(ar[k], code).not.toBe(en[k]);
    }
    for (const lang of ["en", "ar"] as const) {
      const raw = readFileSync(join(repoRoot(), "apps", "web", "src", "i18n", lang, "problems.json"), "utf8");
      const keys = [...raw.matchAll(/^ {2}"([^"]+)":/gm)].map((m) => m[1]!);
      expect(keys.length, lang).toBe(new Set(keys).size);
    }
  });
  it("translates the formula-preview source rule (KBE-F §5.5)", () => {
    for (const lang of ["en", "ar"] as const)
      expect(
        (catalogues[lang].problems as unknown as Record<string, string>)["validation__formula_preview_source"],
      ).toBeTruthy();
  });
});
