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
});

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
    if (/hub_dev_only/.test(e.DATABASE_URL)) problems.push('DATABASE_URL uses the development password');
    if (/:\/\/hub_owner[:@]/.test(e.DATABASE_URL)) problems.push('DATABASE_URL must use the runtime role, not the owner role');
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
  }
  if (problems.length) throw new Error(`Unsafe configuration rejected: ${problems.join('; ')}`);
  // Accepted but noteworthy settings, logged once at startup (bootstrap).
  const warnings: string[] = [];
  if (e.HUB_OIDC_LINK_BY_EMAIL === 'true') warnings.push('OIDC link-by-email is enabled: the first login of a pre-provisioned, unbound account binds it by the IdP-verified email');
  if (e.HUB_STORAGE_DRIVER === 's3' && e.HUB_S3_SSE === 'none') warnings.push('S3 objects are written without per-object server-side encryption (bucket default encryption relied upon)');
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
    rateLimits: { perMinute: e.HUB_RATE_LIMIT_PER_MINUTE, mutationsPerMinute: e.HUB_RATE_LIMIT_MUTATIONS_PER_MINUTE, publicPerMinute: e.HUB_RATE_LIMIT_PUBLIC_PER_MINUTE },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
