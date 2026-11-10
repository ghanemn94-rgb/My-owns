// The six designed states (T-DG6-FE-D2; ADR-0057 §9; REQ-S15-011 A14/A20: "component tests render each of the six
// states"): empty, loading, error, stale, conflict and no-permission, each in English (LTR) and Arabic (RTL). Each
// state has its `data-state`, an accessible role, a text label (never colour alone) and an icon; the stale and
// conflict texts are ADR-0057 §9's English exactly, and different Arabic texts. Unknown is never shown as 0 or green.
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { PROBLEM_TYPES } from "@mth/shared";
import { ApiError } from "../api/client.ts";
import { createI18n } from "../i18n/index.ts";
import {
  ConflictPanel,
  ConflictState,
  EmptyState,
  ErrorState,
  LoadingState,
  NoPermissionState,
  StaleBanner,
} from "./States.tsx";
import { COMPARE_PROVISIONAL_ARABIC } from "./compare/provisional-ar.ts";

afterEach(cleanup);

function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    if (dirname(dir) === dir) throw new Error("repository root not found");
  }
}
const ADR = (() => {
  const dir = join(repoRoot(), "docs", "architecture", "adr");
  const file = readdirSync(dir).find((f) => f.startsWith("ADR-0057-"));
  if (!file) throw new Error("ADR-0057 not found");
  return readFileSync(join(dir, file), "utf8");
})();

const inLocale = (locale: "en" | "ar", ui: ReactNode) => {
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <div dir={locale === "ar" ? "rtl" : "ltr"}>{ui}</div>
    </I18nextProvider>,
  );
};
const problem = (status: 403 | 404 | 500) =>
  new ApiError(status, {
    type: status === 403 ? PROBLEM_TYPES.forbidden : status === 404 ? PROBLEM_TYPES.notFound : PROBLEM_TYPES.internal,
    title: String(status),
    status,
    code: status === 403 ? "forbidden" : status === 404 ? "not_found" : "internal",
    requestId: `req-${status}`,
  });

const SIX = ["empty", "loading", "error", "stale", "conflict", "no-permission"] as const;
const UPDATED = Date.parse("2026-10-30T06:00:00Z");

function renderState(state: (typeof SIX)[number]) {
  switch (state) {
    case "empty":
      return <EmptyState title="Synthetic empty title" body="Synthetic empty body" />;
    case "loading":
      return <LoadingState />;
    case "error":
      return <ErrorState error={problem(500)} onRetry={() => undefined} />;
    case "stale":
      return <StaleBanner updatedAt={UPDATED} onRetry={() => undefined} />;
    case "conflict":
      return <ConflictState action={<button type="button">Compare</button>} />;
    case "no-permission":
      return <NoPermissionState error={problem(403)} />;
  }
}

describe.each(["en", "ar"] as const)("the six designed states in %s (REQ-S15-011)", (locale) => {
  const t = createI18n(locale).t;

  it.each(SIX)("renders %s with its data-state, a role, a text label and an icon", (state) => {
    const { container } = inLocale(locale, renderState(state));
    const el = container.querySelector(`[data-state="${state}"]`);
    expect(el, state).toBeTruthy();
    expect(el!.querySelector("svg, .spinner"), state).toBeTruthy();
    expect((el!.textContent ?? "").trim().length, state).toBeGreaterThan(3);
    const role = el!.getAttribute("role");
    expect(["status", "alert", null], state).toContain(role);
    if (state !== "empty") expect(role, state).not.toBeNull();
    // Text, never a number standing in for a missing value.
    expect(el!.textContent, state).not.toMatch(/(^|\s)0(\s|$)/);
    if (locale === "ar" && state !== "empty") expect(/[؀-ۿ]/.test(el!.textContent ?? ""), state).toBe(true);
  });

  it("stale says the ADR-0057 §9 text with the last update time (Asia/Riyadh) and the Stale label", () => {
    inLocale(locale, <StaleBanner updatedAt={UPDATED} />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain(t("common.status.stale"));
    expect(el.textContent).toContain("09:00");
    if (locale === "en") {
      const text = t("common.state.staleUpdated", { time: "{time}" });
      expect(text).toBe("This information may be out of date. Last updated {time}.");
      expect(ADR).toContain(`"${text}"`);
    } else
      expect(t("common.state.staleUpdated", { time: "x" })).not.toBe(
        createI18n("en").t("common.state.staleUpdated", { time: "x" }),
      );
  });

  it("stale without a known time says so, never a time of 0", () => {
    inLocale(locale, <StaleBanner updatedAt={0} />);
    const el = screen.getByRole("status");
    expect(el.textContent).toContain(t("common.state.staleUnknown"));
    expect(el.textContent).not.toMatch(/1970/);
  });

  it("conflict says the ADR-0057 §9 text and offers its action; the 409 panel says it too", () => {
    const { unmount } = inLocale(locale, <ConflictState action={<button type="button">Compare</button>} />);
    const el = screen.getByRole("alert");
    expect(el.textContent).toContain(t("common.conflict.lead"));
    expect(screen.getByRole("button", { name: "Compare" })).toBeTruthy();
    if (locale === "en") {
      expect(t("common.conflict.lead")).toBe(
        "Someone else saved this record after you opened it. Compare the changes before saving again.",
      );
      expect(ADR).toContain(`"${t("common.conflict.lead")}"`);
    }
    unmount();
    inLocale(locale, <ConflictPanel yourVersion={2} currentVersion={3} rows={[]} onDiscard={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toContain(t("common.conflict.lead"));
  });

  it("no-permission distinguishes 403 from 404 without disclosing existence", () => {
    const { unmount } = inLocale(locale, <NoPermissionState error={problem(403)} />);
    const forbidden = screen.getByRole("alert").textContent;
    unmount();
    inLocale(locale, <NoPermissionState error={problem(404)} />);
    expect(screen.getByRole("alert").textContent).not.toBe(forbidden);
  });
});

describe("provisional Arabic of the FE-D2 common texts", () => {
  it("lists every Arabic text FE-D2 added outside the productivity namespace; each is Arabic and not the English", () => {
    const en = createI18n("en").t;
    const ar = createI18n("ar").t;
    expect([...COMPARE_PROVISIONAL_ARABIC].sort()).toEqual([
      "common.conflict.lead",
      "common.state.staleUnknown",
      "common.state.staleUpdated",
    ]);
    for (const key of COMPARE_PROVISIONAL_ARABIC) {
      expect(ar(key, { time: "x" }), key).not.toBe(en(key, { time: "x" }));
      expect(/[؀-ۿ]/.test(ar(key, { time: "x" })), key).toBe(true);
    }
  });
});
