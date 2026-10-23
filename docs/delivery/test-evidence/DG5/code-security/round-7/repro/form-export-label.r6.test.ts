// code-security-reviewer, DG5 round 6 (T-DG5-REV-SEC-R6): adversarial probe of the wave-AA contract change
// (F-DG5-124; D-178): `illustrativeLabel` in FormRecordExport and the CSV label row of exportFormRecords.
// Copied into the disposable clone as apps/api/test/integration/forms/zz-sec-r6-form-export-label.test.ts, run there on
// a disposable PostgreSQL, then removed. Never part of the candidate. Every datum is SYNTHETIC.
//
// What it asserts (each a security/integrity property of the change, not the domain wording):
//  1. Scope: on the demo database the demo access administrator (ADM_ACCESS only) gets 404 on every export variant
//     (nothing transformation-scoped leaks, the label included); a reader in the transformation gets 200 + label.
//  2. Detection cannot be steered by the application role: mth_app can neither INSERT, UPDATE nor DELETE the
//     deployment_environment marker (SELECT only, 0090), so no API path can add or remove the label.
//  3. An explicit 'production' marker (what `mth-db bootstrap` writes) gives illustrativeLabel null and no label row,
//     the same as no marker; the append-only marker refuses a later change to 'demo' even by the owner.
//  4. The CSV writer: the label row is a single unquoted, un-prefixed field; the formula-injection rule still applies to
//     every value and header cell after the label row; a JSON body whose label is null yields no label row.
//  5. The format/Accept agreement guard is unchanged on the demo database (400).
import { migrate, seedDemo } from "@mth/db";
import { formRecordExport } from "@mth/shared/schemas";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN, DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { exportCsv, FORM_EXPORT_ILLUSTRATIVE_LABELS } from "../../../src/modules/forms/export.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { formsTransformation, seedFormsVersion, T01_FIELDS } from "../../support/forms-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const BOM = "﻿";
const url = (t: string, rt: string, format: string, lang: string) =>
  `/api/v1/transformations/${t}/form-records/${rt}/export?format=${format}&lang=${lang}`;

let demoApi: TestApi;
let prodApi: TestApi;
let demoDb = "";
let prodDb = "";
let admAccess: Session;
let readers: { name: string; s: Session }[] = [];
let prod: { transformationId: string; reader: Session };
const scratch: string[] = [];

async function asRole(database: string, role: string, text: string): Promise<{ ok: boolean; code?: string; msg?: string }> {
  const c = new pg.Client({ connectionString: roleUrl(inject("mthDb").adminUrl, database, role) });
  await c.connect();
  try {
    await c.query(text);
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code, msg: err.message };
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  demoDb = await createScratchDatabase(adminUrl, "mth_sec_r6_label_demo");
  prodDb = await createScratchDatabase(adminUrl, "mth_sec_r6_label_prod");
  scratch.push(demoDb, prodDb);
  for (const db of [demoDb, prodDb]) await migrate(roleUrl(adminUrl, db, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, demoDb, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  demoApi = await startApi({ database: demoDb, env: { MTH_ENV: "demo" } });
  admAccess = await signIn(demoApi.app, DEMO_ACCESS_ADMIN.name);
  readers = [];
  for (const u of DEMO_USERS.filter((x) => ["TL", "CM", "KDS"].includes(x.role)))
    readers.push({ name: u.name, s: await signIn(demoApi.app, u.name) });

  // The production database: an explicit 'production' marker, as `mth-db bootstrap` writes it.
  const mark = await asRole(
    prodDb,
    "mth_owner",
    "INSERT INTO deployment_environment (environment_kind, initialized_via) VALUES ('production', 'bootstrap')",
  );
  if (!mark.ok) throw new Error(`could not write the production marker: ${mark.msg}`);
  prodApi = await startApi({ database: prodDb });
  const w = await seedWorld(prodApi.db);
  const v01 = await seedFormsVersion(prodApi, T01_FIELDS);
  const { transformationId } = await formsTransformation(prodApi, w, w.office.id, v01.id);
  prod = { transformationId, reader: await signIn(prodApi.app, w.auditor.subject) };
}, 240_000);

afterAll(async () => {
  await demoApi?.close();
  await prodApi?.close();
  for (const db of scratch) await dropScratchDatabase(inject("mthDb").adminUrl, db);
}, 60_000);

describe("SEC-R6 1: scope of the labelled export on the demo database", () => {
  for (const rt of ["T01", "T14"])
    for (const format of ["csv", "json"])
      it(`ADM_ACCESS only: ${rt} ${format} -> 404, no body content`, async () => {
        const res = await call<Body>(demoApi.app, "GET", url(DEMO_ANCHORS.transformationId, rt, format, "en"), {
          session: admAccess,
        });
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body ?? "")).not.toContain(FORM_EXPORT_ILLUSTRATIVE_LABELS.en);
      });

  it("readers in the transformation (TL, CM, KDS): 200 and the label in the JSON body", async () => {
    const got: string[] = [];
    for (const r of readers) {
      const res = await call<Body>(demoApi.app, "GET", url(DEMO_ANCHORS.transformationId, "T01", "json", "ar"), {
        session: r.s,
      });
      got.push(`${r.name}:${res.status}:${res.body?.illustrativeLabel}`);
      expect(formRecordExport.safeParse(res.body).success).toBe(true);
    }
    expect(got).toEqual(readers.map((r) => `${r.name}:200:${FORM_EXPORT_ILLUSTRATIVE_LABELS.ar}`));
  });

  it("an unknown transformation id -> 404 (no label oracle)", async () => {
    const res = await call<Body>(
      demoApi.app,
      "GET",
      url("01900000-0000-7000-8000-000000000000", "T01", "csv", "en"),
      { session: readers[0]!.s },
    );
    expect(res.status).toBe(404);
  });
});

