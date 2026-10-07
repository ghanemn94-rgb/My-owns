// T-DG2-FE12 (REQ-S15-007): a message that is visible while the user switches language follows the new language.
// Component state holds a key, a code or the values, never translated text, and the text is translated at render time
// (as LanguageSwitch does since FE11). For every place the FE12 sweep fixed, the message is made visible in one
// language, the language is switched (EN→AR and AR→EN) while it stays visible, and the same element must then show
// exactly the other language's text (and never the previous one's), with <html lang dir> following.
// Places: sign-in (invalid user name; server refusal), journey step editor (field error; "Step N:" form error), reason
// dialog, row-action note, record form (field error; form-level list), gate submission note, gate decision rationale,
// North Star statement, evidence upload (file) and evidence link (record type, record). The Team success notice is in
// pages/team/team.test.tsx. All under <StrictMode>, as in production. SYNTHETIC data, scripted API.
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { journeyUpdate } from "@mth/shared/schemas";
import { setCsrfToken } from "../api/client.ts";
import { AppProviders, createQueryClient } from "../app/App.tsx";
import { issueCode } from "../components/Form.tsx";
import { RecordDialog, type FieldSpec } from "../components/RecordForm.tsx";
import { createI18n } from "../i18n/index.ts";
import { fieldErrorMessage } from "../lib/problem.ts";
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
import { METHODOLOGY, baseline, canvasCell, evidence, gateViews, leadGrants } from "../test/p2fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  setCsrfToken(null);
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "en" | "ar";
type I18n = ReturnType<typeof createI18n>;
const DIRECTIONS = [
  { from: "en" as Locale, to: "ar" as Locale },
  { from: "ar" as Locale, to: "en" as Locale },
];
const translators = new Map<Locale, I18n["t"]>();
const tr = (locale: Locale) => {
  let t = translators.get(locale);
  if (!t) translators.set(locale, (t = createI18n(locale).t));
  return t;
};
// Built once at load, before any test renders: createI18n() also applies its locale to <html>, so building a
// translator during a test would itself change <html lang dir> and hide whether the app did it.
tr("en");
tr("ar");
const DIR = { en: "ltr", ar: "rtl" } as const;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A label that may be followed by " (required)" (and nothing else: "Record" never matches "Record type"). */
const labelled = (text: string) => new RegExp(`^${esc(text)}(\\s*\\(.*\\))?$`);
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });
const TR = `/api/v1/transformations/${TR_ID}`;
const list = (resource: string, items: unknown[]): Handler =>
  route("GET", new RegExp(`${esc(TR)}/${resource}(\\?|$)`), () => page(items));

function base(locale: Locale, extra: Parameters<typeof leadGrants>[0] = []): Handler[] {
  return [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(extra), { preferredLocale: locale }),
    })),
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

function renderAt(path: string, handlers: Handler[], locale: Locale) {
  const api = mockApi(...handlers, emptyRegisters);
  return { ...api, ...renderApp(path, { i18n: createI18n(locale), strict: true }) };
}

/** The text of the elements that describe `field` (its hint and its error). */
const describedText = (field: HTMLElement) =>
  (field.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => (document.getElementById(id)?.textContent ?? "").trim())
    .join(" ");

/**
 * The core check. `read()` returns the visible message's text and `expected(locale)` the message in a locale. The
 * message is visible in `from`, the language is switched to `to` while it stays visible, and then it says exactly
 * `to`'s text, no longer `from`'s, and <html lang dir> follows.
 */
async function expectFollowsSwitch(
  i18n: I18n,
  from: Locale,
  to: Locale,
  read: () => string,
  expected: (locale: Locale) => string,
) {
  const before = expected(from);
  const after = expected(to);
  expect(after).not.toBe(before); // the two languages really differ
  await waitFor(() => expect(read()).toContain(before));
  expect(document.documentElement.lang).toBe(from);
  expect(document.documentElement.dir).toBe(DIR[from]);
  await act(async () => {
    await i18n.changeLanguage(to);
  });
  await waitFor(() => expect(read()).toContain(after));
  expect(read()).not.toContain(before);
  expect(document.documentElement.lang).toBe(to);
  expect(document.documentElement.dir).toBe(DIR[to]);
}

// ------------------------------------------------------------------------------------------------ sign-in

