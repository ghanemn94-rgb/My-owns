// The worker twin of apps/api/src/modules/platform/secrets.ts (ADR-0052 §5; REQ-S16-030 "a secret-management
// interface"; D-198; T-DG6-BE-J): the SecretProvider port, its registry and the two built-in providers (`env`, `file`).
// ADR-0002 rule 5: the worker imports no API code, so the code below this header is a verbatim copy of the API file's;
// secrets.test.ts fails on any difference. main.ts registers the built-in providers at start (the ADR-0052 §5 worker
// composition line). No worker job resolves a secret yet; with no new variable set the worker behaves exactly as DG5.
// A value never appears in a log line, an error message or a job error: a SecretValue prints "[secret]".
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import { ConfigError, readSecretVariable } from "@mth/config";

/** A reference to a secret, stored in settings instead of the value (ADR-0052 §5). */
export interface SecretRef {
  readonly provider: string;
  readonly name: string;
}

/** A resolved secret. Printing or serializing it yields the placeholder, never the value. */
export interface SecretValue {
  reveal(): string;
  toString(): "[secret]";
  toJSON(): "[secret]";
}

export interface SecretProvider {
  /** "env" (default), "file"; IT may register another. */
  readonly id: string;
  /** Never logs, never throws with the value in the message. */
  get(name: string): Promise<SecretValue | undefined>;
}

/** The provider ids ADR-0052 §5 names as built in (registered by BE-E). */
export const BUILT_IN_SECRET_PROVIDER_IDS = ["env", "file"] as const;

const PROVIDER_ID = /^[a-z][a-z0-9_-]{0,31}$/;

export interface SecretProviderRegistry {
  /** Adds a provider; a malformed or already registered id is a composition error. */
  register(provider: SecretProvider): void;
  provider(id: string): SecretProvider | undefined;
  /** The registered ids, in registration order. */
  ids(): readonly string[];
  /** Resolves a reference; an unknown provider is a configuration error that names the provider, never a value. */
  resolve(ref: SecretRef): Promise<SecretValue | undefined>;
}

export function createSecretProviderRegistry(): SecretProviderRegistry {
  const providers = new Map<string, SecretProvider>();
  return {
    register(provider) {
      if (!PROVIDER_ID.test(provider.id)) throw new Error(`secret provider id "${provider.id}" is not valid`);
      if (providers.has(provider.id)) throw new Error(`secret provider "${provider.id}" is already registered`);
      providers.set(provider.id, provider);
    },
    provider: (id) => providers.get(id),
    ids: () => [...providers.keys()],
    async resolve(ref) {
      const provider = providers.get(ref.provider);
      if (provider === undefined) throw new Error(`secret provider "${ref.provider}" is not registered`);
      return provider.get(ref.name);
    },
  };
}

/** The placeholder every SecretValue prints instead of its value (ADR-0052 §5). */
export const SECRET_PLACEHOLDER = "[secret]" as const;

class ResolvedSecret implements SecretValue {
  readonly #value: string;
  constructor(value: string) {
    this.#value = value;
  }
  reveal(): string {
    return this.#value;
  }
  toString(): "[secret]" {
    return SECRET_PLACEHOLDER;
  }
  toJSON(): "[secret]" {
    return SECRET_PLACEHOLDER;
  }
}

/** Wraps a resolved value; only `reveal()` returns it. */
export function secretValue(value: string): SecretValue {
  return new ResolvedSecret(value);
}

/**
 * The namespace of the built-in `env` provider (F-DG6-120): a SecretRef names only a variable `MTH_SECRET_<NAME>`
 * (NAME: `A-Z 0-9 _`, first character a letter or digit, not ending in `_FILE`; 128 characters at most). IT provisions
 * the secrets of connectors, notification channels, storage, the assistant and webhooks under it. Every other variable
 * of the process (DATABASE_URL, DATABASE_OWNER_URL, OIDC_CLIENT_SECRET, ...) is the platform's own and can never be
 * named. `MTH_SECRET_<NAME>_FILE` is still read (the ADR-0011 rule), but a name cannot end in `_FILE` itself.
 */
export const ENV_SECRET_PREFIX = "MTH_SECRET_" as const;
const ENV_SECRET_NAME = /^MTH_SECRET_[A-Z0-9][A-Z0-9_]{0,116}$/;
/** A secret name the `file` provider accepts: one plain file name inside SECRETS_DIR (no path, no "..", no dot first). */
const FILE_SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * Whether a reference names a secret inside its provider's namespace (F-DG6-120): `env` only `MTH_SECRET_<NAME>`,
 * `file` only a plain file name directly inside SECRETS_DIR. A provider IT registers at composition owns its own
 * namespace. Every SecretRef consumer refuses a reference outside it at write time (400 validation), and the two
 * built-in providers resolve nothing outside it (the same answer as an unset secret, so no name is an oracle).
 */
