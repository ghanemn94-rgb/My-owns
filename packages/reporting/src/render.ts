// The renderer entry point (ADR-0046 §1): `render(document, options) -> { bytes, sections, ... }`, one pure function per
// format: CSV and XLSX (BE-M), PDF, DOCX and PPTX (BE-N; p5-work-split §F.6). A format without a renderer
// would be a RenderError (the job fails with export.render_failed, it is never retried, and no file is stored), so a
// requested format is never silently replaced by another; every format of EXPORT_FORMATS has one.
import type { ReportDocument } from "@mth/shared/schemas";
import { renderCsv } from "./csv.ts";
import { renderDocx } from "./docx.ts";
import { RenderError, type ExportFormat, type RenderOptions, type RenderResult } from "./model.ts";
import { renderPdf } from "./pdf/index.ts";
import { renderPptx } from "./pptx.ts";
import { renderXlsx } from "./xlsx/index.ts";

type Renderer = (document: ReportDocument, options: RenderOptions) => Promise<RenderResult>;

const RENDERERS: Partial<Record<ExportFormat, Renderer>> = {
  csv: renderCsv,
  xlsx: renderXlsx,
  pdf: renderPdf,
  docx: renderDocx,
  pptx: renderPptx,
};

/** The formats this build can render. */
export const RENDERED_FORMATS: readonly ExportFormat[] = Object.keys(RENDERERS) as ExportFormat[];

export async function render(document: ReportDocument, options: RenderOptions): Promise<RenderResult> {
  const renderer = RENDERERS[options.format];
  if (renderer === undefined) throw new RenderError(`no renderer for ${options.format} in this release`);
  return renderer(document, options);
}