describe.each(DIRECTIONS)("sign-in (dev form), $from → $to", ({ from, to }) => {
  const open = (refuseLogin: boolean) => {
    mockApi(
      route("GET", /\/api\/v1\/me$/, () => problem(401, "unauthenticated")),
      route("POST", /dev-login/, (req) =>
        req.body && Object.keys(req.body as object).length === 0
          ? problem(400, "validation")
          : refuseLogin
            ? problem(403, "forbidden")
            : undefined,
      ),
    );
    localStorage.setItem("mth.locale", from);
    return renderApp("/login", { i18n: createI18n(from), strict: true });
  };
  /** The real language switch of the sign-in page (signed out: nothing is saved). */
  const clickSwitch = async () => {
    const name = tr(from)("common.language.switchTo", { language: from === "en" ? "العربية" : "English" });
    fireEvent.click(await screen.findByRole("button", { name }));
  };

  it("an invalid user name: the inline message follows the switch", async () => {
    const { i18n } = open(false);
    const input = await screen.findByLabelText(tr(from)("auth.dev.username"));
    fireEvent.change(input, { target: { value: "X" } });
    fireEvent.click(screen.getByRole("button", { name: tr(from)("auth.dev.submit") }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(tr(from)("auth.dev.invalidUsername"));
    await clickSwitch();
    await waitFor(() => expect(i18n.language).toBe(to));
    await waitFor(() => expect(alert.textContent).toContain(tr(to)("auth.dev.invalidUsername")));
    expect(alert.textContent).not.toContain(tr(from)("auth.dev.invalidUsername"));
    expect(describedText(input)).toContain(tr(to)("auth.dev.invalidUsername"));
    expect(document.documentElement.dir).toBe(DIR[to]);
  });

  it("a refused sign-in: the server's problem follows the switch", async () => {
    const { i18n } = open(true);
    const input = await screen.findByLabelText(tr(from)("auth.dev.username"));
    fireEvent.change(input, { target: { value: "synthetic.user" } });
    fireEvent.click(screen.getByRole("button", { name: tr(from)("auth.dev.submit") }));
    const alert = await screen.findByRole("alert");
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => alert.textContent ?? "",
      (l) => tr(l)("problems.forbidden"),
    );
  });
});

// ------------------------------------------------------------------------------------------------ journey step editor

const STEP_KEY = "01920000-0000-7000-8000-0000000000c1";
const journeyFixture = (stepKey: string) => ({
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
      key: stepKey,
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
});

describe.each(DIRECTIONS)("journey step editor, $from → $to", ({ from, to }) => {
  const open = async (stepKey: string) => {
    const t = tr(from);
    const j = journeyFixture(stepKey);
    const utils = renderAt(
      `/transformations/${TR_ID}/design`,
      [
        ...base(from),
        route("GET", /\/tom-canvas$/, () => ({
          status: 200,
          body: { cells: Array.from({ length: 10 }, (_, i) => canvasCell(i)) },
        })),
        list("journeys", [j]),
      ],
      from,
    );
    const row = await waitFor(() => {
      const r = screen
        .getAllByText(j.name)
        .map((el) => el.closest("tr"))
        .find((x): x is HTMLTableRowElement => x !== null);
      if (!r) throw new Error("journey row not shown yet");
      return r;
    });
    fireEvent.click(await within(row).findByRole("button", { name: `${t("design.journeys.open")}: ${j.name}` }));
    await waitFor(() => expect(document.getElementById("journey-detail")).not.toBeNull());
    const detail = document.getElementById("journey-detail")!;
    fireEvent.click(await within(detail).findByRole("button", { name: t("design.journeys.editSteps") }));
    const dialog = await screen.findByRole("dialog");
    const save = () => fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    return { ...utils, dialog, save };
  };

  it("a field error on a step follows the switch", async () => {
    const { i18n, dialog, save } = await open(STEP_KEY);
    const actor = within(dialog).getByLabelText(tr(from)("design.journeys.actor"));
    fireEvent.change(actor, { target: { value: "   " } });
    save();
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(actor),
      (l) => tr(l)("problems.validation__blank"),
    );
  });

  it('the form-level "Step N:" error follows the switch (prefix and message)', async () => {
    // A legacy step whose key is not a UUID: the issue is on the step but not on a text field.
    const badKey = "legacy-step-key";
    const parsed = journeyUpdate.safeParse({ steps: [{ key: badKey, ordinal: 1, name: "x" }] });
    expect(parsed.success).toBe(false);
    const code = issueCode(parsed.error!.issues[0]!);
    const { i18n, dialog, save } = await open(badKey);
    save();
    const alert = await within(dialog).findByRole("alert");
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => alert.textContent ?? "",
      (l) => `${tr(l)("design.journeys.step")} 1: ${fieldErrorMessage(tr(l), code)}`,
    );
  });
});

