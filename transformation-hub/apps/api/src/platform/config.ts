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
  HUB_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(512).default(25),
  /** Files marked `not_scanned` (no enterprise malware scanner configured) may be downloaded/indexed. Default: true outside
   *  production, false in production (ADR-0010). Setting it true in production is an explicit, documented risk acceptance. */
  HUB_ALLOW_UNSCANNED_FILES: z.enum(['true', 'false']).optional(),
  HUB_OIDC_ISSUER: z.string().url().optional(),
  HUB_OIDC_CLIENT_ID: z.string().optional(),
  HUB_OIDC_CLIENT_SECRET: z.string().optional(),
  HUB_OIDC_REDIRECT_URI: z.string().url().optional(),
  HUB_OIDC_LINK_BY_EMAIL: z.enum(['true', 'false']).default('false'),
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

/** Rejects obviously weak secrets: too few distinct characters or a known placeholder. */
export function weakSecret(s: string): boolean {
  if (s.length < 32) return true;
  if (new Set(s).size < 12) return true;
  return /change[-_ ]?me|secret|password|example|placeholder/i.test(s);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Env.safeParse(env);
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
    if (!e.HUB_OIDC_ISSUER) problems.push('OIDC issuer must be configured in production (no password login exists)');
    if (e.HUB_OIDC_ISSUER && !e.HUB_COOKIE_SECRET) problems.push('HUB_COOKIE_SECRET (>= 32 chars) is required when OIDC is enabled');
    if (e.HUB_OIDC_ISSUER && !e.HUB_OIDC_ISSUER.startsWith('https://')) problems.push('OIDC issuer must use https in production');
    if (e.HUB_OIDC_ISSUER && (!e.HUB_OIDC_CLIENT_ID || !e.HUB_OIDC_REDIRECT_URI)) problems.push('OIDC requires HUB_OIDC_CLIENT_ID and HUB_OIDC_REDIRECT_URI (otherwise nobody can sign in)');
    if (e.HUB_OIDC_REDIRECT_URI && !e.HUB_OIDC_REDIRECT_URI.startsWith('https://')) problems.push('HUB_OIDC_REDIRECT_URI must use https in production');
    if (e.HUB_COOKIE_SECRET && weakSecret(e.HUB_COOKIE_SECRET)) problems.push('HUB_COOKIE_SECRET is too weak (use >= 32 random characters, e.g. openssl rand -base64 48)');
    // Model endpoints: https only, and the host must be on the egress allowlist (private mode / ADR on AI egress).
    const allow = e.HUB_EGRESS_ALLOWLIST.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    for (const [name, url] of [['HUB_AI_OPENAI_BASE_URL', e.HUB_AI_OPENAI_BASE_URL], ['HUB_AI_ANTHROPIC_GATEWAY_URL', e.HUB_AI_ANTHROPIC_GATEWAY_URL]] as const) {
      if (!url) continue;
      const u = new URL(url);
      if (u.protocol !== 'https:') problems.push(`${name} must use https in production`);
      if (!allow.includes(u.hostname.toLowerCase())) problems.push(`${name} host ${u.hostname} is not on HUB_EGRESS_ALLOWLIST`);
    }
  }
  if (problems.length) throw new Error(`Unsafe configuration rejected: ${problems.join('; ')}`);
  return {
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
