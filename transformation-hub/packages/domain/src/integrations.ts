/**
 * Integrations (spec §17, REQ-INT-006..010/013/014, REQ-SEC-014): pure rules — no I/O.
 *
 *  - Outbound URL guard (SSRF, C-18): https only, no credentials in the URL, port 443, host on the egress allowlist, and
 *    never an internal address (loopback, private, link-local, cloud metadata, carrier NAT, unique-local, multicast,
 *    reserved). The API resolves the host and re-checks every resolved address with `ipCategory` before it connects to
 *    the checked address (anti-DNS-rebinding); redirects are never followed.
 *  - The adapter registry: every connector the hub knows, with its direction (read / write / send), OAuth scopes and
 *    manual alternative. Future enterprise systems are DOCUMENTED ONLY (REQ-INT-008): no endpoint, data contract or
 *    approval exists, so they cannot be configured.
 *  - Honest status (REQ-INT-013): saving an endpoint or a secret never makes a connector "verified"; only a successful
 *    connectivity check does.
 *  - Send rule (REQ-INT-007): a read-only connector never sends or writes; a write/send connector sends only when it is
 *    verified, enabled, its sending authority is approved and the destination is approved.
 *  - Signed inbound webhooks (REQ-INT-009, C-39): timestamp window and delivery-id (nonce) format.
 */
import { ruleViolation } from './errors';
import type { IntegrationStatus } from './enums';

// ---------------------------------------------------------------------------------------------------------
// Address classification (IPv4 / IPv6 literals as normalised by the WHATWG URL parser or returned by DNS)

export type IpCategory =
  | 'public'
  | 'loopback'
  | 'private'
  | 'link_local'
  | 'metadata'
  | 'carrier_nat'
  | 'unique_local'
  | 'multicast'
  | 'unspecified'
  | 'reserved'
  | 'invalid';

/** Cloud instance-metadata endpoints (AWS / Azure / GCP / OCI 169.254.169.254, AWS ECS 169.254.170.2, Alibaba 100.100.100.200). */
const METADATA_V4 = new Set(['169.254.169.254', '169.254.170.2', '100.100.100.200', '169.254.169.123']);

function parseIpv4(s: string): number[] | null {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out;
}

function categoryV4(b: number[]): IpCategory {
  const [a, c] = [b[0]!, b[1]!];
  const dotted = b.join('.');
  if (METADATA_V4.has(dotted)) return 'metadata';
  if (a === 0) return 'unspecified';
  if (a === 10) return 'private';
  if (a === 100 && c >= 64 && c <= 127) return 'carrier_nat';
  if (a === 127) return 'loopback';
  if (a === 169 && c === 254) return 'link_local';
  if (a === 172 && c >= 16 && c <= 31) return 'private';
  if (a === 192 && c === 168) return 'private';
  if (a === 192 && c === 0 && (b[2] === 0 || b[2] === 2)) return 'reserved';
  if (a === 198 && (c === 18 || c === 19)) return 'reserved';
  if (a === 198 && c === 51 && b[2] === 100) return 'reserved';
  if (a === 203 && c === 0 && b[2] === 113) return 'reserved';
  if (a >= 224 && a <= 239) return 'multicast';
  if (a >= 240) return 'reserved';
  return 'public';
}

/** Expand an IPv6 literal (with optional embedded IPv4) into 8 hextets; null when malformed. */
function parseIpv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(':')) return null;
  let tail: number[] = [];
  const lastColon = s.lastIndexOf(':');
  const last = s.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIpv4(last);
    if (!v4) return null;
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!];
    s = s.slice(0, lastColon + 1) + '0:0';
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const toNums = (h: string) => (h === '' ? [] : h.split(':').map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)));
  const head = toNums(halves[0]!);
  const rest = halves.length === 2 ? toNums(halves[1]!) : [];
  if ([...head, ...rest].some((n) => Number.isNaN(n))) return null;
  let words: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 0) return null;
    words = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    words = head;
  }
  if (words.length !== 8) return null;
  if (tail.length) {
    words[6] = tail[0]!;
    words[7] = tail[1]!;
  }
  return words;
}

