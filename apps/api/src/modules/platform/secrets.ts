// P6 (ADR-0052 §5; REQ-S16-030 "a secret-management interface"): the SecretProvider port, its registry (T-DG6-BE-A)
// and the two built-in providers (T-DG6-BE-E):
//  - `env` reads NAME or NAME_FILE exactly as ADR-0011 does (packages/config `readSecretVariable`); both set is a
//    configuration error that names the variable, never the value;
//  - `file` reads the file NAME under SECRETS_DIR (a container secret mount); unset SECRETS_DIR means not configured.
// Both are registered on the named server.ts line. Nothing in DG1–DG5 reads a secret through the registry, so with no
// new variable set the installation behaves exactly as DG5. Another provider (for example Mobily IT's vault) is
// registered at composition by an adapter IT supplies; the product ships none and claims no vault integration.
// A value never appears in a log line, an error message or a response: a SecretValue prints "[secret]" through
// String(), template literals and JSON.stringify (so pino and JSON responses); the value lives in a private field, which
// util.inspect (console) does not print either.
import { readFile, realpath } from "node:fs/promises";
import { join, sep } from "node:path";
import {
  activeSecretBindings,
  ConfigError,
  ENV_SECRET_PREFIX,
  readSecretVariable,
  secretBinding,
  secretRefInNamespace,
  type SecretBindingResult,
  type SecretBindings,
  type SecretConsumer,
  type SecretUseHost,
} from "@mth/config";

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

/**
 * F-DG6-181 (ADR-0052 amendment of 2026-11-04 §B, §E; D-209): what a resolve is for. The consumer kind, the setting's
 * organization (null for the installation settings storage and assistant; from the stored row, or on create from the
 * authorized target organization) and the host the secret is about to be sent to (null only for webhook signing and for
 * a connector without a network destination). There is no resolve without a use.
 */
export interface SecretUse {
  readonly consumer: SecretConsumer;
  readonly organizationId: string | null;
  readonly host: SecretUseHost | null;
}

/** The code of an organization (immutable in the product), or null when there is none; cached by the caller. */
export type OrganizationCodeOf = (organizationId: string) => Promise<string | null>;

/** The structured `warn` line of a refused resolve; it holds no value. */
export interface SecretRefusalLogLine {
  readonly event: "secret_ref.refused";
  readonly consumer: SecretConsumer;
  readonly organizationId: string | null;
  readonly provider: string;
  readonly name: string;
  readonly reason: Exclude<SecretBindingResult, "bound">;
}

export interface SecretProviderRegistryOptions {
  /** The binding manifest; default: the process's active one (`setSecretBindings`, set by the entry points). */
  readonly bindings?: () => SecretBindings;
  /** The organization code lookup; default: none, so no tenant use is bound (fail closed). */
  readonly organizationCodeOf?: OrganizationCodeOf;
  /** Where the refusal line goes; default: one JSON line through console.warn (redacted in the worker). */
  readonly warn?: (line: SecretRefusalLogLine) => void;
}

export interface SecretProviderRegistry {
  /** Adds a provider; a malformed or already registered id is a composition error. */
  register(provider: SecretProvider): void;
  provider(id: string): SecretProvider | undefined;
  /** The registered ids, in registration order. */
  ids(): readonly string[];
  /**
   * Resolves a reference for one use (F-DG6-181): outside the namespace, or not bound to this consumer kind, the
   * setting's organization and the destination host, it resolves undefined without asking the provider (one `warn`
   * line, no value). An unknown provider is a configuration error that names the provider, never a value.
   */
  resolve(ref: SecretRef, use: SecretUse): Promise<SecretValue | undefined>;
}

const defaultWarn = (line: SecretRefusalLogLine) => console.warn(JSON.stringify({ level: "warn", ...line }));

export function createSecretProviderRegistry(options: SecretProviderRegistryOptions = {}): SecretProviderRegistry {
  const providers = new Map<string, SecretProvider>();
  const bindings = options.bindings ?? activeSecretBindings;
  const organizationCodeOf: OrganizationCodeOf = options.organizationCodeOf ?? (() => Promise.resolve(null));
  const warn = options.warn ?? defaultWarn;
  async function binding(ref: SecretRef, use: SecretUse): Promise<SecretBindingResult> {
    if (!secretRefInNamespace(ref)) return "not_bound";
    let organizationCode: string | null = null;
    if (use.organizationId !== null) {
      organizationCode = await organizationCodeOf(use.organizationId);
      // A tenant use whose organization has no code can never match an installation (null) binding.
      if (organizationCode === null) return "not_bound";
    }
    return secretBinding(bindings(), ref, { consumer: use.consumer, organizationCode, host: use.host });
  }
  return {
    register(provider) {
      if (!PROVIDER_ID.test(provider.id)) throw new Error(`secret provider id "${provider.id}" is not valid`);
      if (providers.has(provider.id)) throw new Error(`secret provider "${provider.id}" is already registered`);
      providers.set(provider.id, provider);
    },
    provider: (id) => providers.get(id),
    ids: () => [...providers.keys()],
    async resolve(ref, use) {
      const answer = await binding(ref, use);
      if (answer !== "bound") {
        warn({
          event: "secret_ref.refused",
          consumer: use.consumer,
          organizationId: use.organizationId,
          provider: ref.provider,
          name: ref.name,
          reason: answer,
        });
        return undefined;
      }
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
 * The namespace of the built-in providers (F-DG6-120): `env` resolves only MTH_SECRET_<NAME>, `file` only a plain file
 * name inside SECRETS_DIR; a provider IT registers owns its namespace. F-DG6-181 moved the rule into @mth/config, where
 * the binding manifest's parser uses the same regexes; it is re-exported here for the consumers.
 */
export { ENV_SECRET_PREFIX, secretRefInNamespace };

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
