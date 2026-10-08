// P2 screens against a scripted API in the contract's shapes (SYNTHETIC data; docs/api/openapi.yaml):
//  - Diagnose: the six T01 dimensions with Unknown for missing values; "Unquantified" value pools never shown as 0;
//    "partial: N unquantified" totals; exact decimal formatting;
//  - Define: the good outcome test per outcome with pass / fail / unknown and localized reasons; the T02 target date
//    is required before anything is sent;
//  - Charter: 14 fields, thesis, five scope checks with pre-checks, 3-5 top-outcomes warning, version diff;
//  - Design: ten canvas boxes and the per-dimension view; workshop conversion with If-Match;
//  - Decisions: GET /decisions?kind=design, D-codes, options A/B/C, Open status; create with inline options;
//  - Gates: labelled business approval (never DG0-DG7), unverified evidence shown as such, failing good-outcome
//    outcomes at G2, submit with If-Match, 422/403/409 problems translated;
//  - Evidence: octet-stream upload with a percent-encoded X-File-Name and If-Match; review never offered to the creator;
//  - read-only auditor (AUD): no write control on any P2 screen (including Team), and a read-only note;
//  - English LTR and Arabic RTL.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/index.ts";
import {
  BUSINESS_UNIT,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type Handler,
} from "../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  METHODOLOGY,
  OTHER_USER,
  baseline,
  canvasCell,
  charterView,
  decision,
  diagnosticItem,
  evidence,
  gateViews,
  leadGrants,
  outcome,
  valuePool,
} from "../test/p2fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** GET {TR}/{resource} (list, any query). */
const list = (resource: string, items: unknown[]): Handler =>
  route("GET", new RegExp(`${esc(TR)}/${resource}(\\?|$)`), () => page(items));

/** The frame every P2 screen needs: session, business units, the transformation, the catalogue, an empty team. */
function base(grants: ReturnType<typeof leadGrants> | typeof AUDITOR_GRANTS, locale: "ar" | "en" = "en"): Handler[] {
  return [
    route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(grants, { preferredLocale: locale }) })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({
      status: 200,
      body: makeTransformation({ currentPhase: "diagnose", entryPhase: null }),
    })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    list("scoped-assignments", []),
  ];
}
/** Anything else that lists a register answers an empty page (never a fabricated 0 total). */
const emptyRegisters: Handler = (req) =>
  req.method === "GET" &&
  /\/api\/v1\/(transformations\/[^/]+\/[a-z-]+(\/[^/]+\/[a-z-]+)?|decisions)(\?|$)/.test(req.url) &&
  !/\/(tom-canvas|gates|charter|north-star|methodology)(\?|$)/.test(req.url)
    ? page([])
    : undefined;

function render(path: string, handlers: Handler[], locale: "ar" | "en" = "en") {
  const api = mockApi(...handlers, emptyRegisters);
  const utils = renderApp(path, { i18n: createI18n(locale) });
  return { ...api, ...utils };
}

// ------------------------------------------------------------------------------------------------ Diagnose

