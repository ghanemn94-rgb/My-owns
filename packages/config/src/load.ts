// Validated runtime configuration loader (ADR-0011, ADR-0005). The catalogue of variable NAMES is frozen in
// ./index.ts (ENV_VARS); this file only reads and validates them.
//
// Rules:
//  - Every value comes from the process environment, or for a secret from a file named by `<NAME>_FILE`
//    (container secret mounts). Setting both is an error, so there is never ambiguity about the source.
//  - Missing required values, malformed values and the forbidden combination AUTH_MODE=dev + NODE_ENV=production
//    make `loadConfig` throw a ConfigError. Entry points print its message and exit non-zero.
//  - Error messages name the variable, never the value (secrets must not reach logs).
import { readFileSync } from "node:fs";
import { z } from "zod";
import { AUTH_MODES, ENV_VARS, type EnvVarName } from "./index.ts";

export type Service = "api" | "worker" | "db-cli";

export const NODE_ENVS = ["production", "development", "test"] as const;
export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug"] as const;

export class ConfigError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

export interface AppConfig {
  readonly service: Service;
  readonly nodeEnv: (typeof NODE_ENVS)[number];
  readonly appBaseUrl: URL | null;
  readonly port: number;
  readonly databaseUrl: string | null;
  readonly databaseOwnerUrl: string | null;
  readonly authMode: (typeof AUTH_MODES)[number];
  readonly oidc: {
    readonly issuerUrl: URL;
    readonly clientId: string;
    readonly clientSecret: string;
    readonly scopes: string;
  } | null;
  readonly session: { readonly idleMinutes: number; readonly absoluteHours: number };
  readonly evidenceStorage: { readonly driver: "filesystem" | "s3"; readonly path: string };
  readonly productName: string;
  readonly defaultTimezone: string;
  readonly defaultCurrency: string;
  readonly rateLimit: { readonly perMinute: number; readonly authPerMinute: number };
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly trustProxy: readonly string[];
}

type Env = Readonly<Record<string, string | undefined>>;

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Reads NAME or NAME_FILE. Returns undefined when neither is set (empty strings count as unset). */
function readRaw(env: Env, name: EnvVarName, problems: string[]): string | undefined {
  const direct = env[name];
  const file = env[`${name}_FILE`];
  const hasDirect = direct !== undefined && direct !== "";
  const hasFile = file !== undefined && file !== "";
  if (hasDirect && hasFile) {
    problems.push(`${name} and ${name}_FILE are both set; set only one`);
    return undefined;
  }
  if (hasFile) {
    try {
      return readFileSync(file, "utf8").replace(/\r?\n$/, "");
    } catch {
      problems.push(`${name}_FILE points to a file that cannot be read`);
      return undefined;
    }
  }
  return hasDirect ? direct : undefined;
}

function isRequiredFor(name: EnvVarName, service: Service): boolean {
  const spec = ENV_VARS[name];
  return spec.required && (spec.usedBy as readonly string[]).includes(service);
}

const positiveInt = (max: number) => z.coerce.number().int().min(1).max(max);

function postgresUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "postgres:" || u.protocol === "postgresql:";
  } catch {
    return false;
  }
}

/**
 * Load and validate the configuration for one service. Throws ConfigError listing every problem at once.
 * `env` defaults to process.env; tests pass an explicit object.
 */
