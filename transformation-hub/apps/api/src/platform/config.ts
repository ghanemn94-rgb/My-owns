import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { z } from 'zod';

/**
 * Configuration is read from environment variables and validated at startup. Unsafe production combinations are
 * rejected (spec §16: "configuration validation rejecting unsafe production settings").
 */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HUB_MODE: z.enum(['demo', 'standard']).default('standard'),
  HUB_ORG_SLUG: z.string().min(1).default('mobily'),
  HUB_APP_NAME: z.string().default('Mobily Transformation & Transactions Hub'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1).default('postgres://hub_app:hub_dev_only@127.0.0.1:5432/hub_dev'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),
  HUB_COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
  HUB_SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),
  HUB_SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** 'false' (default), 'true' (= 1 hop), a hop count, or a comma list of trusted proxy addresses/CIDRs (ADR-0017). */
  HUB_TRUST_PROXY: z.string().regex(/^(true|false|\d{1,2}|[0-9a-fA-F.:/,\s]+)$/).default('false'),
  HUB_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  HUB_STORAGE_LOCAL_DIR: z.string().default('.data/objects'),
  /** S3-compatible object storage (HUB_STORAGE_DRIVER=s3). Not configured unless endpoint, bucket and credentials are set. */
  HUB_S3_ENDPOINT: z.string().url().optional(),
  HUB_S3_REGION: z.string().min(1).default('us-east-1'),
  HUB_S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
  HUB_S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  HUB_S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  HUB_S3_SSE: z.enum(['none', 'AES256', 'aws:kms']).default('none'),
  HUB_S3_KMS_KEY_ID: z.string().min(1).optional(),
  /**
   * I-R4: production requires server-side encryption per object (HUB_S3_SSE=AES256 or aws:kms) unless the operator states
   * that the bucket's default encryption was verified: `assured` (an explicit, documented risk acceptance).
   */
  HUB_S3_BUCKET_DEFAULT_ENCRYPTION: z.enum(['assured']).optional(),
  HUB_S3_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  HUB_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(512).default(25),
  /** Files marked `not_scanned` (no enterprise malware scanner configured) may be downloaded/indexed. Default: true outside
   *  production, false in production (ADR-0010). Setting it true in production is an explicit, documented risk acceptance. */
  HUB_ALLOW_UNSCANNED_FILES: z.enum(['true', 'false']).optional(),
  HUB_OIDC_ISSUER: z.string().url().optional(),
  HUB_OIDC_CLIENT_ID: z.string().optional(),
  HUB_OIDC_CLIENT_SECRET: z.string().optional(),
  HUB_OIDC_REDIRECT_URI: z.string().url().optional(),
  HUB_OIDC_LINK_BY_EMAIL: z.enum(['true', 'false']).default('false'),
  /**
   * Production acknowledgement for link-by-email (I-R2): the first OIDC login binds a pre-provisioned account by the IdP's
   * VERIFIED email (SEC-P1-01). That trusts the IdP's email claims for accounts not bound yet; set exactly this value to
   * accept it.
   */
  HUB_OIDC_LINK_BY_EMAIL_ACK: z.string().optional(),
  /** HMAC key for short-lived signed cookies (OIDC login state). Required when OIDC is enabled. */
  HUB_COOKIE_SECRET: z.string().min(32).optional(),
  HUB_AI_ALLOW_MOCK: z.enum(['true', 'false']).default('true'),
  /** Model endpoints (Not configured unless set): a licensed self-hosted OpenAI-compatible endpoint, or an approved gateway. */
  HUB_AI_OPENAI_BASE_URL: z.string().url().optional(),
  HUB_AI_ANTHROPIC_GATEWAY_URL: z.string().url().optional(),
  HUB_PRIVATE_MODE: z.enum(['true', 'false']).default('true'),
  HUB_EGRESS_ALLOWLIST: z.string().default(''),
  HUB_WORKER_ID: z.string().default(`worker-${process.pid}`),
  HUB_WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  HUB_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HUB_CHROMIUM_PATH: z.string().optional(),
  HUB_DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  HUB_DB_LOCK_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),
  HUB_DB_IDLE_TX_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  HUB_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(600),
  HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE: z.coerce.number().int().min(5).default(120),
  HUB_RATE_LIMIT_PUBLIC_PER_MINUTE: z.coerce.number().int().min(5).default(60),
  /** Per IDENTITY across all of a user's sessions (REQ-DAT-016): a user cannot multiply the budget by opening sessions. */
  HUB_RATE_LIMIT_USER_PER_MINUTE: z.coerce.number().int().min(10).default(2400),
  HUB_RATE_LIMIT_USER_MUTATIONS_PER_MINUTE: z.coerce.number().int().min(5).default(480),
  /** Expensive endpoint class (uploads, report generation and exports, file downloads, AI asks) per identity. */
  HUB_RATE_LIMIT_HEAVY_PER_MINUTE: z.coerce.number().int().min(1).default(60),
  /** Multi-factor evidence required from the IdP (REQ-SEC-008): any of these `amr` values, and/or one of these `acr`. */
  HUB_OIDC_REQUIRED_AMR: z.string().regex(/^[\w.:/,\s-]*$/).optional(),
  HUB_OIDC_REQUIRED_ACR: z.string().regex(/^[\w.:/,\s-]*$/).optional(),
  /**
   * OpenTelemetry (REQ-ARC-009): traces are exported ONLY to this configured collector (OTLP/HTTP JSON, `<endpoint>/v1/traces`);
   * nothing is sent when it is unset (the default) or when OTEL_SDK_DISABLED=true. No public default exists.
   */
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().url().optional(),
  OTEL_SDK_DISABLED: z.enum(['true', 'false']).default('false'),
  OTEL_SERVICE_NAME: z.string().regex(/^[\w.-]{1,64}$/).optional(),
  /**
   * Audit export to an independent log repository (REQ-DAT-007): `off` (default), `file` (append-only JSON lines in
   * HUB_AUDIT_EXPORT_DIR — a volume shipped by the platform's log agent / WORM store), or `syslog` (RFC 5424 over TCP or
   * UDP to HUB_AUDIT_EXPORT_SYSLOG, e.g. a local relay `tcp://127.0.0.1:6514`). The application never sends it elsewhere.
   */
  HUB_AUDIT_EXPORT: z.enum(['off', 'file', 'syslog']).default('off'),
  HUB_AUDIT_EXPORT_DIR: z.string().min(1).optional(),
  HUB_AUDIT_EXPORT_SYSLOG: z.string().regex(/^(tcp|udp):\/\/[^\s/:]+:\d{1,5}$/).optional(),
  HUB_AUDIT_EXPORT_BATCH: z.coerce.number().int().min(1).max(10000).default(500),
});

