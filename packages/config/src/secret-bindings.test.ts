// F-DG6-181 (T-DG6-BE-Z2; ADR-0052 amendment of 2026-11-04 §A, §B; D-209): the SecretRef binding manifest's parser and
// its match rule. Every name, code and host is synthetic; the manifest holds no value.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigError } from "./load.ts";
import {
  EMPTY_SECRET_BINDINGS,
  loadSecretBindings,
  parseSecretBindings,
  SECRET_REF_HOST_NOT_BOUND_CODE,
  SECRET_REF_HOST_NOT_BOUND_MESSAGE,
  SECRET_REF_NOT_BOUND_CODE,
  SECRET_REF_NOT_BOUND_MESSAGE,
  secretBinding,
  secretUseHost,
  secretUseHostOfUrl,
  type SecretBindingUse,
} from "./secret-bindings.ts";

/** The valid example of ADR-0052's amendment §A (organization code ORGB). */
const EXAMPLE = {
  version: 1,
  bindings: [
    {
      provider: "env",
      name: "MTH_SECRET_ORGB_ERP_TOKEN",
      consumer: "connector",
      organization: "ORGB",
      hosts: ["erp.orgb.example"],
    },
    { provider: "env", name: "MTH_SECRET_ORGB_WEBHOOK_SIGNING", consumer: "webhook_signing", organization: "ORGB" },
    {
      provider: "env",
      name: "MTH_SECRET_ORGB_SMTP_PASSWORD",
      consumer: "smtp",
      organization: "ORGB",
      hosts: ["smtp.orgb.example:587"],
    },
    {
      provider: "file",
      name: "s3_secret_access_key",
      consumer: "storage",
      organization: null,
      hosts: ["objects.it.example"],
    },
    {
      provider: "env",
      name: "MTH_SECRET_ASSISTANT_KEY",
      consumer: "assistant",
      organization: null,
      hosts: ["llm.it.example"],
    },
  ],
};
const json = (v: unknown) => JSON.stringify(v);
const withBinding = (patch: Record<string, unknown>, drop: string[] = []) => {
  const b: Record<string, unknown> = { ...EXAMPLE.bindings[0]!, ...patch };
  for (const k of drop) delete b[k];
  return json({ version: 1, bindings: [EXAMPLE.bindings[1], b] });
};

/** The ConfigError's problems; fails when the parse succeeds. */
function problemsOf(text: string): string[] {
  try {
    parseSecretBindings(text);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return [...(error as ConfigError).problems];
  }
  throw new Error("the manifest parsed");
}

