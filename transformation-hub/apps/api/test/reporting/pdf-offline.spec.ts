import { createServer, type Server } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium } from 'playwright-core';
import { closeApp, closePools, DC, loginAs, projectIdByCode, type Client } from '../helpers';
import { exportFile, generate } from './report-kit';
import { OFFLINE_BROWSER_ARGS, offlineBrowserEnv, resolveChromium } from '../../src/modules/reporting/render/pdf.renderer';

/**
 * AT-22 (private mode: no unapproved egress) for the worker's PDF renderer (REQ-RPT-008, REQ-DEP-003). Page requests were
 * already aborted per browser context, but the Chromium PROCESS has background services (network time, component updater,
 * sign-in probes) that contact Google hosts even with Playwright's defaults — through the API's proxy environment when one is
 * set. Found by the lead while investigating a report test (connections to clients2.google.com, redirector.gvt1.com,
 * accounts.google.com and www.google.com during a render; `strace -e trace=connect` showed 7 connections before the fix, 0
 * after). The renderer now ignores proxy settings and resolves no host name.
 *
 * The proof: a local TCP listener stands in for an egress proxy (every proxy variable of the test process points to it while
 * the worker renders). The CONTROL shows that the listener does see Chromium's background traffic when a browser is
 * launched the old way; the export then runs through the real worker path and the listener must see nothing.
 */
const CHROMIUM = resolveChromium(process.env.HUB_CHROMIUM_PATH ?? null, false);
const PROXY_KEYS = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'];

let sink: Server;
let port = 0;
const seen: string[] = [];

async function withProxyEnv<T>(fn: () => Promise<T>): Promise<T> {
  const saved = new Map([...PROXY_KEYS, 'NO_PROXY', 'no_proxy'].map((k) => [k, process.env[k]]));
  for (const k of PROXY_KEYS) process.env[k] = `http://127.0.0.1:${port}`;
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  try {
    return await fn();
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

let dc: string;
let pm: Client;
beforeAll(async () => {
  sink = createServer((s) => {
    s.once('data', (d) => seen.push(d.toString('latin1').split('\r\n')[0]!));
    setTimeout(() => s.destroy(), 100);
  });
  await new Promise<void>((res) => sink.listen(0, '127.0.0.1', res));
  port = (sink.address() as { port: number }).port;
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
});
afterAll(async () => {
  await new Promise<void>((res) => sink.close(() => res()));
  await closeApp();
  await closePools();
});

describe('the PDF renderer browser stays offline (AT-22, REQ-DEP-003)', () => {
  it('the browser environment carries no proxy variable (any case) and keeps the rest; the launch arguments disable proxies and host resolution', () => {
    const env = offlineBrowserEnv({ HTTPS_PROXY: 'http://p:1', http_proxy: 'http://p:1', All_Proxy: 'socks5://p:1', NO_PROXY: 'x', PATH: '/usr/bin', HOME: '/root' });
    expect(env).toEqual({ PATH: '/usr/bin', HOME: '/root' });
    expect(OFFLINE_BROWSER_ARGS).toEqual(expect.arrayContaining(['--no-proxy-server', '--host-resolver-rules=MAP * ~NOTFOUND']));
  });

  describe.skipIf(!CHROMIUM)('with the environment Chromium', () => {
    it('CONTROL: a browser launched without the offline settings sends background requests to the configured proxy (the sink sees them)', async () => {
      seen.length = 0;
      const n = await withProxyEnv(async () => {
        const browser = await chromium.launch({ executablePath: CHROMIUM!, headless: true, args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-first-run'] });
        try {
          const ctx = await browser.newContext({ offline: true });
          await ctx.route('**/*', (r) => r.abort());
          const page = await ctx.newPage();
          await page.setContent('<p>control</p>');
          for (let i = 0; i < 150 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
          return seen.length;
        } finally {
          await browser.close();
        }
      });
      console.log(`PDF offline CONTROL: ${n} request(s) reached the sink: ${JSON.stringify(seen.map((x) => x.replace(/\?.*$/, '?…')))}`);
      expect(n).toBeGreaterThan(0);
    });

    it('a committee pack PDF exported through the worker sends nothing to the proxy (no background request, no page request)', async () => {
      const s = await generate(pm, dc, { kind: 'committee_pack' });
      seen.length = 0;
      const f = await withProxyEnv(async () => {
        const out = await exportFile(pm, dc, s.id, 'pdf', 'ar');
        await new Promise((r) => setTimeout(r, 2000));
        return out;
      });
      expect(f.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(seen, 'requests that reached the proxy sink').toEqual([]);
    });
  });
});
