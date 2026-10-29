// ADR-0053 §4 (REQ-S16-029 "never expose secrets or private evidence URLs … in logs"; T-DG6-DO-D): the API logger
// of server.ts, as composed, censors every redaction class before a line is written. The unit tests per class are in
// packages/config/src/redaction.test.ts; this file proves the wiring (pino redact paths, the streamWrite hook and the
// SecretProvider registry of buildServer). Every value is SYNTHETIC (canary strings built at run time).
import { createPool } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../../src/server.ts";
import { testConfig, testEvidenceDir } from "../../support/harness.ts";

const canary = (name: string) => `mth-canary-${name}-${"q".repeat(16)}`;
const lines: string[] = [];
const logStream = { write: (line: string) => void lines.push(line) };

let built: Awaited<ReturnType<typeof buildServer>>;
let pool: ReturnType<typeof createPool>;
const ENV_SECRET = "MTH_LOG_REDACTION_TEST_SECRET";

beforeAll(async () => {
  process.env[ENV_SECRET] = canary("provider-value");
  const config = testConfig({ LOG_LEVEL: "info" });
  pool = createPool(config.databaseUrl!, { max: 1, applicationName: "api-test-log-redaction" });
  built = await buildServer({ config, pool, logger: true, logStream, webRoot: null, oidc: null });
});

afterAll(async () => {
  delete process.env[ENV_SECRET];
  await built.app.close();
  await built.db.destroy();
  if (!(pool as typeof pool & { ending?: boolean }).ending) await pool.end();
});

describe("the composed API logger (ADR-0053 §4)", () => {
  it("censors header tokens, the link token segment and the OIDC parameters of req.url", async () => {
    lines.length = 0;
    const linkToken = "L".repeat(20) + "k_-".repeat(7) + "Zz"; // 43 characters, the ADR-0051 §3 shape
    const bearer = canary("bearer");
    const signature = canary("webhook-signature");
    await built.app.inject({
      method: "GET",
      url: `/api/v1/links/${linkToken}`,
      headers: {
        authorization: `Bearer ${bearer}`,
        cookie: `mth_session=${canary("cookie")}`,
        "x-mth-signature": signature,
      },
    });
    await built.app.inject({
      method: "GET",
      url: `/auth/callback?code=${canary("oidc-code")}&state=${canary("oidc-state")}`,
    });
    const out = lines.join("");
    expect(out).toContain("/links/[token]");
    expect(out).toContain("code=[redacted]&state=[redacted]");
    expect(out).not.toContain(linkToken);
    expect(out).not.toContain("mth-canary-");
  });

  it("censors a value resolved through the server's SecretProvider registry, storage fields, paths and signed URLs", async () => {
    lines.length = 0;
    const value = await built.secrets.resolve({ provider: "env", name: ENV_SECRET });
    expect(value?.reveal()).toBe(canary("provider-value"));
    built.app.log.error(
      {
        err: `smtp login refused for ${value!.reveal()}`,
        storageKey: "ab/cd/synthetic-object",
        object: {
          Bucket: "mth-evidence",
          Key: "ab/cd/synthetic-object",
          s3_endpoint: "https://objects.example.internal",
        },
        file: `${testEvidenceDir()}/ab/cd/synthetic-object`,
        url: "https://objects.example.internal/mth-evidence/ab?X-Amz-Credential=AKIDSYNTH&X-Amz-Signature=deadbeef01&X-Amz-Expires=60",
      },
      "synthetic failure",
    );
    const out = lines.join("");
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      err: "smtp login refused for [secret]",
      storageKey: "[redacted]",
      object: { Bucket: "[redacted]", Key: "[redacted]", s3_endpoint: "[redacted]" },
      file: "[storage-path]",
      url: "https://objects.example.internal/mth-evidence/ab?X-Amz-Expires=60",
    });
    expect(out).not.toContain("mth-canary-");
    expect(out).not.toContain("synthetic-object");
    expect(out).not.toContain("X-Amz-Signature");
  });
});
