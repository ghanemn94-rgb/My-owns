// G1 leadership agreement confirmations in the gate decision dialog (REQ-PB-022, B0032; ADR-0021 §8). SYNTHETIC data.
//  - approving G1 shows three required, labelled checkboxes (problem, baseline, material value pools);
//  - approval is impossible until all three are ticked; then `agreements` is sent with all three `true`;
//  - any other outcome, and any other gate, sends no `agreements` and shows no confirmations;
//  - the server's 422 gate.g1_agreements_required (with its pointers) and gate.agreements_not_applicable are shown as
//    the dialog's one form-level alert, translated, in English LTR and Arabic RTL.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import {
  BUSINESS_UNIT,
  TR_ID,
  makeMe,
  makeTransformation,
  mockApi,
  problem,
  renderApp,
  route,
  type Handler,
} from "../../test/fixtures.tsx";
import { METHODOLOGY, gateViews, leadGrants } from "../../test/p2fixtures.ts";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Locale = "ar" | "en";
const TR = `/api/v1/transformations/${TR_ID}`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const page = (items: unknown[]) => ({ status: 200, body: { items, nextCursor: null } });

const TEXT = {
  en: {
    open: "Record decision",
    approve: "Approve",
    reject: "Reject",
    rationale: /^Rationale/,
    legend: /Leadership agreement for G1/,
    items: [
      "The leadership team agrees on the problem",
      "The leadership team agrees on the baseline",
      "The leadership team agrees on the material value pools",
    ],
    blocked: "Tick all three confirmations to approve G1.",
    required:
      "G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032). Nothing was recorded.",
    missingBaseline: "Not confirmed: agreement on the baseline",
    notApplicable: "Leadership agreement confirmations apply only to approving G1. Nothing was recorded.",
  },
  ar: {
    open: "تسجيل القرار",
    approve: "موافقة",
    reject: "رفض",
    rationale: /^المبرر/,
    legend: /موافقة القيادة على G1/,
    items: [
      "يتفق فريق القيادة على المشكلة",
      "يتفق فريق القيادة على خط الأساس",
      "يتفق فريق القيادة على مجمّعات القيمة الجوهرية",
    ],
    blocked: "حدّد التأكيدات الثلاثة جميعها لاعتماد G1.",
    required:
      "يتطلب اعتماد G1 اتفاق القيادة على المشكلة وخط الأساس ومجمّعات القيمة الجوهرية (B0032). لم يُسجَّل أي شيء.",
    missingBaseline: "غير مؤكَّد: الاتفاق على خط الأساس",
    notApplicable: "تأكيدات اتفاق القيادة تنطبق فقط على اعتماد G1. لم يُسجَّل أي شيء.",
  },
} as const;

/** A pending submission #1 of `code` that the caller may decide. */
function pendingView(code: "G1" | "G2") {
  const views = gateViews({ pending: true, canDecide: true });
  if (code === "G1") return views[0]!;
  const g1 = views[0]!;
  const g2 = views[1]!;
  return {
    ...g2,
    gate: { ...g2.gate, status: "submitted", currentSubmissionId: g1.currentSubmission!.id, latestSubmissionNo: 1 },
    currentSubmission: { ...g1.currentSubmission!, gateCode: "G2" },
    canDecide: true,
  };
}

function render(code: "G1" | "G2", locale: Locale, decide: Handler) {
  const handlers: Handler[] = [
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(["gate.decide"]), { preferredLocale: locale }),
    })),
    route("GET", /\/business-units/, () => page([BUSINESS_UNIT])),
    route("GET", new RegExp(`${esc(TR)}$`), () => ({ status: 200, body: makeTransformation() })),
    route("GET", new RegExp(`${esc(TR)}/methodology$`), () => ({ status: 200, body: METHODOLOGY })),
    route("GET", new RegExp(`${esc(TR)}/gates/${code}$`), () => ({ status: 200, body: pendingView(code) })),
    decide,
    // Every other register of the transformation answers an empty page.
    (req) => (req.method === "GET" && req.url.startsWith("/api/v1/") ? page([]) : undefined),
  ];
  const api = mockApi(...handlers);
  renderApp(`/transformations/${TR_ID}/gates/${code}`, { i18n: createI18n(locale) });
  return api;
}

