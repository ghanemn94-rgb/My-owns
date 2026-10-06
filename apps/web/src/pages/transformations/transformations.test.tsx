// Transformation screens against a scripted API (SYNTHETIC data; the live API+DB flow is covered by the e2e suite):
//  - F-DG1-004: after a successful create the creator sees the record, or, if the server answers 403/404 for it, a
//    localized "created, but you cannot open it" explanation instead of a dead "Not found" (Arabic RTL and English);
//    a plain 404 / 403 without a just-created record still shows the correct localized message.
//  - F-DG1-005: the audit trail's Changes column shows localized field and value labels, not raw keys or enum codes.
//  - F-DG1-008: the derived creator assignment (F-DG1-106) on a new record's trail shows a localized action, field,
//    role, user and scope labels in English and Arabic, with no raw action code, camelCase key, JSON or role code.
//  - F-DG1-001 (T-DG1-FE3): the edit form never offers `closed` (the API refuses it in P1; G6 governs closure), and
//    the status hint no longer promises a close transition (English LTR and Arabic RTL).
//  - F-DG1-210: after a create, GET /me is re-read so the server-granted derived assignment shows Edit/Archive and the
//    audit trail without a reload (en and ar); nothing is granted on the client; a failed refresh never blocks.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROLES, TRANSFORMATION_STATUS_TRANSITIONS, type Permission, type TransformationStatus } from "@mth/shared";
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
import { ME_REFRESH_TIMEOUT_MS } from "./TransformationCreatePage.tsx";
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
  // The form renders once the business units have loaded; wait generously for it under load (F-DG1-144).
  const unit = (await screen.findByLabelText(labels.unit, undefined, { timeout: 5_000 })) as HTMLSelectElement;
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