/**
 * SEC-P1S-05: values that were ever written into this repository (development / CI passwords, test-only secrets, scanner
 * placeholders) are public and must never protect a production system. Stored as SHA-256 so this file does not repeat
 * them; `apps/api/test/ops/p7-config-hardening.spec.ts` checks that every value allowed as "synthetic" by the secret
 * scanner (scripts/ops/gitleaks.toml) is in this set.
 */
const PUBLISHED_SECRET_SHA256 = new Set([
  '06570ebcdb4e21a05e3827b8524c33f18a692b1aea96c47f9bd882450c2d9b5a', // local / CI database password
  '42512572f0336a10b48a2758d3d57f8b377f511dad661314bafd5d316a6e2293', // CI service-container superuser password
  '1a5d44a2dca19669d72edf4c4f1c27c4c1ca4b4408fbb17f6ce4ad452d78ddb3', // AWS documentation access key id
  '78314b11be2e581549ac1c4f616563fad3fdf0c3b71678f6e2299182080e0598', // AWS documentation secret key
  'bbf4f7cdfa32e31e6afaf4aeb8c5dafdf9d357b908809e73b07e3a24bcec4461', // former test cookie secret (P1 config tests)
  'c74725870e3585f56f0616f955001c075d440306864c367f6c91295a20de060c', // former test database password
  'eb5f38c1c72b5740be26dcffdb7d61d00d86e52c2a1a57f1c8b6757c95c42ad4', // former test cookie secret (storage tests)
  '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b', // documentation example in the entrypoint
  'f708c4cc5b72fc7c69cdd4d12b30880e752faa00ba81d1ea354869335c4434fc', // former test S3 secret key
  'b83c7778c23a8d199def24fba1e96d24338d2bd9d859b613fde9a9a9077d88ec', // scanner redaction placeholder
  '460c881d5ea97c8fb3f43dec2ec4328207249eaeb4f7fa7f6157d457b273e239', // former test OIDC client secret
  '32d8016a597bb23ab1887ce6a68948406d551734e89723ac751d5b8bd54e1f00', // former test S3 secret key
]);
export function publishedSecret(value: string | undefined | null): boolean {
  if (!value) return false;
  return PUBLISHED_SECRET_SHA256.has(createHash('sha256').update(value.trim()).digest('hex'));
}