describe("Diagnose", () => {
  it("shows the six T01 dimensions with Unknown for missing values, and value pools that are never 0", async () => {
    const items = METHODOLOGY.diagnosticDimensions.map((d, i) =>
      diagnosticItem(
        d.code,
        i === 0
          ? {
              currentState: "Synthetic manual billing",
              impactAmount: "1234567.8900",
              impactCurrency: "SAR",
              confidence: "H",
            }
          : {},
      ),
    );
    render(`/transformations/${TR_ID}/diagnose`, [
      ...base(leadGrants()),
      list("diagnostic-items", items),
      list("value-pools", [
        valuePool({
          name: "Quantified pool",
          quantificationStatus: "quantified",
          downsideAmount: "100.1000",
          upsideAmount: "200.2000",
          unquantifiedReason: null,
        }),
        valuePool({ name: "Unsized pool" }),
      ]),
    ]);
    const t01 = await screen.findByRole("region", { name: "Current-State Diagnostic (T01)" });
    const table = await within(t01).findByRole("table");
    // Six dimension rows (row headers), in catalogue order.
    const rowHeaders = within(table)
      .getAllByRole("rowheader")
      .map((h) => h.textContent);
    expect(rowHeaders).toEqual(METHODOLOGY.diagnosticDimensions.map((d) => d.labelEn));
    expect(within(table).getByText("SAR 1,234,567.89")).toBeTruthy();
    expect(within(table).getByText("High (H)")).toBeTruthy();
    // Missing current state / confidence on the other rows are Unknown, never blank or 0.
    expect(within(table).getAllByText("Unknown").length).toBeGreaterThanOrEqual(10);

    const pools = screen.getByRole("region", { name: "Value pools" });
    expect(await within(pools).findByText("Unsized pool")).toBeTruthy();
    expect(within(pools).getAllByText("Unquantified").length).toBeGreaterThanOrEqual(1);
    expect(within(pools).getByText("Partial: 1 unquantified")).toBeTruthy();
    // Exact decimal sum of the quantified pool only (100.1 / 200.2), labelled per currency.
    const total = pools.querySelector("[data-total-currency='SAR']")!;
    expect(total.textContent).toContain("SAR 100.1");
    expect(total.textContent).toContain("SAR 200.2");
    // The unquantified pool is never rendered as an amount of 0.
    const unsizedRow = within(pools).getByText("Unsized pool").closest("tr")!;
    expect(unsizedRow.textContent).not.toMatch(/SAR\s*0(\.|\b)/);
  });

  it("shows the totals as Unknown when no pool is quantified", async () => {
    render(`/transformations/${TR_ID}/diagnose`, [
      ...base(leadGrants()),
      list("value-pools", [valuePool(), valuePool({ name: "Second" })]),
    ]);
    const pools = await screen.findByRole("region", { name: "Value pools" });
    expect(await within(pools).findByText("Partial: 2 unquantified")).toBeTruthy();
    const total = pools.querySelector("[data-total-currency='SAR']")!;
    expect(total.textContent).toContain("Unknown");
    expect(total.textContent).not.toMatch(/SAR\s*0/);
  });

  it("renders the six workstreams with their key questions", async () => {
    render(`/transformations/${TR_ID}/diagnose`, base(leadGrants()));
    const ws = await screen.findByRole("region", { name: "Diagnose workstreams" });
    for (const w of METHODOLOGY.diagnosticWorkstreams) {
      expect(await within(ws).findByRole("heading", { name: w.sourceNameEn })).toBeTruthy();
      expect(within(ws).getByText(w.sourceKeyQuestionsEn)).toBeTruthy();
    }
  });

  it("edits a T01 row with only the changed fields and If-Match", async () => {
    const item = diagnosticItem("financial");
    const { requests } = render(`/transformations/${TR_ID}/diagnose`, [
      ...base(leadGrants()),
      list("diagnostic-items", [item]),
      route("PATCH", /\/diagnostic-items\//, (req) => ({
        status: 200,
        body: { ...item, ...(req.body as object), version: 2 },
      })),
    ]);
    const t01 = await screen.findByRole("region", { name: "Current-State Diagnostic (T01)" });
    fireEvent.click(await within(t01).findByRole("button", { name: /^Edit: Financial dimension$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Root cause"), { target: { value: "Synthetic root cause" } });
    fireEvent.change(within(dialog).getByLabelText("Confidence"), { target: { value: "M" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ rootCause: "Synthetic root cause", confidence: "M" });
    expect(patch.headers["if-match"]).toBe('"1"');
    expect(patch.headers["x-csrf-token"]).toBe("c".repeat(43));
  });

  it("a 409 on save writes nothing, compares, and re-applies on the current version", async () => {
    const item = diagnosticItem("financial", { rootCause: "Mine was this" });
    const theirs = { ...item, version: 2, rootCause: "Changed by someone else", currentState: "Theirs" };
    let patches = 0;
    const { requests } = render(`/transformations/${TR_ID}/diagnose`, [
      ...base(leadGrants()),
      list("diagnostic-items", [item]),
      route("GET", /\/diagnostic-items\/[^/?]+$/, () => ({ status: 200, body: theirs })),
      route("PATCH", /\/diagnostic-items\//, (req) =>
        ++patches === 1
          ? problem(409, "version_conflict", { currentVersion: 2 })
          : { status: 200, body: { ...theirs, ...(req.body as object), version: 3 } },
      ),
    ]);
    const t01 = await screen.findByRole("region", { name: "Current-State Diagnostic (T01)" });
    fireEvent.click(await within(t01).findByRole("button", { name: /^Edit: Financial dimension$/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Root cause"), { target: { value: "My root cause" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    const conflict = await within(dialog).findByRole("alert");
    expect(conflict.dataset["state"]).toBe("conflict");
    expect(conflict.textContent).toContain("Changed by someone else");
    fireEvent.click(within(conflict).getByRole("button", { name: "Re-apply my change on the current version" }));
    await waitFor(() => expect(patches).toBe(2));
    const second = requests.filter((r) => r.method === "PATCH")[1]!;
    expect(second.headers["if-match"]).toBe('"2"');
    expect(second.body).toEqual({ rootCause: "My root cause" });
  });

  // F-DG2-150 (T-DG2-BE5): blank free text is never content. The form sends spaces-only input as null (it clears the
  // field), and the shared schema rejects whitespace-only text client-side; a server 400 `validation.blank` lands on
  // its field as a localized message in EN and AR.
  it.each([
    { locale: "en" as const, edit: /^Edit/, rootCause: "Root cause", save: "Save draft" },
    { locale: "ar" as const, edit: /^تعديل/, rootCause: "السبب الجذري", save: "حفظ كمسودة" },
  ])("a 400 validation.blank shows a localized message on its field ($locale)", async ({ locale, ...l }) => {
    const item = diagnosticItem("financial");
    render(
      `/transformations/${TR_ID}/diagnose`,
      [
        ...base(leadGrants(), locale),
        list("diagnostic-items", [item]),
        route("PATCH", /\/diagnostic-items\//, () =>
          problem(400, "validation", {
            errors: [{ pointer: "/rootCause", code: "validation.blank", message: "validation.blank" }],
          }),
        ),
      ],
      locale,
    );
    const edit = await screen.findAllByRole("button", { name: l.edit });
    fireEvent.click(edit[0]!);
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(l.rootCause);
    fireEvent.change(field, { target: { value: "Synthetic root cause" } });
    fireEvent.click(within(dialog).getByRole("button", { name: l.save }));
    const expected = createI18n(locale).t("problems.validation__blank");
    expect(expected).not.toBe("problems.validation__blank");
    await waitFor(() => expect(within(dialog).getByText(expected)).toBeTruthy());
    expect(field.getAttribute("aria-invalid")).toBe("true");
  });

  // F-DG2-160 (T-DG2-BE6): invisible-only input (an RLM, a word joiner, U+0085) is caught client-side by the shared
  // schema (`hasVisibleContent`): no request is sent and the field shows the localized `validation.blank` message.
  it.each([
    { locale: "en" as const, edit: /^Edit/, rootCause: "Root cause", save: "Save draft", value: "\u200f" },
    {
      locale: "ar" as const,
      edit: /^تعديل/,
      rootCause: "السبب الجذري",
      save: "حفظ كمسودة",
      value: "\u2060\u2060\u0085",
    },
  ])("an invisible-only value is blocked client-side with validation.blank ($locale)", async ({ locale, ...l }) => {
    const item = diagnosticItem("financial");
    const { requests } = render(
      `/transformations/${TR_ID}/diagnose`,
      [
        ...base(leadGrants(), locale),
        list("diagnostic-items", [item]),
        route("PATCH", /\/diagnostic-items\//, () => ({ status: 200, body: item })),
      ],
      locale,
    );
    const edit = await screen.findAllByRole("button", { name: l.edit });
    fireEvent.click(edit[0]!);
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(l.rootCause);
    fireEvent.change(field, { target: { value: l.value } });
    fireEvent.click(within(dialog).getByRole("button", { name: l.save }));
    const expected = createI18n(locale).t("problems.validation__blank");
    await waitFor(() => expect(within(dialog).getByText(expected)).toBeTruthy());
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  // F-DG2-210: whitespace-only text is no longer turned into null by the form. It is an inline `validation.blank` error
  // (EN and AR), with aria-invalid/aria-describedby, focus on the field and NO request.
  it.each([
    { locale: "en" as const, edit: /^Edit/, field: "Current state", save: "Save draft" },
    { locale: "ar" as const, edit: /^تعديل/, field: "الوضع الراهن", save: "حفظ كمسودة" },
  ])("a whitespace-only T01 value is an inline blank error and sends nothing ($locale)", async ({ locale, ...l }) => {
    const item = diagnosticItem("financial", { currentState: "Synthetic current state" });
    const { requests } = render(
      `/transformations/${TR_ID}/diagnose`,
      [
        ...base(leadGrants(), locale),
        list("diagnostic-items", [item]),
        route("PATCH", /\/diagnostic-items\//, () => ({ status: 200, body: item })),
      ],
      locale,
    );
    fireEvent.click((await screen.findAllByRole("button", { name: l.edit }))[0]!);
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByLabelText(l.field);
    fireEvent.change(field, { target: { value: "   \t " } });
    fireEvent.click(within(dialog).getByRole("button", { name: l.save }));
    const expected = createI18n(locale).t("problems.validation__blank");
    await waitFor(() => expect(within(dialog).getByText(expected)).toBeTruthy());
    expect(field.getAttribute("aria-invalid")).toBe("true");
    const describedBy = field.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain(expected);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    // The "no changes" banner is not what the user sees: the change exists and is invalid.
    expect(within(dialog).queryByText(createI18n(locale).t("problems.validation__empty_update"))).toBeNull();
  });

  it("T01: an emptied field is sent as an explicit null; visible text is sent verbatim", async () => {
    const item = diagnosticItem("financial", { currentState: "Synthetic current state" });
    const { requests } = render(`/transformations/${TR_ID}/diagnose`, [
      ...base(leadGrants()),
      list("diagnostic-items", [item]),
      route("PATCH", /\/diagnostic-items\//, (req) => ({
        status: 200,
        body: { ...item, ...(req.body as object), version: 2 },
      })),
    ]);
    fireEvent.click((await screen.findAllByRole("button", { name: /^Edit/ }))[0]!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Current state"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Root cause"), { target: { value: "  Synthetic cause\u200f  " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({
      currentState: null,
      rootCause: "  Synthetic cause\u200f  ",
    });
  });

  it("Arabic: RTL with Arabic labels and the unquantified label", async () => {
    render(
      `/transformations/${TR_ID}/diagnose`,
      [...base(leadGrants(), "ar"), list("value-pools", [valuePool()])],
      "ar",
    );
    expect(await screen.findByRole("heading", { level: 1, name: "التشخيص" })).toBeTruthy();
    expect(document.documentElement.dir).toBe("rtl");
    const pools = await screen.findByRole("region", { name: "مجمّعات القيمة" });
    expect((await within(pools).findAllByText("غير مُقدَّر كمّياً")).length).toBeGreaterThan(0);
    expect(within(pools).getByText("جزئي: 1 غير مُقدَّر كمّياً")).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ Define

describe("Define", () => {
  it("shows the good outcome test per outcome with pass / fail / unknown and localized reasons", async () => {
    const failing = outcome({
      statement: "Launch the new app",
      goodOutcomePass: false,
      goodOutcomeTest: [
        { criterionCode: "specific", ordinal: 1, result: "fail", reason: "English server text" },
        { criterionCode: "measurable", ordinal: 2, result: "fail", reason: "x" },
        { criterionCode: "strategically_relevant", ordinal: 3, result: "unknown", reason: "x" },
        { criterionCode: "owned_by_business_leader", ordinal: 4, result: "fail", reason: "x" },
        { criterionCode: "causal_chain", ordinal: 5, result: "unknown", reason: "x" },
      ],
    });
    const passing = outcome({
      statement: "Synthetic churn below target",
      ownerUserId: USER_ID,
      goodOutcomePass: true,
      goodOutcomeTest: [
        "specific",
        "measurable",
        "strategically_relevant",
        "owned_by_business_leader",
        "causal_chain",
      ].map((c, i) => ({
        criterionCode: c,
        ordinal: i + 1,
        result: "pass" as const,
        reason: "x",
      })),
    });
    render(`/transformations/${TR_ID}/define`, [
      ...base(leadGrants()),
      list("outcomes", [failing, passing]),
      route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
    ]);
    const bad = await screen.findByRole("table", { name: "Good outcome test of “Launch the new app”" });
    expect(within(bad).getByText(/describes an activity/)).toBeTruthy();
    expect(within(bad).getByText("No owner set: the outcome is not owned by a business leader.")).toBeTruthy();
    expect(within(bad).getAllByText("Fail")).toHaveLength(3);
    expect(within(bad).getAllByText("Unknown")).toHaveLength(2);
    // The server's English reason text is never shown as the user-facing message.
    expect(bad.textContent).not.toContain("English server text");
    expect(screen.getByText("Does not pass: 3 failing, 2 unknown")).toBeTruthy();
    const good = screen.getByRole("table", { name: "Good outcome test of “Synthetic churn below target”" });
    expect(within(good).getAllByText("Pass")).toHaveLength(5);
    expect(screen.getByText("Passes")).toBeTruthy();
    // Two top outcomes: the 3-5 warning is shown.
    expect(screen.getByText("2 top outcomes: the charter should name 3 to 5 top outcomes.")).toBeTruthy();
    // North Star not set: an explicit empty state, never a blank.
    expect(screen.getByText("No North Star set")).toBeTruthy();
  });

  it("requires a target date on a T02 row before sending anything", async () => {
    const o = outcome();
    const kpi = {
      id: "01920000-0000-7000-c000-000000000001",
      organizationId: o.organizationId,
      transformationId: TR_ID,
      name: "Synthetic churn",
      description: null,
      businessPurpose: null,
      unitKind: "percentage",
      unitLabel: "%",
      currency: null,
      polarity: "lower_is_better",
      frequency: "monthly",
      isLeading: false,
      dataSource: null,
      ownerUserId: null,
      stewardUserId: null,
      status: "active",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      version: 1,
      createdAt: o.createdAt,
      createdBy: USER_ID,
      updatedAt: o.updatedAt,
      updatedBy: USER_ID,
    };
    const { requests } = render(`/transformations/${TR_ID}/define`, [
      ...base(leadGrants()),
      list("outcomes", [o]),
      list("kpi-definitions", [kpi]),
      route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
    ]);
    const t02 = await screen.findByRole("region", { name: "Outcome & KPI Tree (T02)" });
    const add = await within(t02).findByRole("button", { name: "Add T02 row" });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Outcome/), { target: { value: o.id } });
    fireEvent.change(within(dialog).getByLabelText(/^KPI/), { target: { value: kpi.id } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    const date = within(dialog).getByLabelText(/^Target date/);
    await waitFor(() => expect(date.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("sets the North Star with one sentence and no If-Match the first time", async () => {
    const { requests } = render(`/transformations/${TR_ID}/define`, [
      ...base(leadGrants()),
      route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
      route("PUT", /\/north-star$/, (req) => ({
        status: 200,
        body: {
          id: "01920000-0000-7000-d000-000000000001",
          organizationId: "x",
          transformationId: TR_ID,
          statement: (req.body as { statement: string }).statement,
          status: "current",
          supersededAt: null,
          version: 1,
          createdAt: "2026-09-30T09:00:00Z",
          createdBy: USER_ID,
          updatedAt: "2026-09-30T09:00:00Z",
          updatedBy: USER_ID,
        },
      })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Set North Star" }));
    const input = screen.getByLabelText(/^North Star statement/);
    fireEvent.change(input, { target: { value: "First sentence. Second sentence." } });
    fireEvent.click(screen.getByRole("button", { name: "Save North Star" }));
    expect(await screen.findByText("Use one sentence.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "Every synthetic customer onboarded in one day." } });
    fireEvent.click(screen.getByRole("button", { name: "Save North Star" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    const put = requests.find((r) => r.method === "PUT")!;
    expect(put.headers["if-match"]).toBeUndefined();
  });
});

describe("Define: KPI activation (F-DG2-201)", () => {
  const draftKpi = (over: Record<string, unknown> = {}) => ({
    id: "01920000-0000-7000-c000-000000000009",
    organizationId: outcome().organizationId,
    transformationId: TR_ID,
    name: "Synthetic first-time-right rate",
    description: null,
    businessPurpose: null,
    unitKind: "percentage",
    unitLabel: "%",
    currency: null,
    polarity: "higher_is_better",
    frequency: "monthly",
    isLeading: false,
    dataSource: null,
    ownerUserId: USER_ID,
    stewardUserId: null,
    status: "draft",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 3,
    createdAt: "2026-09-30T09:00:00Z",
    createdBy: USER_ID,
    updatedAt: "2026-09-30T09:00:00Z",
    updatedBy: USER_ID,
    ...over,
  });

  it("offers Activate on a draft KPI, states the unmet precondition on 422, then activates with If-Match", async () => {
    let answer: "refuse" | "ok" = "refuse";
    let current = draftKpi();
    const { requests } = render(`/transformations/${TR_ID}/define`, [
      ...base(leadGrants()),
      route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
      route("GET", new RegExp(`${esc(TR)}/kpi-definitions(\\?|$)`), () => page([current])),
      route("POST", /\/kpi-definitions\/[^/]+\/activate$/, () => {
        if (answer === "refuse")
          return problem(422, "kpi_definition.not_measurable", {
            errors: [{ pointer: "/polarity", code: "kpi_definition.not_measurable", message: "x" }],
          });
        current = draftKpi({ status: "active", version: 4 });
        return { status: 200, body: current };
      }),
    ]);
    const dict = await screen.findByRole("region", { name: "KPI definitions" });
    const row = (await within(dict).findByRole("rowheader", { name: "Synthetic first-time-right rate" })).closest(
      "tr",
    )!;
    expect(within(row).getByText("Draft – not submitted")).toBeTruthy();
    fireEvent.click(within(row).getByRole("button", { name: /^Activate/ }));
    const dialog = await screen.findByRole("dialog", { name: "Activate KPI: Synthetic first-time-right rate" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate KPI" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("This KPI is not measurable yet, so it cannot be activated.");
    expect(alert.textContent).toContain("Not activated: the KPI has no polarity.");
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/activate"))!;
    expect(post.headers["if-match"]).toBe('"3"');
    expect(post.body).toBeUndefined();
    answer = "ok";
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate KPI" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(within(dict).getByText("Active")).toBeTruthy());
    expect(within(dict).queryByRole("button", { name: /^Activate/ })).toBeNull();
  });

  it("Arabic: the Activate action and the 422 reason are in Arabic", async () => {
    render(
      `/transformations/${TR_ID}/define`,
      [
        ...base(leadGrants(), "ar"),
        route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
        list("kpi-definitions", [draftKpi({ unitKind: "other", unitLabel: null, polarity: "within_band" })]),
        route("POST", /\/activate$/, () =>
          problem(422, "kpi_definition.not_measurable", {
            errors: [{ pointer: "/unitLabel", code: "kpi_definition.not_measurable", message: "x" }],
          }),
        ),
      ],
      "ar",
    );
    const activate = await screen.findByRole("button", { name: /^تفعيل/ });
    expect(document.documentElement.dir).toBe("rtl");
    fireEvent.click(activate);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "تفعيل المؤشر" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("تسمية الوحدة");
  });

  it("an active KPI shows Active and offers no Activate", async () => {
    render(`/transformations/${TR_ID}/define`, [
      ...base(leadGrants()),
      route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
      list("kpi-definitions", [draftKpi({ status: "active" })]),
    ]);
    const dict = await screen.findByRole("region", { name: "KPI definitions" });
    await within(dict).findByText("Active");
    expect(within(dict).queryByRole("button", { name: /^Activate/ })).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ Charter

describe("Charter", () => {
  it("shows the 14 fields, the thesis, the five scope checks with pre-checks and the top-outcomes warning", async () => {
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: charterView({}, [outcome()]) })),
      list("charter/versions", []),
    ]);
    const fields = await screen.findByRole("region", { name: "Charter fields (14)" });
    expect(fields.querySelectorAll("li.charter-field")).toHaveLength(14);
    expect(within(fields).getByText("Synthetic case for change")).toBeTruthy();
    expect(within(fields).getByText("18 months")).toBeTruthy();
    expect(screen.getByText("1 top outcomes: the charter should name 3 to 5 top outcomes.")).toBeTruthy();
    const thesis = screen.getByRole("region", { name: "Transformation thesis" });
    expect(within(thesis).getByText("the retail onboarding")).toBeTruthy();
    const scope = screen.getByRole("region", { name: "Scope sanity checks" });
    expect(within(scope).getAllByRole("row")).toHaveLength(6);
    expect(within(scope).getByText("Scope question 1?")).toBeTruthy();
    expect(within(scope).getByText("No baseline has a value, a source and a date.")).toBeTruthy();
    expect(within(scope).getByText("Open decisions have a named owner.")).toBeTruthy();
  });

  // F-DG2-150 (REQ-PB-031 / B0041): no explicit exclusions is a FAILING pre-check: a non-passing chip (never the green
  // pass chip, never the grey Unknown chip) and a detail that says the check fails, in EN and AR.
  it("scope pre-check: an empty Out of scope reads as failing (EN and AR)", async () => {
    const handlers = (locale: "ar" | "en", outOfScope: string | null) => [
      ...base(leadGrants(), locale),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: charterView({ outOfScope }, []) })),
      list("charter/versions", []),
    ];
    const expectFailing = (row: HTMLElement, chipText: string, detail: string) => {
      const chip = row.querySelector<HTMLElement>("[data-result]")!;
      expect(chip.dataset["result"]).toBe("attention");
      expect(chip.className).toContain("status-chip--at-risk");
      expect(chip.className).not.toMatch(/status-chip--(on-track|unknown)/);
      expect(chip.querySelector("svg")).toBeTruthy();
      expect(chip.textContent!.trim()).toBe(chipText);
      expect(within(row).getByText(detail)).toBeTruthy();
    };

    for (const empty of [null, "   "]) {
      render(`/transformations/${TR_ID}/charter`, handlers("en", empty));
      const scope = await screen.findByRole("region", { name: "Scope sanity checks" });
      const row = scope.querySelector<HTMLElement>("[data-scope-check='exclusions_documented']")!;
      expectFailing(
        row,
        "Not supported by data",
        "No explicit exclusions (out of scope) are documented, so this check fails.",
      );
      expect(row.textContent).not.toContain("Check the documented exclusions.");
      cleanup();
    }

    render(`/transformations/${TR_ID}/charter`, handlers("ar", null), "ar");
    const ar = await screen.findByRole("region", { name: "فحوص معقولية النطاق" });
    expectFailing(
      ar.querySelector<HTMLElement>("[data-scope-check='exclusions_documented']")!,
      "لا تدعمه البيانات",
      "لا توجد استثناءات صريحة (خارج النطاق) موثّقة؛ لذلك يفشل هذا الفحص.",
    );
    cleanup();

    // Documented exclusions pass.
    render(`/transformations/${TR_ID}/charter`, handlers("en", "Synthetic: enterprise billing"));
    const ok = await screen.findByRole("region", { name: "Scope sanity checks" });
    const okRow = ok.querySelector<HTMLElement>("[data-scope-check='exclusions_documented']")!;
    expect(okRow.querySelector<HTMLElement>("[data-result]")!.dataset["result"]).toBe("pass");
    expect(within(okRow).getByText("Explicit exclusions (out of scope) are documented.")).toBeTruthy();
  });

  it("thesis: an empty part is Incomplete and no sentence is composed (F-DG2-203)", async () => {
    const view = charterView({}, [outcome()]);
    view.warnings.push(
      ...["thesisOutcomes", "thesisBenefits", "thesisBecause"].map((p) => ({
        code: "charter.thesis_incomplete",
        message: "x",
        pointer: `/charter/${p}`,
      })),
    );
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: view })),
      list("charter/versions", []),
    ]);
    const thesis = await screen.findByRole("region", { name: "Transformation thesis" });
    expect(thesis.querySelector("[data-thesis='incomplete']")).toBeTruthy();
    expect(thesis.querySelector("[data-thesis-sentence]")).toBeNull();
    expect(within(thesis).getByText(/empty parts 3 of 4/)).toBeTruthy();
    expect(thesis.querySelector("[data-thesis-part='thesisChange']")!.getAttribute("data-part-state")).toBe("complete");
    for (const p of ["thesisOutcomes", "thesisBenefits", "thesisBecause"]) {
      const part = thesis.querySelector(`[data-thesis-part='${p}']`)!;
      expect(part.getAttribute("data-part-state")).toBe("incomplete");
      expect(part.textContent).toContain("Incomplete – not stated yet");
      expect(part.textContent).not.toContain("None");
    }
    expect(
      screen.getByText("The transformation thesis is incomplete: “because (evidence / causal logic)” is empty."),
    ).toBeTruthy();
  });

  it("thesis: a part the API flags incomplete is never shown as answered", async () => {
    const view = charterView({
      thesisOutcomes: "first-time-right bills",
      thesisBenefits: "lower cost to serve",
      thesisBecause: "rework drives cost",
    });
    view.warnings.push({ code: "charter.thesis_incomplete", message: "x", pointer: "/charter/thesisBecause" });
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: view })),
      list("charter/versions", []),
    ]);
    const thesis = await screen.findByRole("region", { name: "Transformation thesis" });
    expect(thesis.querySelector("[data-thesis='incomplete']")).toBeTruthy();
    expect(thesis.querySelector("[data-thesis-part='thesisBecause']")!.getAttribute("data-part-state")).toBe(
      "incomplete",
    );
  });

  it("thesis: the four parts compose the B0037 sentence (EN and AR)", async () => {
    const over = {
      thesisChange: "the retail onboarding journey",
      thesisOutcomes: "first-time-right bills",
      thesisBenefits: "lower cost to serve.",
      thesisBecause: "rework drives most billing cost",
    };
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: charterView(over, []) })),
      list("charter/versions", []),
    ]);
    const thesis = await screen.findByRole("region", { name: "Transformation thesis" });
    expect(thesis.querySelector("[data-thesis-sentence]")!.textContent).toBe(
      "If we change the retail onboarding journey, then first-time-right bills will improve, which will create lower cost to serve, because rework drives most billing cost.",
    );
    expect(thesis.querySelectorAll("[data-part-state='complete']")).toHaveLength(4);
    cleanup();
    render(
      `/transformations/${TR_ID}/charter`,
      [
        ...base(leadGrants(), "ar"),
        route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: charterView(over, []) })),
        list("charter/versions", []),
      ],
      "ar",
    );
    const ar = await screen.findByRole("region", { name: "فرضية التحوّل" });
    expect(ar.querySelector("[data-thesis-sentence]")!.textContent).toBe(
      "إذا غيّرنا the retail onboarding journey، فستتحسّن first-time-right bills، مما سيحقق lower cost to serve، لأن rework drives most billing cost.",
    );
  });

  it("North Star (field 5): the current statement; a superseded link is flagged Stale (F-DG2-204)", async () => {
    const ns = {
      id: "01920000-0000-7000-d000-000000000002",
      organizationId: "x",
      transformationId: TR_ID,
      statement: "Every synthetic bill is right the first time, every time",
      status: "current" as const,
      supersededAt: null,
      version: 1,
      createdAt: "2026-09-30T09:00:00Z",
      createdBy: USER_ID,
      updatedAt: "2026-09-30T09:00:00Z",
      updatedBy: USER_ID,
    };
    const view = { ...charterView({ northStarId: "01920000-0000-7000-d000-000000000001" }, []), northStar: ns };
    view.warnings.push({ code: "charter.north_star_superseded", message: "x", pointer: "/northStar" });
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: view })),
      list("charter/versions", []),
    ]);
    const fields = await screen.findByRole("region", { name: "Charter fields (14)" });
    const five = fields.querySelectorAll("li.charter-field")[4]!;
    expect(five.textContent).toContain("Every synthetic bill is right the first time, every time");
    expect(five.textContent).toContain("Current");
    expect(five.querySelector("[data-north-star-link='stale']")!.textContent).toContain("Stale");
  });

  it("North Star (field 5): a superseded statement is never shown as the current one", async () => {
    const ns = {
      id: "01920000-0000-7000-d000-000000000001",
      organizationId: "x",
      transformationId: TR_ID,
      statement: "Old synthetic sentence",
      status: "superseded" as const,
      supersededAt: "2026-09-30T10:00:00Z",
      version: 2,
      createdAt: "2026-09-30T09:00:00Z",
      createdBy: USER_ID,
      updatedAt: "2026-09-30T10:00:00Z",
      updatedBy: USER_ID,
    };
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({
        status: 200,
        body: { ...charterView({}, []), northStar: ns },
      })),
      list("charter/versions", []),
    ]);
    const fields = await screen.findByRole("region", { name: "Charter fields (14)" });
    const five = fields.querySelectorAll("li.charter-field")[4]!;
    expect(five.textContent).not.toContain("Old synthetic sentence");
    expect(five.querySelector("[data-north-star='stale']")!.textContent).toContain("Stale");
  });

  it("compares a version with the previous one", async () => {
    const v = (no: number, over: Record<string, unknown>) => ({
      ...charterView().charter,
      id: `01920000-0000-7000-e000-00000000000${no}`,
      charterId: charterView().charter.id,
      versionNo: no,
      northStarStatement: null,
      topOutcomesSnapshot: [],
      guardrailsSnapshot: [],
      changeSummary: no === 2 ? "Synthetic scope edit" : null,
      savedBy: USER_ID,
      savedAt: "2026-09-30T09:00:00Z",
      ...over,
    });
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: charterView({}, []) })),
      list("charter/versions", [v(2, { inScope: "Retail onboarding" }), v(1, { inScope: null })]),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Compare v2 with v1" }));
    const diff = await screen.findByRole("region", { name: "Changes from v1 to v2" });
    const row = within(diff).getByRole("rowheader", { name: "In scope" }).closest("tr")!;
    expect(row.textContent).toContain("Retail onboarding");
    expect(row.textContent).toContain("None");
  });

  // F-DG2-210: the charter form never drops whitespace-only text (EN and AR).
  it.each([
    {
      locale: "en" as const,
      create: "Create charter",
      caseForChange: "Case for change",
    },
    { locale: "ar" as const, create: "إنشاء الميثاق", caseForChange: "مبررات التغيير" },
  ])("create: a whitespace Case for change is an inline blank error and creates nothing ($locale)", async (l) => {
    const { requests } = render(
      `/transformations/${TR_ID}/charter`,
      [
        ...base(leadGrants(), l.locale),
        route("GET", /\/charter$/, () => problem(404, "charter_not_found")),
        route("POST", /\/charter$/, () => ({ status: 201, body: charterView().charter })),
      ],
      l.locale,
    );
    fireEvent.click(await screen.findByRole("button", { name: l.create }));
    const field = await screen.findByLabelText(l.caseForChange);
    fireEvent.change(field, { target: { value: "  \n  " } });
    const submit = screen.getAllByRole("button", { name: l.create }).find((b) => b.getAttribute("type") === "submit")!;
    fireEvent.click(submit);
    const expected = createI18n(l.locale).t("problems.validation__blank");
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    const describedBy = field.getAttribute("aria-describedby")!.split(" ");
    expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain(expected);
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  const editCharter = async (locale: "ar" | "en", over: Record<string, unknown>) => {
    const view = charterView(over as never, []);
    const api = render(
      `/transformations/${TR_ID}/charter`,
      [
        ...base(leadGrants(), locale),
        route("GET", new RegExp(`${esc(TR)}/charter$`), () => ({ status: 200, body: view })),
        list("charter/versions", []),
        route("PATCH", /\/charter$/, (req) => ({
          status: 200,
          body: { ...view.charter, ...(req.body as object), version: 3 },
        })),
      ],
      locale,
    );
    const i18n = createI18n(locale);
    fireEvent.click(await screen.findByRole("button", { name: i18n.t("define.charter.edit") }));
    const form = (await screen.findByRole("button", { name: i18n.t("define.charter.saveVersion") })).closest("form")!;
    return { ...api, i18n, form };
  };

  it.each(["en", "ar"] as const)(
    "edit: a whitespace Out of scope is an inline blank error, sends nothing and keeps the value (%s)",
    async (locale) => {
      const { requests, i18n, form } = await editCharter(locale, { outOfScope: "Synthetic: enterprise billing" });
      const field = within(form).getByLabelText(i18n.t("define.charter.field.outOfScope"));
      fireEvent.change(field, { target: { value: "    " } });
      fireEvent.change(within(form).getByLabelText(i18n.t("define.charter.changeSummary")), {
        target: { value: "Synthetic edit" },
      });
      fireEvent.click(within(form).getByRole("button", { name: i18n.t("define.charter.saveVersion") }));
      await waitFor(() => expect(within(form).getByText(i18n.t("problems.validation__blank"))).toBeTruthy());
      expect(field.getAttribute("aria-invalid")).toBe("true");
      await waitFor(() => expect(document.activeElement).toBe(field));
      expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    },
  );

  it.each(["en", "ar"] as const)(
    "edit: emptying a filled field sends null; visible text is verbatim (%s)",
    async (locale) => {
      const { requests, i18n, form } = await editCharter(locale, { outOfScope: "Synthetic: enterprise billing" });
      fireEvent.change(within(form).getByLabelText(i18n.t("define.charter.field.outOfScope")), {
        target: { value: "" },
      });
      fireEvent.change(within(form).getByLabelText(i18n.t("define.charter.field.inScope")), {
        target: { value: " \u200fالتجزئة (بيانات اصطناعية)\u200f " },
      });
      fireEvent.change(within(form).getByLabelText(i18n.t("define.charter.changeSummary")), {
        target: { value: "Synthetic edit" },
      });
      fireEvent.click(within(form).getByRole("button", { name: i18n.t("define.charter.saveVersion") }));
      await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
      expect(requests.find((r) => r.method === "PATCH")!.body).toEqual({
        outOfScope: null,
        inScope: " \u200fالتجزئة (بيانات اصطناعية)\u200f ",
        changeSummary: "Synthetic edit",
      });
    },
  );

  it("edit: a change summary alone is not a change (never a content-free version)", async () => {
    const { requests, i18n, form } = await editCharter("en", {});
    fireEvent.change(within(form).getByLabelText(i18n.t("define.charter.changeSummary")), {
      target: { value: "Synthetic edit" },
    });
    fireEvent.click(within(form).getByRole("button", { name: i18n.t("define.charter.saveVersion") }));
    const alert = await within(form).findByText("There are no changes to save.");
    // F-DG2-211: the live region wraps a real list, so the <li> keep their list semantics.
    const region = alert.closest('[role="alert"]')!;
    expect(region.tagName).toBe("DIV");
    expect(region.querySelector("ul:not([role]) > li")).toBeTruthy();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("offers to create the charter when none exists", async () => {
    render(`/transformations/${TR_ID}/charter`, [
      ...base(leadGrants()),
      route("GET", /\/charter$/, () => problem(404, "charter_not_found")),
    ]);
    expect(await screen.findByText("No charter yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create charter" })).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ Design

describe("Design", () => {
  it("shows the ten canvas boxes and the per-dimension view", async () => {
    render(`/transformations/${TR_ID}/design`, [
      ...base(leadGrants()),
      route("GET", /\/tom-canvas$/, () => ({
        status: 200,
        body: { cells: Array.from({ length: 10 }, (_, i) => canvasCell(i)) },
      })),
    ]);
    const canvas = await screen.findByRole("list", { name: "TOM Canvas boxes" });
    expect(within(canvas).getAllByRole("listitem")).toHaveLength(10);
    // Boxes without a target design say so (Unknown), never blank.
    expect(within(canvas).getAllByText("Unknown").length).toBeGreaterThanOrEqual(9);
    fireEvent.click(within(canvas).getAllByRole("button", { name: /^Open dimension view/ })[0]!);
    const view = await screen.findByRole("region", { name: /^Dimension view:/ });
    for (const heading of ["TOM Gap Matrix (T03)", "Decisions", "Dependencies", "Evidence"])
      expect(within(view).getByRole("heading", { name: heading })).toBeTruthy();
    expect(within(view).getByText("Synthetic target design")).toBeTruthy();
  });

  it("converts an unresolved workshop item into a design decision with If-Match", async () => {
    const ws = {
      id: "01920000-0000-7000-f000-000000000001",
      organizationId: "x",
      transformationId: TR_ID,
      title: "Synthetic design workshop",
      workshopDate: "2026-10-05",
      durationMinutes: 90,
      agenda: null,
      facilitatorUserId: USER_ID,
      status: "in_progress",
      closedAt: null,
      closedBy: null,
      version: 2,
      createdAt: "2026-09-30T09:00:00Z",
      createdBy: USER_ID,
      updatedAt: "2026-09-30T09:00:00Z",
      updatedBy: USER_ID,
    };
    const item = {
      id: "01920000-0000-7000-f000-000000000002",
      organizationId: "x",
      transformationId: TR_ID,
      workshopId: ws.id,
      dimensionCode: null,
      kind: "unresolved",
      body: "Who owns pricing decisions?",
      ownerUserId: USER_ID,
      status: "open",
      convertedDecisionId: null,
      convertedActionId: null,
      convertedAt: null,
      convertedBy: null,
      version: 4,
      createdAt: "2026-09-30T09:00:00Z",
      createdBy: USER_ID,
      updatedAt: "2026-09-30T09:00:00Z",
      updatedBy: USER_ID,
    };
    const { requests } = render(`/transformations/${TR_ID}/design`, [
      ...base(leadGrants()),
      list("tom-workshops", [ws]),
      route("GET", /\/tom-canvas$/, () => ({
        status: 200,
        body: { cells: Array.from({ length: 10 }, (_, i) => canvasCell(i)) },
      })),
      route("GET", /\/tom-workshops\/[^/]+\/items/, () => page([item])),
      route("POST", /\/convert$/, () => ({ status: 200, body: { ...item, status: "converted", version: 5 } })),
    ]);
    const section = await screen.findByRole("region", { name: "Design workshops" });
    fireEvent.click(await within(section).findByRole("button", { name: /^Open workshop mode/ }));
    expect(
      await screen.findByText(
        "1 unresolved items open. A workshop closes only when every unresolved item is converted.",
      ),
    ).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^Convert: / }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/convert"))).toBe(true));
    const post = requests.find((r) => r.url.endsWith("/convert"))!;
    expect(post.headers["if-match"]).toBe('"4"');
    expect(post.headers["idempotency-key"]).toBeUndefined();
    expect(post.body).toMatchObject({
      target: "design_decision",
      ownerUserId: USER_ID,
      title: "Who owns pricing decisions?",
    });
  });
});

// ------------------------------------------------------------------------------------------------ Decisions

describe("Decisions (T04)", () => {
  it("reads the log with kind=design and shows D-codes, options A/B/C and Open status", async () => {
    const { requests } = render(`/transformations/${TR_ID}/decisions`, [
      ...base(leadGrants()),
      route("GET", /\/api\/v1\/decisions\?.*kind=design/, () => page([decision()])),
    ]);
    const log = await screen.findByRole("region", { name: "Design Decision Log (T04)" });
    expect(await within(log).findByText("D-01")).toBeTruthy();
    for (const label of ["A", "B", "C"]) expect(log.querySelector(`[data-option='${label}']`)).toBeTruthy();
    expect(within(log).getByText("Open")).toBeTruthy();
    const get = requests.find((r) => r.url.startsWith("/api/v1/decisions?") && r.url.includes("kind=design"))!;
    expect(get.url).toContain(`transformationId=${TR_ID}`);
  });

  it("creates a design decision with inline options and an idempotency key", async () => {
    const { requests } = render(`/transformations/${TR_ID}/decisions`, [
      ...base(leadGrants()),
      route("POST", /\/api\/v1\/decisions$/, () => ({ status: 201, body: decision() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Add design decision" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/^Decision \(required\)$/), {
      target: { value: "Synthetic channel choice" },
    });
    fireEvent.change(within(dialog).getByLabelText("Option A"), { target: { value: "Build in-house" } });
    fireEvent.change(within(dialog).getByLabelText("Option B"), { target: { value: "Partner" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({
      transformationId: TR_ID,
      kind: "design",
      title: "Synthetic channel choice",
      options: [{ title: "Build in-house" }, { title: "Partner" }],
    });
    expect(post.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

// ------------------------------------------------------------------------------------------------ Gates

describe("Gates (business approval)", () => {
  it("lists G1-G6 as business approvals with live readiness, and never mentions the engineering gates", async () => {
    render(`/transformations/${TR_ID}/gates`, [
      ...base(leadGrants()),
      route("GET", /\/gates$/, () => ({ status: 200, body: { items: gateViews() } })),
    ]);
    expect((await screen.findAllByText("Business approval")).length).toBeGreaterThan(0);
    const cards = await screen.findAllByRole("listitem");
    expect(document.querySelectorAll("[data-gate]")).toHaveLength(6);
    expect(cards.length).toBeGreaterThan(0);
    expect(document.querySelector("[data-gate='G1'] [data-readiness]")!.textContent!.trim()).toBe(
      "2 of 3 mandatory outputs complete",
    );
    expect(document.querySelector("[data-gate='G4'] [data-readiness]")!.textContent).toContain(
      "Not available in this release",
    );
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("shows unverified evidence as unverified, the failing outcome at G2, and submits with If-Match", async () => {
    const ev = evidence({ title: "Synthetic filename only", kind: "file_reference", fileName: "x.xlsx" });
    const o = outcome({ statement: "Launch the new app" });
    const views = gateViews({ canSubmit: true, evidenceId: ev.id, outcomeId: o.id });
    const { requests } = render(`/transformations/${TR_ID}/gates/G1`, [
      ...base(leadGrants()),
      route("GET", /\/gates\/G1$/, () => ({ status: 200, body: views[0] })),
      list("evidence", [ev]),
      list("outcomes", [o]),
      route("POST", /\/gates\/G1\/submissions$/, () =>
        problem(422, "gate_criteria_incomplete", {
          errors: [{ pointer: "/criteria/g1.baseline", code: "g1.baseline.verified_evidence_missing", message: "x" }],
        }),
      ),
    ]);
    const readiness = await screen.findByRole("region", { name: "Readiness (live)" });
    const row = within(readiness)
      .getByRole("rowheader", { name: /^Baseline ready/ })
      .closest("tr")!;
    expect(row.dataset["completeness"]).toBe("incomplete");
    expect(await within(row).findByText("Synthetic filename only")).toBeTruthy();
    expect(within(row).getAllByText("Unverified").length).toBeGreaterThan(0);
    expect(within(row).getByText(/A measurable baseline needs verified evidence/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Submit for decision" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain("Submission refused: mandatory required outputs are incomplete.");
    expect(alert.textContent).toContain("A measurable baseline needs verified evidence");
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"3"');
  });

  it("lists outcomes failing the good outcome test at G2", async () => {
    const o = outcome({ statement: "Launch the new app" });
    render(`/transformations/${TR_ID}/gates/G2`, [
      ...base(leadGrants()),
      route("GET", /\/gates\/G2$/, () => ({ status: 200, body: gateViews({ outcomeId: o.id })[1] })),
      list("outcomes", [o]),
    ]);
    const readiness = await screen.findByRole("region", { name: "Readiness (live)" });
    const item = await within(readiness).findByText(/Outcome does not pass the good outcome test/);
    expect(item.closest("li")!.textContent).toContain("Launch the new app");
  });

  it("the approver's decision: rationale required; 403 and 409 problems in words", async () => {
    let call = 0;
    const responses = [
      problem(403, "gate.not_approver"),
      problem(403, "gate.submitter_cannot_decide"),
      {
        ...problem(409, "gate.submission_superseded", { currentVersion: 2 }),
        body: {
          ...problem(409, "gate.submission_superseded").body,
          type: "urn:mth:problem:version-conflict",
          currentVersion: 2,
        },
      },
    ];
    const { requests } = render(`/transformations/${TR_ID}/gates/G1`, [
      ...base(leadGrants(["gate.decide"])),
      route("GET", /\/gates\/G1$/, () => ({ status: 200, body: gateViews({ pending: true, canDecide: true })[0] })),
      route("POST", /\/gates\/G1\/decision$/, () => responses[call++]!),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Record decision" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Approve" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Record decision" }));
    // Rationale is mandatory: nothing is sent without it.
    expect(await within(dialog).findByText("This value is too short or too small.")).toBeTruthy();
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/^Rationale/), { target: { value: "Synthetic rationale" } });
    // REQ-PB-022 (ADR-0021 §8): approving G1 needs the three leadership agreement confirmations.
    for (const name of ["problem", "baseline", "material value pools"]) {
      fireEvent.click(within(dialog).getByRole("checkbox", { name: `The leadership team agrees on the ${name}` }));
    }
    fireEvent.click(within(dialog).getByRole("button", { name: "Record decision" }));
    expect(await within(dialog).findByText(/Only the configured approver of this gate can decide it\./)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Record decision" }));
    expect(await within(dialog).findByText(/the person who submitted this gate cannot decide it/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Record decision" }));
    const conflict = await within(dialog).findByText(/This submission is no longer the current one/);
    expect(conflict.closest("[data-state]")!.getAttribute("data-state")).toBe("conflict");
    const body = requests.find((r) => r.method === "POST")!.body as Record<string, unknown>;
    expect(body).toEqual({
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic rationale",
      agreements: { problem: true, baseline: true, materialValuePools: true },
    });
  });

  // F-DG2-151 (REQ-PB-017 / B0023): the verbatim source gate name already contains the code; it is shown exactly once.
  it("gate list titles: the verbatim B0023 name once, never the code twice (EN and AR)", async () => {
    render(`/transformations/${TR_ID}/gates`, [
      ...base(leadGrants()),
      route("GET", /\/gates$/, () => ({ status: 200, body: { items: gateViews() } })),
    ]);
    const g2 = await waitFor(() => {
      const h = document.querySelector("[data-gate='G2'] .gate-card__title");
      expect(h).toBeTruthy();
      return h!;
    });
    expect(g2.textContent!.trim()).toBe("G2 - Direction");
    const titles = [...document.querySelectorAll(".gate-card__title")].map((h) => h.textContent!.trim());
    expect(titles).toEqual([
      "G1 - Case for Change",
      "G2 - Direction",
      "G3 - Target State",
      "G4 - Mobilization",
      "G5 - Scale",
      "G6 - Sustain",
    ]);
    for (const t of titles) expect(t).not.toMatch(/G\d\s*[–-]\s*G\d/);
    cleanup();

    render(
      `/transformations/${TR_ID}/gates`,
      [...base(leadGrants(), "ar"), route("GET", /\/gates$/, () => ({ status: 200, body: { items: gateViews() } }))],
      "ar",
    );
    const g2ar = await waitFor(() => {
      const h = document.querySelector("[data-gate='G2'] .gate-card__title");
      expect(h).toBeTruthy();
      return h!;
    });
    expect(g2ar.textContent!.trim()).toBe("G2 - التوجّه");
    expect(document.body.textContent).not.toMatch(/G\d\s*[–-]\s*G\d/);
  });

  it("gate detail heading: the verbatim B0023 name once (EN and AR)", async () => {
    const handlers = (locale: "ar" | "en") => [
      ...base(leadGrants(), locale),
      route("GET", /\/gates\/G2$/, () => ({ status: 200, body: gateViews()[1] })),
    ];
    render(`/transformations/${TR_ID}/gates/G2`, handlers("en"));
    expect(await screen.findByRole("heading", { name: "G2 - Direction" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /G2\s*[–-]\s*G2/ })).toBeNull();
    cleanup();

    render(`/transformations/${TR_ID}/gates/G2`, handlers("ar"), "ar");
    expect(await screen.findByRole("heading", { name: "G2 - التوجّه" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /G2\s*[–-]\s*G2/ })).toBeNull();
  });

  it("Arabic: the gate is labelled a business approval, RTL", async () => {
    render(
      `/transformations/${TR_ID}/gates`,
      [...base(leadGrants(), "ar"), route("GET", /\/gates$/, () => ({ status: 200, body: { items: gateViews() } }))],
      "ar",
    );
    expect((await screen.findAllByText("موافقة أعمال")).length).toBeGreaterThan(0);
    expect(document.documentElement.dir).toBe("rtl");
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });
});

// ------------------------------------------------------------------------------------------------ Evidence

describe("Evidence", () => {
  it("uploads a revision as octet-stream with a percent-encoded file name and If-Match", async () => {
    const ev = evidence({ version: 2 });
    const { requests } = render(`/transformations/${TR_ID}/evidence`, [
      ...base(leadGrants()),
      list("evidence", [ev]),
      route("POST", /\/content$/, () => ({ status: 200, body: { ...ev, version: 3, currentContentId: ev.id } })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: /^Upload revision: / }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["synthetic,data\n1,2\n"], "تقرير اصطناعي.csv", { type: "text/csv" });
    fireEvent.change(within(dialog).getByLabelText(/^File/), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload" }));
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/content"))).toBe(true));
    const post = requests.find((r) => r.url.endsWith("/content"))!;
    expect(post.headers["content-type"]).toBe("application/octet-stream");
    expect(post.headers["x-file-name"]).toBe(encodeURIComponent("تقرير اصطناعي.csv"));
    expect(post.headers["if-match"]).toBe('"2"');
  });

  it("never offers review to the creator; a filename reference can only be rejected", async () => {
    const mine = evidence({ title: "Mine", createdBy: USER_ID });
    const ref = evidence({ title: "Reference", kind: "file_reference", fileName: "x.xlsx", createdBy: OTHER_USER });
    render(`/transformations/${TR_ID}/evidence`, [...base(leadGrants()), list("evidence", [mine, ref])]);
    const reg = await screen.findByRole("region", { name: "Evidence register" });
    await within(reg).findByText("Mine");
    expect(within(reg).queryByRole("button", { name: "Review: Mine" })).toBeNull();
    fireEvent.click(within(reg).getByRole("button", { name: "Review: Reference" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("radio", { name: "Verified" })).toBeNull();
    expect(within(dialog).getByRole("radio", { name: "Rejected" })).toBeTruthy();
  });
});

// ------------------------------------------------------------------------------------------------ AUD read-only

describe("read-only auditor (AUD)", () => {
  const screens = ["diagnose", "charter", "define", "design", "decisions", "gates", "evidence", "team"] as const;
  for (const tab of screens) {
    it(`${tab}: no write control and a read-only note`, async () => {
      render(`/transformations/${TR_ID}/${tab}`, [
        ...base(AUDITOR_GRANTS),
        list(
          "diagnostic-items",
          METHODOLOGY.diagnosticDimensions.map((d) => diagnosticItem(d.code)),
        ),
        list("baselines", [baseline()]),
        list("value-pools", [valuePool()]),
        list("outcomes", [outcome()]),
        list("kpi-definitions", [
          {
            id: "01920000-0000-7000-c000-000000000009",
            organizationId: outcome().organizationId,
            transformationId: TR_ID,
            name: "Synthetic draft KPI",
            description: null,
            businessPurpose: null,
            unitKind: "count",
            unitLabel: null,
            currency: null,
            polarity: "higher_is_better",
            frequency: "monthly",
            isLeading: false,
            dataSource: null,
            ownerUserId: null,
            stewardUserId: null,
            status: "draft",
            archivedAt: null,
            archivedBy: null,
            archiveReason: null,
            version: 1,
            createdAt: "2026-09-30T09:00:00Z",
            createdBy: OTHER_USER,
            updatedAt: "2026-09-30T09:00:00Z",
            updatedBy: OTHER_USER,
          },
        ]),
        list("evidence", [evidence({ createdBy: OTHER_USER })]),
        route("GET", /\/api\/v1\/decisions\?/, () => page([decision({ ownerUserId: USER_ID })])),
        route("GET", /\/charter$/, () => ({ status: 200, body: charterView() })),
        route("GET", /\/north-star$/, () => problem(404, "north_star_not_found")),
        route("GET", /\/tom-canvas$/, () => ({
          status: 200,
          body: { cells: Array.from({ length: 10 }, (_, i) => canvasCell(i)) },
        })),
        route("GET", /\/gates$/, () => ({ status: 200, body: { items: gateViews({ pending: true }) } })),
        route("GET", /\/api\/v1\/role-accountabilities$/, () => ({ status: 200, body: { items: [] } })),
      ]);
      await waitFor(() => expect(document.querySelector("[data-state='read-only']")).toBeTruthy());
      await waitFor(() => expect(document.querySelectorAll("[data-state='loading']")).toHaveLength(0));
      const main = document.querySelector("main#main")!;
      const writeWords =
        /^(Add|Edit|Create|Archive|Save|Validate|Review|Upload|Link to record|Submit|Record decision|Approve|Convert|Configure|Set North Star|Refine|Plan workshop|Fill in|Remove link|Activate|Assign(?![a-z]))/;
      const offending = [...main.querySelectorAll("button")]
        .filter((b) => !b.disabled)
        .map((b) => (b.textContent ?? "").trim())
        .filter((text) => writeWords.test(text));
      expect(offending).toEqual([]);
    });
  }
});
