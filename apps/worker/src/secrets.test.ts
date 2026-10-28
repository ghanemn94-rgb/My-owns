// The worker SecretProvider twin (D-198; ADR-0052 §5; T-DG6-BE-J): its code equals the API file's below the header
// comment (ADR-0002 rule 5 twin, read as text: the worker imports no API code), the composition line registers env
// then file, and a resolved value never prints. Every value is synthetic.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSecretProviderRegistry, registerBuiltInSecretProviders } from "./secrets.ts";

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
    const registry = createSecretProviderRegistry();
    registerBuiltInSecretProviders(registry, { secretsDir: null, env: { MTH_BE_J_CANARY: "synthetic-canary-value" } });
    expect(registry.ids()).toEqual(["env", "file"]);
    const value = await registry.resolve({ provider: "env", name: "MTH_BE_J_CANARY" });
    expect(value?.reveal()).toBe("synthetic-canary-value");
    expect(String(value)).toBe("[secret]");
    expect(JSON.stringify({ value })).toBe('{"value":"[secret]"}');
    await expect(registry.resolve({ provider: "file", name: "x" })).rejects.toThrow(/SECRETS_DIR is not set/);
  });
});
