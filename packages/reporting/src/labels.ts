// Export labels (ADR-0045 §3, ADR-0046 §2-§4, §9; p5-work-split §F.11 item 10): every system label of an exported file
// is an i18n key translated at render time into the export language; user-authored text is printed as authored.
//
// Two tables feed a renderer:
//   - FRAME_LABELS (this file): the labels of the file frame every format shares: the header block, "Draft — not an
//     issued report", "No records", the validation labels, the spreadsheet companion status column and the legend, in
//     English and Arabic.
//   - the content table: the `report.*` keys the assemblers put in the document (section titles, column labels, code
//     labels), passed in by the caller (`RenderOptions.labels`). A key that neither table holds is shown by a
//     deterministic fallback (the last key segment, or the code value itself) and is listed in the render result's
//     `missingLabels`, so a missing translation is visible and never silently invented.
// No label names an engineering gate (DG0-DG7); a gate pack names product gates G1-G6 as business approvals.
import type { ReportValidation } from "@mth/shared/schemas";

export type ExportLanguage = "en" | "ar";

/** A label table: i18n key -> text, per language. */
export type LabelTable = Readonly<Record<ExportLanguage, Readonly<Record<string, string>>>>;

/** The frame labels shared by every format (en, ar). */
export const FRAME_LABELS: LabelTable = {
  en: {
    "export.product": "Product",
    "export.output": "Output",
    "export.transformation": "Transformation",
    "export.subject": "Subject",
    "export.period": "Period",
    "export.as_of": "As of",
    "export.snapshot_id": "Snapshot ID",
    "export.issue": "Issue",
    "export.issue_version": "Issued report, version {n}",
    "export.draft": "Draft — not an issued report",
    "export.illustrative": "Illustrative example — synthetic",
    "export.superseded": "Superseded issued report, version {n}",
    "export.methodology_version": "Methodology version",
    "export.approval_state": "Approval state of the sources (recorded, not an approval)",
    "export.no_records": "No records",
    "export.status_suffix": "status",
    "export.label": "Label",
    "export.value": "Value",
    "export.status": "Status",
    "export.total": "Total",
    "export.legend": "Legend",
    "export.legend.title": "Validation labels",
    "export.validation.validated": "Validated",
    "export.validation.provisional": "Provisional",
    "export.validation.unknown": "Unknown",
    "export.validation.stale": "Stale",
    "export.validation.not_applicable": "n/a",
    "export.legend.validated": "The value is validated by its owner process.",
    "export.legend.provisional": "The value is provisional: pending validation or approval; it is shown and counted.",
    "export.legend.unknown": "No value is available; the cell is empty and is never shown as 0.",
    "export.legend.stale": "The value is out of date; no current number is shown.",
    "export.legend.not_applicable": "The value does not apply to this record.",
    "export.legend.formulas":
      "Totals marked as formulas are computed by the spreadsheet from the rows above; text never becomes a formula.",
    "export.about": "About this file",
    "report.empty.no_records": "No records",
    "export.sheet.about": "About",
    "export.sheet.legend": "Legend",
    "export.approval.approved": "Approved",
    "export.approval.pending": "Pending",
    "export.approval.not_submitted": "Not submitted",
    "export.approval.changes_requested": "Changes requested",
    "export.approval.rejected": "Rejected",
    "export.approval.mixed": "Mixed",
    "export.approval.not_applicable": "Not applicable",
  },
  ar: {
    "export.product": "المنتج",
    "export.output": "المخرَج",
    "export.transformation": "التحول",
    "export.subject": "الموضوع",
    "export.period": "الفترة",
    "export.as_of": "حتى تاريخ",
    "export.snapshot_id": "معرّف اللقطة",
    "export.issue": "الإصدار",
    "export.issue_version": "تقرير صادر، الإصدار {n}",
    "export.draft": "مسودة — ليس تقريراً صادراً",
    "export.illustrative": "مثال توضيحي — اصطناعي",
    "export.superseded": "تقرير صادر مستبدَل، الإصدار {n}",
    "export.methodology_version": "إصدار المنهجية",
    "export.approval_state": "حالة اعتماد المصادر (مسجّلة، وليست اعتماداً)",
    "export.no_records": "لا توجد سجلات",
    "export.status_suffix": "الحالة",
    "export.label": "البند",
    "export.value": "القيمة",
    "export.status": "الحالة",
    "export.total": "الإجمالي",
    "export.legend": "دليل الرموز",
    "export.legend.title": "تسميات التحقق",
    "export.validation.validated": "متحقَّق منه",
    "export.validation.provisional": "مؤقت",
    "export.validation.unknown": "غير معروف",
    "export.validation.stale": "قديم",
    "export.validation.not_applicable": "لا ينطبق",
    "export.legend.validated": "القيمة متحقَّق منها من الجهة المالكة.",
    "export.legend.provisional": "القيمة مؤقتة: بانتظار التحقق أو الاعتماد؛ تُعرض وتُحتسب.",
    "export.legend.unknown": "لا تتوفر قيمة؛ تبقى الخلية فارغة ولا تُعرض صفراً أبداً.",
    "export.legend.stale": "القيمة غير محدَّثة؛ لا يُعرض رقم حالي.",
    "export.legend.not_applicable": "القيمة لا تنطبق على هذا السجل.",
    "export.legend.formulas": "الإجماليات المكتوبة كصيغ يحسبها الجدول من الصفوف أعلاه؛ النص لا يصبح صيغة أبداً.",
    "export.about": "حول هذا الملف",
    "report.empty.no_records": "لا توجد سجلات",
    "export.sheet.about": "حول",
    "export.sheet.legend": "دليل الرموز",
    "export.approval.approved": "معتمد",
    "export.approval.pending": "قيد الانتظار",
    "export.approval.not_submitted": "لم يُقدَّم",
    "export.approval.changes_requested": "مطلوب تعديلات",
    "export.approval.rejected": "مرفوض",
    "export.approval.mixed": "مختلط",
    "export.approval.not_applicable": "لا ينطبق",
  },
};

/** Resolves keys in the export language; records every key it could not find (`missing`). */
export interface Labels {
  readonly language: ExportLanguage;
  /** The text of `key`, with `{name}` parameters replaced; the fallback (and a `missing` entry) when no table has it. */
  text(key: string, params?: Readonly<Record<string, string | number>>, fallback?: string): string;
  /** The validation label (Validated, Provisional, Unknown, Stale, n/a). */
  validation(v: ReportValidation): string;
  readonly missing: ReadonlySet<string>;
}

/** The last segment of a key, spaced and capitalized: `report.registers.raid.due_date` -> "Due date". */
export function fallbackLabel(key: string): string {
  const last = key.split(".").pop() ?? key;
  const spaced = last.replace(/_/g, " ");
  return spaced.length === 0 ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function createLabels(language: ExportLanguage, content?: LabelTable): Labels {
  const missing = new Set<string>();
  const frame = FRAME_LABELS[language];
  const own = content?.[language] ?? {};
  const text = (key: string, params?: Readonly<Record<string, string | number>>, fallback?: string): string => {
    let t = Object.hasOwn(own, key) ? own[key] : Object.hasOwn(frame, key) ? frame[key] : undefined;
    if (t === undefined) {
      missing.add(key);
      t = fallback ?? fallbackLabel(key);
    }
    if (params !== undefined) for (const [k, v] of Object.entries(params)) t = t.split(`{${k}}`).join(String(v));
    return t;
  };
  return {
    language,
    text,
    validation: (v) => text(`export.validation.${v}`),
    missing,
  };
}
