// T-DG5-FE-V1 (F-DG5-141, REQ-S02-001; axe 'scrollable-region-focusable'): the shared tables' horizontally scrolled
// .table-wrap is reachable by keyboard (tabIndex 0) and is a region named by the table's localized caption plus
// "(scrollable table)" (common.table.scrollRegion), in en and ar.
// T-DG5-FE-X1 (F-DG5-142, REQ-S15-012): the same region on every page-level table (TableScrollRegion), and no
// .table-wrap anywhere in the web source is left bare.
// T-DG5-FE-Z1B (F-DG5-146, D-176; REQ-S15-009, WCAG 2.1 SC 1.4.10): no element uses the unstyled class table-scroll,
// and every table.table / table--compact is rendered inside a scroll region, so a wide table scrolls in its own
// region and never widens the page at 390 px or with 200 % text.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import ts from "typescript";
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

  // The source files as TSX syntax trees (the TypeScript parser the build already uses), so the checks below see JSX
  // elements and their nesting, not text.
  const trees = files(SRC).map((file) => ({
    file: relative(SRC, file),
    sf: ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  }));
  type Jsx = ts.JsxElement | ts.JsxSelfClosingElement;
  const isJsx = (n: ts.Node): n is Jsx => ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n);
  const opening = (n: Jsx) => (ts.isJsxElement(n) ? n.openingElement : n);
  const tagOf = (n: Jsx) => opening(n).tagName.getText();
  /** The class names of a className attribute: a literal, or every string token of an expression. */
  const classesOf = (n: Jsx): string[] => {
    const attr = opening(n).attributes.properties.find(
      (p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText() === "className",
    );
    return attr?.initializer
      ? attr.initializer
          .getText()
          .split(/[^\w-]+/)
          .filter(Boolean)
      : [];
  };
  const lineOf = (sf: ts.SourceFile, n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const walk = (n: ts.Node, visit: (n: ts.Node) => void) => {
    visit(n);
    n.forEachChild((c) => walk(c, visit));
  };
  /** A scroll region: TableScrollRegion, the P3 TableRegion helper, or a .table-wrap element (checked above). */
  const isRegion = (n: Jsx) =>
    tagOf(n) === "TableScrollRegion" || tagOf(n) === "TableRegion" || classesOf(n).includes("table-wrap");
  /** The PascalCase function component a node is declared in, if any. */
  const componentOf = (n: ts.Node): string | null => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isVariableDeclaration(p.parent))
        return p.parent.name.getText();
    }
    return null;
  };
  /**
   * Whether `node` is rendered inside a scroll region: an enclosing JSX element is a region, or (when its own JSX has
   * none) its component is rendered in this file, and every one of those call sites is inside a region (for example
   * a nested table in a cell of a table that sits in a region, EvidenceRegisterPage's Versions).
   */
  const inRegion = (sf: ts.SourceFile, node: ts.Node, seen: Set<string>): boolean => {
    for (let p = node.parent; p; p = p.parent) if (ts.isJsxElement(p) && isRegion(p)) return true;
    const component = componentOf(node);
    if (component === null || !/^[A-Z]/.test(component) || seen.has(component)) return false;
    seen.add(component);
    const sites: Jsx[] = [];
    walk(sf, (n) => {
      if (isJsx(n) && tagOf(n) === component) sites.push(n);
    });
    return sites.length > 0 && sites.every((s) => inRegion(sf, s, seen));
  };

  it("no element uses the class table-scroll (no stylesheet defines it, so it is not a scroll container)", () => {
    const uses: string[] = [];
    for (const { file, sf } of trees)
      walk(sf, (n) => {
        if (isJsx(n) && classesOf(n).includes("table-scroll")) uses.push(`${file}:${lineOf(sf, n)}`);
      });
    expect(uses).toEqual([]);
  });

  // Tables outside a region that predate P5 and lie outside T-DG5-FE-Z1B's file ownership (D-176), reported in its
  // handback for the orchestrator. This list may only shrink: a new bare table, or a listed one that is fixed or
  // renamed, fails the test below until the list is updated.
  //  - FormConflict and ConflictPanel: the optimistic-concurrency (409) compare table inside the .conflict banner.
  //    The banner's single grid track no longer grows to the table (D-174), and p5-diagnose-reflow.spec.ts measures
  //    a real 409 at 390 px with no page-level scroll.
  //  - UserEdit (DG1, the identities of a user) and GoodOutcomeTest (DG2, Define): no page-level reflow measurement.
  const OUTSIDE_P5_PENDING = [
    "components/RecordForm.tsx > FormConflict",
    "components/States.tsx > ConflictPanel",
    "pages/admin/UsersPage.tsx > UserEdit",
    "pages/define/DefinePage.tsx > GoodOutcomeTest",
  ];

  it("every table.table / table--compact is rendered inside a scroll region (TableScrollRegion, TableRegion or a .table-wrap region)", () => {
    const outside: string[] = [];
    const where: string[] = [];
    let tables = 0;
    for (const { file, sf } of trees)
      walk(sf, (n) => {
        if (!isJsx(n) || tagOf(n) !== "table") return;
        if (!classesOf(n).some((c) => c === "table" || c === "table--compact")) return;
        tables++;
        if (inRegion(sf, n, new Set())) return;
        outside.push(`${file} > ${componentOf(n) ?? "?"}`);
        where.push(`${file}:${lineOf(sf, n)}`);
      });
    // Set-up check: the scan really sees the web source's tables (115 when this guard was written).
    expect(tables).toBeGreaterThan(100);
    expect({ outside: [...new Set(outside)].sort(), where }).toEqual({
      outside: [...OUTSIDE_P5_PENDING].sort(),
      where: expect.any(Array) as unknown,
    });
  });
});