// ------------------------------------------------------------------------------------------------ row action + reason

describe.each(DIRECTIONS)("row-action note and reason dialog, $from → $to", ({ from, to }) => {
  const b = baseline({ metric: "Synthetic handling time" });
  const open = async () => {
    const utils = renderAt(
      `/transformations/${TR_ID}/diagnose`,
      [...base(from, ["finance.validate"]), list("baselines", [b])],
      from,
    );
    const row = await waitFor(() => {
      const r = screen
        .getAllByText(b.metric)
        .map((el) => el.closest("tr"))
        .find((x): x is HTMLTableRowElement => x !== null);
      if (!r) throw new Error("baseline row not shown yet");
      return r;
    });
    return { ...utils, row };
  };

  it("the Finance validation note's 'required' follows the switch", async () => {
    const { i18n, row } = await open();
    const t = tr(from);
    fireEvent.click(await within(row).findByRole("button", { name: `${t("kpi.validation.action")}: ${b.metric}` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("kpi.validation.validated") }));
    const note = within(dialog).getByLabelText(labelled(t("kpi.validation.note")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("kpi.validation.record") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(note),
      (l) => tr(l)("problems.validation__required"),
    );
  });

  it("the Finance validation choice's 'required' follows the switch", async () => {
    const { i18n, row } = await open();
    const t = tr(from);
    fireEvent.click(await within(row).findByRole("button", { name: `${t("kpi.validation.action")}: ${b.metric}` }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("kpi.validation.record") }));
    const group = within(dialog).getAllByRole("radio")[0]!.closest("fieldset")!;
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => group.querySelector(".field__error")?.textContent ?? "",
      (l) => tr(l)("problems.validation__required"),
    );
  });

  it("the archive reason's 'too short' follows the switch", async () => {
    const { i18n, row } = await open();
    const t = tr(from);
    fireEvent.click(await within(row).findByRole("button", { name: `${t("common.action.archive")}: ${b.metric}` }));
    const dialog = await screen.findByRole("dialog");
    const reason = within(dialog).getByLabelText(labelled(t("common.form.reason")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.archive") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(reason),
      (l) => tr(l)("problems.validation__too_small"),
    );
  });
});

// ------------------------------------------------------------------------------------------------ record form

