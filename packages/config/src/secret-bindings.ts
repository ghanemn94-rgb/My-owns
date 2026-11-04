// F-DG6-181 (REQ-S16-029 "never expose secrets"; REQ-S10-004; ADR-0052 §5 and its amendment of 2026-11-04, sections
// A-B; D-209; T-DG6-BE-Z2): the SecretRef binding manifest and its match rule, shared by the API and the worker (one
// module, not a twin, so the two processes cannot drift; ADR-0002 rule 5 holds because both import @mth/config).
//
//  - The namespace (F-DG6-120) says only what kind of name a reference may carry: `env` resolves only MTH_SECRET_<NAME>,
//    `file` only a plain file name. Its rule lives here so the manifest parser and both registries use the same regexes.
//  - The binding says which setting may use it. IT declares, in a read-only JSON manifest named by SECRET_BINDINGS_FILE
//    (names, scopes and hosts, never a value), each secret's one consumer kind, its one scope (an organization code, or
//    the installation for storage and assistant) and the hosts it may be sent to. No manifest: nothing is bound.
//  - `secretBinding` never asks a provider and never reads a variable or file, so its answer is no existence oracle.
import { readFileSync, statSync } from "node:fs";
import { z } from "zod";
import { ConfigError } from "./load.ts";

/** The variable naming the manifest (ADR-0052 amendment of 2026-11-04 §A). */
export const SECRET_BINDINGS_VARIABLE = "SECRET_BINDINGS_FILE" as const;
/** Rule A1: at most 1,000 bindings in a file of at most 1 MiB. */
export const MAX_SECRET_BINDINGS = 1000;
export const MAX_SECRET_BINDINGS_FILE_BYTES = 1024 * 1024;
/** Rule A5: 1 to 16 hosts for every consumer that sends its secret anywhere. */
export const MAX_SECRET_BINDING_HOSTS = 16;

/** Rule A3: the closed set of consumer kinds. A new kind needs an amendment of ADR-0052. */
export const SECRET_CONSUMERS = ["connector", "webhook_signing", "smtp", "storage", "assistant"] as const;
export type SecretConsumer = (typeof SECRET_CONSUMERS)[number];
/** The tenant kinds (scope: an organization code) and the installation kinds (scope: null). */
export const TENANT_SECRET_CONSUMERS: readonly SecretConsumer[] = ["connector", "webhook_signing", "smtp"];
/** The kinds whose secret is never sent anywhere, so the binding lists no hosts. */
export const HOSTLESS_SECRET_CONSUMERS: readonly SecretConsumer[] = ["webhook_signing"];

// ---------------------------------------------------------------------------------------------------------------------
// The namespace (F-DG6-120), moved here from platform/secrets.ts so the manifest, the API and the worker share it.

/** The prefix of every variable the `env` provider resolves. */
export const ENV_SECRET_PREFIX = "MTH_SECRET_" as const;
/** `env`: MTH_SECRET_<NAME> (A-Z 0-9 _, first a letter or digit, at most 128 characters); not ending in _FILE. */
export const ENV_SECRET_NAME = /^MTH_SECRET_[A-Z0-9][A-Z0-9_]{0,116}$/;
/** `file`: one plain file name inside SECRETS_DIR (no path, no "..", no dot first). */
export const FILE_SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
/** A secret provider id (ADR-0052 §5). */
export const SECRET_PROVIDER_ID = /^[a-z][a-z0-9_-]{0,31}$/;

/** A reference to a secret, stored in settings instead of the value (ADR-0052 §5). */
export interface SecretRefLike {
  readonly provider: string;
  readonly name: string;
}

/**
 * Whether a reference names a secret inside its provider's namespace (F-DG6-120): `env` only `MTH_SECRET_<NAME>`,
 * `file` only a plain file name directly inside SECRETS_DIR. A provider IT registers at composition owns its own
 * namespace. The answer depends on the name only, so it is no existence oracle.
 */
