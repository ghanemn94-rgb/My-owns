import { Injectable } from '@nestjs/common';
import { ruleViolation } from '@hub/domain';
import type { ReportExportFormat } from '@hub/contracts';
import type { RenderDoc } from './document';
import { renderXlsx, XLSX_MIME } from './xlsx.renderer';

export interface RenderedFile {
  bytes: Buffer;
  mime: string;
  ext: string;
}

/**
 * The file renderers of report exports (ADR-0011). Every renderer prints the same format-neutral {@link RenderDoc}; none of
 * them has a network channel (REQ-INT-011): they only return bytes.
 */
@Injectable()
export class ReportRenderers {
  /** Null when the format can be rendered here; otherwise the honest reason (shown to the requester as a 422). */
  async unavailable(format: ReportExportFormat): Promise<string | null> {
    if (format === 'xlsx') return null;
    return 'not implemented yet';
  }

  async render(format: ReportExportFormat, doc: RenderDoc): Promise<RenderedFile> {
    switch (format) {
      case 'xlsx':
        return { bytes: await renderXlsx(doc), mime: XLSX_MIME, ext: 'xlsx' };
      default:
        throw ruleViolation('report.renderer_unavailable', `No ${format} renderer`);
    }
  }
}
