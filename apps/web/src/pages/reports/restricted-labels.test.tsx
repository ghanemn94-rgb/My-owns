// T-DG6-BE-Z7B (F-DG6-340, F-DG6-360; ADR-0051 §2 "Totals and rollups"; D-195 Q3; REQ-S10-002): the label
// "Includes restricted records" / "يشمل سجلات مقيدة" on a report section whose response carries
// `includesRestrictedRecords: true` (its totals include a value whose row is not shown), and on the Executive Overview
// when its response carries it. `false` or absent shows nothing. English (LTR) and Arabic (RTL), STUBBED responses,
// SYNTHETIC values. Nothing here is a business approval (G1-G6).
import { cleanup, render, screen } from "@testing-library/react";
import type { ReportDocument } from "@mth/shared/schemas";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { executiveOverview } from "../dashboards/dashboardFixtures.ts";
import { json, p4Handlers } from "../my-work/p4fixtures.ts";
import { ReportDocumentView } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = (n: number) => `01920000-0000-7000-9000-${n.toString(16).padStart(12, "0")}`;

function table(key: string, flag: boolean | undefined): ReportDocument["sections"][number] {
  return {
    key,
    titleKey: "report.registers.benefits.title",
    kind: "table",
    sources: [],
    columns: [
      { key: "pending", labelKey: "report.registers.benefits.pending", valueKind: "decimal", unitKind: "currency" },
    ],
    rows: [],
    totals: [
      {
        columnKey: "pending",
        formula: "sum",
        value: {
          type: "decimal",
          value: "250000.0000",
          unitKind: "currency",
          currency: "SAR",
          valueBasis: null,
          validation: "validated",
          reason: null,
        },
      },
    ],
    emptyKey: null,
    ...(flag === undefined ? {} : { includesRestrictedRecords: flag }),
  } as ReportDocument["sections"][number];
}

const doc = (): ReportDocument =>
  ({
    schemaVersion: 1,
    definitionCode: "registers",
    transformation: { id: TR_ID, code: "TR-0001", name: "Synthetic transformation" },
    subject: { type: "transformation", id: TR_ID, code: "TR-0001", label: "Synthetic transformation" },
    period: null,
    asOf: "2026-11-06T09:00:00Z",
    methodology: { versionId: ID(901), key: "playbook", versionNo: 1 },
    approvalState: "mixed",
    sections: [table("restricted", true), table("admitted", false), table("plain", undefined)],
  }) as ReportDocument;

describe.each(["en", "ar"] as const)("Includes restricted records (%s)", (locale) => {
  const i18n = createI18n(locale);
  const label = i18n.t("access.includesRestrictedRecords");

  it("the label text exists and is translated", () => {
    expect(label.trim()).not.toBe("");
    expect(label).toBe(locale === "en" ? "Includes restricted records" : "يشمل سجلات مقيدة");
  });

  it("a report section with includesRestrictedRecords true shows the label; false or absent shows nothing", () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ReportDocumentView doc={doc()} />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const inSection = (key: string) =>
      container.querySelector(`[data-report-section='${key}'] [data-restricted-records='true']`);
    expect(inSection("restricted")?.textContent).toContain(label);
    expect(inSection("admitted")).toBeNull();
    expect(inSection("plain")).toBeNull();
    expect(container.querySelectorAll("[data-restricted-records='true']")).toHaveLength(1);
  });

  for (const flag of [true, false] as const)
    it(`the Executive Overview with includesRestrictedRecords ${flag} ${flag ? "shows" : "does not show"} the label`, async () => {
      mockApi(
        ...p4Handlers(
          locale,
          [],
          [
            route("GET", /\/api\/v1\/overview\?/, () =>
              json({ ...executiveOverview(), includesRestrictedRecords: flag }),
            ),
          ],
        ),
      );
      renderApp("/executive-overview", { i18n: createI18n(locale) });
      await screen.findByText(i18n.t("dashboards.overview.count", { count: 1 }));
      const chips = document.querySelectorAll("[data-restricted-records='true']");
      expect(chips).toHaveLength(flag ? 1 : 0);
      if (flag) expect(chips[0]!.textContent).toContain(label);
    });
});
