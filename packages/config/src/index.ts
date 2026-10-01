// @mth/config: the runtime configuration contract (ADR-0011). backend-workflow-engineer implements the zod
// loader over this catalogue; devops-engineer generates `.env.example` from it (no values for secrets).
// Secrets are read ONLY from the process environment or files mounted at runtime (`*_FILE` variants),
// never from the repository.

export interface EnvVarSpec {
  readonly description: string;
  readonly required: boolean;
  readonly secret: boolean;
  readonly default?: string;
  readonly usedBy: readonly ("api" | "worker" | "db-cli" | "web-build")[];
}

export const ENV_VARS = {
  NODE_ENV: {
    description: "production | development | test",
    required: true,
    secret: false,
    usedBy: ["api", "worker", "db-cli"],
  },
  APP_BASE_URL: {
    description: "Public origin of the app, e.g. https://hub.example.internal (cookies, OIDC redirect)",
    required: true,
    secret: false,
    usedBy: ["api"],
  },
  PORT: { description: "API listen port", required: false, secret: false, default: "3000", usedBy: ["api"] },
  DATABASE_URL: {
    description: "PostgreSQL URL for the app role (mth_app)",
    required: true,
    secret: true,
    usedBy: ["api", "worker"],
  },
  DATABASE_OWNER_URL: {
    description: "PostgreSQL URL for the owner role (migrations, pg-boss schema install)",
    required: true,
    secret: true,
    usedBy: ["db-cli"],
  },
  AUTH_MODE: {
    description: "oidc | dev. `dev` enables local dev login and is refused when NODE_ENV=production",
    required: true,
    secret: false,
    default: "oidc",
    usedBy: ["api"],
  },
  OIDC_ISSUER_URL: {
    description: "OIDC issuer (corporate IdP; Keycloak realm URL in tests)",
    required: false,
    secret: false,
    usedBy: ["api"],
  },
  OIDC_CLIENT_ID: { description: "OIDC client id", required: false, secret: false, usedBy: ["api"] },
  OIDC_CLIENT_SECRET: {
    description: "OIDC client secret (confidential client)",
    required: false,
    secret: true,
    usedBy: ["api"],
  },
  OIDC_SCOPES: {
    description: "Requested scopes",
    required: false,
    secret: false,
    default: "openid profile email",
    usedBy: ["api"],
  },
  SESSION_IDLE_MINUTES: {
    description: "Idle session timeout",
    required: false,
    secret: false,
    default: "30",
    usedBy: ["api"],
  },
  SESSION_ABSOLUTE_HOURS: {
    description: "Absolute session lifetime",
    required: false,
    secret: false,
    default: "10",
    usedBy: ["api"],
  },
  EVIDENCE_STORAGE_DRIVER: {
    description: "filesystem (P1/P2) | s3 (optional, IT-approved, P6)",
    required: false,
    secret: false,
    default: "filesystem",
    usedBy: ["api", "worker"],
  },
  EVIDENCE_STORAGE_PATH: {
    description: "Private directory for the filesystem adapter (not web-served)",
    required: false,
    secret: false,
    default: "/var/lib/mth/evidence",
    usedBy: ["api", "worker"],
  },
  PRODUCT_NAME: {
    description: "Configurable product name (REQ-S01-002)",
    required: false,
    secret: false,
    default: "Mobily Transformation Hub",
    usedBy: ["api"],
  },
  DEFAULT_TIMEZONE: {
    description: "IANA timezone for new organizations",
    required: false,
    secret: false,
    default: "Asia/Riyadh",
    usedBy: ["api", "worker"],
  },
  DEFAULT_CURRENCY: {
    description: "ISO 4217 currency for new organizations",
    required: false,
    secret: false,
    default: "SAR",
    usedBy: ["api"],
  },
  RATE_LIMIT_PER_MINUTE: {
    description: "General API requests per minute per session/IP",
    required: false,
    secret: false,
    default: "300",
    usedBy: ["api"],
  },
  AUTH_RATE_LIMIT_PER_MINUTE: {
    description: "Login/callback/dev-login requests per minute per IP",
    required: false,
    secret: false,
    default: "20",
    usedBy: ["api"],
  },
  LOG_LEVEL: {
    description: "fatal | error | warn | info | debug",
    required: false,
    secret: false,
    default: "info",
    usedBy: ["api", "worker"],
  },
  TRUST_PROXY: {
    description: "Comma-separated reverse-proxy addresses whose X-Forwarded-* headers are trusted",
    required: false,
    secret: false,
    default: "",
    usedBy: ["api"],
  },
} as const satisfies Record<string, EnvVarSpec>;

export type EnvVarName = keyof typeof ENV_VARS;

/** Allowed AUTH_MODE values; `dev` must be rejected at startup when NODE_ENV=production (ADR-0005). */
export const AUTH_MODES = ["oidc", "dev"] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

// Validated loader over the catalogue above (T-DG1-BE).
export {
  ConfigError,
  isLoopbackHost,
  loadConfig,
  secureOriginAllowed,
  secretVariableNames,
  LOG_LEVELS,
  NODE_ENVS,
  type AppConfig,
  type Service,
} from "./load.ts";
