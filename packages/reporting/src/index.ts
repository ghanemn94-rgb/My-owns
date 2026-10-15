// @mth/reporting (ADR-0002 reservation, ADR-0046 §1): the pure export renderers and the export-file store. The worker
// imports this entry; the API imports only the dependency-free `@mth/reporting/storage` subpath, so no renderer library
// is ever loaded by the API process.
export {
  FORMULA_TRIGGER_CHARACTERS,
  neutralizeSpreadsheetText,
  startsLikeFormula,
  type NeutralizedText,
} from "./injection.ts";
export {
  createLabels,
  fallbackLabel,
  FRAME_LABELS,
  type ExportLanguage,
  type LabelTable,
  type Labels,
} from "./labels.ts";
export {
  EXPORT_CONTENT_TYPES,
  EXPORT_FORMATS,
  formatAsOf,
  issueLine,
  RenderError,
  type ExportFormat,
  type RenderOptions,
  type RenderResult,
  type SnapshotIdentity,
} from "./model.ts";
export { csvField, renderCsv } from "./csv.ts";
export { renderXlsx, sheetName, XLSX_FONTS } from "./xlsx/index.ts";
export { render, RENDERED_FORMATS } from "./render.ts";
export * from "./storage.ts";
