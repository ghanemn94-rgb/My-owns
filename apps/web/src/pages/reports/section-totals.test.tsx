// T-DG6-FE-Z3 round 6 (F-DG6-440; ADR-0051 §2 "Totals and rollups" and its 2026-11-06 amendment; D-195 Q3;
// REQ-S10-002): a report table section whose rows are all omitted for the reader (every row restricted) still shows its
// totals row, identical to the one an admitted reader sees, with the "Includes restricted records" label and the empty
// text inside the table. A section with no rows and no totals keeps the plain empty text. The same SectionView renders
// the live preview, the snapshot page and presentation mode. English (LTR) and Arabic (RTL), STUBBED documents,
// SYNTHETIC values. Nothing here is a business approval (G1-G6).
import { cleanup, render, within } from "@testing-library/react";
import type { ReportDocument } from "@mth/shared/schemas";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID } from "../../test/fixtures.tsx";
import { ReportDocumentView } from "./ui.tsx";

afterEach(() => cleanup());

type Section = ReportDocument["sections"][number];
const ID = (n: number) => `01920000-0000-7000-9000-${n.toString(16).padStart(12, "0")}`;
const sar = (value: string, validation: "validated" | "provisional") => ({
  type: "decimal" as const,
  value,
  unitKind: "currency" as const,
  currency: "SAR",
  valueBasis: null,
  validation,
  reason: null,
});

/** A benefits-register-like table: a code column and two SAR columns, both totalled. */
function table(key: string, opts: { rows: boolean; totals: boolean; flag?: boolean }): Section {
  return {
    key,
    titleKey: "report.registers.benefits.title",
    kind: "table",
    sources: [],
    columns: [
      { key: "code", labelKey: "report.registers.benefits.code", valueKind: "code", unitKind: null },
      {
        key: "realized",
        labelKey: "report.registers.benefits.realized_validated",
        valueKind: "decimal",
        unitKind: "currency",
      },
      { key: "pending", labelKey: "report.registers.benefits.pending", valueKind: "decimal", unitKind: "currency" },
    ],
    rows: opts.rows
      ? [
          {
            recordType: "benefit",
            recordId: ID(1),
            recordVersion: 3,
            cells: [
              { type: "code", value: "B01", labelKey: null, validation: "validated", reason: null },
              sar("222750.0000", "validated"),
              sar("99000.0000", "provisional"),
            ],
          },
        ]
      : [],
    totals: opts.totals
      ? [
          { columnKey: "realized", formula: "sum", value: sar("222750.0000", "validated") },
          { columnKey: "pending", formula: "sum", value: sar("99000.0000", "provisional") },
        ]
      : [],
    emptyKey: null,
    ...(opts.flag === undefined ? {} : { includesRestrictedRecords: opts.flag }),
  } as Section;
}

const doc = (sections: Section[]): ReportDocument =>
  ({
    schemaVersion: 1,
    definitionCode: "registers",
    transformation: { id: TR_ID, code: "TR-0001", name: "Synthetic transformation" },
    subject: { type: "transformation", id: TR_ID, code: "TR-0001", label: "Synthetic transformation" },
    period: null,
    asOf: "2026-11-06T09:00:00Z",
    methodology: { versionId: ID(901), key: "playbook", versionNo: 1 },
    approvalState: "mixed",
    sections,
  }) as ReportDocument;

describe.each(["en", "ar"] as const)("report table totals when no row is shown (%s)", (locale) => {
  const i18n = createI18n(locale);
  const view = (sections: Section[]) =>
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ReportDocumentView doc={doc(sections)} />
        </MemoryRouter>
      </I18nextProvider>,
    ).container;

  it("every row restricted: the label, the header, the empty text in the table and the SAME totals row as an admitted reader", () => {
    const c = view([
      table("restricted", { rows: false, totals: true, flag: true }),
      table("admitted", { rows: true, totals: true, flag: false }),
    ]);
    const restricted = c.querySelector<HTMLElement>("[data-report-section='restricted']")!;
    const admitted = c.querySelector<HTMLElement>("[data-report-section='admitted']")!;
    // The label of ADR-0051 §2.
    expect(restricted.querySelector("[data-restricted-records='true']")?.textContent).toContain(
      i18n.t("access.includesRestrictedRecords"),
    );
    // An accessible table: a named, focusable region and a captioned table with column headers.
    const region = within(restricted).getByRole("region");
    expect(region.getAttribute("tabindex")).toBe("0");
    const heading = restricted.querySelector("h3")!;
    expect(region.getAttribute("aria-labelledby")).toBe(heading.id);
    const tableEl = within(restricted).getByRole("table", { name: heading.textContent! });
    expect(within(tableEl).getAllByRole("columnheader")).toHaveLength(3);
    // The empty text is a cell spanning every column, in the page language; no record row.
    const empty = restricted.querySelector<HTMLTableCellElement>("td[data-empty-table='restricted']")!;
    expect(empty.textContent).toBe(i18n.t("reportsP5.noRecords"));
    expect(empty.colSpan).toBe(3);
    expect(restricted.querySelectorAll("tr[data-record]")).toHaveLength(0);
    // The totals row: "Total" as a row header, and the same text as the admitted reader's totals row.
    const totals = restricted.querySelectorAll<HTMLTableRowElement>("tfoot tr[data-totals='true']");
    expect(totals).toHaveLength(1);
    expect(within(totals[0]!).getByRole("rowheader").textContent).toBe(i18n.t("reportsP5.total"));
    const admittedTotals = admitted.querySelector<HTMLTableRowElement>("tr[data-totals='true']")!;
    expect(totals[0]!.textContent).toBe(admittedTotals.textContent);
    expect(totals[0]!.textContent).not.toBe(i18n.t("reportsP5.total"));
    expect(totals[0]!.querySelectorAll("[data-validation='provisional']")).toHaveLength(1);
    // The admitted reader sees the row and no empty text.
    expect(admitted.querySelectorAll("tr[data-record]")).toHaveLength(1);
    expect(admitted.querySelector("[data-empty-table]")).toBeNull();
    expect(admitted.querySelector("[data-restricted-records='true']")).toBeNull();
  });

  it("no rows and no totals: the plain empty text, no table (unchanged)", () => {
    const c = view([table("none", { rows: false, totals: false })]);
    const s = c.querySelector<HTMLElement>("[data-report-section='none']")!;
    expect(s.querySelector("table")).toBeNull();
    expect(s.querySelector("p[data-empty-table='none']")?.textContent).toBe(i18n.t("reportsP5.noRecords"));
    expect(s.querySelector("[data-restricted-records='true']")).toBeNull();
  });

  it("rows and no totals: the table without an empty row or a totals row (unchanged)", () => {
    const c = view([table("rows", { rows: true, totals: false })]);
    const s = c.querySelector<HTMLElement>("[data-report-section='rows']")!;
    expect(s.querySelectorAll("tr[data-record]")).toHaveLength(1);
    expect(s.querySelector("[data-empty-table]")).toBeNull();
    expect(s.querySelector("tfoot")).toBeNull();
  });
});
