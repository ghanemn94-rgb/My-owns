// Prioritization (T06) screen, stubbed API, English LTR and Arabic RTL (T-DG3-FE-B; REQ-PB-047/048/049,
// REQ-S09-001/003/004/005). SYNTHETIC data.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problem, route } from "../../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  OTHER_USER,
  TR,
  USER_ID,
  V1,
  esc,
  grants,
  page,
  prioritizationView,
  proposedV2,
  renderWorkspace,
} from "./fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const P = `${TR}/prioritization`;
const ALL = ["prioritization.score", "prioritization.edit", "prioritization.approve"] as const;

const TEXT = {
  en: {
    incomplete: "incomplete",
    toggle: "Show the 0–100 view",
    label: "0–100 view = (weighted score − 1) ÷ 4 × 100",
    readOnly: "Read-only view",
    scoreRange: "Enter a whole number from 1 to 5.",
    total95: "Weights must total 100% (got 95.00%).",
    total105: "Weights must total 100% (got 105.00%).",
    ok: "The weights total exactly 100%.",
    propose: "Propose new weights",
    submitPropose: "Propose weights",
    rationale: /^Rationale/,
    weightOf: (c: string) => `Weight of ${c} (%)`,
    sf: "Strategic fit",
    approve2: "Approve version 2 (business approval)",
    approveConfirm: "Approve (business approval)",
    business: "Business approval",
    ownProposal: "You proposed this set; another person must approve it.",
    sod: "The person who proposed this cannot approve it (separation of duties).",
    conflict: "Someone else changed this record",
    weightV2: "weight version 2",
    scoreChange: "score change (Customer impact)",
    overrideCause: "override: Regulatory deadline",
    proposeOverride: "Propose an override",
    reason: /^Reason/,
    blank: /visible/i,
    tooLarge: "The prioritization view covers at most 500 initiatives. Narrow the portfolio before prioritizing.",
    scorecardOf: "Scorecard of INI-02",
    ttv: /^Time-to-value \(weight 15%\)/,
    save: "Save scores",
  },
  ar: {
    incomplete: "غير مكتمل",
    toggle: "إظهار عرض 0–100",
    label: "عرض 0–100 = (النتيجة المرجحة − 1) ÷ 4 × 100",
    readOnly: "عرض للقراءة فقط",
    scoreRange: "أدخل عددًا صحيحًا من 1 إلى 5.",
    total95: "يجب أن يكون مجموع الأوزان 100٪ (المجموع الحالي 95.00٪).",
    total105: "يجب أن يكون مجموع الأوزان 100٪ (المجموع الحالي 105.00٪).",
    ok: "مجموع الأوزان 100٪ تمامًا.",
    propose: "اقتراح أوزان جديدة",
    submitPropose: "اقتراح الأوزان",
    rationale: /^المبرر/,
    weightOf: (c: string) => `وزن ${c} (٪)`,
    sf: "الملاءمة الاستراتيجية",
    approve2: "اعتماد الإصدار 2 (موافقة أعمال)",
    approveConfirm: "اعتماد (موافقة أعمال)",
    business: "موافقة أعمال",
    ownProposal: "أنت من اقترح هذه المجموعة؛ يجب أن يعتمدها شخص آخر.",
    sod: "لا يمكن لمن اقترح هذا أن يعتمده (الفصل بين المهام).",
    conflict: "عدّل شخص آخر هذا السجل",
    weightV2: "إصدار الأوزان 2",
    scoreChange: "تغيّر الدرجات (الأثر على العملاء)",
    overrideCause: "تجاوز: Regulatory deadline",
    proposeOverride: "اقتراح تجاوز",
    reason: /^المبرر/,
    blank: /مرئي|مرئية|فراغ|نص/,
    tooLarge: "يغطي عرض ترتيب الأولويات 500 مبادرة على الأكثر. قلّص المحفظة قبل ترتيب الأولويات.",
    scorecardOf: "بطاقة تقييم INI-02",
    ttv: /^الوقت اللازم لتحقيق القيمة \(الوزن 15٪\)/,
    save: "حفظ الدرجات",
  },
} as const;

function handlers(over: { weightSets?: unknown[]; history?: unknown[]; overrides?: unknown[] } = {}) {
  return [
    route("GET", new RegExp(`${esc(P)}(\\?.*)?$`), () => ({ status: 200, body: prioritizationView() })),
    route("GET", new RegExp(`${esc(P)}/weight-sets$`), () => ({
      status: 200,
      body: { items: over.weightSets ?? [V1] },
    })),
    route("GET", new RegExp(`${esc(P)}/ranking-history`), () => page(over.history ?? [])),
    route("GET", new RegExp(`${esc(P)}/overrides`), () => page(over.overrides ?? [])),
    route("GET", new RegExp(`${esc(P)}/rankings(\\?.*)?$`), () => page([])),
  ];
}

