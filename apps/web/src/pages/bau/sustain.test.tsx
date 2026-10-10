// Slice G screens (T-DG4-FE-E; p4-work-split §F+G FG.8) with stubbed responses, in English (LTR) and Arabic (RTL).
// SYNTHETIC data only.
//  - REQ-S11-005: the handover checklist names the missing items; a 422 bau_handover.incomplete names "data access" in
//    the shown language; only the receiving owner is offered accept/return, labelled a business approval.
//  - REQ-S11-009: after reopening, the area shows the original handover acceptance and closure date unchanged.
//  - REQ-S11-008: a failed control check links to its recovery action; a lesson of another transformation is found.
//  - REQ-PB-084: CI items stay visible and editable when the transformation is closed.
//  - REQ-S11-004: a review with an `unknown` performance signal shows Unknown, never on track.
//  - S-6/S-11: every ADR-0034 §12 code is translated in both languages. S-7: no DG0-DG7 label.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, makeTransformation, mockApi, problem, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers, page } from "../my-work/p4fixtures.ts";
import {
  AREA_ID,
  CASE_ID,
  HANDOVER_ID,
  area,
  check,
  ciItem,
  handover,
  review,
  searchHit,
} from "../adoption/adoptionFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** ADR-0034 §12 codes (S-11). */
const SLICE_G_CODES = [
  "initiative.delivery_not_launched",
  "initiative.adoption_status_invalid",
  "closure.delivery_not_complete",
  "closure.already_closed",
  "closure.value_validation_pending",
  "closure.sustainment_owner_missing",
  "closure.transformation_not_open",
  "closure.g6_not_approved",
  "closure.bau_not_accepted",
  "performance_area.retired",
  "performance_area.not_reopenable",
  "performance_area.reopen_reason_required",
  "performance_area_link.exists",
  "bau_handover.incomplete",
  "bau_handover.not_receiving_owner",
  "bau_handover.status_transition",
  "bau_handover.frozen",
  "bau_handover.accepted_final",
  "bau_handover.area_not_open",
  "bau_handover.exists",
  "bau_handover.return_reason_required",
  "control.retired",
  "control_check.final",
  "control_check.result_note_required",
  "sustainment_review.not_assignee",
  "sustainment_review.final",
  "improvement_item.final",
  "improvement_item.status_transition",
  "improvement_item.resolution_note_required",
  "lesson.archived",
  "lesson.status_transition",
  "transition_decision.exists",
  "transition_decision.final",
  "transition_decision.frozen",
  "transition_decision.benefit_validated",
  "transition_decision.monitoring_after_end",
];

const NO_DG = /\bDG[0-7]\b/;

