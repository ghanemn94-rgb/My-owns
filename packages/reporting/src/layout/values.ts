// What the paged formats (PDF, DOCX, PPTX) print for a document value (ADR-0046 §2, §9; ADR-0045 §5; REQ-S13-008).
//
//  - A number is printed from its canonical decimal string, with display rounding half-up (the stored value is never
//    rounded), Latin digits 0-9 in both languages, its unit (`%` for a percentage) and, for money, the ISO 4217 code
//    (default SAR) - the rule of `formatDecimal` in packages/shared/src/value.ts, mirrored here because @mth/shared
//    exports it on no subpath (a parity test pins the two together).
//  - Every value that is not validated prints its validation label: "Provisional"/"مؤقت" under a provisional number;
//    "Unknown", "Stale" or "n/a" INSTEAD of a value, so Unknown and Stale never print a number and never 0.
//  - The frame and table labels that BE-N adds (page numbers, the fonts note) are en/ar keys merged under the
//    caller's content table (`withPagedLabels`), never typed into a report.
import { Decimal } from "decimal.js";
import type { ReportValue } from "@mth/shared/schemas";
import type { ExportLanguage, LabelTable, Labels } from "../labels.ts";
import { valueText } from "../model.ts";

/** The labels the paged formats add to the shared frame labels (labels.ts), in English and Arabic. */
export const PAGED_LABELS: LabelTable = {
  en: {
    "export.page": "Page {n} of {m}",
    "export.slide": "Slide {n} of {m}",
    "export.continued": "{title} (continued)",
    "export.fonts_note.docx":
      "Fonts: this file names IBM Plex Sans Arabic and IBM Plex Sans (SIL Open Font License 1.1) and does not embed them; a viewer without them shows a substitute font.",
    "export.fonts_note.pptx":
      "Fonts: this presentation names IBM Plex Sans Arabic and IBM Plex Sans (SIL Open Font License 1.1) and does not embed them; a viewer without them shows a substitute font.",
  },
  ar: {
    "export.page": "الصفحة {n} من {m}",
    "export.slide": "الشريحة {n} من {m}",
    "export.continued": "{title} (تابع)",
    "export.fonts_note.docx":
      "الخطوط: يسمّي هذا الملف خطَّي IBM Plex Sans Arabic وIBM Plex Sans (رخصة SIL Open Font License 1.1) دون تضمينهما؛ يعرض البرنامج الذي لا يتوفر فيه الخطّان خطاً بديلاً.",
    "export.fonts_note.pptx":
      "الخطوط: يسمّي هذا العرض خطَّي IBM Plex Sans Arabic وIBM Plex Sans (رخصة SIL Open Font License 1.1) دون تضمينهما؛ يعرض البرنامج الذي لا يتوفر فيه الخطّان خطاً بديلاً.",
  },
};

/** The caller's content table over the paged labels (the caller's keys win). */
export function withPagedLabels(content: LabelTable | undefined): LabelTable {
  return {
    en: { ...PAGED_LABELS.en, ...(content?.en ?? {}) },
    ar: { ...PAGED_LABELS.ar, ...(content?.ar ?? {}) },
  };
}

/**
 * `formatDecimal` of packages/shared/src/value.ts: Intl receives the exact decimal string after half-up display
 * rounding; Arabic uses `ar-u-nu-latn` (Latin digits) and puts the currency code after the amount.
 */
export function formatNumber(
  value: string,
  language: ExportLanguage,
  options: { currency?: string | null; maxFractionDigits?: number } = {},
): string {
  const max = options.maxFractionDigits ?? 2;
  const fixed = new Decimal(value).toDecimalPlaces(max, Decimal.ROUND_HALF_UP).toFixed() as Intl.StringNumericLiteral;
  const nf = new Intl.NumberFormat(language === "ar" ? "ar-u-nu-latn" : "en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: max,
    useGrouping: true,
  });
  const text = nf.format(fixed);
  if (!options.currency) return text;
  return language === "ar" ? `${text} ${options.currency}` : `${options.currency} ${text}`;
}

export interface DisplayValue {
  /** The value as printed, or null when there is none (Unknown, Stale, n/a without a value). */
  readonly text: string | null;
  /** The validation label to print, or null for a validated value. */
  readonly status: string | null;
  readonly provisional: boolean;
}

/** The printed form of one value (numbers formatted; codes translated; every non-validated value labelled). */
export function displayValue(v: ReportValue, labels: Labels): DisplayValue {
  const status = v.validation === "validated" ? null : labels.validation(v.validation);
  const provisional = v.validation === "provisional";
  if (v.value === null) return { text: null, status: status ?? labels.validation("unknown"), provisional };
  if (v.type === "decimal") {
    const money = v.unitKind === "currency";
    const n = formatNumber(v.value, labels.language, {
      currency: money ? (v.currency ?? null) : null,
      maxFractionDigits: money ? 2 : 6,
    });
    return { text: v.unitKind === "percentage" ? `${n}%` : n, status, provisional };
  }
  return { text: valueText(v, labels), status, provisional };
}

/** One printable string: the value, then its label on the next line (or the label alone when there is no value). */
export function cellText(v: ReportValue, labels: Labels): string {
  const d = displayValue(v, labels);
  if (d.text === null) return d.status ?? "";
  return d.status === null ? d.text : `${d.text}\n${d.status}`;
}