export function secretRefInNamespace(ref: SecretRefLike): boolean {
  if (ref.provider === "env") return ENV_SECRET_NAME.test(ref.name) && !ref.name.endsWith("_FILE");
  if (ref.provider === "file") return FILE_SECRET_NAME.test(ref.name);
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// The field errors of the write-time check (ADR-0052 amendment §D; p6-work-split §2 rule 17). The texts are exact.

export const SECRET_REF_NOT_BOUND_CODE = "validation.secret_ref_not_bound" as const;
export const SECRET_REF_NOT_BOUND_MESSAGE: string =
  "Name a secret IT bound to this setting. IT binds each secret to one kind of setting and one organization.";
export const SECRET_REF_HOST_NOT_BOUND_CODE = "validation.secret_ref_host_not_bound" as const;
export const SECRET_REF_HOST_NOT_BOUND_MESSAGE: string =
  "IT has not bound this setting's secret to this host. A secret is sent only to the hosts IT names for it.";

// ---------------------------------------------------------------------------------------------------------------------
// The manifest.

/** A host a binding allows: the canonical hostname and a port (null: any port of that host). */
export interface SecretBindingHost {
  readonly hostname: string;
  readonly port: number | null;
}

/** One binding: a secret, its one consumer kind, its one scope and (except webhook_signing) its hosts. */
export interface SecretBinding {
  readonly provider: string;
  readonly name: string;
  readonly consumer: SecretConsumer;
  /** An organization code for the tenant kinds; null (the installation) for storage and assistant. */
  readonly organization: string | null;
  /** null for webhook_signing (never sent); otherwise 1-16 hosts. */
  readonly hosts: readonly SecretBindingHost[] | null;
}

/** The loaded manifest: at most one binding per (provider, name). */
export interface SecretBindings {
  readonly size: number;
  get(provider: string, name: string): SecretBinding | undefined;
}

const keyOf = (provider: string, name: string) => `${provider}\u0000${name}`;

/** Builds a binding set from already validated bindings (the loader and the test setter's helpers). */
export function secretBindingsOf(bindings: readonly SecretBinding[]): SecretBindings {
  const map = new Map<string, SecretBinding>();
  for (const b of bindings) map.set(keyOf(b.provider, b.name), b);
  return Object.freeze({ size: map.size, get: (provider: string, name: string) => map.get(keyOf(provider, name)) });
}

/** The empty manifest: no reference is bound (rule A7, fail closed). */
export const EMPTY_SECRET_BINDINGS: SecretBindings = secretBindingsOf([]);

/** The organization code pattern (`organization.code`, rule A4). */
const ORGANIZATION_CODE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/;
/** A host entry: a lower-case DNS name (or punycode) or a bracketed IPv6 address, then an optional port. */
const HOST_ENTRY = /^(\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{1,5}))?$/;

/** Parses one manifest host entry, or null when it is not canonical (scheme, path, wildcard, upper case, bad port). */
export function parseSecretBindingHost(entry: string): SecretBindingHost | null {
  const m = HOST_ENTRY.exec(entry);
  if (m === null) return null;
  const host = m[1]!;
  let canonical: string;
  try {
    canonical = new URL(`https://${host}/`).hostname;
  } catch {
    return null;
  }
  if (canonical !== host) return null;
  if (m[2] === undefined) return { hostname: host, port: null };
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || String(port) !== m[2]) return null;
  return { hostname: host, port };
}

// The issue messages below are fixed texts: a ConfigError names the variable, the entry's index and the field, never
// content from the file (a host, a name or a code).
const M = {
  version: "must be 1",
  bindings: "must be an array of at most 1000 bindings",
  provider: "is not a valid provider id",
  name: "is outside the provider's namespace",
  consumer: "is not one of connector, webhook_signing, smtp, storage, assistant",
  orgTenant: "must be an organization code for this consumer",
  orgInstallation: "must be null for this consumer",
  hostsRequired: "must list 1 to 16 hosts for this consumer",
  hostsForbidden: "must be absent for webhook_signing",
  host: "is not a lower-case host or host:port without scheme, path or wildcard (port 1-65535)",
} as const;