const dir = mkdtempSync(join(tmpdir(), "mth-z2-bindings-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("the binding manifest (§A)", () => {
  it("the ADR example parses; unset (or empty) is the empty manifest", () => {
    const parsed = parseSecretBindings(json(EXAMPLE));
    expect(parsed.size).toBe(5);
    expect(parsed.get("env", "MTH_SECRET_ORGB_SMTP_PASSWORD")).toEqual({
      provider: "env",
      name: "MTH_SECRET_ORGB_SMTP_PASSWORD",
      consumer: "smtp",
      organization: "ORGB",
      hosts: [{ hostname: "smtp.orgb.example", port: 587 }],
    });
    expect(parsed.get("env", "MTH_SECRET_ORGB_WEBHOOK_SIGNING")?.hosts).toBeNull();
    expect(loadSecretBindings({})).toBe(EMPTY_SECRET_BINDINGS);
    expect(loadSecretBindings({ SECRET_BINDINGS_FILE: "" })).toBe(EMPTY_SECRET_BINDINGS);
    const file = join(dir, "ok.json");
    writeFileSync(file, json(EXAMPLE));
    expect(loadSecretBindings({ SECRET_BINDINGS_FILE: file }).size).toBe(5);
  });

  it.each([
    ["an unknown key", withBinding({ value: "x" }), "bindings[1]"],
    ["version 2", json({ ...EXAMPLE, version: 2 }), "version"],
    ["an unknown consumer", withBinding({ consumer: "vault" }), "bindings[1].consumer"],
    [
      "storage with an organization",
      withBinding({ consumer: "storage", organization: "ORGB" }),
      "bindings[1].organization",
    ],
    ["connector with null", withBinding({ organization: null }), "bindings[1].organization"],
    ["connector without hosts", withBinding({}, ["hosts"]), "bindings[1].hosts"],
    ["webhook_signing with hosts", withBinding({ consumer: "webhook_signing" }), "bindings[1].hosts"],
    ["a host with a scheme", withBinding({ hosts: ["https://erp.orgb.example"] }), "bindings[1].hosts[0]"],
    ["a host with a path", withBinding({ hosts: ["erp.orgb.example/api"] }), "bindings[1].hosts[0]"],
    ["a wildcard host", withBinding({ hosts: ["*.orgb.example"] }), "bindings[1].hosts[0]"],
    ["an upper-case host", withBinding({ hosts: ["ERP.orgb.example"] }), "bindings[1].hosts[0]"],
    ["port 0", withBinding({ hosts: ["erp.orgb.example:0"] }), "bindings[1].hosts[0]"],
    ["port 70000", withBinding({ hosts: ["erp.orgb.example:70000"] }), "bindings[1].hosts[0]"],
    [
      "17 hosts",
      withBinding({ hosts: Array.from({ length: 17 }, (_, i) => `h${i}.orgb.example`) }),
      "bindings[1].hosts",
    ],
    ["the name DATABASE_URL", withBinding({ name: "DATABASE_URL" }), "bindings[1].name"],
    ["the name OIDC_CLIENT_SECRET", withBinding({ name: "OIDC_CLIENT_SECRET" }), "bindings[1].name"],
    [
      "a duplicate (provider, name)",
      json({ version: 1, bindings: [EXAMPLE.bindings[0], EXAMPLE.bindings[0]] }),
      "bindings[1].name",
    ],
    [
      "more than 1000 entries",
      json({
        version: 1,
        bindings: Array.from({ length: 1001 }, (_, i) => ({ ...EXAMPLE.bindings[1], name: `MTH_SECRET_S${i}` })),
      }),
      "bindings",
    ],
  ])("refuses %s, naming SECRET_BINDINGS_FILE, the entry and the field, never the file's content", (_, text, field) => {
    const problems = problemsOf(text);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.every((p) => p.startsWith("SECRET_BINDINGS_FILE: "))).toBe(true);
    expect(problems.some((p) => p.startsWith(`SECRET_BINDINGS_FILE: ${field} `))).toBe(true);
    const all = problems.join("\n");
    for (const leaked of ["orgb.example", "ORGB", "MTH_SECRET_ORGB", "DATABASE_URL", "OIDC_CLIENT_SECRET", "https://"])
      expect(all).not.toContain(leaked);
  });

  it("refuses a file over 1 MiB, an unreadable path and invalid JSON, naming the variable only", () => {
    const big = join(dir, "big.json");
    writeFileSync(big, " ".repeat(1024 * 1024 + 1));
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{ orgb.example");
    for (const [path, text] of [
      [big, "is larger than 1 MiB"],
      [join(dir, "missing.json"), "cannot be read"],
      [bad, "is not valid JSON"],
    ] as const) {
      let caught: unknown;
      try {
        loadSecretBindings({ SECRET_BINDINGS_FILE: path });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConfigError);
      expect((caught as ConfigError).message).toContain(`SECRET_BINDINGS_FILE: the manifest ${text}`);
      expect((caught as ConfigError).message).not.toContain(dir);
      expect((caught as ConfigError).message).not.toContain("orgb.example");
    }
  });
});

