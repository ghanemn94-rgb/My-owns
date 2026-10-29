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
import { formatWithOptions } from "node:util";
import { z } from "zod";
import {
  AUTH_MODES,
  ENV_VARS,
  HEARTBEAT_INTERVAL_SECONDS,
  MTH_ENVS,
  SUPERVISE_INTERVAL_SECONDS,
  type EnvVarName,
} from "./index.ts";

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
  /** P6 (ADR-0052 §4): the per-minute budget of each rate-limit class, applied in addition to the global limit. */
  readonly rateLimitClasses: RateLimitClassBudgets;
  /** P6 (ADR-0052 §5): the directory of the built-in `file` SecretProvider, or null when unset. */
  readonly secretsDir: string | null;
  readonly logLevel: (typeof LOG_LEVELS)[number];
  readonly trustProxy: readonly string[];
  /**
   * The deployment's environment (ADR-0050 §1): MTH_ENV, else production when NODE_ENV=production, else NODE_ENV. Only
   * a database's own marker decides whether its data is synthetic; this value only refuses demo commands.
   */
  readonly mthEnv: (typeof MTH_ENVS)[number];
  /** The demo reset's admin URL (ADR-0050 §6), or null. A secret: never logged. */
  readonly demoAdminDatabaseUrl: string | null;
  /** Worker-only settings (F-DG4-128). Always present; defaulted when unset. */
  readonly worker: {
    readonly superviseIntervalSeconds: number;
    /** P6 (ADR-0053 §6; T-DG6-DO-D): the worker_heartbeat cadence, WORKER_HEARTBEAT_SECONDS (default 30). */
    readonly heartbeatSeconds: number;
  };
}

/** The rate-limit classes of ADR-0052 §4 that have their own budget (global and auth are `rateLimit`). */
export const RATE_LIMIT_CLASS_VARIABLES = {
  upload: "UPLOAD_RATE_LIMIT_PER_MINUTE",
  search: "SEARCH_RATE_LIMIT_PER_MINUTE",
  assistant: "ASSISTANT_RATE_LIMIT_PER_MINUTE",
  webhook: "WEBHOOK_RATE_LIMIT_PER_MINUTE",
  export: "EXPORT_RATE_LIMIT_PER_MINUTE",
} as const satisfies Record<string, EnvVarName>;
export type BudgetedRateLimitClass = keyof typeof RATE_LIMIT_CLASS_VARIABLES;
export type RateLimitClassBudgets = { readonly [K in BudgetedRateLimitClass]: number };

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

/**
 * ADR-0052 §5: the built-in `env` SecretProvider's read, exactly the ADR-0011 rule above: `NAME` or `NAME_FILE`
 * (never both), empty strings unset. Returns undefined when neither is set; throws a ConfigError that names the
 * variable, never the value, when both are set or the file cannot be read.
 */
