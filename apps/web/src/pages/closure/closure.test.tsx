// Closure and transition decisions (T-DG4-FE-F; p4-work-split §F+G FG.8; ADR-0034 §1-§3, §7, §12; ADR-0026 amendment
// E1-E6) with STUBBED responses, in English (LTR) and Arabic (RTL). The live journey is e2e/p4-gates-closure.spec.ts.
// SYNTHETIC data; a transition decision is decided through a business approval inside the product, never DG0-DG7.
//  - REQ-S03-003: the four statuses side by side, each as the server returns it.
//  - REQ-PB-009: a delivered initiative with value pending reads "Delivered — value validation pending"; its closure
//    refusal 422 closure.value_validation_pending is translated.
//  - REQ-S11-006: the transformation reads "Delivery complete - value validation pending"; nothing says "successful".
//  - REQ-S11-007: a transition decision is created with residual owner and monitoring; a returned one offers "Submit
//    again (round 2)"; only the requester may submit again or withdraw (403 approval.not_requester translated).
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import type { Handler } from "../../test/fixtures.tsx";
import { OTHER_USER, id, leadGrants } from "../../test/p2fixtures.ts";
import { esc, frameHandlers, initiative, page, problemBody, T, TR } from "../portfolio/p3fixtures.ts";
import { STATUS_LABEL_KEYS, statusLabelText } from "./ClosurePage.tsx";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERMS = [
  "initiative.complete_delivery",
  "initiative.close",
  "transformation.close",
  "transition_decision.propose",
] as Permission[];

const INI = initiative({ id: id(), code: "INI-01", name: "Synthetic onboarding", status: "completed" });
const BENEFIT = { id: id(), code: "B01", title: "Synthetic churn reduction" };
const APPROVAL_ID = id();

const TRANSFORMATION_MODEL = {
  transformationId: TR_ID,
  deliveryState: "delivery_complete",
  valueState: "validation_pending",
  bauState: "bau_pending",
  closureState: "open",
  label: "Delivery complete - value validation pending",
  initiatives: { total: 1, completed: 1 },
  performanceAreas: { total: 1, bau: 0 },
};

const INITIATIVE_MODEL = {
  initiativeId: INI.id,
  version: 7,
  delivery: "completed",
  deliveryCompletedAt: T,
  deliveryCompletedBy: USER_ID,
  adoption: "not_assessed",
  adoptionSource: "owner",
  value: "validation_pending",
  closure: "open",
  closureRecordId: null,
  label: "Delivered — value validation pending",
};

function decision(over: Record<string, unknown> = {}) {
  return {
    id: id(),
    transformationId: TR_ID,
    code: "TD-01",
    benefitId: BENEFIT.id,
    residualOwnerUserId: USER_ID,
    rationale: "Synthetic: the remaining value is realized after closure.",
    expectedRealizationEnd: "2027-06-30",
    monitoringFrequency: "monthly",
    monitoringInterval: 1,
    firstMonitoringDate: "2026-11-30",
    nextMonitoringDate: null,
    status: "draft",
    approvalId: APPROVAL_ID,
    decidedAt: null,
    decidedBy: null,
    version: 3,
    createdAt: T,
    createdBy: OTHER_USER,
    updatedAt: T,
    updatedBy: OTHER_USER,
    ...over,
  };
}

function render(locale: "en" | "ar", extra: Handler[] = []) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(PERMS), { preferredLocale: locale }),
    })),
    ...frameHandlers(locale, "lead", [
      ...extra,
      route("GET", new RegExp(`${esc(TR)}/status-model$`), () => ({ status: 200, body: TRANSFORMATION_MODEL })),
      route("GET", new RegExp(`/api/v1/initiatives/${INI.id}/status-model$`), () => ({
        status: 200,
        body: INITIATIVE_MODEL,
      })),
      route("GET", /\/api\/v1\/initiatives\?/, () => page([INI])),
      route("GET", new RegExp(`${esc(TR)}/benefits`), () => page([BENEFIT])),
      route("GET", new RegExp(`${esc(TR)}/transition-decisions`), () => page([decision()])),
      route("GET", new RegExp(`/api/v1/approvals/${APPROVAL_ID}$`), () => ({
        status: 200,
        body: { id: APPROVAL_ID, status: "changes_requested", roundNo: 1, requestedBy: OTHER_USER },
      })),
    ]),
  );
  renderApp(`/transformations/${TR_ID}/closure`, { i18n: createI18n(locale) });
  return api;
}

describe("status labels", () => {
  it("every ADR-0034 §2 label has an English text equal to it, and none says 'successful'", () => {
    const en = createI18n("en").t;
    for (const label of Object.keys(STATUS_LABEL_KEYS)) {
      expect(statusLabelText(en, label)).toBe(label);
      expect(label.toLowerCase()).not.toContain("success");
    }
    expect(statusLabelText(en, "Something else")).toBe(en("common.value.unknown"));
  });
});

