// F-DG2-210 / D-063 (T-DG2-FE6): one blank-text rule in every hand-written P2 form, in English LTR and Arabic RTL,
// against a scripted API (SYNTHETIC data; docs/api/openapi.yaml shapes). For the gate submission note, the gate
// decision rationale and comments, the journey step editor, the row-action note (Finance validation), the reason
// dialog (archive) and the North Star statement:
//  - a whitespace-only or invisible-only value ("‏") is an inline `problems.validation__blank` message with
//    aria-invalid and aria-describedby, focus moves to the first invalid field, and NO request is sent;
//  - visible text is sent verbatim (no trim());
//  - "" keeps today's meaning (optional omitted / null, required "required" or "too short").
// A server 400 `validation.blank` lands on its field (ReasonDialog `/reason`, P1 transformation `/name`).
// Product gates G1-G6 are business approvals; these are synthetic test decisions only.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../i18n/index.ts";
import {
  BUSINESS_UNIT,
  OFFICE_GRANTS,
  TR_ID,
  USER_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type Handler,
  type RecordedRequest,
} from "../test/fixtures.tsx";
import { METHODOLOGY, baseline, canvasCell, gateViews, leadGrants } from "../test/p2fixtures.ts";

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
const LOCALES = ["en", "ar"] as const;
// F-DG2-220: one translation-only i18n instance per locale (the app under test still gets a fresh one per render), so
// assertion helpers such as blankMessage() don't build a new i18next instance on every call.
const translators = new Map<Locale, ReturnType<typeof createI18n>["t"]>();
const tr = (locale: Locale) => {
  let t = translators.get(locale);
  if (!t) translators.set(locale, (t = createI18n(locale).t));
  return t;
};
const blankMessage = (locale: Locale) => tr(locale)("problems.validation__blank");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A label that may be followed by " (required)". */
const labelled = (text: string) => new RegExp(`^${esc(text)}`);

const WHITESPACE = "   \t ";
const INVISIBLE = "‏";
const INVISIBLES = "‏‏‏⁠";
const VERBATIM = "  Synthetic: نص مرئي‏  ";

const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const TR = `/api/v1/transformations/${TR_ID}`;
const list = (resource: string, items: unknown[]): Handler =>
  route("GET", new RegExp(`${esc(TR)}/${resource}(\\?|$)`), () => page(items));

function base(grants: ReturnType<typeof leadGrants>, locale: Locale): Handler[] {
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
const emptyRegisters: Handler = (req) =>
  req.method === "GET" &&
  /\/api\/v1\/(transformations\/[^/]+\/[a-z-]+(\/[^/]+\/[a-z-]+)?|decisions)(\?|$)/.test(req.url) &&
  !/\/(tom-canvas|gates|charter|north-star|methodology)(\?|$)/.test(req.url)
    ? page([])
    : undefined;

function render(path: string, handlers: Handler[], locale: Locale) {
  const api = mockApi(...handlers, emptyRegisters);
  const utils = renderApp(path, { i18n: createI18n(locale) });
  return { ...api, ...utils };
}

const writes = (requests: RecordedRequest[]) => requests.filter((r) => r.method !== "GET");

/**
 * F-DG2-220: the Diagnose and Design pages are large, and a screen-wide `findByRole(..., { name })` recomputes the
 * accessible name of every button on every poll while the page loads (the round-4 flake waited here). Wait for the
 * page once, with a cheap text query, for the table row that shows `text`, and scope the role queries to that row.
 * The wait uses the unit-web async-utility timeout (apps/web/test/setup.ts).
 */
async function rowOf(text: string): Promise<HTMLElement> {
  return waitFor(() => {
    const row = screen
      .getAllByText(text)
      .map((el) => el.closest("tr"))
      .find((r): r is HTMLTableRowElement => r !== null);
    if (!row) throw new Error(`no table row shows "${text}" yet`);
    return row;
  });
}

/** The field shows the localized blank message (linked by aria-describedby), is aria-invalid and has focus. */
async function expectBlankOn(field: HTMLElement, locale: Locale) {
  const expected = blankMessage(locale);
  await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
  const describedBy = (field.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
  expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain(expected);
  await waitFor(() => expect(document.activeElement).toBe(field));
}

// ------------------------------------------------------------------------------------------------ gate submission

describe.each(LOCALES)("gate submission note (%s)", (locale) => {
  const t = tr(locale);
  const open = async (handlers: Handler[] = []) => {
    const views = gateViews({ canSubmit: true });
    const api = render(
      `/transformations/${TR_ID}/gates/G1`,
      [
        ...base(leadGrants(), locale),
        route("GET", /\/gates\/G1$/, () => ({ status: 200, body: views[0] })),
        ...handlers,
        route("POST", /\/gates\/G1\/submissions$/, () => ({ status: 201, body: {} })),
      ],
      locale,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("gates.submit.action") }));
    const dialog = await screen.findByRole("dialog");
    const note = within(dialog).getByLabelText(t("gates.submit.note"));
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    return { ...api, dialog, note, submit };
  };

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLE],
  ])("a %s-only note is refused inline and nothing is sent", async (_, value) => {
    const { requests, note, submit } = await open();
    fireEvent.change(note, { target: { value } });
    submit();
    await expectBlankOn(note, locale);
    expect(writes(requests)).toEqual([]);
  });

  it("visible text is sent verbatim; an empty note is omitted", async () => {
    const { requests, note, submit } = await open();
    fireEvent.change(note, { target: { value: VERBATIM } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    expect(writes(requests)[0]!.body).toEqual({ submissionNote: VERBATIM });
    cleanup();
    const second = await open();
    second.submit();
    await waitFor(() => expect(writes(second.requests)).toHaveLength(1));
    expect(writes(second.requests)[0]!.body).toEqual({});
  });
});

