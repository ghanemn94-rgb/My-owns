// T-DG3-FE-E on the Initiative Card with stubbed API responses, English LTR and Arabic RTL. SYNTHETIC data.
//  - Funding decisions (REQ-S09-003, REQ-S04-006; ADR-0021 §3/§6, ADR-0023 §7): a labelled business approval for
//    `funding.approve` holders, no "on behalf of" control, rationale required, amount a decimal string (empty = Unknown),
//    the BE-E 422s translated as the dialog's one alert (`funding.amount_invalid` also inline at /amount), the history,
//    the deselect rule note, and Funded after an approved decision.
//  - Deliverables (create, edit, archive) and milestones (create, edit) with Idempotency-Key / If-Match; a closed
//    initiative is read-only; 422 `initiative.read_only` translated.
//  - RecordDialog `namespaces`: the card edit form translates `initiative.planned_range` specifically (FE-A §5.2).
import type { Permission } from "@mth/shared";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { AUDITOR_GRANTS, METHODOLOGY, id, leadGrants } from "../../test/p2fixtures.ts";
import { esc, initiative, page, problemBody, TR, wave } from "./p3fixtures.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
const tr = (locale: Locale) => createI18n(locale).t;
const W1 = wave();
const T0 = "2026-10-01T09:00:00Z";

const SELECTED = initiative({
  code: "INI-02",
  name: "Synthetic selected initiative",
  status: "selected",
  fundingState: "unfunded",
  waveId: W1.id,
  version: 4,
});
const CANCELLED = initiative({ code: "INI-09", name: "Synthetic cancelled initiative", status: "cancelled" });

const FIN_TL: Permission[] = ["funding.approve", "initiative.edit", "roadmap.edit"];

