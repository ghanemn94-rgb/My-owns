// The built-in SecretProviders (T-DG6-BE-E; ADR-0052 §5; REQ-S16-030 "a secret-management interface"): a resolved value
// prints "[secret]" in String(), JSON.stringify, util.inspect and a pino log line; `env` reads NAME or NAME_FILE (both
// set is a configuration error naming the variable only); `file` reads a plain file name under SECRETS_DIR. F-DG6-120:
// `env` resolves only MTH_SECRET_<NAME> (never a platform variable such as OIDC_CLIENT_SECRET or DATABASE_URL), `file`
// only a plain file whose real path stays in a SECRETS_DIR that holds no platform secret file. Every value here is
// synthetic.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import {
  createSecretProviderRegistry,
  envSecretProvider,
  fileSecretProvider,
  registerBuiltInSecretProviders,
  SECRET_PLACEHOLDER,
  secretRefInNamespace,
  secretValue,
} from "./secrets.ts";

const VALUE = "synthetic-s3cr3t-value-7f2c";
const dir = mkdtempSync(join(tmpdir(), "mth-secrets-unit-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The message of a rejected promise (and proof that it never carries the value). */
async function refusal(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    const message = (error as Error).message;
    expect(message).not.toContain(VALUE);
    return message;
  }
  throw new Error("expected a refusal");
}

describe("SecretValue never prints its value", () => {
  const secret = secretValue(VALUE);

  it("String(), template literals and concatenation print [secret]; reveal() returns the value", () => {
    expect(SECRET_PLACEHOLDER).toBe("[secret]");
    expect(String(secret)).toBe("[secret]");
    expect(`${secret}`).toBe("[secret]");
    expect("x" + secret).toBe("x[secret]");
    expect(secret.reveal()).toBe(VALUE);
  });

  it("JSON.stringify prints [secret], also nested", () => {
    expect(JSON.stringify(secret)).toBe('"[secret]"');
    expect(JSON.stringify({ smtp: { password: secret } })).toBe('{"smtp":{"password":"[secret]"}}');
  });

  it("util.inspect (console.log) does not show the value", () => {
    expect(inspect(secret, { showHidden: true, depth: 10 })).not.toContain(VALUE);
    expect(inspect({ s: secret }, { showHidden: true, depth: 10 })).not.toContain(VALUE);
  });

  it("a pino log line (Fastify's logger) prints [secret] in a field and in the message", async () => {
    const lines: string[] = [];
    const stream = { write: (line: string) => void lines.push(line) };
    const app = Fastify({ logger: { level: "info", stream } });
    app.log.info({ credential: secret, nested: { token: secret } }, `resolved ${secret}`);
    await app.close();
    const line = lines.join("");
    expect(line).not.toContain(VALUE);
    const parsed = JSON.parse(lines[0]!) as { credential: string; nested: { token: string }; msg: string };
    expect(parsed.credential).toBe("[secret]");
    expect(parsed.nested.token).toBe("[secret]");
    expect(parsed.msg).toBe("resolved [secret]");
  });
});

describe("the env provider (ADR-0011 rule)", () => {
  it("reads NAME", async () => {
    const v = await envSecretProvider({ MTH_SECRET_SMTP_PASSWORD: VALUE }).get("MTH_SECRET_SMTP_PASSWORD");
    expect(v?.reveal()).toBe(VALUE);
    expect(String(v)).toBe("[secret]");
  });

  it("reads NAME_FILE, without one trailing newline", async () => {
    const file = join(dir, "env-file");
    writeFileSync(file, `${VALUE}\n`);
    const v = await envSecretProvider({ MTH_SECRET_SMTP_PASSWORD_FILE: file }).get("MTH_SECRET_SMTP_PASSWORD");
    expect(v?.reveal()).toBe(VALUE);
  });

  it("neither set (or empty) resolves undefined", async () => {
    expect(await envSecretProvider({}).get("MTH_SECRET_SMTP_PASSWORD")).toBeUndefined();
    expect(await envSecretProvider({ MTH_SECRET_SMTP_PASSWORD: "" }).get("MTH_SECRET_SMTP_PASSWORD")).toBeUndefined();
  });

  it("NAME and NAME_FILE both set: a configuration error naming the variable only", async () => {
    const file = join(dir, "both");
    writeFileSync(file, VALUE);
    const message = await refusal(
      envSecretProvider({ MTH_SECRET_SMTP_PASSWORD: VALUE, MTH_SECRET_SMTP_PASSWORD_FILE: file }).get(
        "MTH_SECRET_SMTP_PASSWORD",
      ),
    );
    expect(message).toContain("MTH_SECRET_SMTP_PASSWORD and MTH_SECRET_SMTP_PASSWORD_FILE are both set; set only one");
    expect(message).not.toContain(file);
  });

  it("an unreadable NAME_FILE names the variable, not the path or a value", async () => {
    const missing = join(dir, "does-not-exist");
    const message = await refusal(
      envSecretProvider({ MTH_SECRET_SMTP_PASSWORD_FILE: missing }).get("MTH_SECRET_SMTP_PASSWORD"),
    );
    expect(message).toContain("MTH_SECRET_SMTP_PASSWORD_FILE points to a file that cannot be read");
    expect(message).not.toContain(missing);
  });

  it("a name that is not a variable name resolves undefined (the same answer as an unset secret)", async () => {
    expect(await envSecretProvider({}).get("smtp password")).toBeUndefined();
  });

  // F-DG6-120: before the fix every upper-case variable of the process resolved, so a SecretRef could name the
  // platform's own secrets; these assertions failed (the value came back) on the round-1 candidate.
  it("never resolves a platform variable, even when it is set (F-DG6-120)", async () => {
    const platform = {
      OIDC_CLIENT_SECRET: VALUE,
      DATABASE_URL: VALUE,
      DATABASE_OWNER_URL: VALUE,
      MTH_DEMO_ADMIN_DATABASE_URL: VALUE,
      MTH_SECRETS_DIR: VALUE,
      SECRETS_DIR: VALUE,
      SMTP_PASSWORD: VALUE,
      MTH_SECRET_: VALUE,
      MTH_SECRET_X_FILE: VALUE,
      mth_secret_lower: VALUE,
    };
    const provider = envSecretProvider(platform);
    for (const name of Object.keys(platform)) expect(await provider.get(name)).toBeUndefined();
  });

  it("a platform variable's _FILE is not reachable through the namespace either", async () => {
    const file = join(dir, "platform-oidc");
    writeFileSync(file, VALUE);
    expect(await envSecretProvider({ OIDC_CLIENT_SECRET_FILE: file }).get("OIDC_CLIENT_SECRET")).toBeUndefined();
    expect(await envSecretProvider({ OIDC_CLIENT_SECRET_FILE: file }).get("OIDC_CLIENT_SECRET_FILE")).toBeUndefined();
  });
});

describe("the file provider (SECRETS_DIR)", () => {
  it("reads a plain file name under the directory; a missing file resolves undefined", async () => {
    writeFileSync(join(dir, "connector-token"), `${VALUE}\n`);
    const provider = fileSecretProvider(dir, {});
    expect((await provider.get("connector-token"))?.reveal()).toBe(VALUE);
    expect(await provider.get("absent-token")).toBeUndefined();
  });

  it("paths and dot names resolve nothing (no traversal out of SECRETS_DIR)", async () => {
    writeFileSync(join(dir, ".hidden"), VALUE);
    const provider = fileSecretProvider(dir, {});
    for (const name of ["../etc/passwd", "../../etc/passwd", "a/b", "/etc/passwd", ".hidden", "..", ".", "", "a\\b"]) {
      expect(await provider.get(name)).toBeUndefined();
    }
  });

  it("a symbolic link that leaves SECRETS_DIR resolves nothing (F-DG6-120)", async () => {
    const outside = mkdtempSync(join(tmpdir(), "mth-secrets-outside-"));
    try {
      writeFileSync(join(outside, "database_url"), VALUE);
      const linked = mkdtempSync(join(tmpdir(), "mth-secrets-linked-"));
      symlinkSync(join(outside, "database_url"), join(linked, "escape"));
      writeFileSync(join(linked, "inside"), VALUE);
      const provider = fileSecretProvider(linked, {});
      expect(await provider.get("escape")).toBeUndefined();
      expect((await provider.get("inside"))?.reveal()).toBe(VALUE);
      rmSync(linked, { recursive: true, force: true });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("a SECRETS_DIR that holds a platform secret file (e.g. /run/secrets) is a configuration error (F-DG6-120)", async () => {
    const shared = mkdtempSync(join(tmpdir(), "mth-secrets-shared-"));
    try {
      writeFileSync(join(shared, "oidc_client_secret"), VALUE);
      writeFileSync(join(shared, "connector-token"), VALUE);
      const env = { OIDC_CLIENT_SECRET_FILE: join(shared, "oidc_client_secret") };
      const provider = fileSecretProvider(shared, env);
      for (const name of ["oidc_client_secret", "connector-token"]) {
        const message = await refusal(provider.get(name));
        expect(message).toContain("SECRETS_DIR holds the platform secret file of OIDC_CLIENT_SECRET_FILE");
        expect(message).not.toContain(shared);
      }
      // A nested dedicated directory is fine; an MTH_SECRET_*_FILE inside it is not a platform file.
      const dedicated = join(shared, "settings");
      mkdirSync(dedicated);
      writeFileSync(join(dedicated, "connector-token"), VALUE);
      const nested = fileSecretProvider(dedicated, {
        ...env,
        MTH_SECRET_FEED_FILE: join(dedicated, "connector-token"),
      });
      expect((await nested.get("connector-token"))?.reveal()).toBe(VALUE);
    } finally {
      rmSync(shared, { recursive: true, force: true });
    }
  });

  it("without SECRETS_DIR it is a configuration error, never a silent empty value", async () => {
    expect(await refusal(fileSecretProvider(null).get("connector-token"))).toContain("SECRETS_DIR is not set");
  });
});

describe("registration (the server.ts line)", () => {
  it("registers env then file; a reference resolves through the registry", async () => {
    writeFileSync(join(dir, "smtp"), VALUE);
    const registry = createSecretProviderRegistry();
    registerBuiltInSecretProviders(registry, { secretsDir: dir, env: { MTH_SECRET_SMTP_PASSWORD: VALUE } });
    expect(registry.ids()).toEqual(["env", "file"]);
    expect((await registry.resolve({ provider: "env", name: "MTH_SECRET_SMTP_PASSWORD" }))?.reveal()).toBe(VALUE);
    expect((await registry.resolve({ provider: "file", name: "smtp" }))?.reveal()).toBe(VALUE);
    expect(await refusal(registry.resolve({ provider: "vault", name: "SMTP_PASSWORD" }))).toBe(
      'secret provider "vault" is not registered',
    );
  });

  it("with no new variable set nothing is read: env with an empty environment resolves nothing", async () => {
    const registry = createSecretProviderRegistry();
    registerBuiltInSecretProviders(registry, { secretsDir: null, env: {} });
    expect(await registry.resolve({ provider: "env", name: "MTH_SECRET_SMTP_PASSWORD" })).toBeUndefined();
  });
});

describe("the SecretRef namespace (F-DG6-120; write time and resolve time share it)", () => {
  it.each([
    ["env", "MTH_SECRET_SMTP_PASSWORD", true],
    ["env", "MTH_SECRET_1", true],
    ["env", `MTH_SECRET_${"A".repeat(117)}`, true],
    ["env", `MTH_SECRET_${"A".repeat(118)}`, false],
    ["env", "OIDC_CLIENT_SECRET", false],
    ["env", "DATABASE_URL", false],
    ["env", "DATABASE_OWNER_URL", false],
    ["env", "MTH_DEMO_ADMIN_DATABASE_URL", false],
    ["env", "MTH_SECRETS_DIR", false],
    ["env", "MTH_SECRET_", false],
    ["env", "MTH_SECRET__X", false],
    ["env", "MTH_SECRET_TOKEN_FILE", false],
    ["env", "mth_secret_token", false],
    ["file", "connector-token", true],
    ["file", "smtp.password", true],
    ["file", "../database_url", false],
    ["file", "a/b", false],
    ["file", ".env", false],
    ["file", "..", false],
    ["vault", "kv/connectors/feed", true],
  ] as const)("%s %s -> %s", (provider, name, expected) => {
    expect(secretRefInNamespace({ provider, name })).toBe(expected);
  });
});
