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

/** Pages of a PDF written by Chromium (page objects are plain dictionaries; only content streams are compressed). */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length;
}

/**
 * The browser process itself stays offline too (AT-22 private mode, REQ-DEP-003): even with Playwright's defaults
 * (`--disable-background-networking`, `--disable-component-update`) Chromium's background services contact Google hosts
 * (network time, component updater, sign-in probes) — through the API's proxy environment when one is set. The renderer
 * ignores any proxy configuration and resolves no host name, so no request can leave the machine whatever the report
 * contains; page requests are additionally aborted per context (below).
 */
export const OFFLINE_BROWSER_ARGS = ['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND', '--disable-domain-reliability', '--no-pings', '--disable-sync'];

const PROXY_ENV = /^(https?|all|ftp|no|socks)_proxy$/i;

/** The API's environment without proxy variables (Chromium on Linux reads them). */
export function offlineBrowserEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !PROXY_ENV.test(k)) out[k] = v;
  return out;
}

/** Uniform zoom steps tried last for the one-page layout; never below 75 % (7 pt text stays above 5 pt). */
const ONE_PAGE_ZOOMS = ['0.9', '0.82', '0.75'];

/**
 * Renders the report HTML to PDF in an isolated, offline browser context: no network (every request is aborted and the
 * context is offline), fonts embedded, A4 with a classification + page-number footer on every page.
 */
export async function renderPdf(doc: RenderDoc, executablePath: string): Promise<Buffer> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ executablePath, headless: true, timeout: 30_000, args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', ...OFFLINE_BROWSER_ARGS], env: offlineBrowserEnv() });
    const context = await browser.newContext({ offline: true, javaScriptEnabled: true, locale: doc.locale === 'ar' ? 'ar-SA' : 'en-GB' });
    await context.route('**/*', (route) => route.abort());
    const compact = doc.kind === 'executive_summary';
    // Every attempt uses a fresh page: a page that has already been printed keeps print-layout state.
    const attempt = async (maxRows: number, zoom: string | null) => {
      const page = await context.newPage();
      try {
        await page.setContent(reportHtml(doc, { compact, maxRows }), { waitUntil: 'load', timeout: 30_000 });
        await page.evaluate('document.fonts.ready');
        if (zoom) await page.evaluate(`document.body.style.zoom = '${zoom}'`);
        return Buffer.from(
          await page.pdf({
            format: 'A4',
            printBackground: true,
            preferCSSPageSize: true,
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            footerTemplate: footerHtml(doc),
            margin: compact ? { top: '10mm', bottom: '14mm', left: '10mm', right: '10mm' } : { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
            tagged: true,
            outline: false,
          }),
        );
      } finally {
        await page.close();
      }
    };
    // The executive summary stays on one page whatever the data (REQ-RPT-002): while the printed file has more than one
    // page, fewer rows are kept per table (3 → 2 → 1; each shortened table says "Showing n of m rows"), then the page is
    // zoomed uniformly (90 / 82 / 75 %). What is measured is the real print layout.
    const steps: [number, string | null][] = compact ? [[3, null], [2, null], [1, null], ...ONE_PAGE_ZOOMS.map((z): [number, string] => [1, z])] : [[3, null]];
    let pdf = Buffer.alloc(0);
    for (const [maxRows, zoom] of steps) {
      pdf = await attempt(maxRows, zoom);
      if (pdfPageCount(pdf) <= 1) break;
    }
    await context.close();
    return pdf;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
