// The built-in SecretProviders (T-DG6-BE-E; ADR-0052 §5; REQ-S16-030 "a secret-management interface"): a resolved value
// prints "[secret]" in String(), JSON.stringify, util.inspect and a pino log line; `env` reads NAME or NAME_FILE (both
// set is a configuration error naming the variable only); `file` reads a plain file name under SECRETS_DIR. Every value
// here is synthetic.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    const v = await envSecretProvider({ SMTP_PASSWORD: VALUE }).get("SMTP_PASSWORD");
    expect(v?.reveal()).toBe(VALUE);
    expect(String(v)).toBe("[secret]");
  });

  it("reads NAME_FILE, without one trailing newline", async () => {
    const file = join(dir, "env-file");
    writeFileSync(file, `${VALUE}\n`);
    const v = await envSecretProvider({ SMTP_PASSWORD_FILE: file }).get("SMTP_PASSWORD");
    expect(v?.reveal()).toBe(VALUE);
  });

  it("neither set (or empty) resolves undefined", async () => {
    expect(await envSecretProvider({}).get("SMTP_PASSWORD")).toBeUndefined();
    expect(await envSecretProvider({ SMTP_PASSWORD: "" }).get("SMTP_PASSWORD")).toBeUndefined();
  });

  it("NAME and NAME_FILE both set: a configuration error naming the variable only", async () => {
    const file = join(dir, "both");
    writeFileSync(file, VALUE);
    const message = await refusal(
      envSecretProvider({ SMTP_PASSWORD: VALUE, SMTP_PASSWORD_FILE: file }).get("SMTP_PASSWORD"),
    );
    expect(message).toContain("SMTP_PASSWORD and SMTP_PASSWORD_FILE are both set; set only one");
    expect(message).not.toContain(file);
  });

  it("an unreadable NAME_FILE names the variable, not the path or a value", async () => {
    const missing = join(dir, "does-not-exist");
    const message = await refusal(envSecretProvider({ SMTP_PASSWORD_FILE: missing }).get("SMTP_PASSWORD"));
    expect(message).toContain("SMTP_PASSWORD_FILE points to a file that cannot be read");
    expect(message).not.toContain(missing);
  });

  it("refuses a name that is not a variable name", async () => {
    expect(await refusal(envSecretProvider({}).get("smtp password"))).toContain("is not a variable name");
  });
});

describe("the file provider (SECRETS_DIR)", () => {
  it("reads a plain file name under the directory; a missing file resolves undefined", async () => {
    writeFileSync(join(dir, "connector-token"), `${VALUE}\n`);
    const provider = fileSecretProvider(dir);
    expect((await provider.get("connector-token"))?.reveal()).toBe(VALUE);
    expect(await provider.get("absent-token")).toBeUndefined();
  });

  it("refuses paths and dot names (no traversal out of SECRETS_DIR)", async () => {
    const provider = fileSecretProvider(dir);
    for (const name of ["../etc/passwd", "a/b", ".hidden", "..", ""]) {
      expect(await refusal(provider.get(name))).toContain("is not a plain file name");
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
    registerBuiltInSecretProviders(registry, { secretsDir: dir, env: { SMTP_PASSWORD: VALUE } });
    expect(registry.ids()).toEqual(["env", "file"]);
    expect((await registry.resolve({ provider: "env", name: "SMTP_PASSWORD" }))?.reveal()).toBe(VALUE);
    expect((await registry.resolve({ provider: "file", name: "smtp" }))?.reveal()).toBe(VALUE);
    expect(await refusal(registry.resolve({ provider: "vault", name: "SMTP_PASSWORD" }))).toBe(
      'secret provider "vault" is not registered',
    );
  });

  it("with no new variable set nothing is read: env with an empty environment resolves nothing", async () => {
    const registry = createSecretProviderRegistry();
    registerBuiltInSecretProviders(registry, { secretsDir: null, env: {} });
    expect(await registry.resolve({ provider: "env", name: "SMTP_PASSWORD" })).toBeUndefined();
  });
});