function deliverable(n: number, over: Record<string, unknown> = {}) {
  return {
    id: id(),
    organizationId: "o",
    transformationId: TR_ID,
    initiativeId: SELECTED.id,
    ordinal: n,
    title: `Synthetic deliverable ${n}`,
    description: null,
    ownerUserId: null,
    dueDate: null,
    acceptanceStatus: "pending",
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    acceptanceNote: null,
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 2,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

function milestone(over: Record<string, unknown> = {}) {
  return {
    id: id(),
    organizationId: "o",
    transformationId: TR_ID,
    initiativeId: SELECTED.id,
    waveId: null,
    title: "Synthetic pilot go-live",
    description: null,
    ownerUserId: null,
    approvedDate: null,
    approvedBy: null,
    approvedAt: null,
    approvalReason: null,
    forecastDate: "2026-11-20",
    actualDate: null,
    varianceDays: null,
    status: "planned",
    version: 3,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

function funding(over: Record<string, unknown> = {}) {
  return {
    id: id(),
    organizationId: "o",
    transformationId: TR_ID,
    initiativeId: SELECTED.id,
    decisionId: id(),
    decisionCode: "DEC-07",
    outcome: "approved",
    amount: null,
    currency: "SAR",
    fundingSource: null,
    conditions: null,
    rationale: "Synthetic: approved in the funding committee",
    businessCaseId: null,
    approverRoleCode: "FIN",
    decidedBy: USER_ID,
    onBehalfOfUserId: null,
    decidedAt: T0,
    ...over,
  };
}

function renderCard(
  locale: Locale,
  ini: ReturnType<typeof initiative>,
  perms: Permission[] | "auditor",
  extra: Handler[] = [],
  parts: { deliverables?: unknown[]; milestones?: unknown[]; funding?: unknown[] } = {},
) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(perms === "auditor" ? AUDITOR_GRANTS : leadGrants(perms), { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    ...extra,
    route("GET", new RegExp(`/api/v1/initiatives/${ini.id}$`), () => ({ status: 200, body: ini })),
    route("GET", new RegExp(`/api/v1/initiatives/${ini.id}/deliverables`), () => ({
      status: 200,
      body: { items: parts.deliverables ?? [], countWarning: { code: "initiative.deliverable_count", message: "x" } },
    })),
    route("GET", new RegExp(`/api/v1/initiatives/${ini.id}/milestones`), () => ({
      status: 200,
      body: { items: parts.milestones ?? [] },
    })),
    route("GET", /\/api\/v1\/funding-decisions\?/, () => page(parts.funding ?? [])),
    route("GET", new RegExp(`${esc(TR)}/waves`), () => page([W1])),
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  );
  renderApp(`/transformations/${TR_ID}/initiatives/${ini.id}`, { i18n: createI18n(locale) });
  return api;
}

const section = async (sid: string) => {
  await waitFor(() => expect(document.getElementById(sid)).not.toBeNull());
  return document.getElementById(sid)!.closest("section") as HTMLElement;
};

describe.each(["en", "ar"] as const)("Funding decisions (%s)", (locale) => {
  const t = tr(locale);
  const recordName = new RegExp(t("portfolio.fundingDecision.record"));

  it("is a labelled business approval with no 'on behalf of' control; rationale required; POST with an Idempotency-Key", async () => {
    let fundedNow = false;
    const { requests } = renderCard(locale, SELECTED, FIN_TL, [
      route("GET", new RegExp(`/api/v1/initiatives/${SELECTED.id}$`), () => ({
        status: 200,
        body: fundedNow ? { ...SELECTED, status: "funded", fundingState: "funded", version: 5 } : SELECTED,
      })),
      route("POST", /\/api\/v1\/funding-decisions$/, (req) => {
        fundedNow = true;
        return { status: 201, body: funding({ amount: (req.body as { amount?: string }).amount ?? null }) };
      }),
    ]);
    const button = await screen.findByRole("button", { name: recordName });
    expect(button.textContent).toContain(t("portfolio.businessApproval"));
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain(t("portfolio.businessApproval"));
    expect(dialog.textContent).toContain(t("portfolio.fundingDecision.inPerson"));
    // No delegation control: no field names a person to decide for.
    expect(within(dialog).queryByLabelText(/behalf|نيابة/i)).toBeNull();
    expect(dialog.querySelector("[name='onBehalfOfUserId']")).toBeNull();
    // The rationale is required: nothing is sent without it.
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.fundingDecision.confirm") }));
    const rationale = within(dialog).getByLabelText(new RegExp(`^${t("portfolio.fundingDecision.rationale")}`));
    await waitFor(() => expect(rationale.getAttribute("aria-invalid")).toBe("true"));
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
    fireEvent.change(rationale, { target: { value: "Synthetic: approved in the funding committee" } });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.fundingDecision.amount")}`)), {
      target: { value: "1250000.50" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.fundingDecision.confirm") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({
      initiativeId: SELECTED.id,
      outcome: "approved",
      amount: "1250000.50",
      currency: "SAR",
      rationale: "Synthetic: approved in the funding committee",
    });
    expect(post.headers["idempotency-key"]).toBeTruthy();
    expect(post.headers["if-match"]).toBeUndefined();
    // The card follows the server: Funded.
    await waitFor(() => expect(document.querySelector("[data-funding='funded']")).not.toBeNull());
  });

  it("the BE-E 422s are the dialog's one translated alert; funding.amount_invalid is also inline at /amount", async () => {
    let n = 0;
    renderCard(locale, SELECTED, FIN_TL, [
      route("POST", /\/api\/v1\/funding-decisions$/, () => {
        n += 1;
        return n === 1
          ? problemBody(422, "urn:mth:problem:invalid-transition", "funding.not_selected", "English detail")
          : problemBody(422, "urn:mth:problem:validation", "funding.amount_invalid", "English detail", [
              { pointer: "/amount", code: "funding.amount_invalid", message: "English" },
            ]);
      }),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: recordName }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.fundingDecision.rationale")}`)), {
      target: { value: "Synthetic rationale" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.fundingDecision.confirm") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("portfolio.problem.funding__not_selected"));
    expect(dialog.textContent).not.toContain("English detail");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    const amount = within(dialog).getByLabelText(new RegExp(`^${t("portfolio.fundingDecision.amount")}`));
    fireEvent.change(amount, { target: { value: "-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.fundingDecision.confirm") }));
    await waitFor(() => expect(amount.getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(within(dialog).getByRole("alert").textContent).toContain(t("portfolio.problem.funding__amount_invalid"));
  });

  it("the history shows a missing amount as Unknown (never 0); a re-selected initiative explains the deselect rule", async () => {
    renderCard(locale, SELECTED, FIN_TL, [], { funding: [funding({ amount: null })] });
    const history = await screen.findByTestId("funding-history");
    expect(history.querySelector("[data-funding-outcome='approved']")).not.toBeNull();
    expect(history.querySelector("[data-health='unknown']")).not.toBeNull();
    expect(history.textContent).not.toMatch(/(^|\s)0(\s|$)/);
    expect(history.textContent).toContain("DEC-07");
    expect(document.querySelector("[data-state='funding-voided']")?.textContent).toContain(
      t("portfolio.fundingDecision.voidedBySelection"),
    );
    expect(document.querySelector("[data-funding='unfunded']")?.textContent).toContain(
      t("portfolio.funding.selectedUnfunded"),
    );
  });

  it("an exact decimal amount is shown with its currency; the auditor sees no record control", async () => {
    renderCard(locale, SELECTED, "auditor", [], { funding: [funding({ amount: "1250000.5000" })] });
    const history = await screen.findByTestId("funding-history");
    expect(history.querySelector("[data-amount='1250000.5000']")?.textContent).toContain("SAR");
    expect(screen.queryByRole("button", { name: recordName })).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("Deliverables and milestones on the card (%s)", (locale) => {
  const t = tr(locale);

  it("creates (Idempotency-Key), edits (If-Match) and archives (reason, If-Match) a deliverable", async () => {
    const d1 = deliverable(1);
    const { requests } = renderCard(
      locale,
      SELECTED,
      FIN_TL,
      [
        route("POST", new RegExp(`/initiatives/${SELECTED.id}/deliverables$`), () => ({
          status: 201,
          body: deliverable(2),
        })),
        route("PATCH", new RegExp(`/deliverables/${d1.id}$`), () => ({ status: 200, body: { ...d1, version: 3 } })),
      ],
      { deliverables: [d1] },
    );
    const sec = await section("deliverables");
    expect(sec.querySelector("[data-warning='initiative.deliverable_count']")).not.toBeNull();
    fireEvent.click(await within(sec).findByRole("button", { name: new RegExp(t("portfolio.deliverable.add")) }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.deliverable.fieldTitle")}`)), {
      target: { value: "Synthetic deliverable 2" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.deliverable.dueDate")}`)), {
      target: { value: "2026-12-15" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.deliverable.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const create = requests.find((r) => r.method === "POST")!;
    expect(create.body).toEqual({ title: "Synthetic deliverable 2", dueDate: "2026-12-15" });
    expect(create.headers["idempotency-key"]).toBeTruthy();

    fireEvent.click(within(sec).getByRole("button", { name: new RegExp(`^${t("portfolio.deliverable.edit")}`) }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.deliverable.fieldTitle")}`)), {
      target: { value: "Synthetic deliverable 1 (renamed)" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const edit = requests.filter((r) => r.method === "PATCH")[0]!;
    expect(edit.body).toEqual({ title: "Synthetic deliverable 1 (renamed)" });
    expect(edit.headers["if-match"]).toBe('"2"');

    fireEvent.click(within(sec).getByRole("button", { name: new RegExp(`^${t("portfolio.deliverable.archive")}`) }));
    dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.deliverable.archive") }));
    const reason = within(dialog).getByLabelText(new RegExp(`^${t("portfolio.deliverable.archiveReason")}`));
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
    fireEvent.change(reason, { target: { value: "Synthetic: merged into deliverable 2" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.deliverable.archive") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const archive = requests.filter((r) => r.method === "PATCH")[1]!;
    expect(archive.body).toEqual({ archiveReason: "Synthetic: merged into deliverable 2" });
    expect(archive.headers["if-match"]).toBe('"2"');
  });

  it("creates a milestone with its wave and forecast, and edits it with If-Match", async () => {
    const m = milestone();
    const { requests } = renderCard(
      locale,
      SELECTED,
      FIN_TL,
      [
        route("POST", new RegExp(`/initiatives/${SELECTED.id}/milestones$`), () => ({ status: 201, body: m })),
        route("PATCH", new RegExp(`/milestones/${m.id}$`), () => ({ status: 200, body: { ...m, version: 4 } })),
      ],
      { milestones: [m] },
    );
    const sec = await section("milestones");
    fireEvent.click(await within(sec).findByRole("button", { name: new RegExp(t("portfolio.milestone.add")) }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.milestone.fieldTitle")}`)), {
      target: { value: "Synthetic pilot go-live" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.milestone.forecast")}`)), {
      target: { value: "2026-11-20" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.milestone.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const create = requests.find((r) => r.method === "POST")!;
    // The initiative's wave is the default.
    expect(create.body).toEqual({ title: "Synthetic pilot go-live", waveId: W1.id, forecastDate: "2026-11-20" });

    fireEvent.click(within(sec).getByRole("button", { name: new RegExp(`^${t("portfolio.milestone.edit")}`) }));
    dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.milestone.forecast")}`)), {
      target: { value: "2026-12-05" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const edit = requests.find((r) => r.method === "PATCH")!;
    expect(edit.body).toEqual({ forecastDate: "2026-12-05" });
    expect(edit.headers["if-match"]).toBe('"3"');
  });

  it("422 initiative.read_only (a closure raced the edit) is translated as the dialog's one alert", async () => {
    renderCard(locale, SELECTED, FIN_TL, [
      route("POST", new RegExp(`/initiatives/${SELECTED.id}/deliverables$`), () =>
        problemBody(422, "urn:mth:problem:invalid-transition", "initiative.read_only", "English detail"),
      ),
    ]);
    const sec = await section("deliverables");
    fireEvent.click(await within(sec).findByRole("button", { name: new RegExp(t("portfolio.deliverable.add")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.deliverable.fieldTitle")}`)), {
      target: { value: "Synthetic deliverable" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("portfolio.deliverable.add") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("portfolio.problem.initiative__read_only"));
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
  });

  it("a cancelled initiative shows deliverables, milestones and funding with no write control", async () => {
    renderCard(locale, CANCELLED, FIN_TL, [], { deliverables: [deliverable(1)], milestones: [milestone()] });
    await section("deliverables");
    await screen.findByText("Synthetic deliverable 1");
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.deliverable.add")) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${t("portfolio.deliverable.edit")}`) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.milestone.add")) })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("portfolio.fundingDecision.record")) })).toBeNull();
  });

  it("the card edit form translates initiative.planned_range specifically (RecordDialog namespaces)", async () => {
    renderCard(locale, SELECTED, FIN_TL, [
      route("PATCH", new RegExp(`/api/v1/initiatives/${SELECTED.id}$`), () =>
        problemBody(422, "urn:mth:problem:validation", "initiative.planned_range", "English detail", [
          { pointer: "/plannedEnd", code: "initiative.planned_range", message: "English" },
        ]),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("portfolio.card.edit")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.field.plannedStart")}`)), {
      target: { value: "2027-02-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${t("portfolio.field.plannedEnd")}`)), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("portfolio.problem.initiative__planned_range"));
    expect(dialog.textContent).not.toContain("English");
    const end = within(dialog).getByLabelText(new RegExp(`^${t("portfolio.field.plannedEnd")}`));
    expect(end.getAttribute("aria-invalid")).toBe("true");
  });
});