/** A different user than the signed-in one (USER_ID), so the name is fetched from /users/{id}. */
const LEAD_ID = "01920000-0000-7000-9000-000000000202";

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
    changes: { status: { from: "active", to: "closed" }, lead_user_id: { from: null, to: LEAD_ID } },
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
    route("GET", new RegExp(`/api/v1/users/${LEAD_ID}$`), () => ({
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

// The exact event apps/api access/assignments.ts (grantCreatorTransformationRoles) writes on the new record's trail
// when a business-unit-scoped Transformation Lead creates it (F-DG1-106), followed by the transformation's own create.
const SOURCE_ASSIGNMENT_ID = "01920000-0000-7000-8000-0000000000b1";
const LEAD_CREATED_AUDIT = [
  auditEvent({
    id: "01920000-0000-7000-9000-0000000005b2",
    seq: "2",
    action: "scoped_assignment.create",
    recordType: "scoped_assignment",
    recordId: "01920000-0000-7000-9000-0000000006a1",
    reason: `Creator of transformation TR-0001: TL carried over from business-unit assignment ${SOURCE_ASSIGNMENT_ID}`,
    changes: {
      userId: { from: null, to: USER_ID },
      roleCode: { from: null, to: "TL" },
      scope: { from: null, to: { type: "transformation", id: TR_ID } },
      derivedFromAssignmentId: { from: null, to: SOURCE_ASSIGNMENT_ID },
      effectiveTo: { from: null, to: null },
    },
  }),
  auditEvent({
    id: "01920000-0000-7000-9000-0000000005b1",
    changes: { code: { from: null, to: "TR-0001" }, status: { from: null, to: "draft" } },
  }),
];

function renderLeadCreatedTrail(locale: "en" | "ar") {
  // The real TL role (packages/shared ROLES.TL, incl. audit.read), granted at the business unit only.
  // The real TL role (packages/shared ROLES.TL, incl. audit.read) at the business unit, plus the derived
  // transformation-scope TL assignment that this very event records (it is what lets the creator open the record).
  const tl = [...ROLES.TL.permissions] as Permission[];
  const me = makeMe(
    [
      { ...TL_BU_GRANTS[0]!, permissions: tl },
      { scope: { type: "transformation" as const, id: TR_ID }, inheritsDownward: false, permissions: tl },
    ],
    { preferredLocale: locale },
  );
  const users = vi.fn(() => ({ status: 403, body: problem(403, "forbidden") }));
  mockApi(
    meRoute(me),
    buRoute,
    route("GET", /\/api\/v1\/users\//, users),
    route("GET", /\/audit/, () => ({ status: 200, body: { items: LEAD_CREATED_AUDIT, nextCursor: null } })),
    route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: makeTransformation() })),
  );
  renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
  return { users };
}

async function auditRows(title: string): Promise<{ action: string; changes: string }[]> {
  const region = await screen.findByRole("region", { name: title });
  await waitFor(() => expect(within(region).getAllByRole("row").length).toBe(3));
  return within(region)
    .getAllByRole("row")
    .slice(1)
    .map((row) => {
      const cells = row.querySelectorAll("td");
      return { action: cells[1]!.textContent ?? "", changes: cells[4]!.textContent ?? "" };
    });
}

const RAW_ASSIGNMENT_TOKENS = [
  "scoped_assignment",
  "userId",
  "roleCode",
  "effectiveTo",
  "derivedFromAssignmentId",
  '"type"',
  "{",
  USER_ID,
  TR_ID,
];

describe("derived creator assignment on the audit trail (F-DG1-008)", () => {
  it("English: localized action, fields, role, user and scope; nothing raw or marked untranslated", async () => {
    const { users } = renderLeadCreatedTrail("en");
    const [assignment, create] = await auditRows("Audit trail");
    expect(assignment!.action).toBe("Role granted to the creator (carried over from a business-unit assignment)");
    expect(create!.action).toBe("Created");
    const c = assignment!.changes;
    expect(c).toContain("User: None → Synthetic Test User");
    expect(c).toContain("Role: None → Transformation Lead");
    expect(c).toContain("Scope: None → Transformation: this transformation");
    expect(c).toContain("Effective until: None → None");
    expect(c).toContain(`Carried over from assignment: None → ${SOURCE_ASSIGNMENT_ID}`);
    expect(c).not.toMatch(/without a translation/);
    for (const raw of [...RAW_ASSIGNMENT_TOKENS, ": None → TL"])
      expect(`${assignment!.action}\n${c}`).not.toContain(raw);
    // The creator's own name comes from the session: a BU-scoped Lead holds no user.read.
    expect(users).not.toHaveBeenCalled();
  });

  it("Arabic (RTL): the same event with Arabic labels and the glossary role name", async () => {
    renderLeadCreatedTrail("ar");
    const [assignment, create] = await auditRows("سجل التدقيق");
    expect(document.documentElement.dir).toBe("rtl");
    expect(assignment!.action).toBe("إسناد دور لمُنشئ السجل (منقول من إسناد على مستوى وحدة العمل)");
    expect(create!.action).toBe("إنشاء");
    const c = assignment!.changes;
    expect(c).toContain("المستخدم: لا يوجد ← Synthetic Test User");
    expect(c).toContain("الدور: لا يوجد ← قائد التحوّل");
    expect(c).toContain("النطاق: لا يوجد ← التحوّل: هذا التحوّل");
    expect(c).toContain("يسري حتى: لا يوجد ← لا يوجد");
    expect(c).toContain(`منقول من الإسناد: لا يوجد ← ${SOURCE_ASSIGNMENT_ID}`);
    expect(c).not.toMatch(/بلا ترجمة/);
    for (const raw of [...RAW_ASSIGNMENT_TOKENS, "← TL"]) expect(`${assignment!.action}\n${c}`).not.toContain(raw);
  });

  it("an action the catalogue does not know stays readable and is explicitly marked (en and ar)", async () => {
    for (const [locale, title, marker] of [
      ["en", "Audit trail", "(action without a translation)"],
      ["ar", "سجل التدقيق", "(إجراء بلا ترجمة)"],
    ] as const) {
      const me = makeMe(OFFICE_GRANTS, { preferredLocale: locale });
      mockApi(
        meRoute(me),
        buRoute,
        route("GET", /\/audit/, () => ({
          status: 200,
          body: { items: [auditEvent({ action: "future_record.reopen" })], nextCursor: null },
        })),
        route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: makeTransformation() })),
      );
      renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
      const region = await screen.findByRole("region", { name: title });
      await waitFor(() => expect(within(region).getAllByRole("row").length).toBe(2));
      const action = within(region).getAllByRole("row")[1]!.querySelectorAll("td")[1]!.textContent;
      expect(action).toBe(`future_record.reopen ${marker}`);
      cleanup();
    }
  });
});

