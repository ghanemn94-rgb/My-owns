// Transformation screens against a scripted API (SYNTHETIC data; the live API+DB flow is covered by the e2e suite):
//  - F-DG1-004: after a successful create the creator sees the record, or, if the server answers 403/404 for it, a
//    localized "created, but you cannot open it" explanation instead of a dead "Not found" (Arabic RTL and English);
//    a plain 404 / 403 without a just-created record still shows the correct localized message.
//  - F-DG1-005: the audit trail's Changes column shows localized field and value labels, not raw keys or enum codes.
//  - F-DG1-001 (T-DG1-FE3): the edit form never offers `closed` (the API refuses it in P1; G6 governs closure), and
//    the status hint no longer promises a close transition (English LTR and Arabic RTL).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSFORMATION_STATUS_TRANSITIONS, type Permission, type TransformationStatus } from "@mth/shared";
import type { AuditEvent } from "../../api/types.ts";
import { catalogues, createI18n } from "../../i18n/index.ts";
import {
  BU_ID,
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
} from "../../test/fixtures.tsx";
import { P1_GOVERNED_STATUSES, offeredStatusOptions } from "./TransformationEditPage.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NEW_ID = "01920000-0000-7000-9000-000000000399";

/** A Transformation Lead granted at one business unit, without downward inheritance (ADR-0006). */
const TL_BU_GRANTS = [
  {
    scope: { type: "business_unit" as const, id: BU_ID },
    inheritsDownward: false,
    permissions: [
      "organization.read",
      "business_unit.read",
      "role.read",
      "transformation.read",
      "transformation.create",
      "transformation.update",
    ] as Permission[],
  },
];

const meRoute = (me: ReturnType<typeof makeMe>) => route("GET", /\/api\/v1\/me$/, () => ({ status: 200, body: me }));
const buRoute = route("GET", /\/business-units/, () => ({
  status: 200,
  body: { items: [BUSINESS_UNIT], nextCursor: null },
}));
const created = makeTransformation({
  id: NEW_ID,
  code: "TR-0042",
  name: "Synthetic new transformation",
  mode: "end_to_end",
  entryPhase: null,
  currentPhase: "diagnose",
});
const createRoute = route("POST", /\/api\/v1\/transformations$/, () => ({ status: 201, body: created }));
const auditEmpty = route("GET", /\/audit/, () => ({ status: 200, body: { items: [], nextCursor: null } }));

async function submitCreateForm(labels: { unit: RegExp; name: RegExp; submit: string }) {
  const unit = (await screen.findByLabelText(labels.unit)) as HTMLSelectElement;
  fireEvent.change(unit, { target: { value: BU_ID } });
  fireEvent.change(screen.getByLabelText(labels.name), { target: { value: "Synthetic new transformation" } });
  fireEvent.click(screen.getByRole("button", { name: labels.submit }));
}