export function readSecretVariable(name: string, env: Env = process.env): string | undefined {
  const problems: string[] = [];
  const value = readRaw(env, name as EnvVarName, problems);
  if (problems.length > 0) throw new ConfigError(problems);
  return value;
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
  const classBudgets = Object.fromEntries(
    Object.entries(RATE_LIMIT_CLASS_VARIABLES).map(([cls, name]) => [cls, field(name, positiveInt(1_000_000))]),
  ) as { [K in BudgetedRateLimitClass]: number | undefined };
  const secretsDir = field("SECRETS_DIR", z.string().min(1));
  const logLevel = field("LOG_LEVEL", z.enum(LOG_LEVELS));
  const superviseIntervalSeconds = field(
    "WORKER_SUPERVISE_INTERVAL_SECONDS",
    z.coerce.number().int().min(SUPERVISE_INTERVAL_SECONDS.min).max(SUPERVISE_INTERVAL_SECONDS.max),
  );
  const heartbeatSeconds = field(
    "WORKER_HEARTBEAT_SECONDS",
    z.coerce.number().int().min(HEARTBEAT_INTERVAL_SECONDS.min).max(HEARTBEAT_INTERVAL_SECONDS.max),
  );
  const mthEnvSet = field("MTH_ENV", z.enum(MTH_ENVS));
  const demoAdminDatabaseUrl = field(
    "MTH_DEMO_ADMIN_DATABASE_URL",
    z.string().refine(postgresUrl, "must be a postgres:// URL"),
  );
  // ADR-0050 §1: MTH_ENV defaults from NODE_ENV, so a production NODE_ENV never defaults into demo mode. An explicit
  // MTH_ENV=demo with NODE_ENV=production is a demo deployment running the production build, and is allowed.
  const mthEnv = mthEnvSet ?? (nodeEnv === "production" ? "production" : nodeEnv);
  const trustProxy = (raw.TRUST_PROXY ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // ADR-0005 §3 / F-DG1-112: the session cookie is Secure and __Host- prefixed only on an https origin, so production
  // fails closed on a plain-http APP_BASE_URL instead of silently issuing weaker cookies. The only exception is an
  // explicit loopback host (the local Compose stack), which no other machine's browser can reach.
  if (appBaseUrl && nodeEnv === "production" && !secureOriginAllowed(appBaseUrl, nodeEnv)) {
    problems.push(
      "APP_BASE_URL must use https when NODE_ENV=production (plain http is accepted only for a loopback host: " +
        "localhost, 127.0.0.1 or [::1])",
    );
  }

  // ADR-0005: the dev login must never be reachable in production.
  if (authMode === "dev" && nodeEnv === "production") {
    problems.push("AUTH_MODE=dev is refused when NODE_ENV=production");
  }

  // ADR-0058 §4 (T-DG6-DO-E): the synthetic load run measures the production code path only, so MTH_ENV=load needs
  // NODE_ENV=production and AUTH_MODE=oidc (the dev login stays refused; load sessions are minted by
  // deploy/load/sessions.mjs through the API's own createSession).
  if (mthEnvSet === "load" && nodeEnv !== undefined && nodeEnv !== "production") {
    problems.push("MTH_ENV=load needs NODE_ENV=production");
  }
  if (mthEnvSet === "load" && authMode !== undefined && authMode !== "oidc") {
    problems.push("MTH_ENV=load needs AUTH_MODE=oidc");
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
  // ADR-0053 §4 (T-DG6-DO-D): the secrets and the storage path just read join the process-wide log redaction set.
  registerConfigRedaction(env, storagePath);

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
    rateLimitClasses: Object.freeze({ ...classBudgets }) as RateLimitClassBudgets,
    secretsDir: secretsDir ?? null,
    logLevel: logLevel!,
    trustProxy,
    worker: { superviseIntervalSeconds: superviseIntervalSeconds!, heartbeatSeconds: heartbeatSeconds! },
    mthEnv: mthEnv!,
    demoAdminDatabaseUrl: demoAdminDatabaseUrl ?? null,
  });
}

// ------------------------------------------------------------------------------------------------ MTH_ENV=load
// ADR-0058 §4 (T-DG6-DO-E): the API and the worker refuse to start (EX_CONFIG) when MTH_ENV=load and the database has
// no load_dataset_marker row, and when MTH_ENV is production or demo and the database HAS one. So load sessions can
// never exist in a production database, and the synthetic load dataset never runs as production or demo.

/** The refusal when MTH_ENV=load and the database holds no load dataset (ADR-0058 §4, exact text). */
export const LOAD_ENV_NEEDS_MARKER = "MTH_ENV=load needs a database generated by deploy/load/generate.mjs.";
/** The refusal when MTH_ENV is production or demo and the database holds the load dataset (ADR-0058 §4, exact text). */
export const LOAD_MARKER_REFUSES_ENV =
  "This database holds the synthetic load dataset and cannot run as production or demo.";
