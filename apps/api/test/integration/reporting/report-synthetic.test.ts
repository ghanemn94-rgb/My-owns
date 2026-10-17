// D-163 (T-DG5-BE-N2; F-DG5-qa-c-2, F-DG5-qa-c-1): snapshot generation reads the environment through
// EnvironmentReadPort in its transaction (ADR-0050 §2 (d); REQ-PB-089, REQ-S18-001), and the worker prints the
// illustrative label and the B0004 statement from what the snapshot records. Proves, against the run's disposable
// PostgreSQL:
//  - in a demo database (a scratch database seeded through `seedDemo`, which writes the real `demo` marker), a
//    generated snapshot and the live report record `synthetic: true`, and the content hash covers it;
//  - in a production database (the run's shared database: no marker reads as production), the content has no
//    `synthetic` member and its `content_sha256` is the hash of exactly the content-schema-v1 document (the R2 rule);
//  - the worker's export of the demo snapshot prints "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي",
//    and of the production snapshot does not; both print the B0004 statement as GET /methodology/provenance returns it.
// All data is SYNTHETIC; a report snapshot approves nothing, and nothing here touches DG0-DG7.
import { createHash } from "node:crypto";
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { TEST_DEMO_MODULES } from "../../../../../packages/db/test/demo-fixture.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { readXlsx, cellText } from "../../../../../packages/reporting/src/xlsx/read.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import { environmentReadPort } from "../../../src/modules/admin/environment.ts";
import {
  canonicalReportJson,
  reportEnvironmentPort,
  type ReportEnvironmentPort,
} from "../../../src/modules/reporting/reports/snapshots.ts";
import { call, seedWorld, startApi, testEvidenceDir, type TestApi } from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;

interface Side {
  api: TestApi;
  p: P2World;
  T: string;
}

let demo: Side;
let prod: Side;
let scratch: string | null = null;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

async function side(api: TestApi): Promise<Side> {
  const w = await seedWorld(api.db);
  const p = await setupP2World(api, w);
  return { api, p, T: `/api/v1/transformations/${p.transformationId}` };
}

const generate = (s: Side, code: string, body: Record<string, unknown> = {}) =>
  call<Body>(s.api.app, "POST", `${s.T}/reports/${code}/generate`, { session: s.p.lead.session, body });
/** The RAID register (offered in CSV and XLSX). */
const raidRegister = (s: Side) => generate(s, "registers", { parameters: { register: "raid" } });

/** Requests an export through the API and runs the worker's handler once; returns the stored file's bytes. */
async function exported(s: Side, snapshotId: string, format: "csv" | "xlsx", language: "en" | "ar") {
  const job = ok(
    await call<Body>(s.api.app, "POST", "/api/v1/exports", {
      session: s.p.lead.session,
      headers: { "idempotency-key": `it-${crypto.randomUUID()}` },
      body: { snapshotId, format, language },
    }),
    202,
    "createExport",
  );
  const row = await s.api.db
    .selectFrom("outbox_event")
    .selectAll()
    .where("idempotency_key", "=", `export_job.requested:${job.id}`)
    .executeTakeFirstOrThrow();
  const envelope = {
    outboxEventId: row.id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    idempotencyKey: row.idempotency_key,
    organizationId: row.organization_id,
    payload: row.payload,
  };
  const store = new FilesystemExportStore(testEvidenceDir());
  const result = await runExport(s.api.db, envelope, row.id, { retryCount: 0, retryLimit: 5 }, { store });
  expect(result.outcome).toBe("succeeded");
  const done = await s.api.db
    .selectFrom("export_job")
    .select("storage_key")
    .where("id", "=", job.id)
    .executeTakeFirstOrThrow();
  const chunks: Uint8Array[] = [];
  for await (const c of await store.get(done.storage_key!)) chunks.push(c);
  return new Uint8Array(Buffer.concat(chunks));
}

async function provenance(s: Side): Promise<{ en: string; ar: string }> {
  const r = ok(
    await call<Body>(s.api.app, "GET", "/api/v1/methodology/provenance", { session: s.p.lead.session }),
    200,
    "",
  );
  expect(r.statement.blockRef).toBe("B0004");
  return { en: r.statement.textEn, ar: r.statement.textAr };
}

const csvText = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_report_synthetic");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    modules: TEST_DEMO_MODULES,
  });
  demo = await side(await startApi({ database: scratch, env: { MTH_ENV: "demo" } }));
  prod = await side(await startApi());
}, 180_000);

