// Spreadsheet formula-injection rule (ADR-0046 §4; REQ-S13-006; M0253 "Spreadsheet exports must neutralize formula
// injection in user text while preserving deliberately authored numeric formulas where applicable").
//
// One pure function decides, for every text value written to a spreadsheet (XLSX or CSV), whether a spreadsheet
// application could read it as a formula: a text whose FIRST character is `=`, `+`, `-`, `@`, TAB (U+0009) or CR
// (U+000D). Such a text is neutralized:
//   - XLSX: the cell stays an inline string (never a `<f>` element) and gets the `quotePrefix` style (xlsx/**);
//   - CSV: the field is prefixed with an apostrophe `'` (csv.ts).
// Any other first character is left as it is. Formulas in a spreadsheet come only from the document model's declared
// totals (`formula: 'sum'`), written from a fixed template in xlsx/sheet.ts, never from user text.

/** The six leading characters that make a spreadsheet application treat a cell as a formula (ADR-0046 §4). */
export const FORMULA_TRIGGER_CHARACTERS: readonly string[] = ["=", "+", "-", "@", "\t", "\r"];

const TRIGGERS: ReadonlySet<string> = new Set(FORMULA_TRIGGER_CHARACTERS);

export interface NeutralizedText {
  /** The text to write in a CSV field: prefixed with `'` when `prefixed`, else unchanged. */
  readonly text: string;
  /** True when the text started with one of the six trigger characters. */
  readonly prefixed: boolean;
}

/** True when a spreadsheet application could interpret `text` as a formula (its first UTF-16 unit is a trigger). */
export function startsLikeFormula(text: string): boolean {
  return text.length > 0 && TRIGGERS.has(text.charAt(0));
}

/** ADR-0046 §4: `{ text: "'" + text, prefixed: true }` for a formula-like text, else `{ text, prefixed: false }`. */
export function neutralizeSpreadsheetText(text: string): NeutralizedText {
  return startsLikeFormula(text) ? { text: `'${text}`, prefixed: true } : { text, prefixed: false };
}
