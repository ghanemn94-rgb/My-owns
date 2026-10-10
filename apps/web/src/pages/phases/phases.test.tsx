// The phase workspace (T-DG4-FE-F2; p4-work-split §H H.6; ADR-0035 §1, §11; ADR-0035 A2, D-109) with STUBBED responses,
// in English (LTR) and Arabic (RTL). The live journey is e2e/p4-change-phases.spec.ts. SYNTHETIC data only.
//  - REQ-PB-014: the catalogue lists exactly six phases in order with their names, purposes and the objective text.
//  - REQ-S04-001: steps with required evidence, owners ("Unknown" when unassigned) and the review queue; an unmet
//    completion rule is refused 422 `phase_step.completion_rule_unmet`, translated; the owner cannot review.
//  - A step with no row is read at version 0 and its first save sends `If-Match: "0"`.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@mth/shared";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, USER_ID, makeMe, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import type { Handler } from "../../test/fixtures.tsx";
import { OTHER_USER, leadGrants } from "../../test/p2fixtures.ts";
import { esc, frameHandlers, page, problemBody, T, TR } from "../portfolio/p3fixtures.ts";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PERMS = ["phase_step.manage", "phase_step.progress", "phase_step.review"] as Permission[];
const CODES = ["diagnose", "define", "design", "mobilize", "transform", "realize"] as const;

const phase = (code: (typeof CODES)[number], n: number) => ({
  code,
  ordinal: n,
  gateCode: `G${n}`,
  sourceNameEn: code.toUpperCase(),
  nameAr: `مرحلة ${n}`,
  sourceTitleEn: `${code.toUpperCase()} — synthetic title`,
  titleAr: `عنوان المرحلة ${n}`,
  sourcePurposeEn: `Purpose of ${code}`,
  purposeAr: `غرض المرحلة ${n}`,
  sourceKeyOutputsEn: `Outputs of ${code}`,
  keyOutputsAr: `مخرجات المرحلة ${n}`,
  sourceObjectiveEn: `Objective of ${code}`,
  objectiveAr: `هدف المرحلة ${n}`,
  sourceRef: "B0021",
  arProvisional: true,
});

function step(over: Record<string, unknown> = {}) {
  return {
    transformationId: TR_ID,
    stepKey: "diagnose.capture_baseline",
    phase: "diagnose",
    ordinal: 1,
    sourceProcedureEn: "Capture the baseline",
    procedureAr: "تسجيل خط الأساس",
    requiredEvidenceEn: "A verified baseline evidence item",
    requiredEvidenceAr: "دليل خط أساس موثَّق",
    defaultOwnerRoleCode: "TL",
    reviewerRoleCode: "TO",
    completionRule: "evidence_linked",
    id: null,
    ownerUserId: null,
    status: "not_started",
    enabledByGateDecisionId: null,
    reviewRequestedBy: null,
    reviewRequestedAt: null,
    completionCheck: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewOutcome: null,
    reviewNote: null,
    completedAt: null,
    version: 0,
    ...over,
  };
}

const OWNED = step({
  stepKey: "diagnose.map_pain_points",
  ordinal: 2,
  id: "7c1a3f2e-0000-4000-8000-000000000001",
  ownerUserId: USER_ID,
  status: "in_progress",
  version: 2,
});
const IN_REVIEW = step({
  stepKey: "diagnose.assess_readiness",
  ordinal: 3,
  id: "7c1a3f2e-0000-4000-8000-000000000002",
  ownerUserId: USER_ID,
  status: "in_review",
  reviewRequestedBy: USER_ID,
  reviewRequestedAt: T,
  completionCheck: { rule: "evidence_linked", met: true, facts: {} },
  version: 3,
});

const WORKSPACE = {
  transformationId: TR_ID,
  currentPhase: "diagnose",
  phases: CODES.map((c, i) => ({
    phase: phase(c, i + 1),
    isCurrent: i === 0,
    gateStatus: "draft",
    steps: i === 0 ? [step(), OWNED, IN_REVIEW] : [],
    reviewQueueCount: i === 0 ? 1 : 0,
  })),
};

function render(locale: "en" | "ar", extra: Handler[] = []) {
  const api = mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: makeMe(leadGrants(PERMS), { preferredLocale: locale }),
    })),
    ...frameHandlers(locale, "lead", [
      ...extra,
      route("GET", /\/api\/v1\/phases$/, () => ({
        status: 200,
        body: { items: CODES.map((c, i) => phase(c, i + 1)) },
      })),
      route("GET", new RegExp(`${esc(TR)}/phases$`), () => ({ status: 200, body: WORKSPACE })),
      route("GET", new RegExp(`${esc(TR)}/phase-steps\\?`), () => page([IN_REVIEW])),
      route("GET", /\/team/, () => page([{ assignment: { userId: OTHER_USER } }])),
    ]),
  );
  renderApp(`/transformations/${TR_ID}/phases`, { i18n: createI18n(locale) });
  return api;
}