/** Category of an IP address literal (v4 dotted quad or v6, bracketed or not). Hostnames are 'invalid'. */
export function ipCategory(address: string): IpCategory {
  const v4 = parseIpv4(address);
  if (v4) return categoryV4(v4);
  const w = parseIpv6(address);
  if (!w) return 'invalid';
  if (w.every((x) => x === 0)) return 'unspecified';
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return 'loopback';
  const embedded = () => [w[6]! >> 8, w[6]! & 0xff, w[7]! >> 8, w[7]! & 0xff];
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96) carry an IPv4 address.
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) return categoryV4(embedded());
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) return categoryV4(embedded());
  if (w[0] === 0xfd00 && w[1] === 0x0ec2 && w.slice(2, 7).every((x) => x === 0) && w[7] === 0x254) return 'metadata';
  if ((w[0]! & 0xffc0) === 0xfe80) return 'link_local';
  if ((w[0]! & 0xfe00) === 0xfc00) return 'unique_local';
  if ((w[0]! & 0xff00) === 0xff00) return 'multicast';
  if (w[0] === 0x2001 && w[1] === 0x0db8) return 'reserved';
  if (w[0] === 0x2002) return categoryV4([w[1]! >> 8, w[1]! & 0xff, w[2]! >> 8, w[2]! & 0xff]); // 6to4 embeds an IPv4
  return 'public';
}

export const isIpLiteral = (host: string) => ipCategory(host) !== 'invalid';

/** Names that always designate the local machine, an internal zone or a metadata service. */
const INTERNAL_NAME = /^(localhost|metadata|instance-data|metadata\.google\.internal|kubernetes(\.default(\.svc)?)?)$|\.(localhost|local|internal|localdomain|intranet|lan|home\.arpa|svc|cluster\.local)$/i;

/** A host (name or IP literal) that is internal on its face, before any DNS resolution. */
export function hostIsInternal(host: string): boolean {
  const h = host.trim().replace(/\.$/, '').toLowerCase();
  if (!h) return true;
  const cat = ipCategory(h);
  if (cat !== 'invalid') return cat !== 'public';
  return INTERNAL_NAME.test(h);
}

/** Allowlist match: exact host, or a suffix entry starting with "." (".example.com" matches "a.example.com"). */
export function hostOnAllowlist(host: string, allowlist: readonly string[]): boolean {
  const h = host.trim().replace(/\.$/, '').toLowerCase();
  return allowlist
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .some((x) => h === x || (x.startsWith('.') && h.endsWith(x) && h.length > x.length));
}

export type OutboundUrlCheck = { ok: true; url: URL; host: string; port: number } | { ok: false; code: string; reason: string };

/**
 * SSRF guard for any outbound URL (REQ-SEC-014, C-18). The resolved addresses are checked again by the caller.
 * Codes: egress.url_invalid, egress.scheme_not_allowed, egress.credentials_in_url, egress.port_not_allowed,
 * egress.internal_address, egress.host_not_allowlisted.
 */
export function checkOutboundUrl(raw: string, allowlist: readonly string[]): OutboundUrlCheck {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    return { ok: false, code: 'egress.url_invalid', reason: 'The URL is not valid' };
  }
  if (url.protocol !== 'https:') return { ok: false, code: 'egress.scheme_not_allowed', reason: 'Only https:// endpoints are allowed' };
  if (url.username || url.password) return { ok: false, code: 'egress.credentials_in_url', reason: 'Credentials are never accepted inside a URL' };
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) return { ok: false, code: 'egress.port_not_allowed', reason: 'Only the standard https port (443) is allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (hostIsInternal(host)) {
    return { ok: false, code: 'egress.internal_address', reason: 'Internal, private, link-local and metadata addresses are never contacted' };
  }
  if (!hostOnAllowlist(host, allowlist)) {
    return { ok: false, code: 'egress.host_not_allowlisted', reason: 'The host is not on the organisation egress allowlist' };
  }
  return { ok: true, url, host, port };
}

