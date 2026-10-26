// The SecretProvider registry (T-DG6-BE-A; ADR-0052 §5 wiring point). BE-E's providers and their tests are separate.
import { describe, expect, it } from "vitest";
import { BUILT_IN_SECRET_PROVIDER_IDS, createSecretProviderRegistry, type SecretProvider } from "./secrets.ts";

const value = (v: string) => ({
  reveal: () => v,
  toString: () => "[secret]" as const,
  toJSON: () => "[secret]" as const,
});
const fake = (id: string, entries: Record<string, string>): SecretProvider => {
  const values = new Map(Object.entries(entries));
  return {
    id,
    get: async (name) => {
      const v = values.get(name);
      return v === undefined ? undefined : value(v);
    },
  };
};

describe("SecretProvider registry (ADR-0052 §5)", () => {
  it("starts empty: no provider is registered until BE-E adds env and file", () => {
    expect(createSecretProviderRegistry().ids()).toEqual([]);
    expect([...BUILT_IN_SECRET_PROVIDER_IDS]).toEqual(["env", "file"]);
  });

  it("resolves a reference through its provider, in registration order, and never prints the value", async () => {
    const registry = createSecretProviderRegistry();
    registry.register(fake("env", { SMTP_PASSWORD: "synthetic-value" }));
    registry.register(fake("file", {}));
    expect(registry.ids()).toEqual(["env", "file"]);
    const secret = await registry.resolve({ provider: "env", name: "SMTP_PASSWORD" });
    expect(secret?.reveal()).toBe("synthetic-value");
    expect(String(secret)).toBe("[secret]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[secret]"}');
    expect(await registry.resolve({ provider: "file", name: "MISSING" })).toBeUndefined();
  });

  it("refuses a duplicate or malformed id, and an unknown provider names the provider only", async () => {
    const registry = createSecretProviderRegistry();
    registry.register(fake("env", {}));
    expect(() => registry.register(fake("env", {}))).toThrow('secret provider "env" is already registered');
    expect(() => registry.register(fake("Env Vault", {}))).toThrow("is not valid");
    await expect(registry.resolve({ provider: "vault", name: "X" })).rejects.toThrow(
      'secret provider "vault" is not registered',
    );
    expect(registry.provider("vault")).toBeUndefined();
  });
});