describe("the match rule (§B)", () => {
  const m = parseSecretBindings(json(EXAMPLE));
  const erp = { provider: "env", name: "MTH_SECRET_ORGB_ERP_TOKEN" };
  const signing = { provider: "env", name: "MTH_SECRET_ORGB_WEBHOOK_SIGNING" };
  const smtp = { provider: "env", name: "MTH_SECRET_ORGB_SMTP_PASSWORD" };
  const s3 = { provider: "file", name: "s3_secret_access_key" };
  const use = (
    consumer: SecretBindingUse["consumer"],
    organizationCode: string | null,
    host: string | null,
    port = 443,
  ): SecretBindingUse => ({ consumer, organizationCode, host: host === null ? null : secretUseHost(host, port) });

  it.each([
    ["own scope and host", erp, use("connector", "ORGB", "erp.orgb.example"), "bound"],
    ["another organization's code", erp, use("connector", "ORGA", "erp.orgb.example"), "not_bound"],
    ["another consumer", erp, use("smtp", "ORGB", "erp.orgb.example"), "not_bound"],
    ["a storage secret used as connector", s3, use("connector", "ORGB", "objects.it.example"), "not_bound"],
    ["a connector secret used as storage", erp, use("storage", null, "erp.orgb.example"), "not_bound"],
    [
      "B's webhook_signing secret used as A's connector",
      signing,
      use("connector", "ORGA", "erp.orgb.example"),
      "not_bound",
    ],
    [
      "an unknown name",
      { provider: "env", name: "MTH_SECRET_NOBODY" },
      use("connector", "ORGB", "erp.orgb.example"),
      "not_bound",
    ],
    [
      "a name outside the namespace",
      { provider: "env", name: "DATABASE_URL" },
      use("connector", "ORGB", null),
      "not_bound",
    ],
    ["an unlisted host", erp, use("connector", "ORGB", "collector.attacker.example"), "host_not_bound"],
    ["a subdomain (no suffix match)", erp, use("connector", "ORGB", "x.erp.orgb.example"), "host_not_bound"],
    ["an entry :587 with use port 25", smtp, use("smtp", "ORGB", "smtp.orgb.example", 25), "host_not_bound"],
    ["an entry :587 with use port 587", smtp, use("smtp", "ORGB", "smtp.orgb.example", 587), "bound"],
    ["a port-less entry with any port", erp, use("connector", "ORGB", "erp.orgb.example", 8443), "bound"],
    ["an upper-case use host (canonicalized)", erp, use("connector", "ORGB", "ERP.OrgB.Example"), "bound"],
    ["a null use host with webhook_signing", signing, use("webhook_signing", "ORGB", null), "bound"],
  ] as const)("%s -> %s", (_, ref, u, expected) => {
    expect(secretBinding(m, ref, u)).toBe(expected);
  });

  it("the empty manifest binds nothing (fail closed)", () => {
    expect(secretBinding(EMPTY_SECRET_BINDINGS, erp, use("connector", "ORGB", "erp.orgb.example"))).toBe("not_bound");
  });

  it("a URL's host and effective port", () => {
    expect(secretUseHostOfUrl("https://ERP.orgb.example/api")).toEqual({ hostname: "erp.orgb.example", port: 443 });
    expect(secretUseHostOfUrl("http://127.0.0.1:9000/b")).toEqual({ hostname: "127.0.0.1", port: 9000 });
    expect(secretUseHostOfUrl(null)).toBeNull();
    expect(secretUseHostOfUrl("not a url")).toBeNull();
  });

  it("the two field errors and their exact English texts (§D)", () => {
    expect(SECRET_REF_NOT_BOUND_CODE).toBe("validation.secret_ref_not_bound");
    expect(SECRET_REF_HOST_NOT_BOUND_CODE).toBe("validation.secret_ref_host_not_bound");
    expect(SECRET_REF_NOT_BOUND_MESSAGE).toBe(
      "Name a secret IT bound to this setting. IT binds each secret to one kind of setting and one organization.",
    );
    expect(SECRET_REF_HOST_NOT_BOUND_MESSAGE).toBe(
      "IT has not bound this setting's secret to this host. A secret is sent only to the hosts IT names for it.",
    );
  });
});
