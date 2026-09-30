// The six explicit states (REQ-S15-011): loading, empty, error, stale, conflict and no-permission, each with a text
// label (not colour alone), in both languages. Plus status chips: Unknown is never green or zero.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client.ts";
import { createI18n } from "../i18n/index.ts";
import { HealthChip, LifecycleChip, Unknown } from "./Badges.tsx";
import { ConflictPanel, EmptyState, ErrorState, LoadingState, NoPermissionState, StaleBanner } from "./States.tsx";

afterEach(cleanup);

function inLocale(locale: "ar" | "en", ui: ReactNode) {
  const i18n = createI18n(locale);
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

const forbidden = new ApiError(403, {
  type: "urn:mth:problem:forbidden",
  title: "Forbidden",
  status: 403,
  code: "forbidden",
  requestId: "req-42",
});
const notFound = new ApiError(404, {
  type: "urn:mth:problem:not-found",
  title: "Not found",
  status: 404,
  code: "not_found",
  requestId: "req-43",
});
const server = new ApiError(500, {
  type: "urn:mth:problem:internal",
  title: "Internal",
  status: 500,
  code: "internal",
  requestId: "req-44",
});

describe.each(["en", "ar"] as const)("explicit states in %s", (locale) => {
  it("loading is a polite live region with a text label", () => {
    inLocale(locale, <LoadingState />);
    const el = screen.getByRole("status");
    expect(el.dataset["state"]).toBe("loading");
    expect(el.textContent).toMatch(locale === "en" ? /Loading/ : /جارٍ التحميل/);
  });

  it("empty shows its title, body and action", () => {
    inLocale(locale, <EmptyState title="T" body="B" action={<button type="button">Go</button>} />);
    expect(screen.getByText("T")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go" })).toBeTruthy();
  });

  it("error is an alert with the translated message, the request reference and a retry", () => {
    const retry = vi.fn();
    inLocale(locale, <ErrorState error={server} onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert.dataset["state"]).toBe("error");
    expect(alert.textContent).toContain("req-44");
    expect(alert.textContent).not.toContain("Internal"); // English diagnostics title never shown as the message
    fireEvent.click(screen.getByRole("button"));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("stale is labelled Stale with the last successful load time, never shown as current", () => {
    inLocale(locale, <StaleBanner updatedAt={Date.parse("2026-09-30T06:00:00Z")} onRetry={() => undefined} />);
    const el = screen.getByRole("status");
    expect(el.dataset["state"]).toBe("stale");
    expect(el.textContent).toMatch(locale === "en" ? /Stale/ : /قديم/);
    expect(el.textContent).toContain("09:00"); // shown in Asia/Riyadh
  });

  it("no-permission distinguishes 403 from 404 without disclosing existence", () => {
    const { unmount } = inLocale(locale, <NoPermissionState error={forbidden} />);
    expect(screen.getByRole("alert").dataset["state"]).toBe("no-permission");
    const text403 = screen.getByRole("alert").textContent;
    unmount();
    inLocale(locale, <NoPermissionState error={notFound} />);
    expect(screen.getByRole("alert").textContent).not.toBe(text403);
  });

  it("conflict compares values and offers re-apply and discard", () => {
    const reapply = vi.fn();
    const discard = vi.fn();
    inLocale(
      locale,
      <ConflictPanel
        yourVersion={3}
        currentVersion={4}
        rows={[{ field: "name", label: "Name", mine: "Mine", current: "Theirs" }]}
        onReapply={reapply}
        onDiscard={discard}
      />,
    );
    const panel = screen.getByRole("alert");
    expect(panel.dataset["state"]).toBe("conflict");
    expect(panel.textContent).toContain("3");
    expect(panel.textContent).toContain("4");
    expect(screen.getByText("Mine")).toBeTruthy();
    expect(screen.getByText("Theirs")).toBeTruthy();
    const [first, second] = screen.getAllByRole("button");
    fireEvent.click(first!);
    fireEvent.click(second!);
    expect(reapply).toHaveBeenCalledOnce();
    expect(discard).toHaveBeenCalledOnce();
  });
});

describe("status presentation", () => {
  it("Unknown is labelled and styled as unknown, never green or zero", () => {
    inLocale("en", <Unknown />);
    const chip = screen.getByText("Unknown").closest("[data-health]") as HTMLElement;
    expect(chip.dataset["health"]).toBe("unknown");
    expect(chip.className).toContain("status-chip--unknown");
    expect(chip.textContent).not.toMatch(/\b0\b/);
  });
  it("every health state has an icon and a text label", () => {
    for (const h of ["on_track", "at_risk", "off_track", "unknown", "stale"] as const) {
      const { container, unmount } = inLocale("ar", <HealthChip health={h} />);
      expect(container.querySelector("svg[aria-hidden='true']")).toBeTruthy();
      expect(container.textContent!.trim().length).toBeGreaterThan(2);
      unmount();
    }
  });
  it("a draft is labelled 'Draft – not submitted'", () => {
    inLocale("en", <LifecycleChip status="draft" />);
    expect(screen.getByText(/Draft – not submitted/)).toBeTruthy();
  });
});
