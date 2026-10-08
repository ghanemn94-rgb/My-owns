// Readiness (REQ-PB-007, B0012; ADR-0021 §9) with stubbed responses, in English (LTR) and Arabic (RTL). SYNTHETIC.
//  - missingDiagnosticAreas with the five B0012 labels; not covered is never green;
//  - G1-G4 status; an inherited approval is "pending verification" until it counts, and never shown as approval;
//  - the sequencing blockers translated from their codes (the English text is never shown in Arabic).
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { dispensation, esc, frameHandlers, readiness, TR } from "../portfolio/p3fixtures.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const LABELS = {
  en: ["Economics", "Customer", "Operations", "Capability", "Technology"],
  ar: ["الجوانب الاقتصادية", "العملاء", "العمليات", "القدرات", "التقنية"],
} as const;

describe.each(["en", "ar"] as const)("Readiness (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists the missing diagnostic areas by name, the gates and the translated sequencing blockers", async () => {
    const pendingInherited = dispensation({
      kind: "inherited_approval",
      gateCode: "G1",
      reason: null,
      approvingBody: "Synthetic board",
      approvedOn: "2026-01-15",
      evidenceVerified: false,
      expiresOn: null,
      counts: false,
    });
    const { requests } = mockApi(
      ...frameHandlers(locale, "lead", [
        route("GET", new RegExp(`${esc(TR)}/readiness$`), () => ({
          status: 200,
          body: readiness({
            mode: "modular",
            entryPhase: "design",
            gates: [
              { gateCode: "G1", status: "draft", dispensations: [pendingInherited] },
              { gateCode: "G2", status: "approved", dispensations: [] },
              { gateCode: "G3", status: "draft", dispensations: [] },
              { gateCode: "G4", status: "draft", dispensations: [] },
            ],
          }),
        })),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/readiness`, { i18n: createI18n(locale) });
    expect(await screen.findByRole("heading", { level: 1, name: t("readiness.title") })).toBeTruthy();
    const missing = await screen.findByText(t("readiness.diagnostic.missingTitle"));
    const list = missing.closest("[data-state='missing-areas']")!;
    expect([...list.querySelectorAll("[data-missing-area]")].map((li) => li.textContent?.trim())).toEqual(
      LABELS[locale].map((l) => l),
    );
    // Not covered is a non-colour cue with text, never green.
    for (const row of document.querySelectorAll("tr[data-area]")) {
      expect(row.getAttribute("data-covered")).toBe("false");
      expect(row.textContent).toContain(t("readiness.diagnostic.notCovered"));
      expect(row.querySelector(".status-chip--on-track")).toBeNull();
    }
    // The inherited approval is pending verification and G1 is not shown as approved.
    const g1 = document.querySelector("[data-gate='G1']")!;
    expect(g1.getAttribute("data-gate-status")).toBe("draft");
    expect(g1.textContent).toContain(t("readiness.dispensation.inheritedPending", { gate: "G1" }));
    expect(g1.textContent).not.toContain(t("gates.status.approved"));
    // The blocker is translated; the English server text is not shown.
    const blocker = document.querySelector("[data-blocker='initiative.g1_not_approved']")!;
    expect(blocker.textContent).toContain(
      locale === "en" ? "Case for change not yet approved (G1)" : "مبررات التغيير لم تُعتمد بعد (G1)",
    );
    expect(document.body.textContent).not.toContain("leadership agreement …");
    expect(document.querySelector("[data-sequencing='submit']")?.getAttribute("data-allowed")).toBe("false");
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
    expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  });

  it("an accepted, verified inherited approval counts, and the gate itself still is not approved", async () => {
    const counted = dispensation({
      kind: "inherited_approval",
      gateCode: "G1",
      evidenceVerified: true,
      status: "accepted",
      counts: true,
    });
    mockApi(
      ...frameHandlers(locale, "auditor", [
        route("GET", new RegExp(`${esc(TR)}/readiness$`), () => ({
          status: 200,
          body: readiness({
            gates: [
              { gateCode: "G1", status: "draft", dispensations: [counted] },
              { gateCode: "G2", status: "draft", dispensations: [] },
              { gateCode: "G3", status: "draft", dispensations: [] },
              { gateCode: "G4", status: "draft", dispensations: [] },
            ],
            missingDiagnosticAreas: [],
            diagnostic: readiness().diagnostic.map((d) => ({ ...d, covered: true, missing: [] })),
            sequencing: { canSubmitInitiatives: true, canLaunchInitiatives: false, blockers: [] },
          }),
        })),
      ]),
    );
    renderApp(`/transformations/${TR_ID}/readiness`, { i18n: createI18n(locale) });
    expect(await screen.findByText(new RegExp(esc(t("readiness.diagnostic.allCovered"))))).toBeTruthy();
    const g1 = document.querySelector("[data-gate='G1']")!;
    expect(g1.textContent).toContain(t("readiness.dispensation.inheritedCounts", { gate: "G1" }));
    expect(g1.querySelector("[data-gate-status='draft']")).toBeTruthy();
    expect(document.querySelector("[data-sequencing='submit']")?.getAttribute("data-allowed")).toBe("true");
    expect(document.querySelector("[data-state='read-only']")).toBeTruthy();
  });
});
