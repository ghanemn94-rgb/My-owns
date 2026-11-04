// F-DG6-181 (T-DG6-BE-Z2; ADR-0052 amendment of 2026-11-04 §A; D-209): the test support for SecretRef bindings. A
// suite that names a real secret binds it the way IT would, through the same strict parser as SECRET_BINDINGS_FILE
// (names, scopes and hosts only, never a value), and restores the previous manifest afterwards. Fail closed is never
// weakened: a suite that binds nothing gets the empty manifest, so every reference is refused.
import { parseSecretBindings, setSecretBindings, type SecretBindings, type SecretConsumer } from "@mth/config";

/** One binding as the manifest states it (organization: a code for the tenant kinds; null for storage, assistant). */
export interface TestSecretBinding {
  readonly provider?: string;
  readonly name: string;
  readonly consumer: SecretConsumer;
  readonly organization: string | null;
  readonly hosts?: readonly string[];
}

/** The manifest JSON of `bindings` (for a SECRET_BINDINGS_FILE written by a stack launcher). */
export function secretBindingsManifest(bindings: readonly TestSecretBinding[]): string {
  return JSON.stringify({
    version: 1,
    bindings: bindings.map((b) => ({
      provider: b.provider ?? "env",
      name: b.name,
      consumer: b.consumer,
      organization: b.organization,
      ...(b.hosts !== undefined ? { hosts: [...b.hosts] } : {}),
    })),
  });
}

/** Parses `bindings` as a manifest (invalid: a ConfigError, as at start). */
export function testSecretBindings(bindings: readonly TestSecretBinding[]): SecretBindings {
  return parseSecretBindings(secretBindingsManifest(bindings));
}

/** Makes `bindings` the process's manifest; returns a function that restores the previous one. */
export function bindSecrets(bindings: readonly TestSecretBinding[]): () => void {
  const previous = setSecretBindings(testSecretBindings(bindings));
  return () => void setSecretBindings(previous);
}
