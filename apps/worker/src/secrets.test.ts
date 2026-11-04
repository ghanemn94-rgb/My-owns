// The worker SecretProvider twin (D-198; ADR-0052 §5; T-DG6-BE-J): its code equals the API file's below the header
// comment (ADR-0002 rule 5 twin, read as text: the worker imports no API code), the composition line registers env
// then file, and a resolved value never prints. Every value is synthetic.
import { readFileSync } from "node:fs";
import { secretBindingsOf } from "@mth/config";
import { describe, expect, it, vi } from "vitest";
import {
  createSecretProviderRegistry,
  registerBuiltInSecretProviders,
  type SecretUse,
  type SecretValue,
} from "./secrets.ts";

// F-DG6-181: the canary is bound (synthetic manifest) to organization ORGW's email channel at smtp.orgw.example:587.
const ORG = "00000000-0000-7000-8000-0000000000aa";
const USE: SecretUse = { consumer: "smtp", organizationId: ORG, host: { hostname: "smtp.orgw.example", port: 587 } };
const MANIFEST = secretBindingsOf([
  {
    provider: "env",
    name: "MTH_SECRET_BE_J_CANARY",
    consumer: "smtp",
    organization: "ORGW",
    hosts: [{ hostname: "smtp.orgw.example", port: 587 }],
  },
  {
    provider: "file",
    name: "x",
    consumer: "smtp",
    organization: "ORGW",
    hosts: [{ hostname: "smtp.orgw.example", port: null }],
  },
]);
const organizationCodeOf = async (id: string) => (id === ORG ? "ORGW" : null);

/** The source from the first import line on (the header comments of the two files differ by design). */
const body = (url: URL) => {
  const text = readFileSync(url, "utf8");
  return text.slice(text.search(/^import /m));
};

describe("worker SecretProvider twin (D-198)", () => {
  it("is the API platform/secrets.ts code, verbatim below the header", () => {
    expect(body(new URL("./secrets.ts", import.meta.url))).toBe(
      body(new URL("../../api/src/modules/platform/secrets.ts", import.meta.url)),
    );
  });

  it("the composition line registers env then file; a reference resolves and never prints its value", async () => {
    const registry = createSecretProviderRegistry({ bindings: () => MANIFEST, organizationCodeOf });
    registerBuiltInSecretProviders(registry, {
      secretsDir: null,
      env: { MTH_SECRET_BE_J_CANARY: "synthetic-canary-value" },
    });
    expect(registry.ids()).toEqual(["env", "file"]);
    const value = await registry.resolve({ provider: "env", name: "MTH_SECRET_BE_J_CANARY" }, USE);
    expect(value?.reveal()).toBe("synthetic-canary-value");
    expect(String(value)).toBe("[secret]");
    expect(JSON.stringify({ value })).toBe('{"value":"[secret]"}');
    await expect(registry.resolve({ provider: "file", name: "x" }, USE)).rejects.toThrow(/SECRETS_DIR is not set/);
  });

  it("F-DG6-181: an unbound use resolves undefined without asking the provider; the warn line holds no value", async () => {
    const canary: SecretValue = {
      reveal: () => "synthetic-canary-value",
      toString: (): "[secret]" => "[secret]",
      toJSON: (): "[secret]" => "[secret]",
    };
    const get = vi.fn(async (_name: string) => canary);
    const lines: unknown[] = [];
    const registry = createSecretProviderRegistry({
      bindings: () => MANIFEST,
      organizationCodeOf,
      warn: (l) => lines.push(l),
    });
    registry.register({ id: "env", get });
    const ref = { provider: "env", name: "MTH_SECRET_BE_J_CANARY" };
    const other = "00000000-0000-7000-8000-0000000000bb";
    expect(await registry.resolve(ref, { ...USE, organizationId: other })).toBeUndefined();
    expect(await registry.resolve(ref, { ...USE, host: { hostname: "attacker.example", port: 587 } })).toBeUndefined();
    expect(await registry.resolve(ref, { ...USE, host: { hostname: "smtp.orgw.example", port: 25 } })).toBeUndefined();
    expect(get).toHaveBeenCalledTimes(0);
    expect(lines).toHaveLength(3);
    expect(JSON.stringify(lines)).not.toContain("synthetic-canary-value");
    // @ts-expect-error F-DG6-181: there is no resolve without a use.
    void registry.resolve(ref).catch(() => undefined);
  });
});