afterAll(async () => {
  await demo?.api.close();
  await prod?.api.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("snapshot generation reads the environment (EnvironmentReadPort; ADR-0050 §2 (d))", () => {
  it("the two databases are what the test needs: demo (synthetic) and production", async () => {
    const d = ok(
      await call<Body>(demo.api.app, "GET", "/api/v1/environment", { session: demo.p.lead.session }),
      200,
      "",
    );
    const pr = ok(
      await call<Body>(prod.api.app, "GET", "/api/v1/environment", { session: prod.p.lead.session }),
      200,
      "",
    );
    expect(d).toMatchObject({ kind: "demo", synthetic: true });
    expect(pr).toMatchObject({ kind: "production", synthetic: false });
  });

  it("reporting's environment read answers as admin's EnvironmentReadPort on both databases", async () => {
    // admin's port satisfies the reporting port's contract as it is (a compile-time check) ...
    const asReportPort: ReportEnvironmentPort = environmentReadPort;
    // ... and both read the same marker with the same rule (also inside a transaction, as generation does).
    for (const [s, synthetic] of [
      [demo, true],
      [prod, false],
    ] as const) {
      expect((await reportEnvironmentPort.read(s.api.db)).synthetic).toBe(synthetic);
      expect((await asReportPort.read(s.api.db)).synthetic).toBe(synthetic);
      await s.api.db.transaction().execute(async (tx) => {
        expect((await reportEnvironmentPort.read(tx)).synthetic).toBe((await environmentReadPort.read(tx)).synthetic);
      });
    }
  });

  it("demo: the generated snapshot and the live report record synthetic: true; the hash covers it", async () => {
    const s = ok(await generate(demo, "charter"), 201, "generate charter (demo)");
    expect(s.content.synthetic).toBe(true);
    const stored = await demo.api.db
      .selectFrom("report_snapshot")
      .select(["content", "content_sha256"])
      .where("id", "=", s.id)
      .executeTakeFirstOrThrow();
    expect((stored.content as Body).synthetic).toBe(true);
    const sha = createHash("sha256").update(canonicalReportJson(stored.content), "utf8").digest("hex");
    expect(stored.content_sha256.trim()).toBe(sha);
    expect(s.contentSha256).toBe(sha);
    const read = ok(
      await call<Body>(demo.api.app, "GET", `${demo.T}/report-snapshots/${s.id}`, {
        session: demo.p.lead.session,
      }),
      200,
      "getReportSnapshot",
    );
    expect(read.content.synthetic).toBe(true);
    const live = ok(
      await call<Body>(demo.api.app, "GET", `${demo.T}/reports/charter/live`, {
        session: demo.p.lead.session,
      }),
      200,
      "getLiveReport",
    );
    expect(live.document.synthetic).toBe(true);
  });

  it("production: no `synthetic` member, and content_sha256 is the hash of the unchanged content-schema-v1 document", async () => {
    const s = ok(await generate(prod, "charter"), 201, "generate charter (production)");
    expect(Object.hasOwn(s.content, "synthetic")).toBe(false);
    expect(s.content.schemaVersion).toBe(1);
    const stored = await prod.api.db
      .selectFrom("report_snapshot")
      .select(["content", "content_sha256", "content_schema_version"])
      .where("id", "=", s.id)
      .executeTakeFirstOrThrow();
    expect(Object.hasOwn(stored.content as object, "synthetic")).toBe(false);
    expect(stored.content_schema_version).toBe(1);
    const canonical = canonicalReportJson(stored.content);
    expect(canonical).not.toContain('"synthetic"');
    expect(stored.content_sha256.trim()).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
    const live = ok(
      await call<Body>(prod.api.app, "GET", `${prod.T}/reports/charter/live`, {
        session: prod.p.lead.session,
      }),
      200,
      "getLiveReport",
    );
    expect(Object.hasOwn(live.document, "synthetic")).toBe(false);
  });
});

describe("the worker prints what the snapshot records (D-163)", () => {
  it("demo: CSV and XLSX in en and ar carry the illustrative label and the B0004 statement", async () => {
    const s = ok(await raidRegister(demo), 201, "generate registers (demo)");
    expect(s.content.synthetic).toBe(true);
    const prov = await provenance(demo);
    for (const language of ["en", "ar"] as const) {
      const csv = csvText(await exported(demo, s.id, "csv", language));
      expect(csv, `csv ${language}`).toContain(LABEL[language]);
      expect(csv, `csv ${language}`).toContain(prov[language]);
      const wb = await readXlsx(await exported(demo, s.id, "xlsx", language));
      for (const sheet of wb.sheets) {
        const texts = sheet.rows.flat().map(cellText);
        expect(texts, `xlsx ${language} ${sheet.name}`).toContain(LABEL[language]);
        expect(texts, `xlsx ${language} ${sheet.name}`).toContain(prov[language]);
      }
    }
  }, 120_000);

  it("production: no label in either language, and the B0004 statement on every sheet and in the CSV", async () => {
    const s = ok(await raidRegister(prod), 201, "generate registers (production)");
    expect(Object.hasOwn(s.content, "synthetic")).toBe(false);
    const prov = await provenance(prod);
    for (const language of ["en", "ar"] as const) {
      const csv = csvText(await exported(prod, s.id, "csv", language));
      expect(csv).not.toContain(LABEL[language]);
      expect(csv).toContain(prov[language]);
      const wb = await readXlsx(await exported(prod, s.id, "xlsx", language));
      for (const sheet of wb.sheets) {
        const texts = sheet.rows.flat().map(cellText);
        expect(texts).not.toContain(LABEL[language]);
        expect(texts, `xlsx ${language} ${sheet.name}`).toContain(prov[language]);
      }
    }
  }, 120_000);
});
