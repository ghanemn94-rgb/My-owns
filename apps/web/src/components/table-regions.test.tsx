// T-DG5-FE-V1 (F-DG5-141, REQ-S02-001; axe 'scrollable-region-focusable'): the shared tables' horizontally scrolled
// .table-wrap is reachable by keyboard (tabIndex 0) and is a region named by the table's localized caption plus
// "(scrollable table)" (common.table.scrollRegion), in en and ar.
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "../i18n/index.ts";
import { DataTable } from "./DataTable.tsx";
import { RegisterTable } from "./RegisterTable.tsx";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function inLocale(locale: "ar" | "en", ui: ReactNode) {
  return render(<I18nextProvider i18n={createI18n(locale)}>{ui}</I18nextProvider>);
}

interface Row {
  id: string;
  name: string;
}
const rows: Row[] = [{ id: "r1", name: "Synthetic row" }];

describe.each(["en", "ar"] as const)("shared table regions (%s)", (locale) => {
  const caption = locale === "en" ? "Synthetic register" : "سجل اصطناعي";
  // The region's name is the caption plus "(scrollable table)", so it never repeats the enclosing section's name.
  const name = locale === "en" ? "Synthetic register (scrollable table)" : "سجل اصطناعي (جدول قابل للتمرير)";

  it("DataTable: the scroll container is a focusable region named by the caption", () => {
    inLocale(
      locale,
      <DataTable<Row>
        caption={caption}
        data={rows}
        columns={[{ id: "name", header: "Name", accessorKey: "name" }]}
        getRowId={(r) => r.id}
      />,
    );
    const region = screen.getByRole("region", { name });
    expect(region.classList.contains("table-wrap")).toBe(true);
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector("table")).not.toBeNull();
  });

  it("RegisterTable: the scroll container is a focusable region named by the caption", () => {
    inLocale(
      locale,
      <RegisterTable<Row>
        id={`regions-test-${locale}`}
        caption={caption}
        rows={rows}
        columns={[{ id: "name", header: "Name", cell: (r) => r.name, rowHeader: true }]}
        getRowId={(r) => r.id}
        emptyTitle="Empty"
      />,
    );
    const region = screen.getByRole("region", { name });
    expect(region.classList.contains("table-wrap")).toBe(true);
    expect(region.tabIndex).toBe(0);
    expect(region.querySelector("table")).not.toBeNull();
  });
});
