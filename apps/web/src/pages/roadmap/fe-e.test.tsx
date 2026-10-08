// Wave editing on the roadmap (T-DG3-FE-E; ADR-0023 §1; REQ-PB-050) with stubbed responses, English LTR and Arabic
// RTL. SYNTHETIC data.
//  - edit a wave's planned start/end, owner and notes with If-Match; the verbatim source text is shown read-only and is
//    never sent; overlapping dates are accepted (no client refusal);
//  - 422 roadmap_wave.planned_range is inline at /plannedEnd and translated;
//  - add a non-source wave (POST with an Idempotency-Key);
//  - the auditor gets no wave control.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { problem, route } from "../../test/fixtures.tsx";
import {
  AUDITOR_GRANTS,
  TR,
  WAVES,
  esc,
  grants,
  roadmapView,
  renderWorkspace,
} from "../prioritization/fe-b.fixtures.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tr = (l: "en" | "ar") => createI18n(l).t;
const lbl = (s: string) => new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
const W1 = WAVES[1]!;

describe.each(["en", "ar"] as const)("wave editing (%s)", (locale) => {
  const t = tr(locale);
  const handlers = () => [
    route("GET", new RegExp(`${esc(TR)}/roadmap$`), () => ({ status: 200, body: roadmapView() })),
  ];

  it("edits planned dates (overlap accepted) with If-Match; the source text is read-only and never sent", async () => {
    const { api } = renderWorkspace("roadmap", locale, grants(["roadmap.edit"]), [
      ...handlers(),
      route("PATCH", new RegExp(`${esc(TR)}/waves/${W1.id}$`), () => ({
        status: 200,
        body: { ...W1, plannedStart: "2026-10-01", plannedEnd: "2027-03-31", version: W1.version + 1 },
      })),
    ]);
    const table = await screen.findByTestId("waves");
    const row = table.querySelector(`[data-wave='${W1.code}']`) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: lbl(t("roadmap.waves.edit")) }));
    const dialog = await screen.findByRole("dialog");
    const source = dialog.querySelector("[data-state='wave-source']")!;
    expect(source.textContent).toContain(t("roadmap.waves.sourceReadOnly"));
    expect(source.textContent).toContain(W1.nameEn);
    expect(source.textContent).toContain(W1.purposeEn);
    // No control edits a source text.
    expect(dialog.querySelector("[name='nameEn'], [name='purposeEn'], [name='horizonEn']")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(lbl(t("roadmap.waves.plannedStart"))), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("roadmap.waves.plannedEnd"))), {
      target: { value: "2027-03-31" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const patch = api.requests.find((r) => r.method === "PATCH")!;
    expect(patch.body).toEqual({ plannedStart: "2026-10-01", plannedEnd: "2027-03-31" });
    expect(patch.headers["if-match"]).toBe(`"${W1.version}"`);
  });

  it("422 roadmap_wave.planned_range is inline at the planned end and translated", async () => {
    renderWorkspace("roadmap", locale, grants(["roadmap.edit"]), [
      ...handlers(),
      route("PATCH", new RegExp(`${esc(TR)}/waves/${W1.id}$`), () =>
        problem(422, "roadmap_wave.planned_range", {
          errors: [{ pointer: "/plannedEnd", code: "roadmap_wave.planned_range", message: "English" }],
        }),
      ),
    ]);
    const table = await screen.findByTestId("waves");
    const row = table.querySelector(`[data-wave='${W1.code}']`) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: lbl(t("roadmap.waves.edit")) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(lbl(t("roadmap.waves.plannedStart"))), {
      target: { value: "2027-03-01" },
    });
    fireEvent.change(within(dialog).getByLabelText(lbl(t("roadmap.waves.plannedEnd"))), {
      target: { value: "2027-01-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.action.save") }));
    const end = within(dialog).getByLabelText(lbl(t("roadmap.waves.plannedEnd")));
    await waitFor(() => expect(end.getAttribute("aria-invalid")).toBe("true"));
    expect(dialog.textContent).toContain(t("roadmap.problem.roadmap_wave__planned_range"));
    expect(dialog.textContent).not.toContain("English");
  });

  it("adds a non-source wave with its bilingual texts (POST, Idempotency-Key)", async () => {
    const { api } = renderWorkspace("roadmap", locale, grants(["roadmap.edit"]), [
      ...handlers(),
      route("POST", new RegExp(`${esc(TR)}/waves$`), () => ({ status: 201, body: { ...W1, code: "wave_4" } })),
    ]);
    fireEvent.click(await screen.findByRole("button", { name: lbl(t("roadmap.waves.add")) }));
    const dialog = await screen.findByRole("dialog");
    const values: Record<string, string> = {
      code: "wave_4",
      nameEn: "Wave 4 - Synthetic sustain",
      nameAr: "الموجة 4 - استدامة تجريبية",
      purposeEn: "Synthetic purpose",
      purposeAr: "غرض تجريبي",
      horizonEn: "12-24 months",
      horizonAr: "12-24 شهراً",
      horizonFromWeeks: "52",
      horizonToWeeks: "104",
      entryCriteriaEn: "Synthetic entry",
      entryCriteriaAr: "دخول تجريبي",
      exitEvidenceEn: "Synthetic exit",
      exitEvidenceAr: "خروج تجريبي",
    };
    for (const [name, value] of Object.entries(values))
      fireEvent.change(within(dialog).getByLabelText(lbl(t(`roadmap.waves.create.${name}`))), { target: { value } });
    fireEvent.click(within(dialog).getByRole("button", { name: t("roadmap.waves.add") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = api.requests.find((r) => r.method === "POST")!;
    expect(post.body).toEqual({ ...values, horizonFromWeeks: 52, horizonToWeeks: 104 });
    expect(post.headers["idempotency-key"]).toBeTruthy();
  });

  it("the read-only auditor gets no wave control", async () => {
    renderWorkspace("roadmap", locale, AUDITOR_GRANTS, handlers());
    await screen.findByTestId("waves");
    expect(screen.queryByRole("button", { name: lbl(t("roadmap.waves.add")) })).toBeNull();
    expect(screen.queryByRole("button", { name: lbl(t("roadmap.waves.edit")) })).toBeNull();
  });
});
