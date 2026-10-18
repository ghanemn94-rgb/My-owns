// T-DG5-FE-V1 (F-DG5-141, REQ-S02-001; axe 'scrollable-region-focusable'): the shared tables' horizontally scrolled
// .table-wrap is reachable by keyboard (tabIndex 0) and is a region named by the table's localized caption plus
// "(scrollable table)" (common.table.scrollRegion), in en and ar.
// T-DG5-FE-X1 (F-DG5-142, REQ-S15-012): the same region on every page-level table (TableScrollRegion), and no
// .table-wrap anywhere in the web source is left bare.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "../i18n/index.ts";
import { DataTable } from "./DataTable.tsx";
import { RegisterTable } from "./RegisterTable.tsx";
import { TableScrollRegion } from "./TableScrollRegion.tsx";

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

describe.each(["en", "ar"] as const)("TableScrollRegion (%s)", (locale) => {
  it("is a focusable .table-wrap region named by the caption plus the localized scroll note, and keeps extra attributes", () => {
    const caption = locale === "en" ? "Calculation lineage of version 1" : "سجل اصطناعي";
    const name = locale === "en" ? `${caption} (scrollable table)` : `${caption} (جدول قابل للتمرير)`;
    inLocale(
      locale,
      <TableScrollRegion caption={caption} className="extra" aria-busy="true" data-probe="x1">
        <table className="table">
          <caption>{caption}</caption>
          <tbody>
            <tr>
              <td>Synthetic</td>
            </tr>
          </tbody>
        </table>
      </TableScrollRegion>,
    );
    const region = screen.getByRole("region", { name });
    expect(region.tabIndex).toBe(0);
    expect(region.className).toBe("table-wrap extra");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("data-probe")).toBe("x1");
    expect(region.querySelector("table")).not.toBeNull();
  });
});

describe("no bare table wrapper in the web source", () => {
  // Every element whose class is .table-wrap scrolls horizontally when its table is wider than the column (app.css),
  // so it must be a focusable, named region (axe 'scrollable-region-focusable'; the qa round-2 probe found 16 bare
  // ones on non-P5 screens). Use TableScrollRegion, DataTable or RegisterTable (or the P3 TableRegion helper).
  const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return name.endsWith(".tsx") && !name.includes(".test.") ? [path] : [];
    });

  it("every opening tag with class table-wrap is role=region with tabIndex 0 and an aria-label or aria-labelledby", () => {
    const bare: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(
        /<[a-z]+\b[^>]*?className=(?:"[^"]*\btable-wrap\b[^"]*"|\{[^}]*table-wrap[^}]*\})[^>]*>/gs,
      )) {
        const tag = m[0];
        if (/role="region"/.test(tag) && /tabIndex=\{0\}/.test(tag) && /aria-label(ledby)?=/.test(tag)) continue;
        bare.push(`${relative(SRC, file)}:${text.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(bare).toEqual([]);
  });
});