export const LOAD_DATASET_REFUSALS = Object.freeze([LOAD_ENV_NEEDS_MARKER, LOAD_MARKER_REFUSES_ENV] as const);

/**
 * The start-up refusal for this environment and database, or null when the process may start. `hasLoadMarker` is
 * whether the database's load_dataset_marker table holds its row (`SELECT EXISTS (SELECT 1 FROM load_dataset_marker)`).
 * development and test are not refused either way (the harness's own databases).
 */
export function loadDatasetStartupRefusal(mthEnv: AppConfig["mthEnv"], hasLoadMarker: boolean): string | null {
  if (mthEnv === "load" && !hasLoadMarker) return LOAD_ENV_NEEDS_MARKER;
  if ((mthEnv === "production" || mthEnv === "demo") && hasLoadMarker) return LOAD_MARKER_REFUSES_ENV;
  return null;
}

/**
 * Reads the marker through `query` (the process's own database connection) and throws a ConfigError with the refusal
 * text when the process must not start. Entry points call it after connecting, before serving, and exit 78 (EX_CONFIG)
 * on a ConfigError as they do for every configuration problem.
 */
export async function assertLoadDatasetEnvironment(
  mthEnv: AppConfig["mthEnv"],
  query: (text: string) => Promise<{ rows: readonly { readonly present?: unknown }[] }>,
): Promise<void> {
  const { rows } = await query("SELECT EXISTS (SELECT 1 FROM load_dataset_marker) AS present");
  const refusal = loadDatasetStartupRefusal(mthEnv, rows[0]?.present === true);
  if (refusal !== null) throw new ConfigError([refusal]);
}