/** URLs found in a text value (http, https, ftp, file, UNC / smb paths) — for inert-link detection in imports. */
export function urlsIn(text: string): { url: string; host: string }[] {
  const out: { url: string; host: string }[] = [];
  const s = String(text ?? '');
  for (const m of s.matchAll(/\b(?:https?|ftp|file|smb):\/\/[^\s"'<>)]*/gi)) {
    let host = '';
    try {
      host = new URL(m[0]).hostname.replace(/^\[|\]$/g, '');
    } catch {
      const rest = m[0].replace(/^[a-z]+:\/\//i, '').replace(/^[^@/]*@/, '');
      const end = rest.indexOf(']');
      host = rest.startsWith('[') ? (rest.slice(1, end > 0 ? end : undefined).split(/[/?#]/)[0] ?? '') : (rest.split(/[/:?#]/)[0] ?? '');
    }
    out.push({ url: m[0].slice(0, 300), host });
  }
  for (const m of s.matchAll(/\\\\([A-Za-z0-9._-]+)\\[^\s"'<>]*/g)) out.push({ url: m[0].slice(0, 300), host: m[1]! });
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Adapter registry (REQ-INT-006/007/008/014)

export type IntegrationDirection = 'read' | 'write' | 'send';
export type AdapterAvailability = 'configurable' | 'documented_only';

export interface IntegrationAdapterDef {
  key: string;
  kind: 'smtp' | 'teams' | 'sharepoint' | 'webhook' | 'erp' | 'hr' | 'itsm' | 'dcim' | 'vdr';
  direction: IntegrationDirection;
  availability: AdapterAvailability;
  /** Provider and protocol (product names, not tenant data). */
  provider: string;
  /** OAuth 2.0 scopes the adapter would request — least privilege; read connectors never hold a write/send scope. */
  scopes: readonly string[];
  /** How the configuration is checked: an outbound https endpoint, or a signed ping received from the sender. */
  check: 'outbound_endpoint' | 'inbound_ping' | 'none';
  /** Code of the practical manual alternative shown while the connector is unavailable (web: integrations.manual.<code>). */
  manualAlternative: 'in_app_notifications' | 'upload_documents' | 'import_wizard' | 'export_and_upload' | 'manual_entry';
  /** What is still missing before the connector can exist at all (documented-only connectors). */
  prerequisites: readonly ('endpoint' | 'data_contract' | 'approval' | 'tenant_consent' | 'sending_authority')[];
}

export const INTEGRATION_ADAPTERS: readonly IntegrationAdapterDef[] = [
  {
    key: 'm365_outlook_mail_send',
    kind: 'smtp',
    direction: 'send',
    availability: 'configurable',
    provider: 'Microsoft 365 — Outlook (Microsoft Graph sendMail)',
    scopes: ['Mail.Send'],
    check: 'outbound_endpoint',
    manualAlternative: 'in_app_notifications',
    prerequisites: ['tenant_consent', 'sending_authority', 'approval'],
  },
  {
    key: 'm365_teams_message_send',
    kind: 'teams',
    direction: 'send',
    availability: 'configurable',
    provider: 'Microsoft 365 — Teams channel messages (Microsoft Graph)',
    scopes: ['ChannelMessage.Send'],
    check: 'outbound_endpoint',
    manualAlternative: 'in_app_notifications',
    prerequisites: ['tenant_consent', 'sending_authority', 'approval'],
  },
  {
    key: 'm365_teams_meetings_read',
    kind: 'teams',
    direction: 'read',
    availability: 'configurable',
    provider: 'Microsoft 365 — Teams online meetings (read)',
    scopes: ['OnlineMeetings.Read'],
    check: 'outbound_endpoint',
    manualAlternative: 'import_wizard',
    prerequisites: ['tenant_consent', 'approval'],
  },
  {
    key: 'm365_sharepoint_read',
    kind: 'sharepoint',
    direction: 'read',
    availability: 'configurable',
    provider: 'Microsoft 365 — SharePoint document libraries (read, selected sites)',
    scopes: ['Sites.Selected'],
    check: 'outbound_endpoint',
    manualAlternative: 'upload_documents',
    prerequisites: ['tenant_consent', 'approval'],
  },
  {
    key: 'm365_sharepoint_write',
    kind: 'sharepoint',
    direction: 'write',
    availability: 'configurable',
    provider: 'Microsoft 365 — SharePoint document libraries (write, one approved site)',
    scopes: ['Sites.Selected'],
    check: 'outbound_endpoint',
    manualAlternative: 'export_and_upload',
    prerequisites: ['tenant_consent', 'sending_authority', 'approval'],
  },
  {
    key: 'inbound_webhook',
    kind: 'webhook',
    direction: 'read',
    availability: 'configurable',
    provider: 'Signed inbound webhooks (HMAC-SHA256, timestamp window, delivery-id replay protection)',
    scopes: [],
    check: 'inbound_ping',
    manualAlternative: 'import_wizard',
    prerequisites: ['endpoint', 'approval'],
  },
  { key: 'erp_finance', kind: 'erp', direction: 'read', availability: 'documented_only', provider: 'ERP / Finance system', scopes: [], check: 'none', manualAlternative: 'import_wizard', prerequisites: ['endpoint', 'data_contract', 'approval'] },
  { key: 'hr_people', kind: 'hr', direction: 'read', availability: 'documented_only', provider: 'HR system', scopes: [], check: 'none', manualAlternative: 'import_wizard', prerequisites: ['endpoint', 'data_contract', 'approval'] },
  { key: 'itsm_service_desk', kind: 'itsm', direction: 'read', availability: 'documented_only', provider: 'ITSM / service desk', scopes: [], check: 'none', manualAlternative: 'manual_entry', prerequisites: ['endpoint', 'data_contract', 'approval'] },
  { key: 'dcim_inventory', kind: 'dcim', direction: 'read', availability: 'documented_only', provider: 'DCIM (data-centre infrastructure management)', scopes: [], check: 'none', manualAlternative: 'import_wizard', prerequisites: ['endpoint', 'data_contract', 'approval'] },
  { key: 'vdr_external', kind: 'vdr', direction: 'read', availability: 'documented_only', provider: 'External virtual data room (VDR)', scopes: [], check: 'none', manualAlternative: 'upload_documents', prerequisites: ['endpoint', 'data_contract', 'approval'] },
];

export const INTEGRATION_ADAPTER_KEYS = INTEGRATION_ADAPTERS.map((a) => a.key);

export function adapterDef(key: string): IntegrationAdapterDef | undefined {
  return INTEGRATION_ADAPTERS.find((a) => a.key === key);
}

/** Secret references name an environment variable of the secret store in this namespace — never the secret itself. */
export const SECRET_REF_PATTERN = /^HUB_INTEGRATION_SECRET_[A-Z0-9_]{1,64}$/;

/** Scopes requested by a configuration must be a subset of the adapter's declared scopes (least privilege). */
export function assertScopes(def: IntegrationAdapterDef, scopes: readonly string[]) {
  const extra = scopes.filter((s) => !def.scopes.includes(s));
  if (extra.length) throw ruleViolation('integrations.scope_not_declared', `Scope(s) not declared for this connector: ${extra.join(', ')}`, { extra });
}

/**
 * Status after a configuration is SAVED (REQ-INT-013): never `verified` — a saved token or URL proves nothing. A disabled
 * connector stays disabled until it is enabled again.
 */
export function statusAfterConfigure(current: IntegrationStatus): IntegrationStatus {
  return current === 'disabled' ? 'disabled' : 'configured_unverified';
}

/** Status after a connectivity check: `verified` only when the real check succeeded. */
export function statusAfterCheck(succeeded: boolean): IntegrationStatus {
  return succeeded ? 'verified' : 'failed';
}

export interface SendCheckInput {
  direction: IntegrationDirection;
  status: IntegrationStatus;
  enabled: boolean;
  sendingAuthorized: boolean;
  destinationApproved: boolean;
}

/**
 * REQ-INT-007: whether a connector may perform a write / send operation. A read-only connector can never send, whatever
 * else is configured; a write/send connector needs a verified connection, to be enabled, an approved sending authority
 * (integrations.send_authority.approve — a separate authorisation record) and an approved destination.
 */
export function sendRefusal(c: SendCheckInput): { code: string; reason: string } | null {
  if (c.direction === 'read') return { code: 'integrations.read_only_connector', reason: 'A read-only connector cannot send or write' };
  if (c.status !== 'verified') return { code: 'integrations.not_verified', reason: `The connector is ${c.status.replace(/_/g, ' ')} — nothing is sent` };
  if (!c.enabled) return { code: 'integrations.disabled', reason: 'The connector is disabled' };
  if (!c.sendingAuthorized) return { code: 'integrations.send_authority_missing', reason: 'No approved sending authority for this connector' };
  if (!c.destinationApproved) return { code: 'integrations.destination_not_approved', reason: 'The destination is not on the approved destination list' };
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Signed inbound webhooks (REQ-INT-009, C-39)

/** Accepted clock skew between the sender's timestamp and ours. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;
/** Largest webhook body accepted (bytes). */
export const WEBHOOK_MAX_BYTES = 256 * 1024;
/** Sender delivery ids double as replay nonces. */
export const WEBHOOK_DELIVERY_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const WEBHOOK_EVENT_TYPE = /^[a-z][a-z0-9_.-]{1,63}$/;

/** Timestamp header (unix seconds) within the tolerance window around `nowSeconds`. */
export function webhookTimestampIssue(header: string | undefined, nowSeconds: number, tolerance = WEBHOOK_TOLERANCE_SECONDS): string | null {
  if (!header || !/^\d{9,11}$/.test(header)) return 'webhooks.timestamp_missing';
  const ts = Number(header);
  if (Math.abs(nowSeconds - ts) > tolerance) return 'webhooks.timestamp_out_of_window';
  return null;
}

/** The exact bytes that are signed: `<timestamp>.<deliveryId>.<raw body>`. */
export function webhookSigningPrefix(timestamp: string, deliveryId: string): string {
  return `${timestamp}.${deliveryId}.`;
}

/** Event types an inbound connector processes; anything else is recorded and ignored. */
export const WEBHOOK_EVENT_TYPES = ['ping', 'test.event', 'test.fail'] as const;
