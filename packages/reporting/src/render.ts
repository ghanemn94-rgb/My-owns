// The renderer entry point (ADR-0046 §1): `render(document, options) -> { bytes, sections, ... }`, one pure function per
// format. BE-M ships CSV and XLSX; BE-N adds PDF, DOCX and PPTX here (p5-work-split §F.6). Until a format has its
// renderer, rendering it is a RenderError (the job fails with export.render_failed, it is never retried, and no file
// is stored), so a requested format is never silently replaced by another.
import type { ReportDocument } from "@mth/shared/schemas";
import { renderCsv } from "./csv.ts";
import { RenderError, type ExportFormat, type RenderOptions, type RenderResult } from "./model.ts";
import { renderXlsx } from "./xlsx/index.ts";

type Renderer = (document: ReportDocument, options: RenderOptions) => Promise<RenderResult>;

const RENDERERS: Partial<Record<ExportFormat, Renderer>> = {
  csv: renderCsv,
  xlsx: renderXlsx,
};

/** The formats this build can render. */
export const RENDERED_FORMATS: readonly ExportFormat[] = Object.keys(RENDERERS) as ExportFormat[];

export async function render(document: ReportDocument, options: RenderOptions): Promise<RenderResult> {
  const renderer = RENDERERS[options.format];
  if (renderer === undefined) throw new RenderError(`no renderer for ${options.format} in this release`);
  return renderer(document, options);
}
