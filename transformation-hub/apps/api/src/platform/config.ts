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
  HUB_TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  HUB_STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  HUB_STORAGE_LOCAL_DIR: z.string().default('.data/objects'),
  HUB_MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(512).default(25),
  HUB_OIDC_ISSUER: z.string().url().optional(),
  HUB_OIDC_CLIENT_ID: z.string().optional(),
  HUB_OIDC_CLIENT_SECRET: z.string().optional(),
  HUB_OIDC_REDIRECT_URI: z.string().url().optional(),
  HUB_AI_ALLOW_MOCK: z.enum(['true', 'false']).default('true'),
  HUB_PRIVATE_MODE: z.enum(['true', 'false']).default('true'),
  HUB_EGRESS_ALLOWLIST: z.string().default(''),
  HUB_WORKER_ID: z.string().default(`worker-${process.pid}`),
  HUB_WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  HUB_LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  HUB_CHROMIUM_PATH: z.string().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

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
    trustProxy: e.HUB_TRUST_PROXY === 'true',
    storage: { driver: e.HUB_STORAGE_DRIVER, localDir: e.HUB_STORAGE_LOCAL_DIR, maxUploadBytes: e.HUB_MAX_UPLOAD_MB * 1024 * 1024 },
    oidc: {
      issuer: e.HUB_OIDC_ISSUER ?? null,
      clientId: e.HUB_OIDC_CLIENT_ID ?? null,
      clientSecret: e.HUB_OIDC_CLIENT_SECRET ?? null,
      redirectUri: e.HUB_OIDC_REDIRECT_URI ?? null,
    },
    ai: { allowMock: e.HUB_AI_ALLOW_MOCK === 'true' },
    privateMode: e.HUB_PRIVATE_MODE === 'true',
    egressAllowlist: e.HUB_EGRESS_ALLOWLIST.split(',').map((s) => s.trim()).filter(Boolean),
    worker: { id: e.HUB_WORKER_ID, pollMs: e.HUB_WORKER_POLL_MS },
    logLevel: e.HUB_LOG_LEVEL,
    chromiumPath: e.HUB_CHROMIUM_PATH ?? null,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
