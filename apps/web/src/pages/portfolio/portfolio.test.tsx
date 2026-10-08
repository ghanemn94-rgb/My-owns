// Portfolio list, outcome hierarchy and the Initiative Card (T05) with stubbed API responses, in English (LTR) and
// Arabic (RTL). SYNTHETIC data. REQ-S09-003 (three separate columns, 'Selected - unfunded'), REQ-PB-045 (14 T05
// fields, 3-7 deliverables warning), REQ-PB-040 (not TOM evidence), REQ-PB-032 (outcome required / KPI optional,
// Unknown target), REQ-PB-006 / REQ-PB-004 / REQ-PB-007 (transition 422s translated), read-only auditor.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { id } from "../../test/p2fixtures.ts";
import {
  EMPTY_HIERARCHY,
  esc,
  frameHandlers,
  initiative,
  page,
  problemBody,
  TR,
  wave,
  type Grants,
} from "./p3fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
const tr = (locale: Locale) => createI18n(locale).t;

const W1 = wave();
const DRAFT = initiative({
  code: "INI-01",
  name: "Synthetic draft initiative",
  warnings: [
    { code: "initiative.deliverable_count", message: "x" },
    { code: "initiative.no_gap_link", message: "x" },
  ],
});
const SELECTED = initiative({
  code: "INI-02",
  name: "Synthetic selected initiative",
  status: "selected",
  fundingState: "unfunded",
  waveId: W1.id,
  version: 4,
});
const FUNDED = initiative({
  code: "INI-03",
  name: "Synthetic funded initiative",
  status: "funded",
  fundingState: "funded",
  executiveOwnerUserId: null,
  warnings: [{ code: "initiative.no_owner", message: "x" }],
});
const RANKED = initiative({ code: "INI-04", name: "Synthetic ranked initiative", status: "ranked", version: 2 });

function portfolioHandlers(extra: Handler[] = []): Handler[] {
  return [
    ...extra,
    route("GET", /\/api\/v1\/initiatives\?/, (req) => {
      const u = new URL(req.url, "http://x");
      const status = u.searchParams.get("status");
      const all = [DRAFT, SELECTED, FUNDED, RANKED];
      return page(status ? all.filter((i) => i.status === status) : all);
    }),
    route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
    route("GET", new RegExp(`${esc(TR)}/prioritization$`), () => ({
      status: 200,
      body: {
        items: [
          { initiative: SELECTED, rank: 1 },
          { initiative: RANKED, rank: 2 },
          { initiative: FUNDED, rank: null },
        ],
      },
    })),
    route("GET", new RegExp(`${esc(TR)}/outcome-hierarchy$`), () => ({ status: 200, body: EMPTY_HIERARCHY })),
  ];
}

function renderPortfolio(locale: Locale, grants: Grants = "lead", extra: Handler[] = []) {
  const api = mockApi(...frameHandlers(locale, grants, portfolioHandlers(extra)));
  renderApp(`/transformations/${TR_ID}/portfolio`, { i18n: createI18n(locale) });
  return api;
}

const rowOf = async (code: string) => (await screen.findByText(code)).closest("tr")!;

