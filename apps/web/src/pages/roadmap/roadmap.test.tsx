// Roadmap (T07) screen, stubbed API, English LTR and Arabic RTL (T-DG3-FE-B; REQ-PB-050, REQ-S09-006). SYNTHETIC data.
//  - the four source waves verbatim (EN), provisional Arabic with the English source shown;
//  - the timeline, the initiative table and the work board read ONE ["roadmap", tid] entry: moving a milestone
//    (PATCH + If-Match) refetches that one resource once and all three views show the new date;
//  - a 409 shows the conflict notice and reloads; approve-date requires a reason; deliverable acceptance; Unknown flags.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { problem, route } from "../../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  TR,
  esc,
  grants,
  milestone,
  roadmapView,
  renderWorkspace,
} from "../prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const R = `${TR}/roadmap`;
const TEXT = {
  en: {
    move: "Move Pilot go-live",
    forecast: /^Forecast date/,
    saveForecast: "Save forecast",
    conflict: "Someone else changed this record",
    reapprove: "Re-approve date of Pilot go-live",
    approveConfirm: "Approve date",
    reason: /^Reason/,
    decide: "Accept or reject Pilot report",
    accept: "Accept",
    record: "Record decision",
    unknownFlag: "Schedule Unknown: a date needed for the check is missing",
    nov20: "Nov 20, 2026",
    dec05: "5 Dec 2026",
  },
  ar: {
    move: "نقل Pilot go-live",
    forecast: /^التاريخ المتوقع/,
    saveForecast: "حفظ التوقع",
    conflict: "عدّل شخص آخر هذا السجل",
    reapprove: "إعادة اعتماد تاريخ Pilot go-live",
    approveConfirm: "اعتماد التاريخ",
    reason: /^السبب|^المبرر/,
    decide: "قبول أو رفض Pilot report",
    accept: "قبول",
    record: "تسجيل القرار",
    unknownFlag: "الجدولة غير معروفة: ينقص تاريخ لازم للتحقق",
    nov20: "2026",
    dec05: "2026",
  },
} as const;

const ALL = ["roadmap.edit", "roadmap.approve", "deliverable.accept", "initiative.edit"] as const;

