// The paged view of one report document (ADR-0046 §2): what PDF, DOCX and PPTX print, decided once for the three
// formats so they carry the same content in the same order. Every section, row and value of the snapshot's content,
// in content order, with the validation labels; a section without rows prints "No records" (or its own empty key).
// Nothing is typed into a report here: every string is a document value or a translated label.
import type { ReportDocument, ReportSection } from "@mth/shared/schemas";
import type { Labels } from "../labels.ts";
import { frameRows, legendRows, type RenderOptions } from "../model.ts";
import { cellText } from "./values.ts";

export interface TableBlock {
  readonly kind: "table";
  /** Column labels; null for a label/value table without a header row (the file frame, the legend). */
  readonly header: readonly string[] | null;
  readonly rows: readonly (readonly string[])[];
  readonly totals: readonly string[] | null;
  /** Relative column widths. */
  readonly weights: readonly number[];
  /** The empty-state line of a table without rows ("No records"). */
  readonly empty: string | null;
}
export type Block =
  | TableBlock
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: readonly string[] };

export interface PagedSection {
  readonly key: string;
  readonly title: string;
  readonly blocks: readonly Block[];
}

export interface PagedDocument {
  readonly productName: string;
  readonly title: string;
  /** The header block every file carries (product, output, transformation, ..., issue or Draft line). */
  readonly frame: TableBlock;
  readonly sections: readonly PagedSection[];
  readonly legendTitle: string;
  readonly legend: TableBlock;
}

const WEIGHT: Readonly<Record<string, number>> = {
  text: 3,
  code: 1.4,
  decimal: 1.6,
  date: 1.2,
  timestamp: 1.7,
  count: 0.9,
};

const keyValue = (rows: readonly (readonly [string, string])[]): TableBlock => ({
  kind: "table",
  header: null,
  rows: rows.map(([k, v]) => [k, v]),
  totals: null,
  weights: [1, 2.4],
  empty: null,
});

function sectionBlocks(s: ReportSection, labels: Labels): Block[] {
  const empty = (key: string | null) => labels.text(key ?? "export.no_records");
  switch (s.kind) {
    case "fields":
    case "metrics":
      if (s.fields.length === 0) return [{ kind: "paragraph", text: empty(null) }];
      return [
        {
          kind: "table",
          header: [labels.text("export.label"), labels.text("export.value")],
          rows: s.fields.map((f) => [labels.text(f.labelKey), cellText(f.value, labels)]),
          totals: null,
          weights: [1, 2.4],
          empty: null,
        },
      ];
    case "text":
      return [{ kind: "paragraph", text: cellText(s.text, labels) }];
    case "list":
      if (s.items.length === 0) return [{ kind: "paragraph", text: empty(s.emptyKey) }];
      return [{ kind: "list", items: s.items.map((i) => cellText(i.value, labels)) }];
    case "table": {
      const byColumn = new Map(s.totals.map((t) => [t.columnKey, t] as const));
      const totals =
        s.totals.length === 0
          ? null
          : s.columns.map((c, j) => {
              const t = byColumn.get(c.key);
              if (t !== undefined) return cellText(t.value, labels);
              return j === 0 ? labels.text("export.total") : "";
            });
      return [
        {
          kind: "table",
          header: s.columns.map((c) => labels.text(c.labelKey)),
          rows: s.rows.map((r) => r.cells.map((v) => cellText(v, labels))),
          totals,
          weights: s.columns.map((c) => WEIGHT[c.valueKind] ?? 1),
          empty: s.rows.length === 0 ? empty(s.emptyKey) : null,
        },
      ];
    }
  }
}

/** The paged view of a validated document in the export language. */
export function pagedDocument(doc: ReportDocument, o: RenderOptions, labels: Labels): PagedDocument {
  return {
    productName: o.branding.productName,
    title: o.title,
    frame: keyValue(frameRows(doc, o, labels)),
    sections: doc.sections.map((s) => ({
      key: s.key,
      title: labels.text(s.titleKey),
      blocks: sectionBlocks(s, labels),
    })),
    legendTitle: labels.text("export.legend.title"),
    legend: keyValue(legendRows(labels)),
  };
}
