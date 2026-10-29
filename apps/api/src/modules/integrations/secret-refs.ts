// Connector credentials as SecretRefs (ADR-0055 §1 "configured credentials", ADR-0052 §5; REQ-S17-001; T-DG6-BE-L).
//
// A connector configuration stores only references `{provider, name}`; never a value. This file
//   - checks the shape of the references a request sends (anything but exactly {provider, name} is a value the
//     server refuses: 422 connector.secret_value_refused, before any row is written);
//   - answers, for a response, whether each reference resolves NOW (`resolvable`), by asking the SecretProvider and
//     dropping the value at once (it is never kept, returned, logged or audited);
//   - resolves the references just before an adapter call, outside any transaction (§B/A.13 item 1).
//
// The SecretProvider registry is the process's (ADR-0052 §5, BE-E; server.ts creates it). It reaches this module
// through `setConnectorSecretProviders`, called on one composition line. Until that line runs, `resolvable` is null
// ("not checked", shown Unknown) and a call that needs a credential fails with connector.secret_unresolvable: the
// server never guesses that a secret exists.
import type { SecretProviderRegistry, SecretRef, SecretValue } from "../platform/index.ts";
import { ConnectorAdapterError } from "./adapters/port.ts";

/** The property names of the credential map and the reference patterns of the contract (SecretRef, 0104). */
export const CREDENTIAL_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const SECRET_PROVIDER = /^[a-z][a-z0-9_]{0,31}$/;
export const SECRET_NAME = /^[A-Za-z_][A-Za-z0-9_./-]{0,127}$/;
export const MAX_CREDENTIAL_REFS = 8;

/** The contract's CredentialRefView: the reference and whether it resolves (null: not checked). */
export interface CredentialRefView {
  readonly provider: string;
  readonly name: string;
  readonly resolvable: boolean | null;
}

let providers: SecretProviderRegistry | null = null;

/** The composition line (server.ts, after the built-in providers are registered) hands the registry over here. */
export function setConnectorSecretProviders(registry: SecretProviderRegistry | null): SecretProviderRegistry | null {
  const previous = providers;
  providers = registry;
  return previous;
}

/** Why a credential map is refused: "value" (a value or anything but a reference) or "shape" (names, count). */
export type CredentialRefsProblem = { readonly kind: "value"; readonly key: string } | { readonly kind: "shape" };

/**
 * Checks a request's credential map. Returns the references (in key order as sent) or the problem: a property whose
 * value is not exactly `{provider, name}` with two strings is a value ("value"); a bad property name, more than 8
 * references, or a provider or name outside its pattern is a shape problem ("shape").
 */
export function checkCredentialRefs(
  input: Readonly<Record<string, unknown>>,
): { ok: true; refs: Record<string, SecretRef> } | { ok: false; problem: CredentialRefsProblem } {
  const entries = Object.entries(input);
  for (const [key, value] of entries) {
    if (
      value === null ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "name,provider" ||
      typeof (value as { provider: unknown }).provider !== "string" ||
      typeof (value as { name: unknown }).name !== "string"
    )
      return { ok: false, problem: { kind: "value", key } };
  }
  if (entries.length > MAX_CREDENTIAL_REFS) return { ok: false, problem: { kind: "shape" } };
  const refs: [string, SecretRef][] = [];
  for (const [key, value] of entries) {
    const { provider, name } = value as SecretRef;
    if (!CREDENTIAL_NAME.test(key) || !SECRET_PROVIDER.test(provider) || !SECRET_NAME.test(name))
      return { ok: false, problem: { kind: "shape" } };
    refs.push([key, { provider, name }]);
  }
  return { ok: true, refs: Object.fromEntries(refs) };
}

/** Whether one reference resolves now; the value is dropped at once. Errors and unknown providers are `false`. */
async function resolvesNow(registry: SecretProviderRegistry, ref: SecretRef): Promise<boolean> {
  if (registry.provider(ref.provider) === undefined) return false;
  try {
    return (await registry.resolve(ref)) !== undefined;
  } catch {
    return false;
  }
}

/**
 * The response view of a stored credential map: `{provider, name, resolvable}` per reference, never a value. Called
 * outside any transaction (a provider may read a file or a vault).
 */
export async function credentialRefViews(stored: unknown): Promise<Record<string, CredentialRefView>> {
  const out: [string, CredentialRefView][] = [];
  const registry = providers;
  for (const [key, value] of Object.entries(storedRefs(stored))) {
    out.push([
      key,
      {
        provider: value.provider,
        name: value.name,
        resolvable: registry === null ? null : await resolvesNow(registry, value),
      },
    ]);
  }
  return Object.fromEntries(out);
}

/**
 * Resolves every reference of a stored credential map for one adapter call (outside any transaction). The first
 * reference that does not resolve fails the call with connector.secret_unresolvable naming the secret (its name, never
 * a value).
 */
export async function resolveCredentials(stored: unknown): Promise<Map<string, SecretValue>> {
  const resolved = new Map<string, SecretValue>();
  const registry = providers;
  for (const [key, ref] of Object.entries(storedRefs(stored))) {
    let value: SecretValue | undefined;
    if (registry !== null && registry.provider(ref.provider) !== undefined) {
      try {
        value = await registry.resolve(ref);
      } catch {
        value = undefined;
      }
    }
    if (value === undefined) throw new ConnectorAdapterError("connector.secret_unresolvable", { name: ref.name });
    resolved.set(key, value);
  }
  return resolved;
}

/** The stored jsonb map as references (the database CHECK p6_credential_refs_valid guarantees the shape). */
function storedRefs(stored: unknown): Record<string, SecretRef> {
  if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: [string, SecretRef][] = [];
  for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
    const v = value as Partial<SecretRef> | null;
    if (v && typeof v.provider === "string" && typeof v.name === "string")
      out.push([key, { provider: v.provider, name: v.name }]);
  }
  return Object.fromEntries(out);
}
