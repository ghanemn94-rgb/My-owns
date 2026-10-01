import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hostAllowed } from '@hub/domain';
import { AnthropicGatewayProvider, OpenAiCompatibleProvider } from '../../src/modules/ai/providers/http.providers';
import type { ModelRequest } from '../../src/modules/ai/providers/model-provider';

/**
 * P5 security review (docs/reviews/P5-security-review.md) — outbound egress guard of the model-provider adapters (AT-22,
 * AIT-29, spec §16 "Block unapproved outbound traffic"). Written by the security-privacy-reviewer; no implementation file
 * and no existing test was changed. LOCAL LOOPBACK ONLY: the "approved" endpoint is 127.0.0.1 (the only allowlisted host)
 * and the "unapproved" destination is 127.0.0.2 (a different host, not on the allowlist; Linux routes 127.0.0.0/8 to
 * loopback). No external host is contacted. The API key value is a placeholder, not a credential.
 * Fix status (implementer, separate context): the three DEFECTs are fixed and run as "(fixed, regression)", assertions unchanged.
 * `DEFECT` = `it.fails` asserting the REQUIRED behaviour (red once fixed; then rename "(fixed, regression)", plain `it`);
 * `CONTROL` confirms an existing control.
 */

interface Hit {
  url: string;
  method: string;
  headers: IncomingHttpHeaders;
  body: string;
}

const CANARY = 'P5SEC-EGRESS-CONTEXT-CANARY';
const KEY = 'p5sec-placeholder-not-a-credential';

let approved: Server;
let unapproved: Server;
let approvedPort = 0;
let unapprovedPort = 0;
const approvedHits: Hit[] = [];
const unapprovedHits: Hit[] = [];
/** Status the approved endpoint answers with (a redirect to the unapproved host). */
let redirectStatus = 307;

const req: ModelRequest = {
  task: 'answer',
  locale: 'en',
  question: 'What is pending?',
  context: [
    {
      key: 'document:00000000-0000-4000-8000-000000000001',
      ref: { type: 'document', id: '00000000-0000-4000-8000-000000000001', version: 1 },
      kind: 'document_chunk',
      tool: 'search_documents',
      classification: 'internal',
      roomId: null,
      title: 'Synthetic memo',
      text: `Synthetic source text ${CANARY}.`,
      suspicious: false,
      sourceUpdatedAt: null,
    },
  ],
  missing: [],
  tools: [],
  maxOutputTokens: 200,
  model: null,
};

