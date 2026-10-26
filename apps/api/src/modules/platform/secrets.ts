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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

/** A secret name the `env` provider accepts: an environment variable name (ADR-0011 naming). */
const ENV_SECRET_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
/** A secret name the `file` provider accepts: one plain file name inside SECRETS_DIR (no path, no "..", no dot first). */
const FILE_SECRET_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** A refusal of a provider: it names the provider and the secret name, never a value. */
export class SecretProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretProviderError";
  }
}

/**
 * The built-in `env` provider: NAME or NAME_FILE of `env` (default process.env), the ADR-0011 rule. Both set, or an
 * unreadable NAME_FILE, is a ConfigError naming the variable only.
 */
export function envSecretProvider(env: Readonly<Record<string, string | undefined>> = process.env): SecretProvider {
  return {
    id: "env",
    get(name) {
      if (!ENV_SECRET_NAME.test(name))
        return Promise.reject(new SecretProviderError(`secret provider "env": "${name}" is not a variable name`));
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

/**
 * The built-in `file` provider: the file `name` directly inside `dir` (SECRETS_DIR), one trailing newline removed as
 * ADR-0011's NAME_FILE does. A missing file resolves undefined; no `dir` is a configuration error.
 */
export function fileSecretProvider(dir: string | null): SecretProvider {
  return {
    id: "file",
    async get(name) {
      if (dir === null) throw new ConfigError([`SECRETS_DIR is not set; the file secret provider cannot read ${name}`]);
      if (!FILE_SECRET_NAME.test(name))
        throw new SecretProviderError(`secret provider "file": "${name}" is not a plain file name`);
      let content: string;
      try {
        content = await readFile(join(dir, name), "utf8");
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
  registry.register(fileSecretProvider(options.secretsDir));
}
