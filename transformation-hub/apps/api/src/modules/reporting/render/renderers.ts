import { Inject, Injectable } from '@nestjs/common';
import { ruleViolation } from '@hub/domain';
import type { ReportExportFormat } from '@hub/contracts';
import { APP_CONFIG, type AppConfig } from '../../../platform/config';
import type { RenderDoc } from './document';
import { renderXlsx, XLSX_MIME } from './xlsx.renderer';
import { PDF_MIME, renderPdf, resolveChromium } from './pdf.renderer';
import { PPTX_MIME, renderPptx } from './pptx.renderer';
import { DOCX_MIME, renderDocx } from './docx.renderer';

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
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private chromium(): string | null {
    return resolveChromium(this.config.chromiumPath, this.config.nodeEnv === 'production');
  }

  /** Null when the format can be rendered here; otherwise the honest reason (shown to the requester as a 422). */
  async unavailable(format: ReportExportFormat): Promise<string | null> {
    if (format === 'pdf') return this.chromium() ? null : 'no headless Chromium configured (HUB_CHROMIUM_PATH, api-chromium image)';
    return null;
  }

  async render(format: ReportExportFormat, doc: RenderDoc): Promise<RenderedFile> {
    switch (format) {
      case 'xlsx':
        return { bytes: await renderXlsx(doc), mime: XLSX_MIME, ext: 'xlsx' };
      case 'pdf': {
        const exe = this.chromium();
        if (!exe) throw ruleViolation('report.renderer_unavailable', 'No headless Chromium configured');
        return { bytes: await renderPdf(doc, exe), mime: PDF_MIME, ext: 'pdf' };
      }
      case 'pptx':
        return { bytes: await renderPptx(doc), mime: PPTX_MIME, ext: 'pptx' };
      case 'docx':
        return { bytes: await renderDocx(doc), mime: DOCX_MIME, ext: 'docx' };
      default:
        throw ruleViolation('report.renderer_unavailable', `No ${format} renderer`);
    }
  }
}
