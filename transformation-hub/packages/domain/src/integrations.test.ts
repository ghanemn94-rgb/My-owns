import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_ADAPTERS,
  adapterDef,
  assertScopes,
  checkOutboundUrl,
  hostIsInternal,
  ipCategory,
  sendRefusal,
  statusAfterCheck,
  statusAfterConfigure,
  urlsIn,
  webhookTimestampIssue,
} from './integrations';
import { DomainError } from './errors';

describe('REQ-SEC-014 SSRF guard — address classification', () => {
  it.each([
    ['169.254.169.254', 'metadata'],
    ['169.254.170.2', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['127.0.0.1', 'loopback'],
    ['127.10.20.30', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.10', 'private'],
    ['169.254.1.1', 'link_local'],
    ['100.64.0.1', 'carrier_nat'],
    ['0.0.0.0', 'unspecified'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['8.8.8.8', 'public'],
    ['172.32.0.1', 'public'],
    ['::1', 'loopback'],
    ['[::1]', 'loopback'],
    ['::', 'unspecified'],
    ['fe80::1', 'link_local'],
    ['fd00::1', 'unique_local'],
    ['fd00:ec2::254', 'metadata'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['::ffff:a9fe:a9fe', 'metadata'],
    ['::ffff:7f00:1', 'loopback'],
    ['64:ff9b::a9fe:a9fe', 'metadata'],
    ['2002:a9fe:a9fe::1', 'metadata'],
    ['ff02::1', 'multicast'],
    ['2001:db8::1', 'reserved'],
    ['2a00:1450:4001:80b::200e', 'public'],
    ['example.com', 'invalid'],
  ])('%s → %s', (ip, cat) => {
    expect(ipCategory(ip)).toBe(cat);
  });

  it('internal host names are refused before any DNS lookup', () => {
    for (const h of ['localhost', 'api.localhost', 'metadata.google.internal', 'db.internal', 'printer.local', 'kubernetes.default.svc', '169.254.169.254', '[::1]']) {
      expect(hostIsInternal(h), h).toBe(true);
    }
    expect(hostIsInternal('graph.microsoft.com')).toBe(false);
  });
});

describe('REQ-SEC-014 checkOutboundUrl — allow-list, https only, never an internal address', () => {
  const allow = ['graph.microsoft.com', '.sharepoint.com'];
  it('accepts an allowlisted https host on 443', () => {
    const r = checkOutboundUrl('https://graph.microsoft.com/v1.0/$metadata', allow);
    expect(r.ok).toBe(true);
    expect(checkOutboundUrl('https://contoso.sharepoint.com/sites/x', allow).ok).toBe(true);
  });
  it.each([
    ['http://graph.microsoft.com/', 'egress.scheme_not_allowed'],
    ['file:///etc/passwd', 'egress.scheme_not_allowed'],
    ['gopher://graph.microsoft.com/', 'egress.scheme_not_allowed'],
    ['https://user:pw@graph.microsoft.com/', 'egress.credentials_in_url'],
    ['https://graph.microsoft.com:8443/', 'egress.port_not_allowed'],
    ['https://169.254.169.254/latest/meta-data/', 'egress.internal_address'],
    // numeric / hex / octal IPv4 forms are normalised by the URL parser to the dotted quad
    ['https://2852039166/latest/meta-data/', 'egress.internal_address'],
    ['https://0xA9FEA9FE/', 'egress.internal_address'],
    ['https://0251.0376.0251.0376/', 'egress.internal_address'],
    ['https://[::ffff:169.254.169.254]/', 'egress.internal_address'],
    ['https://127.0.0.1/', 'egress.internal_address'],
    ['https://localhost/', 'egress.internal_address'],
    ['https://metadata.google.internal/computeMetadata/v1/', 'egress.internal_address'],
    ['https://evil.example/', 'egress.host_not_allowlisted'],
    ['https://graph.microsoft.com.evil.example/', 'egress.host_not_allowlisted'],
    ['https://sharepoint.com/', 'egress.host_not_allowlisted'],
    ['not a url', 'egress.url_invalid'],
  ])('%s → %s', (url, code) => {
    const r = checkOutboundUrl(url, allow);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
  });
  it('an internal address is refused even when someone allowlisted it', () => {
    const r = checkOutboundUrl('https://169.254.169.254/', ['169.254.169.254']);
    expect(r.ok).toBe(false);
  });
});

describe('urlsIn — links found in imported text (stored inert, never fetched)', () => {
  it('finds http(s), file and UNC links with their hosts', () => {
    const found = urlsIn('see http://169.254.169.254/latest and https://example.com/a and \\\\fileserver\\share\\x.xlsx and file:///c:/x');
    expect(found.map((f) => f.host)).toEqual(['169.254.169.254', 'example.com', '', 'fileserver']);
  });
  it('bracketed IPv6 (IPv4-mapped metadata address) is recognised as internal', () => {
    const [u] = urlsIn('https://[::ffff:169.254.169.254]/latest');
    expect(hostIsInternal(u!.host)).toBe(true);
    const [v] = urlsIn('http://user@[fe80::1');
    expect(v!.host).toBe('fe80::1');
    expect(hostIsInternal(v!.host)).toBe(true);
  });
});

describe('REQ-INT-006/007/008/013 adapter registry and honest status', () => {
  it('UT: adapter declares scopes; read connectors hold no write/send scope; future integrations are documented only', () => {
    const m365 = INTEGRATION_ADAPTERS.filter((a) => a.key.startsWith('m365_'));
    expect(m365.length).toBeGreaterThanOrEqual(5);
    for (const a of m365) expect(a.scopes.length, a.key).toBeGreaterThan(0);
    for (const a of INTEGRATION_ADAPTERS.filter((x) => x.direction === 'read')) {
      expect(a.scopes.some((s) => /Send|Write|ReadWrite/i.test(s)), a.key).toBe(false);
    }
    const future = INTEGRATION_ADAPTERS.filter((a) => ['erp', 'hr', 'itsm', 'dcim', 'vdr'].includes(a.kind));
    expect(future.map((a) => a.kind).sort()).toEqual(['dcim', 'erp', 'hr', 'itsm', 'vdr']);
    for (const a of future) {
      expect(a.availability).toBe('documented_only');
      expect(a.prerequisites).toEqual(expect.arrayContaining(['endpoint', 'data_contract', 'approval']));
    }
    // separate read and write connectors for the same product
    expect(adapterDef('m365_sharepoint_read')!.direction).toBe('read');
    expect(adapterDef('m365_sharepoint_write')!.direction).toBe('write');
    expect(() => assertScopes(adapterDef('m365_sharepoint_read')!, ['Sites.ReadWrite.All'])).toThrow(DomainError);
    expect(() => assertScopes(adapterDef('m365_outlook_mail_send')!, ['Mail.Send'])).not.toThrow();
  });

  it('UT: saved credentials without successful test show Not verified', () => {
    expect(statusAfterConfigure('not_configured')).toBe('configured_unverified');
    expect(statusAfterConfigure('verified')).toBe('configured_unverified');
    expect(statusAfterConfigure('failed')).toBe('configured_unverified');
    expect(statusAfterConfigure('disabled')).toBe('disabled');
    expect(statusAfterCheck(false)).toBe('failed');
    expect(statusAfterCheck(true)).toBe('verified');
  });

  it('UT: read connector cannot invoke send operation', () => {
    const all = { status: 'verified' as const, enabled: true, sendingAuthorized: true, destinationApproved: true };
    expect(sendRefusal({ direction: 'read', ...all })?.code).toBe('integrations.read_only_connector');
    expect(sendRefusal({ direction: 'send', ...all })).toBeNull();
    expect(sendRefusal({ direction: 'send', ...all, status: 'configured_unverified' })?.code).toBe('integrations.not_verified');
    expect(sendRefusal({ direction: 'send', ...all, status: 'simulated' })?.code).toBe('integrations.not_verified');
    expect(sendRefusal({ direction: 'send', ...all, enabled: false })?.code).toBe('integrations.disabled');
    expect(sendRefusal({ direction: 'write', ...all, sendingAuthorized: false })?.code).toBe('integrations.send_authority_missing');
    expect(sendRefusal({ direction: 'send', ...all, destinationApproved: false })?.code).toBe('integrations.destination_not_approved');
  });
});

describe('REQ-INT-009 webhook timestamp window', () => {
  it('accepts within ±5 minutes, refuses stale, future and missing timestamps', () => {
    const now = 1_790_000_000;
    expect(webhookTimestampIssue(String(now - 100), now)).toBeNull();
    expect(webhookTimestampIssue(String(now + 299), now)).toBeNull();
    expect(webhookTimestampIssue(String(now - 301), now)).toBe('webhooks.timestamp_out_of_window');
    expect(webhookTimestampIssue(String(now + 3600), now)).toBe('webhooks.timestamp_out_of_window');
    expect(webhookTimestampIssue(undefined, now)).toBe('webhooks.timestamp_missing');
    expect(webhookTimestampIssue('12ab', now)).toBe('webhooks.timestamp_missing');
  });
});