async function openDialog(locale: Locale) {
  fireEvent.click(await screen.findByRole("button", { name: TEXT[locale].open }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText(TEXT[locale].rationale), {
    target: { value: "Synthetic rationale" },
  });
  return dialog;
}

const confirmButton = (dialog: HTMLElement, locale: Locale) =>
  within(dialog).getByRole("button", { name: TEXT[locale].open }) as HTMLButtonElement;

describe.each(["en", "ar"] as const)("G1 agreements step (%s)", (locale) => {
  const tx = TEXT[locale];

  it("approving G1 needs the three labelled confirmations; then sends agreements with all three true", async () => {
    const { requests } = render(
      "G1",
      locale,
      route("POST", /\/gates\/G1\/decision$/, () => ({ status: 200, body: {} })),
    );
    const dialog = await openDialog(locale);
    expect(document.documentElement.dir).toBe(locale === "ar" ? "rtl" : "ltr");
    // Not shown before the outcome is "approve".
    expect(within(dialog).queryByRole("group", { name: tx.legend })).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.approve }));

    const group = within(dialog).getByRole("group", { name: tx.legend });
    expect(group.textContent).toContain("B0032");
    const boxes = tx.items.map((name) => within(group).getByRole("checkbox", { name }) as HTMLInputElement);
    for (const box of boxes) {
      expect(box.checked).toBe(false);
      expect(box.required).toBe(true);
    }
    // Impossible until all three are ticked: a submit attempt sends nothing, marks the unticked boxes invalid, says
    // why next to them (no second live region: the dialog's one form-level alert stays for server problems) and
    // focuses the first unticked box.
    fireEvent.click(boxes[0]!);
    fireEvent.click(confirmButton(dialog, locale));
    await waitFor(() => expect(document.activeElement).toBe(boxes[1]));
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(boxes.map((b) => b.getAttribute("aria-invalid"))).toEqual([null, "true", "true"]);
    expect(document.getElementById(boxes[1]!.getAttribute("aria-describedby")!)!.textContent).toContain(tx.blocked);
    expect(within(dialog).queryAllByRole("alert")).toHaveLength(0);
    fireEvent.click(boxes[1]!);
    fireEvent.click(confirmButton(dialog, locale));
    expect(requests.some((r) => r.method === "POST")).toBe(false);
    expect(boxes[2]!.getAttribute("aria-invalid")).toBe("true");

    fireEvent.click(boxes[2]!);
    // All three ticked: the error is gone and the decision is sent.
    expect(within(dialog).queryByText(tx.blocked)).toBeNull();
    expect(boxes.every((b) => b.getAttribute("aria-invalid") === null)).toBe(true);
    fireEvent.click(confirmButton(dialog, locale));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic rationale",
      agreements: { problem: true, baseline: true, materialValuePools: true },
    });
  });

  it("a non-approve outcome on G1 sends no agreements (even after ticking them)", async () => {
    const { requests } = render(
      "G1",
      locale,
      route("POST", /\/gates\/G1\/decision$/, () => ({ status: 200, body: {} })),
    );
    const dialog = await openDialog(locale);
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.approve }));
    for (const name of tx.items) fireEvent.click(within(dialog).getByRole("checkbox", { name }));
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.reject }));
    expect(within(dialog).queryByRole("group", { name: tx.legend })).toBeNull();
    fireEvent.click(confirmButton(dialog, locale));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      submissionNo: 1,
      outcome: "rejected",
      rationale: "Synthetic rationale",
    });
  });

  it("approving another gate (G2) shows no confirmations and sends no agreements", async () => {
    const { requests } = render(
      "G2",
      locale,
      route("POST", /\/gates\/G2\/decision$/, () => ({ status: 200, body: {} })),
    );
    const dialog = await openDialog(locale);
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.approve }));
    expect(within(dialog).queryByRole("group", { name: tx.legend })).toBeNull();
    expect(within(dialog).queryAllByRole("checkbox")).toHaveLength(0);
    fireEvent.click(confirmButton(dialog, locale));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.body).toEqual({
      submissionNo: 1,
      outcome: "approved",
      rationale: "Synthetic rationale",
    });
  });

  it("the server's 422 gate.g1_agreements_required is the one form-level alert, with the missing confirmations", async () => {
    render(
      "G1",
      locale,
      route("POST", /\/gates\/G1\/decision$/, () =>
        problem(422, "gate.g1_agreements_required", {
          detail:
            "G1 approval requires leadership agreement on the problem, the baseline and the material value pools (B0032)",
          errors: [
            { pointer: "/agreements/baseline", code: "gate.g1_agreements_required", message: "English diagnostic" },
          ],
        }),
      ),
    );
    const dialog = await openDialog(locale);
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.approve }));
    for (const name of tx.items) fireEvent.click(within(dialog).getByRole("checkbox", { name }));
    fireEvent.click(confirmButton(dialog, locale));
    const alert = await within(dialog).findByRole("alert");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(alert.dataset["problem"]).toBe("gate.g1_agreements_required");
    expect(alert.textContent).toContain(tx.required);
    expect(alert.textContent).toContain(tx.missingBaseline);
    expect(alert.querySelector("[data-missing-agreements]")!.getAttribute("data-missing-agreements")).toBe("baseline");
    // The English diagnostic never shows in Arabic.
    if (locale === "ar") expect(alert.textContent).not.toContain("English diagnostic");
  });

  it("the server's 422 gate.agreements_not_applicable is translated as the one form-level alert", async () => {
    render(
      "G1",
      locale,
      route("POST", /\/gates\/G1\/decision$/, () =>
        problem(422, "gate.agreements_not_applicable", {
          errors: [{ pointer: "/agreements", code: "gate.agreements_not_applicable", message: "English diagnostic" }],
        }),
      ),
    );
    const dialog = await openDialog(locale);
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.reject }));
    fireEvent.click(confirmButton(dialog, locale));
    const alert = await within(dialog).findByRole("alert");
    expect(within(dialog).getAllByRole("alert")).toHaveLength(1);
    expect(alert.textContent).toContain(tx.notApplicable);
    expect(alert.querySelector("[data-missing-agreements]")).toBeNull();
  });
});