describe.each(["en", "ar"] as const)("closure page (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("shows the four statuses side by side and the value-pending labels; never 'successful'", async () => {
    render(locale);
    const banner = await waitFor(() => {
      const el = document.querySelector("[data-transformation-label]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(banner.textContent).toContain(t("closureP4.label.deliveryCompleteValuePending"));
    if (locale === "en") expect(banner.textContent).toContain("Delivery complete - value validation pending");
    for (const card of ["delivery", "value", "bau", "closure"])
      expect(document.querySelector(`[data-status-card='${card}']`), card).not.toBeNull();
    const row = await waitFor(() => {
      const r = document.querySelector("[data-initiative-status='INI-01']");
      expect(r?.getAttribute("data-label")).toBe("Delivered — value validation pending");
      return r!;
    });
    expect(row.textContent).toContain(t("closureP4.label.deliveredValuePending"));
    if (locale === "en") expect(row.textContent).toContain("Delivered — value validation pending");
    // Four separate statuses, each as returned: delivery complete, adoption not assessed, value pending, open.
    expect(row.querySelector("[data-status-group='delivery']")!.getAttribute("data-status-value")).toBe("completed");
    expect(row.querySelector("[data-status-group='adoption']")!.getAttribute("data-status-value")).toBe("not_assessed");
    expect(row.querySelector("[data-status-group='value']")!.getAttribute("data-status-value")).toBe(
      "validation_pending",
    );
    expect(row.querySelector("[data-status-group='closure']")!.getAttribute("data-status-value")).toBe("open");
    // Pending value is never shown as validated and nothing is called successful.
    expect(row.textContent).not.toContain(t("closureP4.value.validated"));
    expect(document.querySelector("main")!.textContent!.toLowerCase()).not.toMatch(/success|ناجح\b/);
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
    if (locale === "ar") expect(document.querySelector("[data-provisional-ar]")).not.toBeNull();
  });

  it("closing a value-pending initiative shows the translated 422 closure.value_validation_pending", async () => {
    const { requests } = render(locale, [
      route("POST", new RegExp(`/api/v1/initiatives/${INI.id}/close$`), () =>
        problemBody(
          422,
          "urn:mth:problem:invalid-transition",
          "closure.value_validation_pending",
          "Delivered — value validation pending: an initiative closes only when …",
        ),
      ),
    ]);
    const row = await waitFor(() => {
      const r = document.querySelector("[data-initiative-status='INI-01'] [data-action='close-initiative']");
      expect(r).not.toBeNull();
      return r!;
    });
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("closureP4.initiatives.close") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.closure__value_validation_pending"));
    expect(alert.textContent).not.toContain("an initiative closes only when …");
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBeUndefined();
  });

  it("closing the transformation without G6 shows the translated refusal", async () => {
    render(locale, [
      route("POST", new RegExp(`${esc(TR)}/close$`), () =>
        problemBody(422, "urn:mth:problem:invalid-transition", "closure.g6_not_approved", "English detail"),
      ),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("closureP4.transformation.close")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("closureP4.transformation.close") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.closure__g6_not_approved"));
  });

  it("a returned decision offers 'Submit again (round 2)'; a non-requester's withdrawal is refused, translated", async () => {
    const { requests } = render(locale, [
      route("PATCH", new RegExp(`${esc(TR)}/transition-decisions/`), () =>
        problemBody(403, "urn:mth:problem:forbidden", "approval.not_requester", "English detail"),
      ),
    ]);
    const row = await waitFor(() => {
      const r = document.querySelector("[data-transition-decision='TD-01']");
      expect(r).not.toBeNull();
      expect(r!.querySelector("[data-action='resubmit-decision']")).not.toBeNull();
      return r!;
    });
    expect(row.querySelector("[data-action='resubmit-decision']")!.textContent).toContain(
      t("closureP4.decisions.resubmitRound", { n: 2 }),
    );
    expect(row.textContent).toContain(t("closureP4.decisions.returned"));
    expect(row.textContent).toContain(t("closureP4.decisions.round", { n: 1 }));
    expect(row.querySelector("[data-requester-only]")).not.toBeNull();
    expect(row.textContent).toContain("B01 Synthetic churn reduction");
    fireEvent.click(row.querySelector("[data-action='withdraw-decision']")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("closureP4.decisions.withdraw") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.approval__not_requester"));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ status: "withdrawn" });
    expect(patch.headers["if-match"]).toBe('"3"');
  });

  it("creates a transition decision with the residual owner and monitoring (a draft until submitted)", async () => {
    const { requests } = render(locale, [
      route("POST", new RegExp(`${esc(TR)}/transition-decisions$`), () => ({ status: 201, body: decision() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("closureP4.decisions.create")) }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(dialog.querySelector(`[data-field='benefitId'] option[value='${BENEFIT.id}']`)).not.toBeNull(),
    );
    const set = (name: string, value: string) =>
      fireEvent.change(dialog.querySelector(`[data-field='${name}']`)!, { target: { value } });
    set("benefitId", BENEFIT.id);
    set("residualOwnerUserId", USER_ID);
    set("rationale", "Synthetic rationale");
    set("expectedRealizationEnd", "2027-06-30");
    set("firstMonitoringDate", "2026-11-30");
    fireEvent.click(within(dialog).getByRole("button", { name: t("closureP4.decisions.createSubmit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      benefitId: BENEFIT.id,
      residualOwnerUserId: USER_ID,
      rationale: "Synthetic rationale",
      expectedRealizationEnd: "2027-06-30",
      monitoringFrequency: "monthly",
      firstMonitoringDate: "2026-11-30",
      monitoringInterval: 1,
    });
  });
});
