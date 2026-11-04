// The SecretProvider registry (T-DG6-BE-A; ADR-0052 §5 wiring point). BE-E's providers and their tests are separate.
// F-DG6-181 (T-DG6-BE-Z2; ADR-0052 amendment of 2026-11-04 §E): every resolve names its use and is checked against the
// binding manifest first; an unbound reference resolves undefined and the provider is never asked. Values synthetic.
import { secretBindingsOf, type SecretBinding, type SecretBindings } from "@mth/config";
import { describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_SECRET_PROVIDER_IDS,
  createSecretProviderRegistry,
  type SecretProvider,
  type SecretRefusalLogLine,
  type SecretUse,
} from "./secrets.ts";

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

const ORG_A = "00000000-0000-7000-8000-00000000000a";
const ORG_B = "00000000-0000-7000-8000-00000000000b";
const codes = new Map<string, string>([
  [ORG_A, "ORGA"],
  [ORG_B, "ORGB"],
]);
const organizationCodeOf = async (id: string) => codes.get(id) ?? null;
const STORE: SecretUse = {
  consumer: "storage",
  organizationId: null,
  host: { hostname: "objects.it.example", port: 443 },
};
const bind = (...b: SecretBinding[]): (() => SecretBindings) => {
  const set = secretBindingsOf(b);
  return () => set;
};
const storageBinding = (name: string): SecretBinding => ({
  provider: "env",
  name,
  consumer: "storage",
  organization: null,
  hosts: [{ hostname: "objects.it.example", port: null }],
});

describe("SecretProvider registry (ADR-0052 §5)", () => {
  it("starts empty: no provider is registered until BE-E adds env and file", () => {
    expect(createSecretProviderRegistry().ids()).toEqual([]);
    expect([...BUILT_IN_SECRET_PROVIDER_IDS]).toEqual(["env", "file"]);
  });

  it("resolves a bound reference through its provider, in registration order, and never prints the value", async () => {
    const registry = createSecretProviderRegistry({
      bindings: bind(storageBinding("MTH_SECRET_SMTP_PASSWORD"), storageBinding("MTH_SECRET_MISSING")),
    });
    registry.register(fake("env", { MTH_SECRET_SMTP_PASSWORD: "synthetic-value" }));
    registry.register(fake("file", {}));
    expect(registry.ids()).toEqual(["env", "file"]);
    const secret = await registry.resolve({ provider: "env", name: "MTH_SECRET_SMTP_PASSWORD" }, STORE);
    expect(secret?.reveal()).toBe("synthetic-value");
    expect(String(secret)).toBe("[secret]");
    expect(JSON.stringify({ secret })).toBe('{"secret":"[secret]"}');
    expect(await registry.resolve({ provider: "env", name: "MTH_SECRET_MISSING" }, STORE)).toBeUndefined();
  });

  it("refuses a duplicate or malformed id, and an unknown provider names the provider only", async () => {
    const registry = createSecretProviderRegistry({
      bindings: bind({ ...storageBinding("X"), provider: "vault" }),
    });
    registry.register(fake("env", {}));
    expect(() => registry.register(fake("env", {}))).toThrow('secret provider "env" is already registered');
    expect(() => registry.register(fake("Env Vault", {}))).toThrow("is not valid");
    await expect(registry.resolve({ provider: "vault", name: "X" }, STORE)).rejects.toThrow(
      'secret provider "vault" is not registered',
    );
    expect(registry.provider("vault")).toBeUndefined();
  });

  it("there is no resolve without a use (the type has no such overload)", () => {
    const registry = createSecretProviderRegistry();
    // @ts-expect-error F-DG6-181: resolve(ref) without a use does not compile.
    void registry.resolve({ provider: "env", name: "MTH_SECRET_X" }).catch(() => undefined);
  });
});

describe("F-DG6-181: resolve is fail closed on the binding (ADR-0052 amendment of 2026-11-04 §E)", () => {
  const TOKEN = "synthetic-orgb-erp-token-z2-unit";
  const B_CONNECTOR: SecretBinding = {
    provider: "env",
    name: "MTH_SECRET_ORGB_ERP_TOKEN",
    consumer: "connector",
    organization: "ORGB",
    hosts: [{ hostname: "erp.orgb.example", port: null }],
  };
  const setup = (bindings: () => SecretBindings) => {
    const get = vi.fn(async (name: string) => (name === "MTH_SECRET_ORGB_ERP_TOKEN" ? value(TOKEN) : undefined));
    const lines: SecretRefusalLogLine[] = [];
    const registry = createSecretProviderRegistry({ bindings, organizationCodeOf, warn: (l) => lines.push(l) });
    registry.register({ id: "env", get });
    return { registry, get, lines };
  };
  const ref = { provider: "env", name: "MTH_SECRET_ORGB_ERP_TOKEN" };
  const use = (organizationId: string | null, hostname: string | null, consumer: SecretUse["consumer"] = "connector") =>
    ({ consumer, organizationId, host: hostname === null ? null : { hostname, port: 443 } }) as SecretUse;

  it("a bound reference returns the value", async () => {
    const { registry, get, lines } = setup(bind(B_CONNECTOR));
    expect((await registry.resolve(ref, use(ORG_B, "erp.orgb.example")))?.reveal()).toBe(TOKEN);
    expect(get).toHaveBeenCalledTimes(1);
    expect(lines).toEqual([]);
  });

  it.each([
    ["another organization", use(ORG_A, "erp.orgb.example"), "not_bound"],
    ["another consumer kind", use(ORG_B, "erp.orgb.example", "smtp"), "not_bound"],
    ["the installation (storage)", use(null, "erp.orgb.example", "storage"), "not_bound"],
    ["an organization without a code", use("00000000-0000-7000-8000-0000000000ff", "erp.orgb.example"), "not_bound"],
    ["an unlisted host", use(ORG_B, "collector.attacker.example"), "host_not_bound"],
  ] as const)(
    "%s: undefined, the provider's get is called 0 times, one warn line without a value",
    async (_, u, why) => {
      const { registry, get, lines } = setup(bind(B_CONNECTOR));
      expect(await registry.resolve(ref, u)).toBeUndefined();
      expect(get).toHaveBeenCalledTimes(0);
      expect(lines).toEqual([
        {
          event: "secret_ref.refused",
          consumer: u.consumer,
          organizationId: u.organizationId,
          provider: "env",
          name: "MTH_SECRET_ORGB_ERP_TOKEN",
          reason: why,
        },
      ]);
      expect(JSON.stringify(lines)).not.toContain(TOKEN);
    },
  );

  it("with no manifest nothing is bound, and the provider is never asked", async () => {
    const { registry, get } = setup(bind());
    expect(await registry.resolve(ref, use(ORG_B, "erp.orgb.example"))).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(0);
  });

  it("the default warn sink writes one JSON line without a value", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const registry = createSecretProviderRegistry({ bindings: bind(), organizationCodeOf });
      registry.register(fake("env", { MTH_SECRET_ORGB_ERP_TOKEN: TOKEN }));
      expect(await registry.resolve(ref, use(ORG_B, "erp.orgb.example"))).toBeUndefined();
      expect(spy).toHaveBeenCalledTimes(1);
      const line = String(spy.mock.calls[0]![0]);
      expect(JSON.parse(line)).toMatchObject({ level: "warn", event: "secret_ref.refused", reason: "not_bound" });
      expect(line).not.toContain(TOKEN);
    } finally {
      spy.mockRestore();
    }
  });
});