describe("effective permissions refresh after create (F-DG1-210)", () => {
  /** What the server grants the creator after the create (the derived transformation-scope assignment, F-DG1-106). */
  const DERIVED_GRANT = {
    scope: { type: "transformation" as const, id: NEW_ID },
    inheritsDownward: false,
    permissions: [
      "transformation.read",
      "transformation.update",
      "transformation.archive",
      "audit.read",
    ] as Permission[],
  };

  /**
   * GET /me answers with the BU-scoped grants until the POST succeeded, then with the server's refreshed grants
   * (`after`), exactly like the live API does once the derived assignment exists.
   */
  function scriptedMe(locale: "en" | "ar", after: "derived" | "unchanged" | "error") {
    let createdOnServer = false;
    const meRoute = route("GET", /\/api\/v1\/me$/, () => {
      if (!createdOnServer || after === "unchanged") {
        return { status: 200, body: makeMe(TL_BU_GRANTS, { preferredLocale: locale }) };
      }
      if (after === "error") return problem(503, "unavailable");
      return { status: 200, body: makeMe([...TL_BU_GRANTS, DERIVED_GRANT], { preferredLocale: locale }) };
    });
    const create = route("POST", /\/api\/v1\/transformations$/, () => {
      createdOnServer = true;
      return { status: 201, body: created };
    });
    return { meRoute, create };
  }

  const detailRoute = route("GET", /\/api\/v1\/transformations\/[^/?]+$/, () => ({ status: 200, body: created }));

  /**
   * F-DG1-144: the controls below appear only after the async create, the navigation, the effective-permissions
   * (GET /me) refresh and the detail/audit queries have all settled. Under CPU load that chain can exceed Testing
   * Library's default 1 s, so every wait that depends on it gets an explicit, generous timeout. The assertions
   * themselves are unchanged; the test timeout covers the sum of these waits.
   */
  const SETTLE = { timeout: 5_000 };
  const SETTLED_TEST_TIMEOUT_MS = 20_000;

  it(
    "English: Edit, Archive and the audit trail appear after create, without a reload",
    async () => {
      const { meRoute: me, create } = scriptedMe("en", "derived");
      const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
      const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
      await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
      expect(await screen.findByRole("link", { name: "Edit" }, SETTLE)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
      expect(await screen.findByRole("heading", { name: "Audit trail" }, SETTLE)).toBeTruthy();
      // /me was re-read after the POST (the refreshed server answer), and the page was never reloaded (same router).
      const postAt = requests.findIndex((r) => r.method === "POST");
      expect(requests.slice(postAt + 1).some((r) => r.method === "GET" && r.url === "/api/v1/me")).toBe(true);
      expect(document.documentElement.dir).toBe("ltr");
    },
    SETTLED_TEST_TIMEOUT_MS,
  );

  it(
    "Arabic (RTL): the same controls and the audit trail appear after create, without a reload",
    async () => {
      const { meRoute: me, create } = scriptedMe("ar", "derived");
      mockApi(me, buRoute, create, detailRoute, auditEmpty);
      const { router } = renderApp("/transformations/new", { i18n: createI18n("ar") });
      await submitCreateForm({ unit: /^وحدة العمل/, name: /^الاسم/, submit: "إنشاء التحوّل" });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
      expect(await screen.findByRole("link", { name: "تعديل" }, SETTLE)).toBeTruthy();
      expect(screen.getByRole("button", { name: "أرشفة" })).toBeTruthy();
      expect(await screen.findByRole("heading", { name: "سجل التدقيق" }, SETTLE)).toBeTruthy();
      expect(document.documentElement.dir).toBe("rtl");
    },
    SETTLED_TEST_TIMEOUT_MS,
  );

  it(
    "does not over-grant: if the refreshed server answer adds nothing, Archive and the audit trail stay hidden",
    async () => {
      const { meRoute: me, create } = scriptedMe("en", "unchanged");
      const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
      const { router } = renderApp("/transformations/new", { i18n: createI18n("en") });
      await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
      await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), SETTLE);
      expect(await screen.findByRole("heading", { level: 1 }, SETTLE)).toBeTruthy();
      await screen.findByText("Transformation created as a draft. It is not submitted or approved.", undefined, SETTLE);
      expect(screen.queryByRole("link", { name: "Edit" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
      expect(requests.some((r) => r.url.includes("/audit"))).toBe(false);
    },
    SETTLED_TEST_TIMEOUT_MS,
  );

  // F-DG2-143: this test took ~3.2 s against vitest's 5 s default. The time was not the assertion: useMeQuery retries
  // a 5xx twice and TanStack Query's default back-off waited 1 s + 2 s in real time. The retries now run with no delay
  // (`retryDelayMs: 0`); the same three failing /me reads still happen (asserted below) and the create page still
  // races them against ME_REFRESH_TIMEOUT_MS. The explicit 30 s timeout keeps headroom under parallel load.
  it("a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)", async () => {
    const { meRoute: me, create } = scriptedMe("en", "error");
    const { requests } = mockApi(me, buRoute, create, detailRoute, auditEmpty);
    const { router } = renderApp("/transformations/new", { i18n: createI18n("en"), retryDelayMs: 0 });
    await submitCreateForm({ unit: /^Business unit/, name: /^Name/, submit: "Create transformation" });
    // The create page waits at most ME_REFRESH_TIMEOUT_MS for the refreshed /me, then navigates anyway.
    await waitFor(() => expect(router.state.location.pathname).toBe(`/transformations/${NEW_ID}`), {
      timeout: ME_REFRESH_TIMEOUT_MS + 1_000,
    });
    await screen.findByText("Transformation created as a draft. It is not submitted or approved.", undefined, SETTLE);
    // The refresh really failed: one read plus two retries after the POST, all 503.
    const postAt = requests.findIndex((r) => r.method === "POST");
    await waitFor(
      () =>
        expect(
          requests.slice(postAt + 1).filter((r) => r.method === "GET" && r.url === "/api/v1/me").length,
        ).toBeGreaterThanOrEqual(3),
      SETTLE,
    );
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Audit trail" })).toBeNull();
  }, 30_000);
});