const bindingSchema = z
  .strictObject({
    provider: z.string().regex(SECRET_PROVIDER_ID, M.provider),
    name: z.string(),
    consumer: z.enum(SECRET_CONSUMERS, M.consumer),
    organization: z.string().nullable(),
    hosts: z.array(z.string()).optional(),
  })
  .superRefine((b, ctx) => {
    if (!secretRefInNamespace({ provider: b.provider, name: b.name }) || b.name.length === 0)
      ctx.addIssue({ code: "custom", path: ["name"], message: M.name });
    const tenant = TENANT_SECRET_CONSUMERS.includes(b.consumer);
    if (tenant && (b.organization === null || !ORGANIZATION_CODE.test(b.organization)))
      ctx.addIssue({ code: "custom", path: ["organization"], message: M.orgTenant });
    if (!tenant && b.organization !== null)
      ctx.addIssue({ code: "custom", path: ["organization"], message: M.orgInstallation });
    if (HOSTLESS_SECRET_CONSUMERS.includes(b.consumer)) {
      if (b.hosts !== undefined) ctx.addIssue({ code: "custom", path: ["hosts"], message: M.hostsForbidden });
    } else if (b.hosts === undefined || b.hosts.length < 1 || b.hosts.length > MAX_SECRET_BINDING_HOSTS) {
      ctx.addIssue({ code: "custom", path: ["hosts"], message: M.hostsRequired });
    } else {
      b.hosts.forEach((h, i) => {
        if (parseSecretBindingHost(h) === null) ctx.addIssue({ code: "custom", path: ["hosts", i], message: M.host });
      });
    }
  });

const manifestSchema = z.strictObject({
  version: z.literal(1, M.version),
  bindings: z.array(bindingSchema, M.bindings).max(MAX_SECRET_BINDINGS, M.bindings),
});

/** `bindings[3].hosts[0]` from a zod path. */
function fieldOf(path: readonly PropertyKey[]): string {
  let out = "";
  for (const p of path) out += typeof p === "number" ? `[${p}]` : out === "" ? String(p) : `.${String(p)}`;
  return out === "" ? "the manifest" : out;
}

/** The fixed message of an issue: ours when we wrote it, a generic one by issue code otherwise (never file content). */
function messageOf(issue: z.core.$ZodIssue): string {
  const ours = Object.values(M) as string[];
  if (ours.includes(issue.message)) return issue.message;
  if (issue.code === "unrecognized_keys") return "has an unknown key";
  if (issue.code === "invalid_type") return "has the wrong type";
  return "is invalid";
}

/**
 * Parses and validates a manifest's text (rules A1-A6). Any violation throws a ConfigError naming
 * SECRET_BINDINGS_FILE, the entry's index and the field; the message never contains content from the file.
 */
export function parseSecretBindings(text: string): SecretBindings {
  const v = SECRET_BINDINGS_VARIABLE;
  if (Buffer.byteLength(text, "utf8") > MAX_SECRET_BINDINGS_FILE_BYTES)
    throw new ConfigError([`${v}: the manifest is larger than 1 MiB`]);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ConfigError([`${v}: the manifest is not valid JSON`]);
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const problems = [
      ...new Set(parsed.error.issues.map((issue) => `${v}: ${fieldOf(issue.path)} ${messageOf(issue)}`)),
    ];
    throw new ConfigError(problems);
  }
  const seen = new Map<string, number>();
  const out: SecretBinding[] = [];
  const problems: string[] = [];
  parsed.data.bindings.forEach((b, i) => {
    const key = keyOf(b.provider, b.name);
    const first = seen.get(key);
    if (first !== undefined) {
      problems.push(`${v}: bindings[${i}].name repeats the (provider, name) of bindings[${first}]; each appears once`);
      return;
    }
    seen.set(key, i);
    out.push(
      Object.freeze({
        provider: b.provider,
        name: b.name,
        consumer: b.consumer,
        organization: b.organization,
        hosts:
          b.hosts === undefined ? null : Object.freeze(b.hosts.map((h) => Object.freeze(parseSecretBindingHost(h)!))),
      }),
    );
  });
  if (problems.length > 0) throw new ConfigError(problems);
  return secretBindingsOf(out);
}

/**
 * Loads the manifest named by SECRET_BINDINGS_FILE (rule A7: unset or empty is the empty manifest, so nothing is
 * bound). An unreadable, oversized or invalid file throws a ConfigError naming the variable, never a path's content.
 */