/** Names of the variables a service reads that are secrets (for redaction and for `.env.example`). */
export function secretVariableNames(): EnvVarName[] {
  return (Object.keys(ENV_VARS) as EnvVarName[]).filter((n) => ENV_VARS[n].secret);
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True for the loopback hosts a plain-http origin is tolerated on in production (local Compose stack only). */
export function isLoopbackHost(url: URL): boolean {
  return LOOPBACK_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * The application origin's cookie-security rule (ADR-0005 §3, F-DG1-112): outside production any http(s) origin is
 * fine; in production it must be https, or plain http on a loopback host. Used by the loader and, as defence in
 * depth, by the API's session setup.
 */
export function secureOriginAllowed(appBaseUrl: URL, nodeEnv: string): boolean {
  if (nodeEnv !== "production") return true;
  return appBaseUrl.protocol === "https:" || isLoopbackHost(appBaseUrl);
}

// ------------------------------------------------------------------------------------------------ log redaction
// P6 (ADR-0053 §4; REQ-S16-029 "never expose secrets or private evidence URLs … in logs"; T-DG6-DO-D). One
// process-wide redaction set, applied to every API log line (pino `hooks.streamWrite`, server.ts) and every worker
// console line (installConsoleRedaction, apps/worker/src/main.ts):
//   1. secrets: every value resolved through a SecretProvider (withSecretRedaction wraps the registry) and every
//      secret variable loadConfig reads (with the password of a postgres URL) is replaced by "[secret]";
//   2. storage: the fields storageKey, storage_key, key, Key, Bucket, bucket, endpoint and s3_* are censored by path
//      ("[redacted]", at any depth); a URL whose host is a registered object-store endpoint becomes "[storage-url]"; an
//      absolute path under EVIDENCE_STORAGE_PATH becomes "[storage-path]"; the X-Amz-Signature, X-Amz-Credential and
//      X-Amz-Security-Token query parameters are removed;
//   3. tokens: the deep-link token segment (/links/<token> -> /links/[token]) and the OIDC code, state, id_token,
//      access_token and refresh_token parameters; bearer tokens, JWTs, private-key blocks and AWS access-key ids too.
// The header paths (authorization, cookie, x-csrf-token, set-cookie, x-mth-signature) stay pino `redact` paths
// (REDACTED_LOG_PATHS). Request and response bodies are never logged.

export const SECRET_CENSOR = "[secret]";
export const PATH_CENSOR = "[redacted]";
export const STORAGE_URL_CENSOR = "[storage-url]";
export const STORAGE_PATH_CENSOR = "[storage-path]";

/** The pino `redact` paths of the API logger (ADR-0053 §4 item 3: the DG1 four plus the webhook signature). */
export const REDACTED_LOG_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  'req.headers["x-mth-signature"]',
];

/** The object keys censored by path at any depth (ADR-0053 §4 item 2), plus every key starting with `s3_`. */
export const REDACTED_LOG_KEYS: ReadonlySet<string> = new Set([
  "storageKey",
  "storage_key",
  "key",
  "Key",
  "Bucket",
  "bucket",
  "endpoint",
]);

/** A secret shorter than this is not registered: replacing a 1–3 character string would censor ordinary text. */
export const MIN_REDACTED_SECRET_LENGTH = 4;

const redactedSecrets = new Set<string>();
let secretsByLength: string[] = [];
const storageHosts = new Set<string>();
const storagePaths = new Set<string>();

function addSecretForm(value: string): void {
  if (value.length < MIN_REDACTED_SECRET_LENGTH || redactedSecrets.has(value)) return;
  redactedSecrets.add(value);
  secretsByLength = [...redactedSecrets].sort((a, b) => b.length - a.length);
}

/**
 * Registers a secret value: its occurrences in any later log line print "[secret]". The JSON-escaped and
 * percent-encoded forms are registered too, so the value is also found inside a serialized string or a URL.
 */
export function registerRedactedSecret(value: string): void {
  if (typeof value !== "string") return;
  addSecretForm(value);
  addSecretForm(JSON.stringify(value).slice(1, -1));
  addSecretForm(encodeURIComponent(value));
}

/** Registers an object-store endpoint (ADR-0054 §2): any URL on its host (and port) prints "[storage-url]". */
export function registerRedactedStorageEndpoint(endpoint: string | URL): void {
  let url: URL;
  try {
    url = typeof endpoint === "string" ? new URL(endpoint) : endpoint;
  } catch {
    return;
  }
  if (url.host !== "") storageHosts.add(url.host.toLowerCase());
}

/** Registers a private storage directory (EVIDENCE_STORAGE_PATH): any absolute path under it prints "[storage-path]". */
export function registerRedactedStoragePath(path: string): void {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed.startsWith("/") && trimmed.length > 1) storagePaths.add(trimmed);
}