describe("SEC-R6 2: the application role cannot steer detection", () => {
  it("mth_app: INSERT/UPDATE/DELETE on deployment_environment are refused (42501) on both databases", async () => {
    const out: string[] = [];
    for (const db of [demoDb, prodDb]) {
      for (const stmt of [
        "UPDATE deployment_environment SET environment_kind = 'production'",
        "DELETE FROM deployment_environment",
        "INSERT INTO deployment_environment (singleton, environment_kind, initialized_via, dataset_code, dataset_version, synthetic_clock_at) VALUES (true, 'demo', 'seed_demo', 'international_roaming', '1.0.0', now())",
      ]) {
        const r = await asRole(db, "mth_app", stmt);
        out.push(`${db === demoDb ? "demo" : "prod"}:${stmt.split(" ")[0]}:${r.ok ? "ok" : r.code}`);
      }
    }
    expect(out).toEqual([
      "demo:UPDATE:42501",
      "demo:DELETE:42501",
      "demo:INSERT:42501",
      "prod:UPDATE:42501",
      "prod:DELETE:42501",
      "prod:INSERT:42501",
    ]);
  });

  it("the owner cannot flip the production marker to demo afterwards (append-only)", async () => {
    const r = await asRole(prodDb, "mth_owner", "UPDATE deployment_environment SET environment_kind = 'demo'");
    expect(r.ok).toBe(false);
  });
});

describe("SEC-R6 3: an explicit production marker gives no label", () => {
  it("GET /environment is production, not synthetic", async () => {
    const env = await call<Body>(prodApi.app, "GET", "/api/v1/environment", { session: prod.reader });
    expect([env.status, env.body.kind, env.body.synthetic]).toEqual([200, "production", false]);
  });
  for (const lang of ["en", "ar"])
    it(`T01 json+csv ${lang}: illustrativeLabel null, CSV starts with BOM + header`, async () => {
      const j = await call<Body>(prodApi.app, "GET", url(prod.transformationId, "T01", "json", lang), {
        session: prod.reader,
      });
      expect(j.status).toBe(200);
      expect(j.body.illustrativeLabel).toBeNull();
      const c = await call<Body>(prodApi.app, "GET", url(prod.transformationId, "T01", "csv", lang), {
        session: prod.reader,
      });
      expect(c.status).toBe(200);
      const first = String(c.body).split("\r\n")[0]!;
      expect(first.startsWith(BOM)).toBe(true);
      expect(first).not.toContain(FORM_EXPORT_ILLUSTRATIVE_LABELS.en);
      expect(first).not.toContain(FORM_EXPORT_ILLUSTRATIVE_LABELS.ar);
      expect(first.includes(",")).toBe(true);
    });
});

describe("SEC-R6 4: the CSV writer with the label row", () => {
  const base = {
    recordType: "T01",
    formSchemaVersionId: "01900000-0000-7000-8000-000000000001",
    language: "en",
    columns: [
      { key: "name", label: "=HYPERLINK(\"http://x\")", fieldType: "text", extension: false },
      { key: "n", label: "Amount", fieldType: "number", extension: false },
    ],
    rows: [
      {
        recordId: "01900000-0000-7000-8000-000000000002",
        version: 1,
        values: { name: "+cmd|' /C calc'!A0", n: "-12.50" },
        statuses: {},
      },
      {
        recordId: "01900000-0000-7000-8000-000000000003",
        version: 2,
        values: { name: "@SUM(A1:A2)", n: "-1+1" },
        statuses: {},
      },
    ],
  } as const;

  it("label row: one plain field; every formula-like text after it is apostrophe-prefixed; canonical decimals are not", () => {
    const csv = exportCsv({ ...base, illustrativeLabel: FORM_EXPORT_ILLUSTRATIVE_LABELS.en } as never);
    const lines = csv.replace(/^﻿/, "").split("\r\n");
    expect(lines[0]).toBe(FORM_EXPORT_ILLUSTRATIVE_LABELS.en);
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(lines[2]).toContain(`'+cmd|' /C calc'!A0`);
    expect(lines[2]).toContain(",-12.50,");
    expect(lines[3]).toContain("'@SUM(A1:A2)");
    expect(lines[3]).toContain("'-1+1");
    for (const l of lines.slice(1)) for (const cell of l.split(",")) expect(cell).not.toMatch(/^[=+@\t\r]/);
  });

  it("label null: no label row (the header is the first line)", () => {
    const csv = exportCsv({ ...base, illustrativeLabel: null } as never);
    expect(csv.replace(/^﻿/, "").split("\r\n")[0]!.startsWith("Record ID,Version,")).toBe(true);
  });

  it("the Arabic label row is the Arabic string, unquoted", () => {
    const csv = exportCsv({ ...base, language: "ar", illustrativeLabel: FORM_EXPORT_ILLUSTRATIVE_LABELS.ar } as never);
    expect(csv.replace(/^﻿/, "").split("\r\n")[0]).toBe(FORM_EXPORT_ILLUSTRATIVE_LABELS.ar);
  });
});

describe("SEC-R6 5: format/Accept guard unchanged on the demo database", () => {
  it("format=csv with Accept: application/json -> 400", async () => {
    const res = await call<Body>(demoApi.app, "GET", url(DEMO_ANCHORS.transformationId, "T01", "csv", "en"), {
      session: readers[0]!.s,
      headers: { accept: "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
