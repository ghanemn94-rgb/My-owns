// ADR-0053 §4 (REQ-S16-029; T-DG6-DO-D): one test per redaction class. Every value below is SYNTHETIC; the
// "secrets" are canary strings built at run time, never a real credential.
import { afterEach, describe, expect, it } from "vitest";
import {
  clearLogRedactionForTests,
  installConsoleRedaction,
  loadConfig,
  redactLogLine,
  redactText,
  registerRedactedSecret,
  registerRedactedStorageEndpoint,
  registerRedactedStoragePath,
  withSecretRedaction,
} from "./index.ts";

const canary = (name: string) => `mth-canary-${name}-${"x".repeat(12)}`;
const line = (obj: object) => `${JSON.stringify(obj)}\n`;

afterEach(() => clearLogRedactionForTests());

describe("ADR-0053 §4 item 1: secrets resolved through a SecretProvider or read by loadConfig", () => {
  it("a registered secret is censored in msg, in nested values, JSON-escaped and percent-encoded", () => {
    const secret = `${canary("smtp")}"/&?`;
    registerRedactedSecret(secret);
    const out = redactLogLine(
      line({
        level: 30,
        msg: `connect failed with ${secret}`,
        err: { detail: [secret] },
        url: `x?p=${encodeURIComponent(secret)}`,
      }),
    );
    expect(out).not.toContain("mth-canary-smtp");
    expect(out.match(/\[secret\]/g)).toHaveLength(3);
    expect(out.endsWith("\n")).toBe(true);
  });

  it("a secret shorter than 4 characters is not registered (it would censor ordinary text)", () => {
    registerRedactedSecret("abc");
    expect(redactText("abcdef")).toBe("abcdef");
  });

  it("withSecretRedaction: a value a provider resolves is censored afterwards; the registry keeps its identity", async () => {
    const secret = canary("s3-secret-key");
    const providers: { id: string; get(n: string): Promise<{ reveal(): string } | undefined> }[] = [];
    const registry = { register: (p: (typeof providers)[number]) => void providers.push(p) };
    const same = withSecretRedaction(registry);
    expect(same).toBe(registry);
    same.register({
      id: "env",
      get: (n) => Promise.resolve(n === "S3_SECRET_ACCESS_KEY" ? { reveal: () => secret } : undefined),
    });
    expect(providers[0]!.id).toBe("env");
    expect(redactText(secret)).toBe(secret); // not yet resolved
    expect((await providers[0]!.get("S3_SECRET_ACCESS_KEY"))!.reveal()).toBe(secret);
    expect(redactText(`key=${secret}`)).toBe("key=[secret]");
    expect(await providers[0]!.get("UNSET")).toBeUndefined();
  });

  it("loadConfig registers its secret variables (the database password, the OIDC client secret) and the storage path", () => {
    const dbPassword = canary("db-password");
    const oidcSecret = canary("oidc-client-secret");
    loadConfig("api", {
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:3000",
      DATABASE_URL: `postgres://mth_app:${dbPassword}@db.example.internal:5432/mth`,
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: "https://idp.example.internal/realms/mth",
      OIDC_CLIENT_ID: "mth",
      OIDC_CLIENT_SECRET: oidcSecret,
      EVIDENCE_STORAGE_PATH: "/srv/mth-evidence-synthetic",
    });
    const out = redactLogLine(
      line({
        msg: `pool error for ${dbPassword}; token exchange sent ${oidcSecret}; file /srv/mth-evidence-synthetic/ab/cd.bin`,
      }),
    );
    expect(out).not.toContain("mth-canary-");
    expect(out).toContain("[secret]");
    expect(out).toContain("[storage-path]");
    expect(out).not.toContain("/srv/mth-evidence-synthetic");
  });
});