describe.each(["en", "ar"] as const)("BAU and improvement screens (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("translates every ADR-0034 §12 code in both languages", () => {
    const key = (c: string) => `problems.${c.replace(/\./g, "__")}`;
    expect(SLICE_G_CODES.filter((c) => !t(key(c), { defaultValue: "" }))).toEqual([]);
    if (locale === "ar") for (const c of SLICE_G_CODES) expect(t(key(c)), c).toMatch(/[؀-ۿ]/);
  });

  it("handover checklist marks data access missing; submit 422 names it in the shown language", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["bau_handover.prepare"],
        [
          route("GET", new RegExp(`${esc(TRP)}/bau-handovers/${HANDOVER_ID}$`), () => json(handover())),
          route("GET", new RegExp(`${esc(TRP)}/performance-areas\\?`), () => page([area()])),
          route("POST", new RegExp(`${esc(TRP)}/bau-handovers/${HANDOVER_ID}/submit$`), () =>
            problem(422, "bau_handover.incomplete", {
              detail: "The BAU handover is incomplete. Missing: data access.",
              errors: [{ pointer: "/dataAccess", code: "bau_handover.incomplete", message: "data access" }],
            }),
          ),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/bau-handovers/${HANDOVER_ID}`, { i18n: createI18n(locale) });
    const checklist = await screen.findByRole("table", { name: t("sustainP4.handover.checklist") });
    const rows = checklist.querySelectorAll("tbody tr");
    expect(rows).toHaveLength(9);
    const data = checklist.querySelector("[data-item='data_access']")!;
    expect(data.getAttribute("data-item-state")).toBe("missing");
    expect(data.textContent).toContain(t("sustainP4.handover.missing"));
    expect(checklist.querySelector("[data-item='kpi_owner']")!.getAttribute("data-item-state")).toBe("present");
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("sustainP4.handover.submit")) }));
    const alert = await screen.findByRole("alert");
    expect(alert.getAttribute("data-problem")).toBe("bau_handover.incomplete");
    expect(alert.querySelector("[data-missing-items]")!.textContent).toBe(t("sustainP4.handover.item.data_access"));
    if (locale === "ar") expect(alert.textContent).not.toContain("data access");
    expect(requests.find((r) => r.method === "POST")!.headers["if-match"]).toBe('"4"');
    // The preparer is not the receiving owner: no accept/return offered.
    expect(document.querySelector("[data-accept-handover]")).toBeNull();
    expect(document.body.textContent).not.toMatch(NO_DG);
  });

  it("only the receiving owner is offered accept, labelled a business approval", async () => {
    const submitted = handover({ status: "submitted", missingItems: [], dataAccess: "Synthetic BI read role" });
    // Not the receiving owner (the receiving owner is OTHER_USER): no action, a note instead.
    mockApi(
      ...p4Handlers(
        locale,
        ["bau_handover.accept"],
        [route("GET", new RegExp(`${esc(TRP)}/bau-handovers/${HANDOVER_ID}$`), () => json(submitted))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/bau-handovers/${HANDOVER_ID}`, { i18n: createI18n(locale) });
    expect(await screen.findByText(t("sustainP4.handover.receiverOnly"))).toBeTruthy();
    expect(document.querySelector("[data-accept-handover]")).toBeNull();
    cleanup();
    vi.unstubAllGlobals();
    // The receiving owner: accept is offered, with the business-approval note, and sends If-Match.
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["bau_handover.accept"],
        [
          route("GET", new RegExp(`${esc(TRP)}/bau-handovers/${HANDOVER_ID}$`), () =>
            json({ ...submitted, receivingOwnerUserId: USER_ID }),
          ),
          route("POST", new RegExp(`${esc(TRP)}/bau-handovers/${HANDOVER_ID}/accept$`), () => json(submitted)),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/bau-handovers/${HANDOVER_ID}`, { i18n: createI18n(locale) });
    fireEvent.click(await screen.findByRole("button", { name: new RegExp(t("sustainP4.handover.accept")) }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("[data-state='business-approval']")!.textContent).toContain(
      t("myWork.ui.businessApproval"),
    );
    expect(dialog.textContent).not.toMatch(NO_DG);
    fireEvent.click(within(dialog).getByRole("button", { name: t("sustainP4.handover.acceptSubmit") }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/accept"))).toBe(true));
    expect(requests.find((r) => r.method === "POST")!.headers["if-match"]).toBe('"4"');
  });

  it("after reopening, the area shows the original handover acceptance and closure date", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [route("GET", new RegExp(`${esc(TRP)}/performance-areas/${AREA_ID}$`), () => json(area()))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/performance-areas/${AREA_ID}`, { i18n: createI18n(locale) });
    const cycles = await screen.findByRole("table", { name: t("sustainP4.areas.cyclesTitle") });
    const cycle2 = cycles.querySelector("[data-cycle='2']")!;
    expect(cycle2.querySelector("[data-prior-handover-accepted='2026-03-10T09:30:00Z']")).toBeTruthy();
    expect(cycle2.querySelector("[data-prior-closed='2026-06-30T12:00:00Z']")).toBeTruthy();
    expect(cycle2.textContent).toMatch(/2026|٢٠٢٦/);
    expect(cycle2.textContent).toContain("Synthetic: walk-in waits deteriorated");
    // BAU owner and next review: Unknown / not scheduled, never a guessed value.
    const details = document.querySelector("[data-area='PA-01']")!;
    expect(details.querySelector("[data-owner='unknown']")).toBeTruthy();
    expect(details.querySelector("[data-scheduled='none']")!.textContent).toContain(t("sustainP4.notScheduled"));
  });

  it("a failed check links to its recovery action; an unknown review signal is Unknown, never on track", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/control-checks\\?`), () => page([check()])),
          route("GET", new RegExp(`${esc(TRP)}/sustainment-reviews\\?`), () => page([review()])),
          route("GET", new RegExp(`${esc(TRP)}/performance-areas\\?`), () => page([area()])),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/bau-controls`, { i18n: createI18n(locale) });
    const link = await waitFor(() => {
      const el = document.querySelector(`[data-recovery='${CASE_ID}']`);
      expect(el).toBeTruthy();
      return el as HTMLAnchorElement;
    });
    expect(link.getAttribute("href")).toBe(`/transformations/${TR_ID}/corrective-actions/${CASE_ID}`);
    cleanup();
    renderApp(`/transformations/${TR_ID}/bau-reviews`, { i18n: createI18n(locale) });
    const signal = await waitFor(() => {
      const el = document.querySelector("[data-signal='unknown']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(signal.textContent).toContain(t("sustainP4.signal.unknown"));
    expect(document.querySelector("[data-signal='on_track']")).toBeNull();
  });

  it("CI backlog stays visible and editable after the transformation is closed", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["improvement.edit"],
        [
          route("GET", new RegExp(`${esc(TRP)}$`), () => json(makeTransformation({ status: "closed" }))),
          route("GET", new RegExp(`${esc(TRP)}/improvement-items\\?`), () => page([ciItem()])),
          route("PATCH", new RegExp(`${esc(TRP)}/improvement-items/`), () => json(ciItem({ version: 2 }))),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/improvement`, { i18n: createI18n(locale) });
    expect(await screen.findByText("Synthetic: shorten the walk-in triage")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-edit='CI-01']")!);
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(dialog.querySelector("[data-field='status']")!, { target: { value: "in_progress" } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("sustainP4.save") }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ status: "in_progress" });
    expect(patch.headers["if-match"]).toBe('"1"');
  });

  it("lesson search finds a published lesson of another transformation", async () => {
    const { requests } = mockApi(
      ...p4Handlers(
        locale,
        ["lesson.search"],
        [route("GET", /\/api\/v1\/lessons\/search\?/, () => page([searchHit()]))],
      ),
    );
    renderApp(`/lessons`, { i18n: createI18n(locale) });
    fireEvent.change(await screen.findByLabelText(t("sustainP4.search.q")), { target: { value: "champions" } });
    fireEvent.click(screen.getByRole("button", { name: t("sustainP4.search.submit") }));
    const hit = await waitFor(() => {
      const el = document.querySelector("[data-search-hit='LL-01']");
      expect(el).toBeTruthy();
      return el!;
    });
    expect(hit.closest("tr")!.textContent).toContain("TR-0002");
    expect(requests.some((r) => r.url.includes("/lessons/search?") && r.url.includes("q=champions"))).toBe(true);
  });
});