const anthropicReply = JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ claims: [], toolCalls: [] }) }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'probe' });
const openaiReply = JSON.stringify({ choices: [{ message: { content: JSON.stringify({ claims: [], toolCalls: [] }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: 'probe' });

function listen(s: Server, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, host, () => resolve((s.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  unapproved = createServer((r, res) => {
    let body = '';
    r.on('data', (c) => (body += c));
    r.on('end', () => {
      unapprovedHits.push({ url: r.url ?? '', method: r.method ?? '', headers: r.headers, body });
      res.setHeader('content-type', 'application/json');
      res.end((r.url ?? '').includes('chat/completions') ? openaiReply : anthropicReply);
    });
  });
  unapprovedPort = await listen(unapproved, '127.0.0.2');
  approved = createServer((r, res) => {
    let body = '';
    r.on('data', (c) => (body += c));
    r.on('end', () => {
      approvedHits.push({ url: r.url ?? '', method: r.method ?? '', headers: r.headers, body });
      // The approved gateway answers with a redirect to another host (misconfiguration, a login redirect, or compromise).
      res.statusCode = redirectStatus;
      res.setHeader('location', `http://127.0.0.2:${unapprovedPort}${r.url ?? '/'}`);
      res.end();
    });
  });
  approvedPort = await listen(approved, '127.0.0.1');
});

afterAll(async () => {
  await new Promise<void>((r) => approved.close(() => r()));
  await new Promise<void>((r) => unapproved.close(() => r()));
});

describe('SEC-P5-04 — the provider adapters follow redirects from the approved endpoint to an unapproved host [AT-22, AIT-29, spec §16]', () => {
  it('CONTROL: only 127.0.0.1 is approved; a provider configured directly on the unapproved host is refused before any request (EGRESS_NOT_APPROVED, 0 hits)', async () => {
    expect(hostAllowed(`http://127.0.0.1:${approvedPort}`, ['127.0.0.1'])).toBe(true);
    expect(hostAllowed(`http://127.0.0.2:${unapprovedPort}`, ['127.0.0.1'])).toBe(false);
    const before = unapprovedHits.length;
    const direct = new AnthropicGatewayProvider({ url: () => `http://127.0.0.2:${unapprovedPort}`, apiKey: () => KEY, allowlist: () => ['127.0.0.1'] });
    expect(direct.status()).toBe('egress_not_approved');
    await expect(direct.generate(req, new AbortController().signal)).rejects.toThrow(/egress allowlist/);
    expect(unapprovedHits.length).toBe(before);
  });

  it('SEC-P5-04 (fixed, regression) (anthropic adapter, 307): a redirect from the approved gateway is not followed — the unapproved host receives no request, no context and no x-api-key', async () => {
    redirectStatus = 307;
    const before = unapprovedHits.length;
    const p = new AnthropicGatewayProvider({ url: () => `http://127.0.0.1:${approvedPort}`, apiKey: () => KEY, allowlist: () => ['127.0.0.1'] });
    expect(p.status()).toBe('configured_unverified');
    const outcome = await p.generate(req, new AbortController().signal).then(
      () => 'resolved',
      (e: Error) => `rejected: ${e.name}`,
    );
    const got = unapprovedHits.slice(before);
    console.log(
      `SEC-P5-04 observed (anthropic, 307): generate ${outcome}; approved host hits ${approvedHits.length}; unapproved host hits ${got.length}; ` +
        JSON.stringify(got.map((h) => ({ method: h.method, url: h.url, xApiKeyForwarded: h.headers['x-api-key'] === KEY, contextCanaryInBody: h.body.includes(CANARY) }))),
    );
    expect(got).toHaveLength(0);
  });

  it('SEC-P5-04 (fixed, regression) (anthropic adapter, 302 — e.g. a login redirect): the unapproved host receives no request and no x-api-key', async () => {
    redirectStatus = 302;
    const before = unapprovedHits.length;
    const p = new AnthropicGatewayProvider({ url: () => `http://127.0.0.1:${approvedPort}`, apiKey: () => KEY, allowlist: () => ['127.0.0.1'] });
    await p.generate(req, new AbortController().signal).catch(() => undefined);
    const got = unapprovedHits.slice(before);
    console.log(`SEC-P5-04 observed (anthropic, 302): unapproved host hits ${got.length}; ${JSON.stringify(got.map((h) => ({ method: h.method, xApiKeyForwarded: h.headers['x-api-key'] === KEY, contextCanaryInBody: h.body.includes(CANARY) })))}`);
    expect(got).toHaveLength(0);
  });

  it('SEC-P5-04 (fixed, regression) (openai_compatible adapter, 307): the unapproved host receives no request and no context', async () => {
    redirectStatus = 307;
    const before = unapprovedHits.length;
    const p = new OpenAiCompatibleProvider({ url: () => `http://127.0.0.1:${approvedPort}/v1`, apiKey: () => KEY, allowlist: () => ['127.0.0.1'] });
    await p.generate(req, new AbortController().signal).catch(() => undefined);
    const got = unapprovedHits.slice(before);
    console.log(
      `SEC-P5-04 observed (openai_compatible, 307): unapproved host hits ${got.length}; ` +
        JSON.stringify(got.map((h) => ({ method: h.method, url: h.url, authorizationForwarded: typeof h.headers.authorization === 'string', contextCanaryInBody: h.body.includes(CANARY) }))),
    );
    expect(got).toHaveLength(0);
  });
});