describe("after create (F-DG1-004)", () => {
  it("shows the created record when the server lets the creator read it", async () => {
    const { requests } = mockApi(
      meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })),
      buRoute,
      createRoute,
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: created })),
      auditEmpty,
    );
    const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`));
    expect(await screen.findByText("Transformation created as a draft. It is not submitted or approved.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("TR-0042");
    // The record shown is read back from the server, not taken from the create response.
    expect(requests.some((r) => r.method === "GET" && r.url === `/api/v1/transformations/${NEW_ID}`)).toBe(true);
  });

  it("explains, in English, that the draft was created but cannot be opened (server 404), instead of 'Not found'", async () => {
    mockApi(meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })), buRoute, createRoute);
    renderApp("/transformations/new", { i18n: createI18n("en") });
    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
    const state = await screen.findByRole("alert");
    expect(state.dataset["state"]).toBe("created-not-visible");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Transformation created, but you cannot open it",
    );
    expect(state.textContent).toContain("TR-0042 · Synthetic new transformation was saved as a draft");
    expect(state.textContent).toContain("not submitted or approved");
    expect(state.textContent).toContain("Ask an access administrator");
    expect(screen.queryByText("Not found")).toBeNull();
    expect(within(state).getByRole("link", { name: "Back to Transformations" }).getAttribute("href")).toBe(
      "/transformations",
    );
  });

  it("explains the same in Arabic (RTL), using the glossary term for Transformation", async () => {
    mockApi(meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "ar" })), buRoute, createRoute);
    renderApp("/transformations/new", { i18n: createI18n("ar") });
    await submitCreateForm({ unit: /^وحدة العمل/, name: /^الاسم/, submit: "إنشاء التحوّل" });
    const state = await screen.findByRole("alert");
    expect(state.dataset["state"]).toBe("created-not-visible");
    expect(document.documentElement.dir).toBe("rtl");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("أُنشئ التحوّل، لكن لا يمكنك فتحه");
    expect(state.textContent).toContain("TR-0042 · Synthetic new transformation");
    expect(state.textContent).toContain("مسودة");
    expect(screen.queryByText("غير موجود")).toBeNull();
    expect(within(state).getByRole("link", { name: "العودة إلى التحوّلات" })).toBeTruthy();
  });

  it("treats a 403 for the just-created record the same way", async () => {
    mockApi(
      meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })),
      buRoute,
      createRoute,
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => problem(403, "forbidden")),
    );
    renderApp("/transformations/new", { i18n: createI18n("en") });
    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("created-not-visible");
  });
});

describe("truly out-of-scope records keep the correct localized message", () => {
  it("404 without a just-created record: 'Not found' (en) / 'غير موجود' (ar), nothing disclosed", async () => {
    mockApi(meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })), buRoute);
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n("en") });
    const en = await screen.findByRole("alert");
    expect(en.dataset["state"]).toBe("no-permission");
    expect(en.textContent).toContain("Not found");
    expect(en.textContent).not.toContain("created");
    cleanup();
    mockApi(meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "ar" })), buRoute);
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n("ar") });
    const ar = await screen.findByRole("alert");
    expect(ar.textContent).toContain("غير موجود");
  });

  it("403: 'You do not have access' rather than 'Not found'", async () => {
    mockApi(
      meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })),
      buRoute,
      route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => problem(403, "forbidden")),
    );
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n("en") });
    const state = await screen.findByRole("alert");
    expect(state.dataset["state"]).toBe("no-permission");
    expect(state.textContent).not.toContain("Not found");
  });

  it("router state for a different id does not turn a 404 into the created message", async () => {
    mockApi(meRoute(makeMe(TL_BU_GRANTS, { preferredLocale: "en" })), buRoute);
    const { router } = renderApp("/transformations", { i18n: createI18n("en") });
    await router.navigate(`/transformations/${TR_ID}`, {
      state: { created: { id: NEW_ID, code: "TR-0042", name: "x" } },
    });
    expect((await screen.findByRole("alert")).dataset["state"]).toBe("no-permission");
  });
});

function auditEvent(overrides: Partial<AuditEvent>): AuditEvent {
  return {
    id: "01920000-0000-7000-9000-0000000005a1",
    seq: "1",
    occurredAt: "2026-10-01T06:29:00Z",
    action: "transformation.create",
    recordType: "transformation",
    recordId: TR_ID,
    transformationId: TR_ID,
    actor: { type: "user", userId: USER_ID, displayName: "Synthetic Test User" },
    onBehalfOfUserId: null,
    priorVersion: null,
    newVersion: 1,
    reason: null,
    requestId: null,
    changes: null,
    ...overrides,
  };
}

const AUDIT = [
  auditEvent({
    id: "01920000-0000-7000-9000-0000000005a3",
    seq: "3",
    action: "transformation.archive",
    priorVersion: 2,
    newVersion: 3,
    changes: { archivedAt: { from: null, to: "2026-10-01T07:00:00Z" } },
  }),
  auditEvent({
    id: "01920000-0000-7000-9000-0000000005a2",
    seq: "2",
    action: "transformation.update",
    priorVersion: 1,
    newVersion: 2,
    changes: { status: { from: "active", to: "closed" }, lead_user_id: { from: null, to: USER_ID } },
  }),
  auditEvent({
    changes: {
      code: { from: null, to: "TR-0001" },
      mode: { from: null, to: "end_to_end" },
      status: { from: null, to: "draft" },
      current_phase: { from: null, to: "diagnose" },
      business_unit_id: { from: null, to: BU_ID },
      future_field: { from: null, to: "x_code" },
    },
  }),
];

function renderAuditTrail(locale: "en" | "ar") {
  mockApi(
    meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: locale })),
    buRoute,
    route("GET", new RegExp(`/api/v1/users/${USER_ID}$`), () => ({
      status: 200,
      body: { ...makeMe([]).user, displayName: "Synthetic Lead" },
    })),
    route("GET", /\/audit/, () => ({ status: 200, body: { items: AUDIT, nextCursor: null } })),
    route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: makeTransformation() })),
  );
  renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
}

async function changesCells(title: string): Promise<string[]> {
  const region = await screen.findByRole("region", { name: title });
  await waitFor(() => expect(within(region).getAllByRole("row").length).toBe(4));
  await waitFor(() => expect(region.textContent).toContain("Synthetic Lead"));
  return within(region)
    .getAllByRole("row")
    .slice(1)
    .map((row) => row.querySelectorAll("td")[4]!.textContent ?? "");
}

describe("audit trail changes (F-DG1-005)", () => {
  it("English: field and value labels, not raw keys or enum codes", async () => {
    renderAuditTrail("en");
    const [archive, update, create] = await changesCells("Audit trail");
    expect(archive).toMatch(/^Archived on: None → \d{1,2} Oct 2026, 10:00$/);
    expect(update).toContain("Status: Active → Closed");
    expect(update).toContain("Transformation Lead: None → Synthetic Lead");
    expect(create).toContain("Code: None → TR-0001");
    expect(create).toContain("Mode: None → End-to-End");
    expect(create).toContain("Status: None → Draft – not submitted");
    expect(create).toContain("Phase: None → Diagnose");
    expect(create).toContain("Business unit: None → Synthetic Operations SYN-OPS");
    // The unknown field stays readable and is explicitly marked, never blank or guessed.
    expect(create).toContain("future_field (field without a translation): None → x_code (value without a translation)");
    for (const raw of ["current_phase", "business_unit_id", "end_to_end", "lead_user_id", "archivedAt", BU_ID, "∅"]) {
      expect([archive, update, create].join("\n")).not.toContain(raw);
    }
  });

  it("Arabic: the same changes with Arabic labels in the RTL layout", async () => {
    renderAuditTrail("ar");
    const [archive, update, create] = await changesCells("سجل التدقيق");
    expect(document.documentElement.dir).toBe("rtl");
    expect(archive).toContain("تاريخ الأرشفة: لا يوجد ←");
    expect(update).toContain("الحالة: نشط ← مغلق");
    expect(update).toContain("قائد التحوّل: لا يوجد ← Synthetic Lead");
    expect(create).toContain("الرمز: لا يوجد ← TR-0001");
    expect(create).toContain("النمط: لا يوجد ← النمط الشامل (من البداية إلى النهاية)");
    expect(create).toContain("الحالة: لا يوجد ← مسودة – لم تُقدَّم");
    expect(create).toContain("المرحلة: لا يوجد ← التشخيص");
    expect(create).toContain("وحدة العمل: لا يوجد ← العمليات (اصطناعي) SYN-OPS");
    expect(create).toContain("future_field (حقل بلا ترجمة): لا يوجد ← x_code (قيمة بلا ترجمة)");
    for (const raw of ["current_phase", "business_unit_id", "end_to_end", "lead_user_id", "archivedAt", BU_ID, "∅"]) {
      expect([archive, update, create].join("\n")).not.toContain(raw);
    }
  });
});

describe("P1 close rule in the edit form (F-DG1-001, T-DG1-FE3)", () => {
  it("governs exactly `closed`, mirroring the API's GOVERNED_TARGET_STATUSES", () => {
    expect([...P1_GOVERNED_STATUSES]).toEqual(["closed"]);
  });

  it("offers only the P1 transitions plus the current status; never `closed`", () => {
    expect(offeredStatusOptions("draft")).toEqual(["draft", "active"]);
    expect(offeredStatusOptions("active")).toEqual(["active", "on_hold"]);
    expect(offeredStatusOptions("on_hold")).toEqual(["on_hold", "active"]);
    for (const s of ["draft", "active", "on_hold"] as TransformationStatus[]) {
      expect(offeredStatusOptions(s), s).not.toContain("closed");
    }
    // The shared transition table still lists `closed` (G6 arrives in P2+); the web filters it out.
    expect(TRANSFORMATION_STATUS_TRANSITIONS.active).toContain("closed");
    // Defensive: an already-closed record still renders its own status.
    expect(offeredStatusOptions("closed")[0]).toBe("closed");
  });

  it("the status hint no longer promises a close transition and names the G6 approval (en and ar)", () => {
    const en = catalogues.en.transformations.form.statusHint;
    const ar = catalogues.ar.transformations.form.statusHint;
    expect(en).toBe(
      "Only the allowed next statuses are offered: draft → active; active → on hold; on hold → active. " +
        "Closing a transformation needs the G6 (Sustain) business approval, which is available in a later release.",
    );
    expect(en).not.toMatch(/or closed/);
    expect(en).not.toMatch(/→ closed/i);
    expect(ar).not.toMatch(/أو مغلق/);
    expect(ar).not.toMatch(/← مغلق/);
    expect(ar).toContain("مسودة ← نشط؛ نشط ← معلّق؛ معلّق ← نشط");
    expect(ar).toContain("البوابة 6 - الاستدامة");
    expect(ar).toContain("التحوّل");
  });

  for (const [locale, title, statusLabel] of [
    ["en", "Edit transformation", /^Status/],
    ["ar", "تعديل التحوّل", /^الحالة/],
  ] as const) {
    it(`${locale}: the rendered status select for an active record has no Closed option`, async () => {
      mockApi(
        meRoute(makeMe(OFFICE_GRANTS, { preferredLocale: locale })),
        buRoute,
        route("GET", /\/api\/v1\/users/, () => ({ status: 200, body: { items: [], nextCursor: null } })),
        route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({
          status: 200,
          body: makeTransformation({ status: "active" }),
        })),
      );
      renderApp(`/transformations/${TR_ID}/edit`, { i18n: createI18n(locale) });
      const select = (await screen.findByLabelText(statusLabel)) as HTMLSelectElement;
      expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(title);
      expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
      expect([...select.options].map((o) => o.value)).toEqual(["active", "on_hold"]);
      const hint = catalogues[locale].transformations.form.statusHint;
      expect(screen.getByText(hint)).toBeTruthy();
    });
  }
});
