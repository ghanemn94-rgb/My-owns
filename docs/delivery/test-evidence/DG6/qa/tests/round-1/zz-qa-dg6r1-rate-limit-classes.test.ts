// qa-verifier DG6 round 1 probe (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// apps/api/test/integration/security/zz-qa-dg6r1-rate-limit-classes.test.ts (integration project, disposable PostgreSQL).
// ADR-0052 §4 (REQ-S16-030 "rate limits"): the `export` class (EXPORT_RATE_LIMIT_PER_MINUTE, default 10, documented in
// .env.example and @mth/config as "Export starts per minute per session/IP") applies to the export start operations,
// and the `upload` class (UPLOAD_RATE_LIMIT_PER_MINUTE) applies to uploadEvidenceContent AND the import upload
// (ADR-0056). Method copied from the candidate's rate-limits.test.ts: a fresh API with the class budget set to 1; the
// class limiter runs on request before authentication and validation, so the synthetic calls need not succeed to be
// counted. Expected per the ADR: the second call is 429 rate_limited. Control: uploadEvidenceContent under the upload
// class. Synthetic data only; nothing here approves anything.
import { describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Res, type Session, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const uuid = () => crypto.randomUUID();

async function withBudgetOfOne<T>(variable: string, run: (api: TestApi, session: Session) => Promise<T>) {
  const api = await startApi({ env: { [variable]: "1" } });
  try {
    const w = await seedWorld(api.db);
    const session = await signIn(api.app, w.office.subject);
    return await run(api, session);
  } finally {
    await api.close();
  }
}

const twice = async (attempt: () => Promise<Res<Body>>) => {
  const first = await attempt();
  const second = await attempt();
  return { first: first.status, second: second.status, secondCode: second.body?.code ?? null };
};

describe("QA-DG6R1 probe: ADR-0052 §4 rate-limit classes for export start and import upload", () => {
  it("control: upload class, uploadEvidenceContent twice at UPLOAD_RATE_LIMIT_PER_MINUTE=1 -> second 429", async () => {
    const r = await withBudgetOfOne("UPLOAD_RATE_LIMIT_PER_MINUTE", (api, session) =>
      twice(() =>
        call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/evidence/${uuid()}/content`, {
          session,
          headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
          body: Buffer.from("a,b\n1,2\n"),
        }),
      ),
    );
    console.log(`PROBE upload/uploadEvidenceContent: ${JSON.stringify(r)}`);
    expect(r.second).toBe(429);
  });

  it("export class: createExport twice at EXPORT_RATE_LIMIT_PER_MINUTE=1 -> expected second 429", async () => {
    const r = await withBudgetOfOne("EXPORT_RATE_LIMIT_PER_MINUTE", (api, session) =>
      twice(() =>
        call<Body>(api.app, "POST", "/api/v1/exports", {
          session,
          headers: { "idempotency-key": uuid() },
          body: { transformationId: uuid(), definitionCode: "registers", format: "csv", selection: { register: "raid" } },
        }),
      ),
    );
    console.log(`PROBE export/createExport: ${JSON.stringify(r)}`);
    expect(r.second, "the second export start within the minute").toBe(429);
  });

  it("upload class: createImport (import upload) twice at UPLOAD_RATE_LIMIT_PER_MINUTE=1 -> expected second 429", async () => {
    const r = await withBudgetOfOne("UPLOAD_RATE_LIMIT_PER_MINUTE", (api, session) =>
      twice(() =>
        call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/imports`, {
          session,
          headers: { "content-type": "text/csv", "x-file-name": "actuals.csv", "idempotency-key": uuid() },
          body: Buffer.from("a,b\n1,2\n"),
        }),
      ),
    );
    console.log(`PROBE upload/createImport: ${JSON.stringify(r)}`);
    expect(r.second, "the second import upload within the minute").toBe(429);
  });
});