describe.each(["en", "ar"] as const)("phase workspace (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("lists the six phases in order, the objective, Unknown owners and the review queue; never moves a gate", async () => {
    render(locale);
    const catalogue = await waitFor(() => {
      const el = document.querySelector("[data-phase-catalogue]");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(catalogue.getAttribute("data-phase-catalogue")).toBe("6");
    expect([...catalogue.querySelectorAll("[data-phase]")].map((r) => r.getAttribute("data-phase"))).toEqual([
      ...CODES,
    ]);
    const panel = await waitFor(() => {
      const el = document.querySelector("[data-phase-panel='diagnose']");
      expect(el).not.toBeNull();
      return el!;
    });
    expect(panel.querySelector("[data-phase-objective='diagnose']")!.textContent).toBe(
      locale === "en" ? "Objective of diagnose" : "هدف المرحلة 1",
    );
    const unowned = panel.querySelector("[data-step='diagnose.capture_baseline']")!;
    expect(unowned.querySelector("[data-owner='unknown']")!.textContent).toContain(t("common.value.unknown"));
    expect(unowned.getAttribute("data-version")).toBe("0");
    expect(unowned.textContent).toContain(t("phasesP4.rule.evidence_linked"));
    expect(document.querySelector("[data-review-queue='1']")).not.toBeNull();
    expect(document.querySelector("[data-state='steps-never-move-gates']")).not.toBeNull();
    if (locale === "ar") expect(document.querySelector("[data-ar-provisional]")).not.toBeNull();
    // The owner of a step in review is not offered the review.
    const own = panel.querySelector("[data-step='diagnose.assess_readiness']")!;
    expect(own.querySelector("[data-action='step-review']")).toBeNull();
    expect(own.querySelector("[data-own-step]")!.textContent).toContain(t("phasesP4.step.ownerCannotReview"));
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it('a step with no record is read with ETag "0" and its first save sends If-Match "0"', async () => {
    const { requests } = render(locale, [
      route("GET", new RegExp(`${esc(TR)}/phase-steps/diagnose.capture_baseline$`), () => ({
        status: 200,
        body: step({}),
        headers: { ETag: '"0"' },
      })),
      route("PATCH", new RegExp(`${esc(TR)}/phase-steps/diagnose.capture_baseline$`), () => ({
        status: 200,
        body: step({ id: "7c1a3f2e-0000-4000-8000-000000000009", status: "in_progress", version: 1 }),
      })),
    ]);
    const btn = await waitFor(() => {
      const el = document.querySelector("[data-step='diagnose.capture_baseline'] [data-action='step-start']");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(btn);
    // getPhaseStep is read first (D-109); then the form dialog shows the version of its ETag.
    const startButton = await screen.findByRole("button", { name: t("phasesP4.step.start") });
    const dialog = screen.getByRole("dialog");
    fireEvent.click(startButton);
    expect(requests.some((r) => r.method === "GET" && r.url.endsWith("/phase-steps/diagnose.capture_baseline"))).toBe(
      true,
    );
    expect(dialog.textContent).toContain(t("phasesP4.step.versionNote", { n: 0 }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"0"');
    expect(patch.body).toEqual({ start: true });
  });

  it("requesting review with an unmet completion rule shows the translated 422", async () => {
    const { requests } = render(locale, [
      route("POST", new RegExp(`${esc(TR)}/phase-steps/diagnose.map_pain_points/request-review$`), () =>
        problemBody(
          422,
          "urn:mth:problem:invalid-transition",
          "phase_step.completion_rule_unmet",
          "The completion rule of this step is not met: at least one verified evidence item must be linked.",
        ),
      ),
    ]);
    const btn = await waitFor(() => {
      const el = document.querySelector("[data-step='diagnose.map_pain_points'] [data-action='step-request']");
      expect(el).not.toBeNull();
      return el!;
    });
    fireEvent.click(btn);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: t("phasesP4.step.requestReview") }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).toContain(t("problems.phase_step__completion_rule_unmet"));
    if (locale === "ar") expect(alert.textContent).not.toContain("verified evidence item");
    const post = requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"2"');
  });
});