export function secretRefInNamespace(ref: SecretRef): boolean {
  if (ref.provider === "env") return ENV_SECRET_NAME.test(ref.name) && !ref.name.endsWith("_FILE");
  if (ref.provider === "file") return FILE_SECRET_NAME.test(ref.name);
  return true;
}

/** The validation error code and message every consumer answers for a reference outside the namespace (400). */
export const SECRET_REF_NAMESPACE_CODE = "validation.secret_ref_namespace" as const;
export const SECRET_REF_NAMESPACE_MESSAGE: string =
  "Name a secret IT provisioned for this setting: for the env provider a variable MTH_SECRET_<NAME>, for the file " +
  "provider a plain file name in the secrets directory.";

/** A refusal of a provider: it names the provider and the secret name, never a value. */
export class SecretProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretProviderError";
  }
}

/**
 * The built-in `env` provider: NAME or NAME_FILE of `env` (default process.env), the ADR-0011 rule, for a NAME inside
 * the namespace only (`secretRefInNamespace`); any other name resolves undefined, exactly as an unset one. Both set,
 * or an unreadable NAME_FILE, is a ConfigError naming the variable only.
 */
export function envSecretProvider(env: Readonly<Record<string, string | undefined>> = process.env): SecretProvider {
  return {
    id: "env",
    get(name) {
      if (!secretRefInNamespace({ provider: "env", name })) return Promise.resolve(undefined);
      try {
        const value = readSecretVariable(name, env);
        return Promise.resolve(value === undefined ? undefined : secretValue(value));
      } catch (error) {
        // readSecretVariable's ConfigError already names only the variable; anything else is replaced by a generic one.
        return Promise.reject(error instanceof ConfigError ? error : new ConfigError([`${name} cannot be read`]));
      }
    },
  };
}

/** The real path of `path`, or null when it does not exist or cannot be read. */
async function realPathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch {
    return null;
  }
}

/** Whether `path` is `dir` or lies below it (both real paths). */
const within = (dir: string, path: string) => path === dir || path.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/**
 * The built-in `file` provider: the file `name` directly inside `dir` (SECRETS_DIR), one trailing newline removed as
 * ADR-0011's NAME_FILE does. A missing file resolves undefined; no `dir` is a configuration error. F-DG6-120: a name
 * outside the namespace resolves undefined; a file whose real path leaves `dir` (a symbolic link out) resolves
 * undefined; and a `dir` that holds a platform secret file (the target of any `<VARIABLE>_FILE` of `env` other than
 * `MTH_SECRET_*_FILE`, for example /run/secrets with database_url) is a configuration error: SECRETS_DIR must be a
 * directory dedicated to the secrets IT provisions for settings.
 */
export function fileSecretProvider(
  dir: string | null,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SecretProvider {
  return {
    id: "file",
    async get(name) {
      if (dir === null) throw new ConfigError([`SECRETS_DIR is not set; the file secret provider cannot read ${name}`]);
      if (!secretRefInNamespace({ provider: "file", name })) return undefined;
      const realDir = await realPathOrNull(dir);
      if (realDir === null) return undefined;
      for (const [variable, target] of Object.entries(env)) {
        if (!variable.endsWith("_FILE") || variable.startsWith(ENV_SECRET_PREFIX) || !target) continue;
        const realTarget = await realPathOrNull(target);
        if (realTarget !== null && within(realDir, realTarget))
          throw new ConfigError([
            `SECRETS_DIR holds the platform secret file of ${variable}; the file secret provider needs a dedicated directory`,
          ]);
      }
      const realFile = await realPathOrNull(join(dir, name));
      if (realFile === null) return undefined;
      if (!within(realDir, realFile) || realFile === realDir) return undefined;
      let content: string;
      try {
        content = await readFile(realFile, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new ConfigError([`the secret file ${name} under SECRETS_DIR cannot be read`]);
      }
      return secretValue(content.replace(/\r?\n$/, ""));
    },
  };
}

/** Registers the two built-in providers of ADR-0052 §5 (the server.ts and worker composition line). */
export function registerBuiltInSecretProviders(
  registry: SecretProviderRegistry,
  options: { readonly secretsDir: string | null; readonly env?: Readonly<Record<string, string | undefined>> },
): void {
  registry.register(envSecretProvider(options.env ?? process.env));
  registry.register(fileSecretProvider(options.secretsDir, options.env ?? process.env));
}
