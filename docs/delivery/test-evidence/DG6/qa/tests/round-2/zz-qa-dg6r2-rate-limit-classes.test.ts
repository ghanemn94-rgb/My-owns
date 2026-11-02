// qa-verifier DG6 round 2 probe (T-DG6-REV-QA-R2), NOT part of the candidate. Copied into a disposable copy as
// apps/api/test/integration/security/zz-qa-dg6r2-rate-limit-classes.test.ts (integration project, disposable PostgreSQL).
// F-DG6-141 re-verification. Part 1 is the round-1 reproduction unchanged (budget 1, two calls). Part 2 is new: the
// DEFAULT budgets of ADR-0052 §4 (export 10, upload 30) with no variable set: the (budget+1)-th call of one session in
// the minute is 429 with Retry-After, and every earlier one is not 429; a second session is not counted.
// Synthetic data only; nothing here approves anything (no business approval G1-G6, nothing about DG0-DG7).
import { ENV_VARS, loadConfig } from "@mth/config";
import { describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Res, type Session, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const uuid = () => crypto.randomUUID();

async function withApi<T>(env: Record<string, string>, run: (api: TestApi, s1: Session, s2: Session) => Promise<T>) {
  const api = await startApi({ env });
  try {
    const w = await seedWorld(api.db);
    const s1 = await signIn(api.app, w.office.subject);
    const s2 = await signIn(api.app, w.leadA1.subject);
    return await run(api, s1, s2);
  } finally {
    await api.close();
  }
}
const exportStart = (api: TestApi, session: Session) =>
  call<Body>(api.app, "POST", "/api/v1/exports", {
    session,
    headers: { "idempotency-key": uuid() },
    body: { transformationId: uuid(), definitionCode: "registers", format: "csv", selection: { register: "raid" } },
  });
const importUpload = (api: TestApi, session: Session) =>
  call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/imports`, {
    session,
    headers: { "content-type": "text/csv", "x-file-name": "actuals.csv", "idempotency-key": uuid() },
    body: Buffer.from("a,b\n1,2\n"),
  });
const evidenceUpload = (api: TestApi, session: Session) =>
  call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/evidence/${uuid()}/content`, {
    session,
    headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
    body: Buffer.from("a,b\n1,2\n"),
  });
const summary = (rs: Res<Body>[]) => rs.map((r) => r.status);

describe("QA-DG6R2 part 1 (round-1 reproduction): budget 1, two calls", () => {
  for (const [label, variable, attempt] of [
    ["upload/uploadEvidenceContent (control)", "UPLOAD_RATE_LIMIT_PER_MINUTE", evidenceUpload],
    ["export/createExport", "EXPORT_RATE_LIMIT_PER_MINUTE", exportStart],
    ["upload/createImport", "UPLOAD_RATE_LIMIT_PER_MINUTE", importUpload],
  ] as const) {
    it(`${label}: the second call within the minute is 429 rate_limited with Retry-After`, async () => {
      const r = await withApi({ [variable]: "1" }, async (api, s1) => [await attempt(api, s1), await attempt(api, s1)]);
      console.log(`PROBE-R2 ${label}: ${JSON.stringify(summary(r))} code=${r[1]!.body?.code} retry-after=${r[1]!.headers["retry-after"]}`);
      expect(r[0]!.status).not.toBe(429);
      expect(r[1]!.status).toBe(429);
      expect(r[1]!.body?.code).toBe("rate_limited");
      expect(Number(r[1]!.headers["retry-after"])).toBeGreaterThan(0);
    });
  }
});

// Part 2 note: the test harness (apps/api/test/support/harness.ts testConfig) raises every class budget to 100000, so
// part 2 passes the DOCUMENTED default value of @mth/config explicitly; part 2a checks that loadConfig with no class
// variable resolves exactly those defaults. (The first execution of this file omitted the variable and so measured the
// harness's 100000, not the product default: recorded in 10-probe-f140-f141.log.)
describe("QA-DG6R2 part 2a: loadConfig without the class variables resolves the ADR-0052 section 4 defaults", () => {
  it("export 10, upload 30 (and the documented ENV_VARS defaults say the same)", () => {
    const cfg = loadConfig("api", {
      NODE_ENV: "test",
      APP_BASE_URL: "http://localhost:5173",
      DATABASE_URL: "postgresql://mth_app@127.0.0.1:1/mth",
      AUTH_MODE: "dev",
    });
    console.log(`PROBE-R2 loadConfig rateLimitClasses=${JSON.stringify(cfg.rateLimitClasses)}`);
    expect(cfg.rateLimitClasses.export).toBe(10);
    expect(cfg.rateLimitClasses.upload).toBe(30);
    expect([ENV_VARS.EXPORT_RATE_LIMIT_PER_MINUTE.default, ENV_VARS.UPLOAD_RATE_LIMIT_PER_MINUTE.default]).toEqual(["10", "30"]);
  });
});

describe("QA-DG6R2 part 2: the documented default budgets, set explicitly over the harness's 100000", () => {
  it("export default 10: calls 1-10 not 429, call 11 is 429; a second session's call is not counted", async () => {
    const r = await withApi({ EXPORT_RATE_LIMIT_PER_MINUTE: ENV_VARS.EXPORT_RATE_LIMIT_PER_MINUTE.default! }, async (api, s1, s2) => {
      const first: Res<Body>[] = [];
      for (let i = 0; i < 11; i += 1) first.push(await exportStart(api, s1));
      return { first, other: await exportStart(api, s2) };
    });
    console.log(`PROBE-R2 export default: s1=${JSON.stringify(summary(r.first))} s2=${r.other.status}`);
    expect(r.first.slice(0, 10).every((x) => x.status !== 429)).toBe(true);
    expect(r.first[10]!.status).toBe(429);
    expect(r.other.status).not.toBe(429);
  });
  it("upload default 30: createImport calls 1-30 not 429, call 31 is 429", async () => {
    const r = await withApi({ UPLOAD_RATE_LIMIT_PER_MINUTE: ENV_VARS.UPLOAD_RATE_LIMIT_PER_MINUTE.default! }, async (api, s1) => {
      const out: Res<Body>[] = [];
      for (let i = 0; i < 31; i += 1) out.push(await importUpload(api, s1));
      return out;
    });
    console.log(`PROBE-R2 upload default createImport: ${JSON.stringify(summary(r))}`);
    expect(r.slice(0, 30).every((x) => x.status !== 429)).toBe(true);
    expect(r[30]!.status).toBe(429);
  });
});
