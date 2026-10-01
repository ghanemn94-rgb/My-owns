import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { checkOutboundUrl, ipCategory } from '@hub/domain';

export type ProbeResult = { ok: true; httpStatus: number; address: string } | { ok: false; code: string; detail: string };

export interface EgressTransport {
  /** All addresses of a host name (A and AAAA). */
  resolve(host: string): Promise<string[]>;
  /** One https GET to `address` for `url` (SNI + Host header of the URL's host); never follows redirects. */
  get(url: URL, address: string, timeoutMs: number): Promise<{ status: number }>;
}

/** Real transport: system resolver and node:https. Redirects are never followed (node's https does not follow them). */
export const NODE_TRANSPORT: EgressTransport = {
  async resolve(host) {
    const r = await lookup(host, { all: true, verbatim: true });
    return r.map((x) => x.address);
  },
  get(url, address, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = httpsRequest(
        {
          host: address,
          servername: url.hostname,
          port: 443,
          method: 'GET',
          path: `${url.pathname}${url.search}`,
          headers: { host: url.hostname, 'user-agent': 'transformation-hub-connectivity-check', accept: 'application/json' },
          timeout: timeoutMs,
        },
        (res) => {
          res.resume(); // the body is never read beyond what the socket delivers; nothing is stored
          resolve({ status: res.statusCode ?? 0 });
          req.destroy();
        },
      );
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
      req.on('error', reject);
      req.end();
    });
  },
};

/**
 * The ONLY outbound HTTP client of the integrations module (REQ-SEC-014, C-18). Order: URL guard (https, port 443, no
 * credentials, never an internal address, host on the egress allowlist) → DNS resolution → EVERY resolved address must be
 * public (loopback / private / link-local / metadata / carrier-NAT / unique-local … refused — anti DNS rebinding) → connect
 * to the CHECKED address with the URL's host for TLS (SNI) and Host → a redirect is a failure, never followed.
 */
export class EgressClient {
  constructor(public transport: EgressTransport = NODE_TRANSPORT) {}

  async probe(rawUrl: string, allowlist: readonly string[], timeoutMs = 5000): Promise<ProbeResult> {
    const chk = checkOutboundUrl(rawUrl, allowlist);
    if (!chk.ok) return { ok: false, code: chk.code, detail: chk.reason };
    let addresses: string[];
    try {
      addresses = await this.transport.resolve(chk.host);
    } catch {
      return { ok: false, code: 'egress.dns_failed', detail: 'The host name could not be resolved' };
    }
    if (!addresses.length) return { ok: false, code: 'egress.dns_failed', detail: 'The host name could not be resolved' };
    const bad = addresses.find((a) => ipCategory(a) !== 'public');
    if (bad) return { ok: false, code: 'egress.internal_address', detail: 'The host resolves to an internal, private, link-local or metadata address — refused' };
    const address = addresses[0]!;
    let status: number;
    try {
      status = (await this.transport.get(chk.url, address, timeoutMs)).status;
    } catch (e) {
      const code = (e as { code?: string }).code === 'ETIMEDOUT' ? 'egress.timeout' : 'egress.unreachable';
      return { ok: false, code, detail: code === 'egress.timeout' ? 'The endpoint did not answer in time' : 'The endpoint could not be reached' };
    }
    if (status >= 300 && status < 400) return { ok: false, code: 'egress.redirect_refused', detail: `The endpoint answered with a redirect (HTTP ${status}); redirects are never followed` };
    if (status < 200 || status >= 300) return { ok: false, code: 'egress.http_error', detail: `The endpoint answered HTTP ${status}` };
    return { ok: true, httpStatus: status, address };
  }
}