// ------------------------------------------------------------------------------------------------ gate decision

describe.each(LOCALES)("gate decision rationale and comments (%s)", (locale) => {
  const t = tr(locale);
  const open = async (
    respond: Handler = route("POST", /\/gates\/G1\/decision$/, () => ({ status: 201, body: {} })),
  ) => {
    const api = render(
      `/transformations/${TR_ID}/gates/G1`,
      [
        ...base(leadGrants(["gate.decide"]), locale),
        route("GET", /\/gates\/G1$/, () => ({ status: 200, body: gateViews({ pending: true, canDecide: true })[0] })),
        respond,
      ],
      locale,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("gates.decision.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("gates.outcome.approved") }));
    const rationale = within(dialog).getByLabelText(labelled(t("gates.decision.rationale")));
    const comments = within(dialog).getByLabelText(t("gates.decision.comments"));
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    return { ...api, dialog, rationale, comments, submit };
  };

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLE],
    ["invisible (long enough for min 3)", INVISIBLES],
  ])("a %s-only rationale is refused inline and nothing is sent", async (_, value) => {
    const { requests, rationale, submit } = await open();
    fireEvent.change(rationale, { target: { value } });
    submit();
    await expectBlankOn(rationale, locale);
    expect(writes(requests)).toEqual([]);
  });

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLE],
  ])("a %s-only comment is refused inline (focus on it) and nothing is sent", async (_, value) => {
    const { requests, rationale, comments, submit } = await open();
    fireEvent.change(rationale, { target: { value: "Synthetic rationale" } });
    fireEvent.change(comments, { target: { value } });
    submit();
    await expectBlankOn(comments, locale);
    expect(rationale.getAttribute("aria-invalid")).toBeNull();
    expect(writes(requests)).toEqual([]);
  });

  it("visible text is sent verbatim; empty comments are omitted; an empty rationale stays 'too short'", async () => {
    const { requests, rationale, submit, dialog } = await open();
    submit();
    expect(await within(dialog).findByText(t("problems.validation__too_small"))).toBeTruthy();
    expect(writes(requests)).toEqual([]);
    fireEvent.change(rationale, { target: { value: VERBATIM } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    expect(writes(requests)[0]!.body).toEqual({ submissionNo: 1, outcome: "approved", rationale: VERBATIM });
  });

  it("a server 400 validation.blank on /rationale lands on the field", async () => {
    const { requests, rationale, submit, dialog } = await open(
      route("POST", /\/gates\/G1\/decision$/, () =>
        problem(400, "validation", { errors: [{ pointer: "/rationale", code: "validation.blank", message: "x" }] }),
      ),
    );
    fireEvent.change(rationale, { target: { value: "Synthetic rationale" } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    await expectBlankOn(rationale, locale);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ journey steps

const STEP_KEY = "01920000-0000-7000-8000-0000000000c1";
const journeyFixture = {
  id: "01920000-0000-7000-c000-000000000010",
  organizationId: "01920000-0000-7000-9000-000000000001",
  transformationId: TR_ID,
  version: 2,
  createdAt: "2026-09-30T09:00:00Z",
  createdBy: USER_ID,
  updatedAt: "2026-09-30T09:00:00Z",
  updatedBy: USER_ID,
  name: "Synthetic onboarding journey",
  kind: "journey",
  state: "current",
  description: null,
  dimensionCode: null,
  steps: [
    {
      key: STEP_KEY,
      ordinal: 1,
      name: "Synthetic step",
      actor: "Synthetic agent",
      handoffTo: null,
      systems: [],
      controls: [],
      cycleTimeValue: null,
      cycleTimeUnit: null,
    },
  ],
  cycleTimeValue: null,
  cycleTimeUnit: null,
  failureDemand: null,
  ownerUserId: USER_ID,
  status: "active",
  archivedAt: null,
  archivedBy: null,
  archiveReason: null,
};

describe.each(LOCALES)("journey step editor (%s)", (locale) => {
  const t = tr(locale);
  const open = async () => {
    const api = render(
      `/transformations/${TR_ID}/design`,
      [
        ...base(leadGrants(), locale),
        route("GET", /\/tom-canvas$/, () => ({
          status: 200,
          body: { cells: Array.from({ length: 10 }, (_, i) => canvasCell(i)) },
        })),
        list("journeys", [journeyFixture]),
        route("PATCH", /\/journeys\/[^/]+$/, () => ({ status: 200, body: { ...journeyFixture, version: 3 } })),
      ],
      locale,
    );
    const row = await rowOf(journeyFixture.name);
    fireEvent.click(
      await within(row).findByRole("button", { name: `${t("design.journeys.open")}: ${journeyFixture.name}` }),
    );
    await waitFor(() => expect(document.getElementById("journey-detail")).not.toBeNull());
    const detail = document.getElementById("journey-detail")!;
    fireEvent.click(await within(detail).findByRole("button", { name: t("design.journeys.editSteps") }));
    const dialog = await screen.findByRole("dialog");
    const field = (label: string) =>
      within(dialog).getByLabelText(label === t("common.field.name") ? labelled(label) : label);
    const save = () => fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    return { ...api, dialog, field, save };
  };

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLE],
  ])("a %s-only actor is refused inline (not turned into null) and nothing is sent", async (_, value) => {
    const { requests, field, save } = await open();
    const actor = field(t("design.journeys.actor"));
    fireEvent.change(actor, { target: { value } });
    save();
    await expectBlankOn(actor, locale);
    expect(writes(requests)).toEqual([]);
  });

  it("several blank fields: each gets the message and focus goes to the first (name)", async () => {
    const { requests, field, save } = await open();
    const name = field(t("common.field.name"));
    const handoff = field(t("design.journeys.handoffTo"));
    const cycle = field(t("design.journeys.cycleTime"));
    const systems = field(t("design.journeys.systemsHint"));
    fireEvent.change(name, { target: { value: WHITESPACE } });
    fireEvent.change(handoff, { target: { value: INVISIBLE } });
    fireEvent.change(cycle, { target: { value: "  " } });
    fireEvent.change(systems, { target: { value: `CRM, ${INVISIBLE}` } });
    save();
    await expectBlankOn(name, locale);
    for (const f of [handoff, cycle, systems]) expect(f.getAttribute("aria-invalid")).toBe("true");
    expect(writes(requests)).toEqual([]);
  });

  it("visible text is sent verbatim; emptied optional text is null; an empty name is required", async () => {
    const { requests, field, save, dialog } = await open();
    const name = field(t("common.field.name"));
    fireEvent.change(name, { target: { value: "" } });
    save();
    expect(await within(dialog).findByText(t("problems.validation__required"))).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(name));
    expect(writes(requests)).toEqual([]);
    fireEvent.change(name, { target: { value: VERBATIM } });
    fireEvent.change(field(t("design.journeys.actor")), { target: { value: "" } });
    fireEvent.change(field(t("design.journeys.handoffTo")), { target: { value: "  Synthetic team‏ " } });
    save();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    const body = writes(requests)[0]!.body as { steps: Record<string, unknown>[] };
    expect(body.steps[0]).toMatchObject({
      key: STEP_KEY,
      name: VERBATIM,
      actor: null,
      handoffTo: "  Synthetic team‏ ",
      cycleTimeValue: null,
    });
  });
});

// ------------------------------------------------------------------------------------------------ row-action note + reason

describe.each(LOCALES)("Finance validation note and archive reason (%s)", (locale) => {
  const t = tr(locale);
  const b = baseline({ metric: "Synthetic handling time" });
  /** Renders the Diagnose page and waits once for the baseline's row (F-DG2-220). */
  const open = async (archive: Handler = route("POST", /\/archive$/, () => ({ status: 200, body: b }))) => {
    const api = render(
      `/transformations/${TR_ID}/diagnose`,
      [
        ...base(leadGrants(["finance.validate"]), locale),
        list("baselines", [b]),
        route("POST", /\/finance-validation$|\/validation$/, () => ({ status: 200, body: b })),
        archive,
      ],
      locale,
    );
    return { ...api, row: await rowOf(b.metric) };
  };
  const openValidation = async (row: HTMLElement) => {
    fireEvent.click(await within(row).findByRole("button", { name: `${t("kpi.validation.action")}: ${b.metric}` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("kpi.validation.validated") }));
    const note = within(dialog).getByLabelText(labelled(t("kpi.validation.note")));
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("kpi.validation.record") }));
    return { dialog, note, submit };
  };
  const openArchive = async (row: HTMLElement) => {
    fireEvent.click(await within(row).findByRole("button", { name: `${t("common.action.archive")}: ${b.metric}` }));
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText(labelled(t("common.form.reason")));
    const submit = () => fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.archive") }));
    return { dialog, reason, submit };
  };

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLE],
  ])("note: a %s-only note is refused inline and nothing is sent", async (_, value) => {
    const { requests, row } = await open();
    const { note, submit } = await openValidation(row);
    fireEvent.change(note, { target: { value } });
    submit();
    await expectBlankOn(note, locale);
    expect(writes(requests)).toEqual([]);
  });

  it("note: empty is 'required'; visible text is sent verbatim", async () => {
    const { requests, row } = await open();
    const { note, submit, dialog } = await openValidation(row);
    submit();
    expect(await within(dialog).findByText(t("problems.validation__required"))).toBeTruthy();
    expect(writes(requests)).toEqual([]);
    fireEvent.change(note, { target: { value: VERBATIM } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    expect(writes(requests)[0]!.body).toEqual({ result: "validated", note: VERBATIM });
  });

  it.each([
    ["whitespace", WHITESPACE],
    ["invisible", INVISIBLES],
  ])("reason: a %s-only reason is refused inline and nothing is archived", async (_, value) => {
    const { requests, row } = await open();
    const { reason, submit } = await openArchive(row);
    fireEvent.change(reason, { target: { value } });
    submit();
    await expectBlankOn(reason, locale);
    expect(writes(requests)).toEqual([]);
  });

  it("reason: a server 400 validation.blank on /reason is the field message, not a generic error", async () => {
    const { requests, row } = await open(
      route("POST", /\/archive$/, () =>
        problem(400, "validation", { errors: [{ pointer: "/reason", code: "validation.blank", message: "x" }] }),
      ),
    );
    const { reason, submit, dialog } = await openArchive(row);
    fireEvent.change(reason, { target: { value: "Synthetic reason" } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    await expectBlankOn(reason, locale);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("reason: empty keeps 'too short'; visible text is sent verbatim", async () => {
    const { requests, row } = await open();
    const { reason, submit, dialog } = await openArchive(row);
    submit();
    expect(await within(dialog).findByText(t("problems.validation__too_small"))).toBeTruthy();
    expect(writes(requests)).toEqual([]);
    fireEvent.change(reason, { target: { value: VERBATIM } });
    submit();
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    expect(writes(requests)[0]!.body).toEqual({ reason: VERBATIM });
  });
});

// ------------------------------------------------------------------------------------------------ North Star

describe.each(LOCALES)("North Star statement (%s)", (locale) => {
  const t = tr(locale);
  it.each([
    ["whitespace", WHITESPACE.replace("\t", " ")],
    ["invisible", INVISIBLE],
  ])("a %s-only statement is refused inline and nothing is sent", async (_, value) => {
    const { requests } = render(
      `/transformations/${TR_ID}/define`,
      [...base(leadGrants(), locale), route("GET", /\/north-star$/, () => problem(404, "north_star_not_found"))],
      locale,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("define.northStar.set") }));
    const statement = await screen.findByLabelText(labelled(t("define.northStar.statement")));
    fireEvent.change(statement, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: t("define.northStar.save") }));
    await expectBlankOn(statement, locale);
    expect(writes(requests)).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------ P1 server mapping

describe.each(LOCALES)("P1 transformation edit: server validation.blank on /name (%s)", (locale) => {
  it("is the localized field message, not only a generic failure", async () => {
    const t = tr(locale);
    const loaded = makeTransformation({ version: 1, name: "Original" });
    const { requests } = mockApi(
      route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: makeMe(OFFICE_GRANTS, { preferredLocale: locale }) })),
      route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
      route("PATCH", /\/api\/v1\/transformations\//, () =>
        problem(400, "validation", { errors: [{ pointer: "/name", code: "validation.blank", message: "x" }] }),
      ),
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: loaded })),
      route("GET", /\/audit/, () => page([])),
    );
    renderApp(`/transformations/${loaded.id}/edit`, { i18n: createI18n(locale) });
    const name = await screen.findByLabelText(labelled(t("transformations.field.name")));
    fireEvent.change(name, { target: { value: "Synthetic name" } });
    fireEvent.click(screen.getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(writes(requests)).toHaveLength(1));
    await waitFor(() => expect(name.getAttribute("aria-invalid")).toBe("true"));
    const describedBy = (name.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
    expect(describedBy.map((id) => document.getElementById(id)?.textContent ?? "").join(" ")).toContain(
      blankMessage(locale),
    );
  });
});