/** Password part of a connection URL (percent-decoded), or null. */
export function urlPassword(url: string): string | null {
  try {
    const u = new URL(url);
    return u.password ? decodeURIComponent(u.password) : null;
  } catch {
    return null;
  }
}

/**
 * REQ-SEC-011: a production database connection must be encrypted and verified — `sslmode=require | verify-ca |
 * verify-full` (node-postgres verifies the certificate for all three; verify-full is recommended) — unless it is a local
 * Unix socket (`?host=/path` or a percent-encoded socket path), which never crosses a network. Returns the problem or null.
 */
export function databaseTlsProblem(url: string, env: NodeJS.ProcessEnv = {}): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
  const hostParam = u.searchParams.get('host') ?? '';
  const host = decodeURIComponent(u.hostname || '');
  if (hostParam.startsWith('/') || host.startsWith('/') || (!u.hostname && (env.PGHOST ?? '').startsWith('/'))) return null;
  const mode = (u.searchParams.get('sslmode') ?? env.PGSSLMODE ?? '').toLowerCase();
  if (['require', 'verify-ca', 'verify-full'].includes(mode)) return null;
  return `DATABASE_URL must use TLS in production: add sslmode=verify-full (or verify-ca / require) — found ${mode ? `sslmode=${mode}` : 'no sslmode'}`;
}

export type AppConfig = ReturnType<typeof loadConfig>;

/** Express 'trust proxy' value: false, a hop count, or a list of trusted proxy addresses (never `true` = trust everyone). */
export function parseTrustProxy(v: string): false | number | string {
  if (v === 'false') return false;
  if (v === 'true') return 1;
  if (/^\d{1,2}$/.test(v)) return Number(v) || false;
  return v.split(',').map((x) => x.trim()).filter(Boolean).join(', ');
}

/**
 * Conservative entropy ESTIMATE of a secret, in bits (I-R2): the Shannon entropy of its character distribution × length,
 * discounted for repetition (how well it compresses — `abcdefghijkl` × 3 compresses to a third) and for predictable runs
 * (`abcdef…`, `987654…`: a step of −1/0/+1 that repeats the previous step). Random secrets keep most of their estimate
 * (32 random hex characters: ≥ 78 bits in 200 000 samples, average ≈ 115); patterned ones collapse (≤ 50 bits).
 */
export function secretEntropyBits(s: string): number {
  if (!s) return 0;
  const counts = new Map<string, number>();
  const chars = [...s];
  for (const c of chars) counts.set(c, (counts.get(c) ?? 0) + 1);
  let perChar = 0;
  for (const n of counts.values()) {
    const p = n / chars.length;
    perChar -= p * Math.log2(p);
  }
  const bytes = Buffer.byteLength(s, 'utf8');
  const repetition = Math.min(1, (deflateRawSync(Buffer.from(s, 'utf8'), { level: 9 }).length - 1) / bytes);
  const cp = chars.map((c) => c.codePointAt(0)!);
  let predictable = 0;
  for (let i = 2; i < cp.length; i++) {
    const d = cp[i]! - cp[i - 1]!;
    if (Math.abs(d) <= 1 && d === cp[i - 1]! - cp[i - 2]!) predictable++;
  }
  return perChar * chars.length * Math.max(0, repetition) * (1 - predictable / chars.length);
}

/** Minimum estimated entropy for a production secret (see secretEntropyBits for the calibration). */
export const MIN_SECRET_BITS = 64;