/** Empties the redaction set (unit tests only; a running process never forgets a secret). */
export function clearLogRedactionForTests(): void {
  redactedSecrets.clear();
  secretsByLength = [];
  storageHosts.clear();
  storagePaths.clear();
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const TOKEN_RULES: readonly (readonly [RegExp, string])[] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, SECRET_CENSOR],
  [/\bAKIA[0-9A-Z]{16}\b/g, SECRET_CENSOR],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, `Bearer ${SECRET_CENSOR}`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]*)?/g, SECRET_CENSOR],
  [/\/links\/[A-Za-z0-9_-]{16,}/g, "/links/[token]"],
  [/([?&](?:code|state|id_token|access_token|refresh_token)=)[^&\s"'#\\]*/g, `$1${PATH_CENSOR}`],
];

/** Removes the X-Amz-Signature, X-Amz-Credential and X-Amz-Security-Token query parameters (ADR-0053 §4 item 2). */
function removeAmzParameters(text: string): string {
  if (!/X-Amz-/i.test(text)) return text;
  // Only inside the URL-like token that carries the parameter, so ordinary text around it is untouched.
  return text.replace(/[^\s"'<>\\]*X-Amz-[^\s"'<>\\]*/gi, (token) =>
    token
      .replace(/([?&])X-Amz-(?:Signature|Credential|Security-Token)=[^&#]*/gi, "$1")
      .replace(/([?&])&+/g, "$1")
      .replace(/[?&]+(?=$|#)/, ""),
  );
}

/** The text-level redaction of ADR-0053 §4 (secrets, storage URLs and paths, tokens). Idempotent. */
export function redactText(text: string): string {
  let out = text;
  for (const secret of secretsByLength) if (out.includes(secret)) out = out.split(secret).join(SECRET_CENSOR);
  for (const host of storageHosts)
    out = out.replace(
      new RegExp(`\\b[a-z][a-z0-9+.-]*://${escapeRegExp(host)}(?![A-Za-z0-9.-])[^\\s"'<>\\\\]*`, "gi"),
      STORAGE_URL_CENSOR,
    );
  for (const dir of storagePaths)
    out = out.replace(new RegExp(`${escapeRegExp(dir)}(?=[/"'\\s\\\\]|$)[^\\s"'<>\\\\]*`, "g"), STORAGE_PATH_CENSOR);
  out = removeAmzParameters(out);
  for (const [pattern, replacement] of TOKEN_RULES) out = out.replace(pattern, replacement);
  return out;
}

const isRedactedKey = (key: string): boolean => REDACTED_LOG_KEYS.has(key) || key.startsWith("s3_");

function censorKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(censorKeys);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = isRedactedKey(k) ? PATH_CENSOR : censorKeys(v);
  return out;
}

const REDACTED_KEY_IN_JSON = /"(?:storageKey|storage_key|key|Key|Bucket|bucket|endpoint|s3_[^"]*)"\s*:/;

/**
 * One log line, redacted: the censored keys by path (when the line is a JSON object that has one), then the text rules.
 * A line that is not JSON gets the text rules only. The trailing newline is kept.
 */
export function redactLogLine(line: string): string {
  let out = line;
  if (REDACTED_KEY_IN_JSON.test(out)) {
    const newline = out.endsWith("\n") ? "\n" : "";
    try {
      out = JSON.stringify(censorKeys(JSON.parse(out))) + newline;
    } catch {
      // Not one JSON document: the text rules below still apply.
    }
  }
  return redactText(out);
}

interface RedactableSecretValue {
  reveal(): string;
}
interface RedactableSecretProvider {
  readonly id: string;
  get(name: string): Promise<RedactableSecretValue | undefined>;
}

/**
 * ADR-0053 §4 item 1: wraps a SecretProvider registry (ADR-0052 §5) so every provider registered on it adds each value
 * it resolves to the redaction set before returning it. The registry object is returned (same identity).
 */
export function withSecretRedaction<R extends { register(provider: RedactableSecretProvider): void }>(registry: R): R {
  const register = registry.register.bind(registry);
  registry.register = (provider: RedactableSecretProvider) => {
    const wrapped: RedactableSecretProvider = Object.assign(Object.create(provider) as RedactableSecretProvider, {
      async get(name: string) {
        const value = await provider.get(name);
        if (value !== undefined) registerRedactedSecret(value.reveal());
        return value;
      },
    });
    register(wrapped);
  };
  return registry;
}

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

/** The worker's line sink (it logs through console): every console line is redacted before it is written. */
export function installConsoleRedaction(target: Pick<Console, ConsoleMethod> = console): void {
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => original(redactLogLine(formatWithOptions({ colors: false }, ...args)));
  }
}

/** Registers the secrets and the storage path loadConfig read (ADR-0053 §4 items 1 and 2). */
function registerConfigRedaction(env: Env, storagePath: string | undefined): void {
  for (const name of secretVariableNames()) {
    let value: string | undefined;
    try {
      value = readRaw(env, name, []);
    } catch {
      value = undefined;
    }
    if (value === undefined) continue;
    registerRedactedSecret(value);
    try {
      const url = new URL(value);
      if (url.password !== "") registerRedactedSecret(decodeURIComponent(url.password));
    } catch {
      // Not a URL: the whole value is registered above.
    }
  }
  if (storagePath !== undefined) registerRedactedStoragePath(storagePath);
}