describe("ADR-0053 §4 item 2: storage keys, URLs and paths", () => {
  it.each(["storageKey", "storage_key", "key", "Key", "Bucket", "bucket", "endpoint", "s3_access_key_ref"])(
    "the field %s is censored by path at any depth",
    (field) => {
      const out = redactLogLine(line({ msg: "stored", nested: { deeper: [{ [field]: "evidence/2026/abc.pdf" }] } }));
      expect(out).not.toContain("evidence/2026/abc.pdf");
      expect(JSON.parse(out)).toEqual({ msg: "stored", nested: { deeper: [{ [field]: "[redacted]" }] } });
    },
  );

  it("a URL on the configured object-store host becomes [storage-url]; another host is kept", () => {
    registerRedactedStorageEndpoint("https://objects.example.internal:9000");
    const out = redactText(
      "GET https://objects.example.internal:9000/mth-evidence/ab/cd?x=1 failed; see https://docs.example.internal/x",
    );
    expect(out).toBe("GET [storage-url] failed; see https://docs.example.internal/x");
    expect(redactText("https://objects.example.internal.evil/x")).toBe("https://objects.example.internal.evil/x");
  });

  it("an absolute path under EVIDENCE_STORAGE_PATH becomes [storage-path]; a sibling directory is kept", () => {
    registerRedactedStoragePath("/var/lib/mth/evidence/");
    expect(redactText('open "/var/lib/mth/evidence/0b/12/0b12.bin" failed')).toBe('open "[storage-path]" failed');
    expect(redactText("/var/lib/mth/evidence-old/x")).toBe("/var/lib/mth/evidence-old/x");
  });

  it("the X-Amz-Signature, X-Amz-Credential and X-Amz-Security-Token parameters are removed", () => {
    const out = redactText(
      "https://s3.example.internal/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIDSYNTH%2F20261029&X-Amz-Signature=abcdef0123&X-Amz-Security-Token=tok&X-Amz-Expires=60",
    );
    expect(out).toBe("https://s3.example.internal/b/k?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=60");
    expect(redactText("https://h/k?X-Amz-Signature=abc")).toBe("https://h/k");
  });
});

describe("ADR-0053 §4 item 3: tokens", () => {
  it("the deep-link token segment becomes /links/[token]", () => {
    const token = "A".repeat(20) + "b_-".repeat(7) + "Zz";
    expect(redactLogLine(line({ req: { url: `/api/v1/links/${token}?lang=ar` } }))).toBe(
      line({ req: { url: "/api/v1/links/[token]?lang=ar" } }),
    );
  });

  it.each(["code", "state", "id_token", "access_token", "refresh_token"])("the OIDC %s parameter is censored", (p) => {
    expect(redactText(`/auth/callback?${p}=SYNTHETIC-value.123&lang=en`)).toBe(
      `/auth/callback?${p}=[redacted]&lang=en`,
    );
  });

  it("bearer tokens, JWTs, private-key blocks and access-key ids are censored", () => {
    const jwt = `eyJ${"a".repeat(12)}.eyJ${"b".repeat(12)}.${"c".repeat(10)}`;
    const out = redactText(
      `Authorization: Bearer ${"t".repeat(30)} jwt=${jwt} -----BEGIN RSA PRIVATE KEY-----\nMIIsynthetic\n-----END RSA PRIVATE KEY----- id=AKIA${"Q".repeat(16)}`,
    );
    expect(out).toBe("Authorization: Bearer [secret] jwt=[secret] [secret] id=[secret]");
  });
});

describe("the worker's console sink", () => {
  it("installConsoleRedaction redacts every console method's formatted line", () => {
    registerRedactedSecret(canary("worker"));
    const written: string[] = [];
    const push = (...args: unknown[]) => void written.push(args.map(String).join(" "));
    const sink = { log: push, info: push, warn: push, error: push, debug: push };
    installConsoleRedaction(sink);
    sink.log(JSON.stringify({ msg: `x ${canary("worker")}` }));
    sink.error("mth-worker failed to start:", `bad ${canary("worker")}`);
    sink.warn("%s", "/links/" + "k".repeat(43));
    expect(written).toEqual(['{"msg":"x [secret]"}', "mth-worker failed to start: bad [secret]", "/links/[token]"]);
  });
});