describe.each(["en", "ar"] as const)("Portfolio (%s)", (locale) => {
  const t = tr(locale);

  it("lists code, name, wave, owners and three separate columns: proposed rank, selection and funding", async () => {
    renderPortfolio(locale);
    expect(await screen.findByRole("heading", { level: 1, name: t("portfolio.title") })).toBeTruthy();
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    const table = (await rowOf("INI-02")).closest("table")!;
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent ?? "");
    for (const key of ["proposedRank", "selection", "funding", "wave", "owners", "warnings"])
      expect(
        headers.some((h) => h.includes(t(`portfolio.field.${key}`))),
        key,
      ).toBe(true);

    const selected = await rowOf("INI-02");
    expect(selected.querySelector("[data-rank]")?.textContent).toBe("1");
    expect(selected.querySelector("[data-selection='selected']")).toBeTruthy();
    // REQ-S09-003: selection never funds.
    expect(selected.querySelector("[data-funding='unfunded']")?.textContent).toContain(
      locale === "en" ? "Selected - unfunded" : "مختارة - غير ممولة",
    );
    expect(selected.textContent).toContain(W1[locale === "en" ? "nameEn" : "nameAr"]);

    const funded = await rowOf("INI-03");
    expect(funded.querySelector("[data-funding='funded']")?.textContent).toContain(t("portfolio.funding.funded"));
    expect(funded.textContent).toContain(t("portfolio.rank.notRanked"));
    expect(funded.querySelector("[data-warning='initiative.no_owner']")).toBeTruthy();

    const draft = await rowOf("INI-01");
    expect(draft.querySelector("[data-funding='none']")?.textContent).toBe("—");
    expect(draft.querySelector("[data-selection='not_selected']")).toBeTruthy();
    expect(draft.querySelector("[data-warning='initiative.deliverable_count']")?.textContent).toContain(
      t("portfolio.warning.initiative__deliverable_count"),
    );
    expect(draft.querySelector("[data-warning='initiative.no_gap_link']")).toBeTruthy();
    expect(draft.textContent).toContain(t("portfolio.status.draft"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("the proposed rank is Unknown (never 0) when the prioritization view is unavailable", async () => {
    renderPortfolio(locale, "lead", [
      route("GET", new RegExp(`${esc(TR)}/prioritization$`), () =>
        problemBody(422, "urn:mth:problem:validation", "x", "x"),
      ),
    ]);
    const row = await rowOf("INI-02");
    await waitFor(() => expect(row.querySelector("[data-health='unknown']")).toBeTruthy());
    expect(row.querySelector("[data-rank]")).toBeNull();
  });

  it("filters by status and wave on the server", async () => {
    const { requests } = renderPortfolio(locale);
    await rowOf("INI-01");
    fireEvent.change(screen.getByLabelText(t("portfolio.filter.status")), { target: { value: "selected" } });
    await waitFor(() => expect(requests.some((r) => r.url.includes("status=selected"))).toBe(true));
    await waitFor(() => expect(screen.queryByText("INI-01")).toBeNull());
    fireEvent.change(screen.getByLabelText(t("portfolio.filter.wave")), { target: { value: W1.id } });
    await waitFor(() => expect(requests.some((r) => r.url.includes(`waveId=${W1.id}`))).toBe(true));
  });

  it("creates a draft at any time: POST /initiatives with the transformation and an Idempotency-Key", async () => {
    const created = initiative({ code: "INI-05", name: "Synthetic new initiative" });
    const { requests } = renderPortfolio(locale, "lead", [
      route("POST", /\/api\/v1\/initiatives$/, () => ({ status: 201, body: created })),
      route("GET", new RegExp(`/api/v1/initiatives/${created.id}$`), () => ({ status: 200, body: created })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("portfolio.create.action")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.field.name")}`)), {
      target: { value: "Synthetic new initiative" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.create.submit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toMatchObject({ transformationId: TR_ID, name: "Synthetic new initiative" });
    expect(post.headers["idempotency-key"]).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 1, name: t("portfolio.initiativeTitle") })).toBeTruthy();
  });

  it("the read-only auditor sees the list with no enabled write control", async () => {
    const { requests } = renderPortfolio(locale, "auditor");
    await rowOf("INI-01");
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.create.action")) })).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("outcome hierarchy: five levels, an Unknown target is Unknown (never 0)", async () => {
    const outcomeId = id();
    const kpiRow = id();
    const kpiDef = id();
    const contribution = {
      id: id(),
      organizationId: SELECTED.organizationId,
      transformationId: TR_ID,
      initiativeId: SELECTED.id,
      outcomeId,
      outcomeKpiId: kpiRow,
      contributionStatement: "Synthetic contribution",
      expectedKpiMovement: null,
      status: "active",
      removedAt: null,
      removedBy: null,
      removeReason: null,
      version: 1,
      createdAt: SELECTED.createdAt,
      createdBy: USER_ID,
      updatedAt: SELECTED.createdAt,
      updatedBy: USER_ID,
    };
    renderPortfolio(locale, "lead", [
      route("GET", new RegExp(`${esc(TR)}/outcome-hierarchy$`), () => ({
        status: 200,
        body: {
          northStar: { id: id(), statement: "Synthetic North Star" },
          outcomes: [
            {
              outcome: { id: outcomeId, statement: "Synthetic outcome" },
              kpis: [
                {
                  outcomeKpiId: kpiRow,
                  kpiDefinitionId: kpiDef,
                  targetValue: null,
                  targetDate: "2027-06-30",
                  contributions: [contribution],
                },
              ],
              contributions: [],
            },
          ],
        },
      })),
      route("GET", new RegExp(`${esc(TR)}/kpi-definitions`), () => page([{ id: kpiDef, name: "Synthetic NPS" }])),
    ]);
    const tree = await screen.findByText("Synthetic outcome");
    const section = tree.closest("section")!;
    await within(section).findByText("Synthetic NPS");
    expect(section.textContent).toContain("Synthetic North Star");
    const target = section.querySelector("[data-level='target']")!;
    expect(target.getAttribute("data-target")).toBe("unknown");
    expect(target.querySelector("[data-health='unknown']")?.textContent).toContain(t("common.value.unknown"));
    expect(target.textContent).not.toMatch(/(^|\s)0(\s|$)/);
    expect(section.querySelector("[data-level='contribution']")?.textContent).toContain("INI-02");
  });
});

// ------------------------------------------------------------------------------------------------ initiative card

function cardHandlers(ini: typeof DRAFT, extra: Handler[] = []): Handler[] {
  return [
    ...extra,
    route("GET", new RegExp(`/api/v1/initiatives/${ini.id}$`), () => ({ status: 200, body: ini })),
    route("GET", new RegExp(`/api/v1/initiatives/${ini.id}/deliverables`), () => ({
      status: 200,
      body: { items: [], countWarning: { code: "initiative.deliverable_count", message: "x" } },
    })),
    route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
  ];
}

function renderCard(locale: Locale, ini: typeof DRAFT, grants: Grants = "lead", extra: Handler[] = []) {
  const api = mockApi(...frameHandlers(locale, grants, cardHandlers(ini, extra)));
  renderApp(`/transformations/${TR_ID}/initiatives/${ini.id}`, { i18n: createI18n(locale) });
  return api;
}

async function openTransition(locale: Locale, idKey: string) {
  const t = tr(locale);
  const button = await screen.findByRole("button", { name: new RegExp(t(`portfolio.transition.${idKey}.action`)) });
  fireEvent.click(button);
  return screen.findByRole("dialog");
}

describe.each(["en", "ar"] as const)("Initiative Card (%s)", (locale) => {
  const t = tr(locale);

  it("shows all 14 T05 fields in the source order and the 3-7 deliverables warning (a warning, not a block)", async () => {
    renderCard(locale, DRAFT);
    await screen.findByRole("heading", { level: 2, name: new RegExp("INI-01") });
    const fields = document.querySelectorAll("[data-t05]");
    expect([...fields].map((f) => f.getAttribute("data-t05"))).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 1)),
    );
    for (const key of [
      "name",
      "executiveOwner",
      "workstreamLead",
      "problemGap",
      "objective",
      "scope",
      "deliverables",
      "contribution",
      "financialBenefit",
      "customerBenefit",
      "dependencies",
      "risks",
      "milestones",
      "decisions",
    ])
      expect(document.querySelector(".t05-fields")!.textContent).toContain(t(`portfolio.t05.${key}`));
    const warning = await screen.findByText(new RegExp(t("portfolio.deliverable.notABlock")));
    expect(warning.closest("[data-warning='initiative.deliverable_count']")).toBeTruthy();
    expect(document.querySelector("[data-state='draft']")?.textContent).toContain(t("portfolio.card.draftNote"));
    // Editing is offered even with the warning (it never blocks).
    expect(screen.getByRole("button", { name: new RegExp(t("portfolio.card.edit")) })).toBeTruthy();
  });

  it("submit refused: 'Case for change not yet approved (G1)…' is the dialog's one translated alert", async () => {
    const { requests } = renderCard(locale, DRAFT, "lead", [
      route("POST", new RegExp(`/initiatives/${DRAFT.id}/submit$`), () =>
        problemBody(422, "urn:mth:problem:invalid-transition", "initiative.g1_not_approved", "English detail G1", [
          { pointer: "", code: "initiative.g1_not_approved", message: "English detail G1" },
        ]),
      ),
    ]);
    const dialog = await openTransition(locale, "submit");
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.submit.confirm") }));
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain(t("portfolio.problem.initiative__g1_not_approved"));
    expect(alerts[0]!.textContent).toContain(
      locale === "en" ? "Case for change not yet approved (G1)" : "مبررات التغيير لم تُعتمد بعد (G1)",
    );
    expect(dialog.textContent).not.toContain("English detail G1");
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe(`"${DRAFT.version}"`);
  });

  it("submit refused: 'Outcome before activity…' (validation at /outcomeContributions) is translated", async () => {
    renderCard(locale, DRAFT, "lead", [
      route("POST", new RegExp(`/initiatives/${DRAFT.id}/submit$`), () =>
        problemBody(422, "urn:mth:problem:validation", "initiative.outcome_before_activity", "English detail", [
          { pointer: "/outcomeContributions", code: "initiative.outcome_before_activity", message: "English" },
        ]),
      ),
    ]);
    const dialog = await openTransition(locale, "submit");
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.submit.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("portfolio.problem.initiative__outcome_before_activity"));
    expect(alert.textContent).toContain(locale === "en" ? "Outcome before activity" : "النتيجة قبل النشاط");
  });

  it("launch refused: 'North Star, outcomes and target state not yet approved', then 'Selected - unfunded…'", async () => {
    let answer = "initiative.direction_not_approved";
    renderCard(locale, SELECTED, "lead", [
      route("POST", new RegExp(`/initiatives/${SELECTED.id}/launch$`), () =>
        problemBody(422, "urn:mth:problem:invalid-transition", answer, "English"),
      ),
    ]);
    let dialog = await openTransition(locale, "launch");
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.launch.confirm") }));
    let alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(
      locale === "en"
        ? "North Star, outcomes and target state not yet approved"
        : "النجم الشمالي والنتائج والوضع المستهدف لم تُعتمد بعد",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.cancel") }));
    answer = "initiative.selected_unfunded";
    dialog = await openTransition(locale, "launch");
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.launch.confirm") }));
    alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(
      locale === "en"
        ? "Selected - unfunded: a funding approval is required before launch"
        : "مختارة - غير ممولة: تلزم موافقة تمويل قبل الإطلاق",
    );
  });

  it("select is a labelled business approval: rationale required, If-Match, no 'on behalf of' control", async () => {
    const { requests } = renderCard(locale, RANKED, "lead", [
      route("POST", new RegExp(`/initiatives/${RANKED.id}/select$`), () => ({
        status: 200,
        body: { ...RANKED, status: "selected", fundingState: "unfunded", version: 3 },
      })),
    ]);
    const button = await screen.findByRole("button", { name: new RegExp(t("portfolio.transition.select.action")) });
    expect(button.textContent).toContain(t("portfolio.businessApproval"));
    expect(screen.getByRole("button", { name: new RegExp(t("portfolio.transition.withdraw.action")) })).toBeTruthy();
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-approval']")?.textContent).toContain(
      t("portfolio.businessApproval"),
    );
    expect(dialog.textContent?.toLowerCase()).not.toMatch(/on behalf/);
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    // Blank and missing rationales are refused inline; nothing is sent.
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.select.confirm") }));
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(new RegExp(t("portfolio.transition.text.rationale")))
          .getAttribute("aria-invalid"),
      ).toBe("true"),
    );
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.transition.text.rationale"))), {
      target: { value: "‏  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.select.confirm") }));
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.transition.text.rationale"))), {
      target: { value: "Synthetic: top of the proposed ranking" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.select.confirm") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ rationale: "Synthetic: top of the proposed ranking" });
    expect(post.headers["if-match"]).toBe(`"${RANKED.version}"`);
  });

  it("a 409 shows the conflict banner and reloads", async () => {
    const { requests } = renderCard(locale, RANKED, "lead", [
      route("POST", new RegExp(`/initiatives/${RANKED.id}/withdraw$`), () => ({
        status: 409,
        body: {
          type: "urn:mth:problem:version-conflict",
          title: "Conflict",
          status: 409,
          code: "version_conflict",
          currentVersion: 3,
          requestId: "r",
        },
      })),
    ]);
    const dialog = await openTransition(locale, "withdraw");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.transition.text.reason"))), {
      target: { value: "Synthetic reason" },
    });
    const gets = () => requests.filter((r) => r.method === "GET" && r.url.endsWith(`/initiatives/${RANKED.id}`)).length;
    const before = gets();
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.transition.withdraw.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.getAttribute("data-state")).toBe("conflict");
    expect(alert.textContent).toContain(t("portfolio.conflictReloaded"));
    await waitFor(() => expect(gets()).toBeGreaterThan(before));
  });

  it("a gap link to another TOM record shows 'A project portfolio is not a Target Operating Model…'", async () => {
    const journeyId = id();
    const { requests } = renderCard(locale, DRAFT, "lead", [
      route("GET", new RegExp(`${esc(TR)}/journeys`), () => page([{ id: journeyId, name: "Synthetic journey" }])),
      route("POST", new RegExp(`/initiatives/${DRAFT.id}/gap-links$`), () =>
        problemBody(422, "urn:mth:problem:validation", "initiative.not_tom_evidence", "English detail", [
          { pointer: "/targetType", code: "initiative.not_tom_evidence", message: "English" },
        ]),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("portfolio.gap.add")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.gap.field.type"))), {
      target: { value: "journey" },
    });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(new RegExp(t("portfolio.gap.field.target")))
          .querySelectorAll("option"),
      ).toHaveLength(2),
    );
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.gap.field.target"))), {
      target: { value: journeyId },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.gap.add") }));
    const alerts = await within(dialog).findAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.textContent).toContain(
      locale === "en"
        ? "A project portfolio is not a Target Operating Model"
        : "محفظة المشاريع ليست نموذج التشغيل المستهدف",
    );
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({ targetType: "journey", targetId: journeyId });
  });

  it("an outcome contribution needs an outcome; the KPI is optional and labelled so", async () => {
    const outcomeId = id();
    const { requests } = renderCard(locale, DRAFT, "lead", [
      route("GET", new RegExp(`${esc(TR)}/outcomes`), () =>
        page([{ id: outcomeId, statement: "Synthetic outcome", status: "active" }]),
      ),
      route("POST", new RegExp(`/initiatives/${DRAFT.id}/outcome-contributions$`), () => ({ status: 201, body: {} })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("portfolio.contribution.add")) }));
    const dialog = await screen.findByRole("dialog");
    const outcome = within(dialog).getByLabelText(new RegExp(`^${t("portfolio.contribution.field.outcome")}`));
    const kpi = within(dialog).getByLabelText(new RegExp(esc(t("portfolio.contribution.field.kpiOptional"))));
    expect(outcome.getAttribute("aria-required")).toBe("true");
    expect(kpi.getAttribute("aria-required")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.contribution.add") }));
    await waitFor(() => expect(outcome.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    await waitFor(() => expect(outcome.querySelectorAll("option").length).toBe(2));
    fireEvent.change(outcome, { target: { value: outcomeId } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(t("portfolio.contribution.field.statement"))), {
      target: { value: "Synthetic statement" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.contribution.add") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      outcomeId,
      contributionStatement: "Synthetic statement",
    });
  });

  it("the read-only auditor sees the card with no enabled write control", async () => {
    const { requests } = renderCard(locale, SELECTED, "auditor");
    await screen.findByRole("heading", { level: 2, name: new RegExp("INI-02") });
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
    expect(document.querySelectorAll("[data-transition]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.card.edit")) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.gap.add")) })).toBeNull();
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("a cancelled initiative is read-only even for the lead", async () => {
    renderCard(
      locale,
      initiative({ status: "cancelled", cancelReason: "Synthetic stop", cancelledAt: "2026-10-02T00:00:00Z" }),
    );
    expect(
      await screen.findByText(
        new RegExp(esc(t("portfolio.card.readOnly", { status: t("portfolio.status.cancelled") }))),
      ),
    ).toBeTruthy();
    expect(document.querySelectorAll("[data-transition]")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.card.edit")) })).toBeNull();
  });
});