describe.each(["en", "ar"] as const)("roadmap (%s)", (locale) => {
  const tx = TEXT[locale];

  it("shows the four source waves verbatim (English source also shown in Arabic) with overlapping horizons", async () => {
    renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
    ]);
    const waves = await screen.findByTestId("waves");
    for (const name of ["Wave 0 — Mobilize", "Wave 1 — Prove", "Wave 2 — Scale", "Wave 3 — Embed"]) {
      expect(waves.textContent).toContain(name);
    }
    if (locale === "en") {
      expect(waves.textContent).toContain("Evidence + capacity");
      expect(waves.textContent).toContain("Benefits sustained, ownership transferred");
    } else {
      expect(waves.textContent).toContain("الموجة 0 (ترجمة مؤقتة)");
      expect(document.querySelector(".badge--provisional")).not.toBeNull();
    }
    const horizons = screen.getByTestId("wave-horizons");
    expect(within(horizons).getAllByRole("listitem")).toHaveLength(4);
    expect(document.body.textContent).not.toMatch(/critical path(?! is)/i);
  });

  it("moving a milestone PATCHes the forecast with If-Match and the timeline, table and board all show the new date from one refetch", async () => {
    let current = roadmapView();
    const { api } = renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: current })),
      route("PATCH", /\/api\/v1\/milestones\/[^/]+$/, (req) => {
        const body = req.body as { forecastDate: string };
        current = roadmapView({
          milestones: [milestone({ forecastDate: body.forecastDate, varianceDays: 20, version: 4 })],
        });
        return { status: 200, body: current.milestones[0] };
      }),
    ]);
    await screen.findByTestId("timeline-milestones");
    const before = api.requests.filter((r) => r.method === "GET" && r.url.endsWith("/roadmap")).length;
    fireEvent.click(screen.getByRole("button", { name: tx.move }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tx.forecast), { target: { value: "2026-12-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.saveForecast }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"3"');
    expect(patch.body).toEqual({ forecastDate: "2026-12-05" });
    await waitFor(() => expect(screen.getByTestId("timeline-date").textContent).toMatch(/5|٥/));
    const after = api.requests.filter((r) => r.method === "GET" && r.url.endsWith("/roadmap")).length;
    expect(after - before).toBe(1);
    const timeline = screen.getByTestId("timeline-date").textContent;
    const table = document.querySelector(
      "[data-initiative='INI-01'] [data-testid='table-next-milestone']",
    )!.textContent;
    const board = document.querySelector("[data-card='INI-01'] [data-testid='board-next-milestone']")!.textContent;
    const forecastCell = screen.getByTestId("milestone-forecast").textContent;
    for (const text of [table, board, forecastCell]) expect(text).toContain(timeline!);
    if (locale === "en") expect(timeline).toBe(tx.dec05);
  });

  it("a 409 on moving a milestone shows the conflict notice and reloads the roadmap", async () => {
    const { api } = renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
      route("PATCH", /\/api\/v1\/milestones\//, () => problem(409, "version_conflict", { currentVersion: 4 })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.move }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(tx.forecast), { target: { value: "2026-12-05" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.saveForecast }));
    expect(await screen.findByText(tx.conflict)).toBeTruthy();
    await waitFor(() =>
      expect(api.requests.filter((r) => r.method === "GET" && r.url.endsWith("/roadmap")).length).toBeGreaterThan(1),
    );
  });

  it("re-approving a date requires a reason; then it is POSTed with If-Match", async () => {
    const { api } = renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
      route("POST", /approve-date$/, () => ({ status: 200, body: milestone() })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.reapprove }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: tx.approveConfirm }));
    const reason = within(dialog).getByLabelText(tx.reason);
    await waitFor(() => expect(reason.getAttribute("aria-invalid")).toBe("true"));
    expect(api.requests.some((r) => r.method === "POST")).toBe(false);
    fireEvent.change(reason, { target: { value: "Vendor slip agreed by sponsor" } });
    fireEvent.click(within(dialog).getByRole("button", { name: tx.approveConfirm }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.headers["if-match"]).toBe('"3"');
    expect(post.body).toEqual({ approvedDate: "2026-11-20", reason: "Vendor slip agreed by sponsor" });
  });

  it("deliverable acceptance sends the AcceptanceDecision with If-Match (no 'on behalf of' control)", async () => {
    const { api } = renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
      route("POST", /acceptance$/, () => ({ status: 200, body: {} })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: tx.decide }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText(/behalf|نيابة/)).toBeNull();
    fireEvent.click(within(dialog).getByRole("radio", { name: tx.accept }));
    fireEvent.click(within(dialog).getByRole("button", { name: tx.record }));
    await waitFor(() => expect(api.requests.some((r) => r.method === "POST")).toBe(true));
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ result: "accepted" });
    expect(post.headers["if-match"]).toBe('"2"');
  });

  it("an Unknown schedule flag is shown as Unknown; missing dates are Unknown, never blank", async () => {
    renderWorkspace("roadmap", locale, grants([...ALL]), [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
    ]);
    const table = await screen.findByTestId("roadmap-table");
    expect(table.textContent).toContain(tx.unknownFlag);
    expect(table.querySelector("[data-flag='schedule.unknown'].status-chip--unknown")).not.toBeNull();
    expect(table.querySelectorAll("[data-health='unknown']").length).toBeGreaterThan(0);
  });

  it("the read-only auditor sees no write control", async () => {
    renderWorkspace("roadmap", locale, AUDITOR_GRANTS, [
      route("GET", new RegExp(`${esc(R)}$`), () => ({ status: 200, body: roadmapView() })),
    ]);
    await screen.findByTestId("roadmap-table");
    expect(document.querySelector("[data-state='read-only']")).not.toBeNull();
    expect(screen.queryByRole("button", { name: tx.move })).toBeNull();
    expect(screen.queryByRole("button", { name: tx.reapprove })).toBeNull();
    expect(screen.queryByRole("button", { name: tx.decide })).toBeNull();
  });
});