describe.each(DIRECTIONS)("record form, $from → $to", ({ from, to }) => {
  const FIELDS: readonly FieldSpec[] = [
    { name: "name", kind: "text", label: "Name (synthetic)", required: true },
    { name: "notes", kind: "textarea", label: "Notes (synthetic)" },
  ];
  const open = (respond: Handler) => {
    mockApi(respond);
    const i18n = createI18n(from);
    rtlRender(
      <StrictMode>
        <AppProviders i18n={i18n} queryClient={createQueryClient()}>
          <RecordDialog
            fields={FIELDS}
            record={null}
            createUrl="/api/v1/synthetic-records"
            submitLabel="Save (synthetic)"
            title="Synthetic record"
            onSaved={() => undefined}
            onCancel={() => undefined}
          />
        </AppProviders>
      </StrictMode>,
    );
    return i18n;
  };

  it("a client field error (blank) follows the switch", async () => {
    const i18n = open(route("POST", /synthetic-records/, () => ({ status: 201, body: {} })));
    const name = screen.getByLabelText(/^Name \(synthetic\)/);
    fireEvent.change(name, { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save (synthetic)" }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(name),
      (l) => tr(l)("problems.validation__blank"),
    );
  });

  it("a server field error and a form-level (unmapped) error both follow the switch", async () => {
    const i18n = open(
      route("POST", /synthetic-records/, () =>
        problem(400, "validation", {
          errors: [
            { pointer: "/name", code: "validation.too_big", message: "x" },
            { pointer: "/elsewhere", code: "validation.invalid_character", message: "x" },
          ],
        }),
      ),
    );
    const name = screen.getByLabelText(/^Name \(synthetic\)/);
    fireEvent.change(name, { target: { value: "Synthetic name" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (synthetic)" }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(name),
      (l) => tr(l)("problems.validation__too_big"),
    );
    const list = document.querySelector("[data-state='form-errors']")!;
    expect(list.textContent).toContain(tr(to)("problems.validation__invalid_character"));
    expect(list.textContent).not.toContain(tr(from)("problems.validation__invalid_character"));
  });
});

// ------------------------------------------------------------------------------------------------ gates

describe.each(DIRECTIONS)("gate dialogs, $from → $to", ({ from, to }) => {
  it("the submission note's field error follows the switch", async () => {
    const t = tr(from);
    const { i18n } = renderAt(
      `/transformations/${TR_ID}/gates/G1`,
      [...base(from), route("GET", /\/gates\/G1$/, () => ({ status: 200, body: gateViews({ canSubmit: true })[0] }))],
      from,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("gates.submit.action") }));
    const dialog = await screen.findByRole("dialog");
    const note = within(dialog).getByLabelText(t("gates.submit.note"));
    fireEvent.change(note, { target: { value: "‏" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.submit.confirm") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(note),
      (l) => tr(l)("problems.validation__blank"),
    );
  });

  it("the decision rationale's field error follows the switch", async () => {
    const t = tr(from);
    const { i18n } = renderAt(
      `/transformations/${TR_ID}/gates/G1`,
      [
        ...base(from, ["gate.decide"]),
        route("GET", /\/gates\/G1$/, () => ({ status: 200, body: gateViews({ pending: true, canDecide: true })[0] })),
      ],
      from,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("gates.decision.action") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("radio", { name: t("gates.outcome.approved") }));
    const rationale = within(dialog).getByLabelText(labelled(t("gates.decision.rationale")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("gates.decision.confirm") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(rationale),
      (l) => tr(l)("problems.validation__too_small"),
    );
  });
});

// ------------------------------------------------------------------------------------------------ North Star

describe.each(DIRECTIONS)("North Star statement, $from → $to", ({ from, to }) => {
  it("the statement's field error follows the switch", async () => {
    const t = tr(from);
    const { i18n } = renderAt(
      `/transformations/${TR_ID}/define`,
      [...base(from), route("GET", /\/north-star$/, () => problem(404, "north_star_not_found"))],
      from,
    );
    fireEvent.click(await screen.findByRole("button", { name: t("define.northStar.set") }));
    const statement = await screen.findByLabelText(labelled(t("define.northStar.statement")));
    fireEvent.change(statement, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: t("define.northStar.save") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(statement),
      (l) => tr(l)("problems.validation__blank"),
    );
  });
});

// ------------------------------------------------------------------------------------------------ evidence

describe.each(DIRECTIONS)("evidence dialogs, $from → $to", ({ from, to }) => {
  const ev = evidence({ title: "Synthetic extract", version: 2 });
  const open = () => renderAt(`/transformations/${TR_ID}/evidence`, [...base(from), list("evidence", [ev])], from);

  it("upload without a file: 'required' follows the switch", async () => {
    const t = tr(from);
    const { i18n } = open();
    fireEvent.click(await screen.findByRole("button", { name: `${t("evidence.upload.action")}: ${ev.title}` }));
    const dialog = await screen.findByRole("dialog");
    const file = within(dialog).getByLabelText(labelled(t("evidence.upload.file")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("evidence.upload.confirm") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => describedText(file),
      (l) => tr(l)("problems.validation__required"),
    );
  });

  it("a link without a record type or record: both 'required' messages follow the switch", async () => {
    const t = tr(from);
    const { i18n } = open();
    fireEvent.click(await screen.findByRole("button", { name: `${t("evidence.links.add")}: ${ev.title}` }));
    const dialog = await screen.findByRole("dialog");
    const type = within(dialog).getByLabelText(labelled(t("evidence.links.recordType")));
    const record = within(dialog).getByLabelText(labelled(t("evidence.links.record")));
    fireEvent.click(within(dialog).getByRole("button", { name: t("evidence.links.add") }));
    await expectFollowsSwitch(
      i18n,
      from,
      to,
      () => `${describedText(type)} | ${describedText(record)}`,
      (l) => `${tr(l)("problems.validation__required")} | ${tr(l)("problems.validation__required")}`,
    );
  });
});