export function loadSecretBindings(env: Readonly<Record<string, string | undefined>> = process.env): SecretBindings {
  const path = env[SECRET_BINDINGS_VARIABLE];
  if (path === undefined || path === "") return EMPTY_SECRET_BINDINGS;
  let text: string;
  try {
    if (statSync(path).size > MAX_SECRET_BINDINGS_FILE_BYTES)
      throw new ConfigError([`${SECRET_BINDINGS_VARIABLE}: the manifest is larger than 1 MiB`]);
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError([`${SECRET_BINDINGS_VARIABLE}: the manifest cannot be read`]);
  }
  return parseSecretBindings(text);
}

// ---------------------------------------------------------------------------------------------------------------------
// The match rule (§B).

/** The host a secret is about to be sent to: canonical hostname and the effective port. */
export interface SecretUseHost {
  readonly hostname: string;
  readonly port: number;
}

/** A use as the match rule sees it: the consumer kind, the setting's organization code and the destination host. */
export interface SecretBindingUse {
  readonly consumer: SecretConsumer;
  /** The code of the setting's organization; null for the installation settings (storage, assistant). */
  readonly organizationCode: string | null;
  /** null only for webhook_signing and for a connector without a network destination. */
  readonly host: SecretUseHost | null;
}

export type SecretBindingResult = "bound" | "not_bound" | "host_not_bound";

/** The canonical host of a destination given as hostname and port (SMTP), lower-cased as WHATWG URL does. */
export function secretUseHost(hostname: string, port: number): SecretUseHost {
  let canonical = hostname.toLowerCase();
  try {
    canonical = new URL(`https://${hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname}/`)
      .hostname;
  } catch {
    // An unparseable host matches no binding entry (all are canonical), so the lower-cased text is safe to keep.
  }
  return { hostname: canonical, port };
}

/** The canonical host and effective port of a URL (connector, assistant, S3 endpoint); null when it is not a URL. */
export function secretUseHostOfUrl(url: string | URL | null | undefined): SecretUseHost | null {
  if (url === null || url === undefined || url === "") return null;
  let u: URL;
  try {
    u = typeof url === "string" ? new URL(url) : url;
  } catch {
    return null;
  }
  const port = u.port !== "" ? Number(u.port) : u.protocol === "https:" ? 443 : u.protocol === "http:" ? 80 : 0;
  return { hostname: u.hostname, port };
}

/**
 * Whether `ref` is bound to `use` (§B): `not_bound` when it is outside its namespace, when no binding names it, or when
 * the binding's consumer kind or scope differs (null matches only null; codes compare exactly); `host_not_bound` when it
 * is bound but `use.host` matches none of its hosts (exact hostname, no suffix match; a port-less entry admits any
 * port). A use without a host (webhook signing; a connector without a destination) is `bound` once kind and scope
 * match. It never asks a provider.
 */
export function secretBinding(
  bindings: SecretBindings,
  ref: SecretRefLike,
  use: SecretBindingUse,
): SecretBindingResult {
  if (!secretRefInNamespace(ref)) return "not_bound";
  const b = bindings.get(ref.provider, ref.name);
  if (b === undefined) return "not_bound";
  if (b.consumer !== use.consumer) return "not_bound";
  if (b.organization !== use.organizationCode) return "not_bound";
  if (b.hosts === null || use.host === null) return "bound";
  const { hostname, port } = use.host;
  return b.hosts.some((h) => h.hostname === hostname && (h.port === null || h.port === port))
    ? "bound"
    : "host_not_bound";
}

// ---------------------------------------------------------------------------------------------------------------------
// The process's active manifest. The API and worker entry points set it from loadConfig (SECRET_BINDINGS_FILE) before
// building anything; tests set it with setSecretBindings. Until then nothing is bound (fail closed).

let active: SecretBindings = EMPTY_SECRET_BINDINGS;

/** Sets the process's binding manifest; returns the previous one (the composition line, and a test setter). */
export function setSecretBindings(bindings: SecretBindings): SecretBindings {
  const previous = active;
  active = bindings;
  return previous;
}

/** The process's binding manifest. */
export function activeSecretBindings(): SecretBindings {
  return active;
}