/**
 * Rejects weak secrets: short, very few distinct characters, a known placeholder, or a low entropy estimate (repetition,
 * sequences). The distinct-character floor is 8, not 12: a random 32-character HEX secret (`openssl rand -hex 16`, 16
 * possible symbols) regularly shows only 11 distinct characters; the entropy estimate catches the patterned cases.
 */
export function weakSecret(s: string): boolean {
  if (s.length < 32) return true;
  if (new Set(s).size < 8) return true;
  if (/change[-_ ]?me|secret|password|example|placeholder/i.test(s)) return true;
  return secretEntropyBits(s) < MIN_SECRET_BITS;
}

/**
 * A trusted-proxy entry that trusts (almost) every client address (I-R2): with it, any client can forge
 * X-Forwarded-For and pick its own rate-limit bucket and audited IP. IPv4 prefixes shorter than /8, IPv6 shorter than /16,
 * and IPv4-mapped IPv6 ranges shorter than ::ffff:0:0/104 (= IPv4 /8) are refused — `0.0.0.0/0`, `0/0`, `::/0`,
 * `::ffff:0:0/96`, `0.0.0.0/1` + `128.0.0.0/1` alike.
 */
export function trustsEveryone(entry: string): boolean {
  const [addr = '', prefixText] = entry.trim().split('/');
  if (!addr) return false;
  const v6 = addr.includes(':');
  const prefix = prefixText === undefined || prefixText === '' ? (v6 ? 128 : 32) : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0) return true; // unparseable → refuse rather than guess
  if (!v6) return prefix < 8;
  if (/^::ffff:/i.test(addr)) return prefix < 104;
  return prefix < 16;
}

/** Well-known default / documentation credentials of S3-compatible stores (MinIO, AWS examples) — never in production. */
const DEFAULT_S3_KEYS = new Set(['minioadmin', 'minio', 'admin', 'root', 'user', 'test', 'akiaiosfodnn7example']);
const DEFAULT_S3_SECRETS = new Set(['minioadmin', 'minio123', 'minio', 'password', 'admin', 'secret', 'changeme', 'test', 'wjalrxutnfemi/k7mdeng/bpxrficyexamplekey']);
export function defaultS3Credentials(accessKeyId: string | undefined, secret: string | undefined): boolean {
  const k = (accessKeyId ?? '').trim().toLowerCase();
  const s = (secret ?? '').trim().toLowerCase();
  return DEFAULT_S3_KEYS.has(k) || DEFAULT_S3_SECRETS.has(s) || /example/.test(k) || /example/.test(s) || (!!secret && secret.length < 16);
}

