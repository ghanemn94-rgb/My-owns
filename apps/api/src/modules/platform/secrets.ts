// P6 (T-DG6-BE-A; p6-plan §5.1, p6-work-split §E/F.1): the SecretProvider port and its registry, the wiring point of
// ADR-0052 §5 (REQ-S16-030 "a secret-management interface"). Owned and filled by task BE-E from here on: the built-in
// providers `env` (NAME or NAME_FILE, exactly as ADR-0011) and `file` (under SECRETS_DIR), their lines in
// packages/config/src/load.ts, and their registration on the named server.ts line. BE-A ships only the port and the
// registry, so no provider exists yet and nothing reads a secret through it; the installation behaves exactly as DG5.
// Another provider (for example Mobily IT's vault) is registered at composition by an adapter IT supplies; the product
// ships none and claims no vault integration. A value never appears in a log line, an error message or a response.

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