describe.each(["en", "ar"] as const)("prioritization (%s)", (locale) => {
  const tx = TEXT[locale];

  it("ranked table: an incomplete score is 'incomplete' (never a number), 3.30 complete; 0–100 shows 57.5 with its label", async () => {
    renderWorkspace("prioritization", locale, grants([...ALL]), handlers());
    const table = await screen.findByRole("table", { name: /ranked|المرتّبة/i });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]!.textContent).toContain("INI-01");
    expect(rows[1]!.textContent).toContain("3.30");
    expect(rows[2]!.textContent).toContain("INI-02");
    expect(rows[2]!.textContent).toContain(tx.incomplete);
    expect(rows[2]!.textContent).not.toMatch(/\b0\.00\b/);
    expect(screen.queryByTestId("conversion-label")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tx.toggle }));
    expect(screen.getByRole("button", { name: tx.toggle }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("conversion-label").textContent).toBe(tx.label);
    const after = within(screen.getByRole("table", { name: /ranked|المرتّبة/i })).getAllByRole("row");
    expect(after[1]!.textContent).toContain("57.5");
    expect(after[2]!.textContent).toContain(tx.incomplete);
    // The comparison chart is an image with a text alternative and the same data as a table.
    expect(screen.getByRole("img").getAttribute("aria-label")).toBeTruthy();
    expect(within(screen.getByTestId("chart-table")).getAllByRole("row")).toHaveLength(3);
  });

  it("scorecard: 6 is refused inline and nothing is sent; 4 is POSTed as the integer; the weighted score is read-only 'incomplete'", async () => {
    const { api } = renderWorkspace("prioritization", locale, grants([...ALL]), [
      ...handlers(),
      route("GET", /\/api\/v1\/initiatives\/[^/]+\/scores$/, () => ({
        status: 200,
        body: {
          initiativeId: prioritizationView().items[1]!.initiative.id,
          scores: [],
          result: { ...prioritizationView().items[1]!.result },
        },
      })),
      route("POST", /\/api\/v1\/initiatives\/[^/]+\/scores$/, () => ({ status: 201, body: {} })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.scorecardOf }));
    const input = await screen.findByLabelText(tx.ttv);
    const out = screen.getByTestId("weighted-score");
    expect(out.textContent).toContain(tx.incomplete);
    expect(out.tagName).toBe("OUTPUT");
    fireEvent.change(input, { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: tx.save }));
    expect(await screen.findByText(tx.scoreRange)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(api.requests.some((r) => r.method !== "GET")).toBe(false);
    fireEvent.change(input, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: tx.save }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ criterionCode: "time_to_value", score: 4 });
    expect(post.body).not.toHaveProperty("weightedScore");
  });

  it("weight sets: the live total refuses 95% and 105%; 100% is accepted and POSTed as decimal strings", async () => {
    const { api } = renderWorkspace("prioritization", locale, grants([...ALL]), [
      ...handlers(),
      route("POST", new RegExp(`${esc(P)}/weight-sets$`), () => ({ status: 201, body: proposedV2(USER_ID) })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.propose }));
    const dialog = await screen.findByRole("dialog");
    const sf = within(dialog).getByLabelText(tx.weightOf(tx.sf));
    fireEvent.change(sf, { target: { value: "20" } });
    expect(within(dialog).getByTestId("weights-total").textContent).toContain(tx.total95);
    expect(within(dialog).getByTestId("weights-total").getAttribute("data-valid")).toBe("false");
    fireEvent.change(within(dialog).getByLabelText(tx.rationale), { target: { value: "Context" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.submitPropose }));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(sf, { target: { value: "30" } });
    expect(within(dialog).getByTestId("weights-total").textContent).toContain(tx.total105);
    fireEvent.change(sf, { target: { value: "25" } });
    expect(within(dialog).getByTestId("weights-total").textContent).toContain(tx.ok);
    fireEvent.click(within(dialog).getByRole("button", { name: tx.submitPropose }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const body = api.requests.find((r) => r.method === "POST")!.body as { weights: { weightPercent: unknown }[] };
    expect(body.weights.every((w) => typeof w.weightPercent === "string")).toBe(true);
    expect(body.weights[0]).toEqual({ criterionCode: "strategic_fit", weightPercent: "25" });
  });

  it("weight sets: the proposer is never offered approval; another approver's approval is a business approval with If-Match; 403 SoD is translated", async () => {
    const { api } = renderWorkspace("prioritization", locale, grants([...ALL]), [
      ...handlers({ weightSets: [V1, proposedV2(OTHER_USER)] }),
      route("POST", /weight-sets\/2\/approve$/, () => problem(403, "approval.approver_is_proposer")),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.approve2 }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(tx.business)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: tx.approveConfirm }));
    expect(await within(dialog).findByText(tx.sod)).toBeTruthy();
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"4"');
    expect(post.body).toEqual({});
    cleanup();
    renderWorkspace("prioritization", locale, grants([...ALL]), handlers({ weightSets: [V1, proposedV2(USER_ID)] }));
    expect(await screen.findByText(tx.ownProposal)).toBeTruthy();
    expect(screen.queryByRole("button", { name: tx.approve2 })).toBeNull();
  });

  it("weight set approval: a 409 shows the conflict banner and reloads", async () => {
    const { api } = renderWorkspace("prioritization", locale, grants([...ALL]), [
      ...handlers({ weightSets: [V1, proposedV2(OTHER_USER)] }),
      route("POST", /weight-sets\/2\/approve$/, () => problem(409, "version_conflict", { currentVersion: 5 })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.approve2 }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: tx.approveConfirm }));
    expect(await screen.findByText(tx.conflict)).toBeTruthy();
    await waitFor(() =>
      expect(api.requests.filter((r) => r.method === "GET" && /weight-sets$/.test(r.url)).length).toBeGreaterThan(1),
    );
  });

  it("ranking history: causes are translated from codes, including 'weight version 2', score change and the override reason", async () => {
    const OV = "01920000-0000-7000-a100-000000000001";
    const entry = (causes: string[], causeDetail: Record<string, unknown>, overrideId: string | null = null) => ({
      snapshotNo: 2,
      proposedAt: "2026-10-05T08:00:00Z",
      entry: {
        initiativeId: prioritizationView().items[0]!.initiative.id,
        rank: 1,
        previousRank: 2,
        weightedScore: "3.3000",
        completeness: "complete",
        causes,
        causeLabels: ["ENGLISH SERVER LABEL"],
        causeDetail,
        overrideId,
      },
    });
    renderWorkspace(
      "prioritization",
      locale,
      grants([...ALL]),
      handlers({
        history: [
          entry(["weight"], { weightSetVersionNo: 2, previousWeightSetVersionNo: 1 }),
          entry(["score"], { changedCriteria: ["customer_impact"] }),
          entry(["override"], { overrideId: OV }, OV),
        ],
        overrides: [
          {
            id: OV,
            organizationId: "x",
            transformationId: "x",
            initiativeId: prioritizationView().items[0]!.initiative.id,
            overrideRank: 1,
            reason: "Regulatory deadline",
            status: "approved",
            proposedBy: OTHER_USER,
            decidedBy: USER_ID,
            decidedAt: null,
            decisionNote: null,
            revokedBy: null,
            revokedAt: null,
            revokeReason: null,
            version: 2,
            createdAt: "2026-10-01T08:00:00Z",
            createdBy: OTHER_USER,
            updatedAt: "2026-10-01T08:00:00Z",
            updatedBy: OTHER_USER,
          },
        ],
      }),
    );
    const hist = await screen.findByTestId("ranking-history");
    expect(hist.textContent).toContain(tx.weightV2);
    expect(hist.textContent).toContain(tx.scoreChange);
    expect(hist.textContent).toContain(tx.overrideCause);
    expect(hist.textContent).not.toContain("ENGLISH SERVER LABEL");
  });

  it("overrides: a reason is required (missing and invisible-only are refused, nothing sent); with a reason it is POSTed", async () => {
    const { api } = renderWorkspace("prioritization", locale, grants([...ALL]), [
      ...handlers(),
      route("POST", new RegExp(`${esc(P)}/overrides$`), () => ({ status: 201, body: {} })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.proposeOverride }));
    const dialog = await screen.findByRole("dialog");
    const selects = within(dialog).getAllByRole("combobox");
    fireEvent.change(selects[0]!, { target: { value: prioritizationView().items[1]!.initiative.id } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /rank|الترتيب/i }), { target: { value: "1" } });
    const confirm = within(dialog).getAllByRole("button").at(-1)!;
    fireEvent.click(confirm);
    const reason = within(dialog).getByLabelText(tx.reason);
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.change(reason, { target: { value: "‏ ‏" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(reason, { target: { value: "Regulatory deadline" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    expect(api.requests.find((r) => r.method === "POST")!.body).toEqual({
      initiativeId: prioritizationView().items[1]!.initiative.id,
      overrideRank: 1,
      reason: "Regulatory deadline",
    });
  });

  it("the read-only auditor sees the data and no enabled write control", async () => {
    renderWorkspace("prioritization", locale, AUDITOR_GRANTS, handlers({ weightSets: [V1, proposedV2(OTHER_USER)] }));
    await screen.findByRole("table", { name: /ranked|المرتّبة/i });
    expect(document.querySelector("[data-state='read-only']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: tx.propose })).toBeNull();
    expect(screen.queryByRole("button", { name: tx.approve2 })).toBeNull();
    expect(screen.queryByRole("button", { name: tx.proposeOverride })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: tx.scorecardOf }));
    expect(screen.queryByRole("button", { name: tx.save })).toBeNull();
  });

  it("a portfolio above 500 eligible initiatives is the translated 422 state, not an empty table", async () => {
    renderWorkspace("prioritization", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(P)}(\\?.*)?$`), () => problem(422, "prioritization.portfolio_too_large")),
      ...handlers(),
    ]);
    const state = await waitFor(() => {
      const el = document.querySelector("[data-state='too-large']");
      if (!el) throw new Error("not yet");
      return el;
    });
    expect(state.textContent).toContain(tx.tooLarge);
    expect(screen.queryByRole("table", { name: /ranked|المرتّبة/i })).toBeNull();
  });

  it("never mentions a delivery gate (DG0–DG7)", async () => {
    renderWorkspace("prioritization", locale, grants([...ALL]), handlers());
    await screen.findByRole("table", { name: /ranked|المرتّبة/i });
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });
});