const splitList = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** The exact acknowledgement value for HUB_OIDC_LINK_BY_EMAIL in production. */
export const LINK_BY_EMAIL_ACK = 'accept-idp-verified-email-first-login-binding';

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // An empty HUB_* value (e.g. `HUB_OIDC_ISSUER=` from Compose/.env files) means "not set", not an invalid value.
  const parsed = Env.safeParse(Object.fromEntries(Object.entries(env).filter(([k, v]) => !(k.startsWith('HUB_') && v === ''))));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  const problems: string[] = [];
  if (e.NODE_ENV === 'production') {
    if (e.HUB_MODE === 'demo') problems.push('HUB_MODE=demo is not allowed in production (demo login and synthetic users)');
    if (e.HUB_COOKIE_SECURE !== 'true') problems.push('HUB_COOKIE_SECURE must be true in production');
    if (e.HUB_AI_ALLOW_MOCK === 'true') problems.push('HUB_AI_ALLOW_MOCK must be false in production (mock AI is simulated)');
    if (/hub_dev_only/.test(e.DATABASE_URL) || /hub_dev_only/.test(env.PGPASSWORD ?? '')) problems.push('DATABASE_URL uses the development password');
    if (/:\/\/hub_owner[:@]/.test(e.DATABASE_URL)) problems.push('DATABASE_URL must use the runtime role, not the owner role');
    const tls = databaseTlsProblem(e.DATABASE_URL, env);
    if (tls) problems.push(tls);
    // SEC-P1S-05: no value ever published in the repository protects a production system.
    const secrets: [string, string | undefined | null][] = [
      ['DATABASE_URL password', urlPassword(e.DATABASE_URL)],
      ['PGPASSWORD', env.PGPASSWORD],
      ['HUB_COOKIE_SECRET', e.HUB_COOKIE_SECRET],
      ['HUB_OIDC_CLIENT_SECRET', e.HUB_OIDC_CLIENT_SECRET],
      ['HUB_S3_ACCESS_KEY_ID', e.HUB_S3_ACCESS_KEY_ID],
      ['HUB_S3_SECRET_ACCESS_KEY', e.HUB_S3_SECRET_ACCESS_KEY],
      ['HUB_AI_OPENAI_API_KEY', env.HUB_AI_OPENAI_API_KEY],
      ['HUB_AI_ANTHROPIC_API_KEY', env.HUB_AI_ANTHROPIC_API_KEY],
    ];
    for (const [name, value] of secrets) {
      if (publishedSecret(value)) problems.push(`${name} is a value published in the repository (a development / test value) — generate a new secret`);
    }
    if (e.HUB_STORAGE_DRIVER === 'local') problems.push('Local filesystem storage is for development only; configure s3-compatible storage');
    if (e.HUB_STORAGE_DRIVER === 's3') {
      if (!e.HUB_S3_ENDPOINT || !e.HUB_S3_BUCKET || !e.HUB_S3_ACCESS_KEY_ID || !e.HUB_S3_SECRET_ACCESS_KEY) problems.push('HUB_STORAGE_DRIVER=s3 needs HUB_S3_ENDPOINT, HUB_S3_BUCKET, HUB_S3_ACCESS_KEY_ID and HUB_S3_SECRET_ACCESS_KEY');
      if (e.HUB_S3_ENDPOINT && !e.HUB_S3_ENDPOINT.startsWith('https://')) problems.push('HUB_S3_ENDPOINT must use https in production');
      if (e.HUB_S3_SSE === 'aws:kms' && !e.HUB_S3_KMS_KEY_ID) problems.push('HUB_S3_SSE=aws:kms needs HUB_S3_KMS_KEY_ID');
      if (e.HUB_S3_SSE === 'none' && e.HUB_S3_BUCKET_DEFAULT_ENCRYPTION !== 'assured') {
        problems.push('HUB_S3_SSE must be AES256 or aws:kms in production (or set HUB_S3_BUCKET_DEFAULT_ENCRYPTION=assured after verifying the bucket default encryption)');
      }
      if (defaultS3Credentials(e.HUB_S3_ACCESS_KEY_ID, e.HUB_S3_SECRET_ACCESS_KEY)) problems.push('HUB_S3_ACCESS_KEY_ID / HUB_S3_SECRET_ACCESS_KEY are default or example credentials (or the secret is shorter than 16 characters)');
    }
    const broadProxy = e.HUB_TRUST_PROXY.split(',').filter((x) => /[.:/]/.test(x) && trustsEveryone(x));
    if (broadProxy.length) problems.push(`HUB_TRUST_PROXY trusts (almost) every address (${broadProxy.map((x) => x.trim()).join(', ')}); list the ingress proxy addresses or use a hop count`);
    if (e.HUB_OIDC_LINK_BY_EMAIL === 'true' && e.HUB_OIDC_LINK_BY_EMAIL_ACK !== LINK_BY_EMAIL_ACK) {
      problems.push(`HUB_OIDC_LINK_BY_EMAIL=true binds unbound accounts by the IdP's verified email; set HUB_OIDC_LINK_BY_EMAIL_ACK=${LINK_BY_EMAIL_ACK} to accept that trust, or pre-provision the IdP subject instead`);
    }
    if (!e.HUB_OIDC_ISSUER) problems.push('OIDC issuer must be configured in production (no password login exists)');
    if (e.HUB_OIDC_ISSUER && !e.HUB_COOKIE_SECRET) problems.push('HUB_COOKIE_SECRET (>= 32 chars) is required when OIDC is enabled');
    if (e.HUB_OIDC_ISSUER && !e.HUB_OIDC_ISSUER.startsWith('https://')) problems.push('OIDC issuer must use https in production');
    if (e.HUB_OIDC_ISSUER && (!e.HUB_OIDC_CLIENT_ID || !e.HUB_OIDC_REDIRECT_URI)) problems.push('OIDC requires HUB_OIDC_CLIENT_ID and HUB_OIDC_REDIRECT_URI (otherwise nobody can sign in)');
    if (e.HUB_OIDC_REDIRECT_URI && !e.HUB_OIDC_REDIRECT_URI.startsWith('https://')) problems.push('HUB_OIDC_REDIRECT_URI must use https in production');
    if (e.HUB_COOKIE_SECRET && weakSecret(e.HUB_COOKIE_SECRET)) problems.push('HUB_COOKIE_SECRET is too weak (use >= 32 random characters, e.g. openssl rand -base64 48)');
    // Model endpoints: https only, and the host must be on the egress allowlist (private mode / ADR on AI egress).
    const allow = e.HUB_EGRESS_ALLOWLIST.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const [name, url] of [['HUB_AI_OPENAI_BASE_URL', e.HUB_AI_OPENAI_BASE_URL], ['HUB_AI_ANTHROPIC_GATEWAY_URL', e.HUB_AI_ANTHROPIC_GATEWAY_URL], ['HUB_S3_ENDPOINT', e.HUB_STORAGE_DRIVER === 's3' ? e.HUB_S3_ENDPOINT : undefined]] as const) {
      if (!url) continue;
      const u = new URL(url);
      if (u.protocol !== 'https:') problems.push(`${name} must use https in production`);
      if (!allow.includes(u.hostname.toLowerCase())) problems.push(`${name} host ${u.hostname} is not on HUB_EGRESS_ALLOWLIST`);
    }
    // Telemetry and the audit export reach only configured, allow-listed internal endpoints (private mode).
    const otel = e.OTEL_SDK_DISABLED === 'true' ? undefined : (e.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? e.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (otel && !allow.includes(new URL(otel).hostname.toLowerCase())) problems.push(`OpenTelemetry collector host ${new URL(otel).hostname} is not on HUB_EGRESS_ALLOWLIST`);
    if (e.HUB_AUDIT_EXPORT === 'syslog' && e.HUB_AUDIT_EXPORT_SYSLOG) {
      const h = new URL(e.HUB_AUDIT_EXPORT_SYSLOG).hostname.toLowerCase();
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(h) && !allow.includes(h)) problems.push(`HUB_AUDIT_EXPORT_SYSLOG host ${h} is neither a local relay nor on HUB_EGRESS_ALLOWLIST`);
    }
  }
  if (e.HUB_AUDIT_EXPORT === 'file' && !e.HUB_AUDIT_EXPORT_DIR) problems.push('HUB_AUDIT_EXPORT=file needs HUB_AUDIT_EXPORT_DIR');
  if (e.HUB_AUDIT_EXPORT === 'syslog' && !e.HUB_AUDIT_EXPORT_SYSLOG) problems.push('HUB_AUDIT_EXPORT=syslog needs HUB_AUDIT_EXPORT_SYSLOG (tcp://host:port or udp://host:port)');
  if (problems.length) throw new Error(`Unsafe configuration rejected: ${problems.join('; ')}`);
  // Accepted but noteworthy settings, logged once at startup (bootstrap).
  const warnings: string[] = [];
  if (e.HUB_OIDC_LINK_BY_EMAIL === 'true') warnings.push('OIDC link-by-email is enabled: the first login of a pre-provisioned, unbound account binds it by the IdP-verified email');
  if (e.HUB_STORAGE_DRIVER === 's3' && e.HUB_S3_SSE === 'none') warnings.push('S3 objects are written without per-object server-side encryption (bucket default encryption relied upon)');
  if (e.NODE_ENV === 'production' && e.HUB_OIDC_ISSUER && !e.HUB_OIDC_REQUIRED_AMR?.trim() && !e.HUB_OIDC_REQUIRED_ACR?.trim()) {
    warnings.push('No MFA claim is required from the IdP (HUB_OIDC_REQUIRED_AMR / HUB_OIDC_REQUIRED_ACR): the application relies on the IdP policy alone');
  }
  return {
    warnings,
    nodeEnv: e.NODE_ENV,
    demoMode: e.HUB_MODE === 'demo',
    orgSlug: e.HUB_ORG_SLUG,
    appName: e.HUB_APP_NAME,
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    cookieSecure: e.HUB_COOKIE_SECURE === 'true',
    sessionIdleMinutes: e.HUB_SESSION_IDLE_MINUTES,
    sessionAbsoluteHours: e.HUB_SESSION_ABSOLUTE_HOURS,
    trustProxy: parseTrustProxy(e.HUB_TRUST_PROXY),
    storage: {
      driver: e.HUB_STORAGE_DRIVER,
      localDir: e.HUB_STORAGE_LOCAL_DIR,
      maxUploadBytes: e.HUB_MAX_UPLOAD_MB * 1024 * 1024,
      allowUnscanned: e.HUB_ALLOW_UNSCANNED_FILES ? e.HUB_ALLOW_UNSCANNED_FILES === 'true' : e.NODE_ENV !== 'production',
      s3:
        e.HUB_S3_ENDPOINT && e.HUB_S3_BUCKET && e.HUB_S3_ACCESS_KEY_ID && e.HUB_S3_SECRET_ACCESS_KEY
          ? {
              endpoint: e.HUB_S3_ENDPOINT,
              region: e.HUB_S3_REGION,
              bucket: e.HUB_S3_BUCKET,
              accessKeyId: e.HUB_S3_ACCESS_KEY_ID,
              secretAccessKey: e.HUB_S3_SECRET_ACCESS_KEY,
              sse: e.HUB_S3_SSE,
              kmsKeyId: e.HUB_S3_KMS_KEY_ID ?? null,
              timeoutMs: e.HUB_S3_TIMEOUT_MS,
            }
          : null,
    },
    oidc: {
      issuer: e.HUB_OIDC_ISSUER ?? null,
      clientId: e.HUB_OIDC_CLIENT_ID ?? null,
      clientSecret: e.HUB_OIDC_CLIENT_SECRET ?? null,
      redirectUri: e.HUB_OIDC_REDIRECT_URI ?? null,
      linkByEmail: e.HUB_OIDC_LINK_BY_EMAIL === 'true',
    },
    cookieSecret: e.HUB_COOKIE_SECRET ?? null,
    ai: { allowMock: e.HUB_AI_ALLOW_MOCK === 'true' },
    privateMode: e.HUB_PRIVATE_MODE === 'true',
    egressAllowlist: e.HUB_EGRESS_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean),
    worker: { id: e.HUB_WORKER_ID, pollMs: e.HUB_WORKER_POLL_MS },
    logLevel: e.HUB_LOG_LEVEL,
    chromiumPath: e.HUB_CHROMIUM_PATH ?? null,
    dbTimeouts: { statementMs: e.HUB_DB_STATEMENT_TIMEOUT_MS, lockMs: e.HUB_DB_LOCK_TIMEOUT_MS, idleMs: e.HUB_DB_IDLE_TX_TIMEOUT_MS },
    rateLimits: {
      perMinute: e.HUB_RATE_LIMIT_PER_MINUTE,
      mutationsPerMinute: e.HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE,
      publicPerMinute: e.HUB_RATE_LIMIT_PUBLIC_PER_MINUTE,
      userPerMinute: e.HUB_RATE_LIMIT_USER_PER_MINUTE,
      userMutationsPerMinute: e.HUB_RATE_LIMIT_USER_MUTATIONS_PER_MINUTE,
      heavyPerMinute: e.HUB_RATE_LIMIT_HEAVY_PER_MINUTE,
    },
    mfa: { requiredAmr: splitList(e.HUB_OIDC_REQUIRED_AMR), requiredAcr: splitList(e.HUB_OIDC_REQUIRED_ACR) },
    otel: {
      tracesEndpoint:
        e.OTEL_SDK_DISABLED === 'true'
          ? null
          : (e.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? (e.OTEL_EXPORTER_OTLP_ENDPOINT ? `${e.OTEL_EXPORTER_OTLP_ENDPOINT.replace(/\/+$/, '')}/v1/traces` : null)),
      serviceName: e.OTEL_SERVICE_NAME ?? null,
    },
    auditExport: { target: e.HUB_AUDIT_EXPORT, dir: e.HUB_AUDIT_EXPORT_DIR ?? null, syslog: e.HUB_AUDIT_EXPORT_SYSLOG ?? null, batch: e.HUB_AUDIT_EXPORT_BATCH },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
