import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import type { RenderDoc } from './document';
import { footerHtml, reportHtml } from './html';

export const PDF_MIME = 'application/pdf';

/**
 * Headless Chromium for PDF exports (ADR-0011): `HUB_CHROMIUM_PATH` (the api-chromium image sets it). Outside production,
 * the Chromium build matching playwright-core (PLAYWRIGHT_BROWSERS_PATH) or a system Chrome / Chromium is used when present.
 * Null when none is available — the PDF format is then reported as unavailable, never faked.
 */
export function resolveChromium(configured: string | null, production: boolean): string | null {
  if (configured) return existsSync(configured) ? configured : null;
  if (production) return null;
  const candidates: string[] = [];
  try {
    candidates.push(chromium.executablePath());
  } catch {
    /* no bundled browser registry entry */
  }
  candidates.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return candidates.find((c) => !!c && existsSync(c)) ?? null;
}

/**
 * Renders the report HTML to PDF in an isolated, offline browser context: no network (every request is aborted and the
 * context is offline), fonts embedded, A4 with a classification + page-number footer on every page.
 */
export async function renderPdf(doc: RenderDoc, executablePath: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000, args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-first-run'] });
    const context = await browser.newContext({ offline: true, javaScriptEnabled: true, locale: doc.locale === 'ar' ? 'ar-SA' : 'en-GB' });
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    const compact = doc.kind === 'executive_summary';
    await page.setContent(reportHtml(doc, { compact, maxRows: 3 }), { waitUntil: 'load', timeout: 30_000 });
    await page.evaluate('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: footerHtml(doc),
      margin: compact ? { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' } : { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
      tagged: true,
      outline: false,
    });
    await context.close();
    return Buffer.from(pdf);
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