export function loadConfig(service: Service, env: Env = process.env): AppConfig {
  const problems: string[] = [];
  const raw = {} as Record<EnvVarName, string | undefined>;
  for (const name of Object.keys(ENV_VARS) as EnvVarName[]) {
    const value = readRaw(env, name, problems);
    const spec = ENV_VARS[name] as { default?: string };
    raw[name] = value ?? spec.default;
    if (raw[name] === undefined && isRequiredFor(name, service)) {
      problems.push(`${name} is required for ${service}`);
    }
  }

  const field = <T>(name: EnvVarName, schema: z.ZodType<T>): T | undefined => {
    const value = raw[name];
    if (value === undefined) return undefined;
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      problems.push(`${name} is invalid (${parsed.error.issues[0]?.message ?? "invalid value"})`);
      return undefined;
    }
    return parsed.data;
  };

  const nodeEnv = field("NODE_ENV", z.enum(NODE_ENVS));
  const authMode = field("AUTH_MODE", z.enum(AUTH_MODES));
  const appBaseUrl = field(
    "APP_BASE_URL",
    z.string().transform((v, ctx) => {
      try {
        const u = new URL(v);
        if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("protocol");
        if (u.pathname !== "/" || u.search !== "" || u.hash !== "") {
          ctx.addIssue({ code: "custom", message: "must be an origin without path, query or fragment" });
          return z.NEVER;
        }
        return u;
      } catch {
        ctx.addIssue({ code: "custom", message: "must be an absolute http(s) URL" });
        return z.NEVER;
      }
    }),
  );
  const port = field("PORT", positiveInt(65535));
  const databaseUrl = field("DATABASE_URL", z.string().refine(postgresUrl, "must be a postgres:// URL"));
  const databaseOwnerUrl = field("DATABASE_OWNER_URL", z.string().refine(postgresUrl, "must be a postgres:// URL"));
  const idleMinutes = field("SESSION_IDLE_MINUTES", positiveInt(24 * 60));
  const absoluteHours = field("SESSION_ABSOLUTE_HOURS", positiveInt(24 * 30));
  const driver = field("EVIDENCE_STORAGE_DRIVER", z.enum(["filesystem", "s3"]));
  const storagePath = field("EVIDENCE_STORAGE_PATH", z.string().min(1));
  const productName = field("PRODUCT_NAME", z.string().trim().min(1).max(200));
  const defaultTimezone = field("DEFAULT_TIMEZONE", z.string().refine(isValidTimeZone, "unknown IANA time zone"));
  const defaultCurrency = field("DEFAULT_CURRENCY", z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code"));
  const perMinute = field("RATE_LIMIT_PER_MINUTE", positiveInt(1_000_000));
  const authPerMinute = field("AUTH_RATE_LIMIT_PER_MINUTE", positiveInt(1_000_000));
  const logLevel = field("LOG_LEVEL", z.enum(LOG_LEVELS));
  const trustProxy = (raw.TRUST_PROXY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // ADR-0005: the dev login must never be reachable in production.
  if (authMode === "dev" && nodeEnv === "production") {
    problems.push("AUTH_MODE=dev is refused when NODE_ENV=production");
  }

  // OIDC is all-or-nothing. With AUTH_MODE=oidc the API needs it (there is no other way to sign in).
  const issuer = raw.OIDC_ISSUER_URL;
  const clientId = raw.OIDC_CLIENT_ID;
  const clientSecret = raw.OIDC_CLIENT_SECRET;
  const anyOidc = issuer !== undefined || clientId !== undefined || clientSecret !== undefined;
  let oidc: AppConfig["oidc"] = null;
  if (anyOidc || (service === "api" && authMode === "oidc")) {
    const missing = (["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"] as const).filter(
      (n) => raw[n] === undefined,
    );
    if (service === "api" && missing.length > 0) {
      problems.push(
        `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required when AUTH_MODE=oidc or any OIDC_* variable is set`,
      );
    }
    if (issuer !== undefined && clientId !== undefined && clientSecret !== undefined) {
      let issuerUrl: URL | undefined;
      try {
        issuerUrl = new URL(issuer);
        if (issuerUrl.protocol !== "https:" && issuerUrl.protocol !== "http:") throw new Error("protocol");
      } catch {
        problems.push("OIDC_ISSUER_URL is invalid (must be an absolute http(s) URL)");
      }
      if (issuerUrl && issuerUrl.protocol === "http:" && nodeEnv === "production") {
        problems.push("OIDC_ISSUER_URL must use https when NODE_ENV=production");
      }
      if (issuerUrl) oidc = { issuerUrl, clientId, clientSecret, scopes: raw.OIDC_SCOPES ?? "openid profile email" };
    }
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return Object.freeze({
    service,
    nodeEnv: nodeEnv!,
    appBaseUrl: appBaseUrl ?? null,
    port: port!,
    databaseUrl: databaseUrl ?? null,
    databaseOwnerUrl: databaseOwnerUrl ?? null,
    authMode: authMode!,
    oidc,
    session: { idleMinutes: idleMinutes!, absoluteHours: absoluteHours! },
    evidenceStorage: { driver: driver!, path: storagePath! },
    productName: productName!,
    defaultTimezone: defaultTimezone!,
    defaultCurrency: defaultCurrency!,
    rateLimit: { perMinute: perMinute!, authPerMinute: authPerMinute! },
    logLevel: logLevel!,
    trustProxy,
  });
}

/** Names of the variables a service reads that are secrets (for redaction and for `.env.example`). */
export function secretVariableNames(): EnvVarName[] {
  return (Object.keys(ENV_VARS) as EnvVarName[]).filter((n) => ENV_VARS[n].secret);
}
