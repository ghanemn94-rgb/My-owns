// T-DG5-BE-AA1 (F-DG5-124; D-178; REQ-S18-001, REQ-PB-089; ADR-0050 §2 (d); M0090, M0339): the form framework's own
// export (exportFormRecords, ADR-0041 §5) carries the illustrative label on a demo database.
//
// The domain reviewer's reproduction (round 5, probe dom-r5-forms.spec.ts), as a product test: on the REAL synthetic
// dataset (`seedDemo`) in a scratch database with the REAL API on it (MTH_ENV=demo), signed in as the demo Team Lead
// (roaming.user.tl), GET /transformations/{roaming}/form-records/{T14|T01}/export?format={csv|json}&lang={en|ar}:
//   - CSV: the first row, after the byte-order mark and before the header, is the label in the export language (the
//     reporting pipeline's exact `export.illustrative` strings); CRLF line ends are kept;
//   - JSON: `illustrativeLabel` is the same string in the export language.
// On a database that is not a demo database (no marker: production, fail-safe), the same exports carry no label row
// and `illustrativeLabel: null`. Everything is SYNTHETIC; nothing here approves anything or touches DG0-DG7.
import { FRAME_LABELS } from "@mth/reporting";
import { migrate, seedDemo } from "@mth/db";
import { formRecordExport } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { FORM_EXPORT_ILLUSTRATIVE_LABELS } from "../../../src/modules/forms/export.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";
import { formsTransformation, seedFormsVersion, T01_FIELDS } from "../../support/forms-fixtures.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const BOM = "﻿";
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const HEADER = { en: "Record ID,Version,", ar: "معرّف السجل,الإصدار," } as const;
const CASES = (["T14", "T01"] as const).flatMap((rt) =>
  (["en", "ar"] as const).flatMap((lang) => (["csv", "json"] as const).map((format) => ({ rt, lang, format }))),
);
const exportUrl = (t: string, rt: string, format: string, lang: string) =>
  `/api/v1/transformations/${t}/form-records/${rt}/export?format=${format}&lang=${lang}`;

let demoApi: TestApi;
let prodApi: TestApi;
let tl: Session;
let prodT01: { transformationId: string; reader: Session };
let prodT14: { transformationId: string; reader: Session };
const scratch: string[] = [];

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  const demoDb = await createScratchDatabase(adminUrl, "mth_forms_export_demo");
  const prodDb = await createScratchDatabase(adminUrl, "mth_forms_export_prod");
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
  tl = await signIn(demoApi.app, DEMO_USERS.find((u) => u.role === "TL")!.name);

  // The non-demo database: migrated, no marker (production), with T01 and T14 records of synthetic fixtures.
  prodApi = await startApi({ database: prodDb });
  const w = await seedWorld(prodApi.db);
  const v01 = await seedFormsVersion(prodApi, T01_FIELDS);
  const { transformationId } = await formsTransformation(prodApi, w, w.office.id, v01.id);
  prodT01 = { transformationId, reader: await signIn(prodApi.app, w.auditor.subject) };
  const b: BenefitWorld = await seedBenefitWorld(prodApi, w);
  await benefitAt(prodApi, b, "identify");
  prodT14 = { transformationId: b.transformationId, reader: b.s.auditor };
}, 240_000);

afterAll(async () => {
  await demoApi?.close();
  await prodApi?.close();
  for (const db of scratch) await dropScratchDatabase(inject("mthDb").adminUrl, db);
}, 60_000);

describe("F-DG5-124: the native form-record export on a demo database carries the illustrative label", () => {
  it("the label strings are the reporting pipeline's export.illustrative (en, ar)", () => {
    expect(FORM_EXPORT_ILLUSTRATIVE_LABELS).toEqual({
      en: FRAME_LABELS.en["export.illustrative"],
      ar: FRAME_LABELS.ar["export.illustrative"],
    });
    expect(FORM_EXPORT_ILLUSTRATIVE_LABELS).toEqual(LABEL);
  });

  it("the stack under test is a demo database (GET /environment: kind demo, synthetic)", async () => {
    const env = await call<Body>(demoApi.app, "GET", "/api/v1/environment", { session: tl });
    expect([env.status, env.body.kind, env.body.synthetic]).toEqual([200, "demo", true]);
  });

  for (const { rt, lang, format } of CASES)
    it(`demo: ${rt} ${format} ${lang} starts with / carries the label in the export language`, async () => {
      const res = await call<Body>(demoApi.app, "GET", exportUrl(DEMO_ANCHORS.transformationId, rt, format, lang), {
        session: tl,
      });
      if (format === "csv") {
        const body = res.body as string;
        expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
        const lines = body.split("\r\n");
        expect(lines[0], "first row: BOM + label, before the header").toBe(`${BOM}${LABEL[lang]}`);
        expect(lines[1]!.startsWith(HEADER[lang]), lines[1]).toBe(true);
        expect(lines.length, "label, header, at least one record, final CRLF").toBeGreaterThanOrEqual(4);
        expect(lines.at(-1)).toBe("");
        expect(body.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      } else {
        expect(formRecordExport.safeParse(res.body).success, JSON.stringify(res.body).slice(0, 300)).toBe(true);
        expect(res.body.language).toBe(lang);
        expect(res.body.illustrativeLabel).toBe(LABEL[lang]);
        expect(res.body.rows.length).toBeGreaterThan(0);
      }
      // The probe's final assertion.
      expect(res.status).toBe(200);
    });
});

describe("F-DG5-124: a database that is not a demo database carries no label (illustrativeLabel: null)", () => {
  it("the stack under test is not a demo database", async () => {
    const env = await call<Body>(prodApi.app, "GET", "/api/v1/environment", { session: prodT01.reader });
    expect([env.status, env.body.kind, env.body.synthetic]).toEqual([200, "production", false]);
  });

  for (const { rt, lang, format } of CASES)
    it(`non-demo: ${rt} ${format} ${lang} has no label row and illustrativeLabel null`, async () => {
      const site = rt === "T01" ? prodT01 : prodT14;
      const res = await call<Body>(prodApi.app, "GET", exportUrl(site.transformationId, rt, format, lang), {
        session: site.reader,
      });
      expect(res.status).toBe(200);
      if (format === "csv") {
        const body = res.body as string;
        expect(body.split("\r\n")[0]!.startsWith(`${BOM}${HEADER[lang]}`)).toBe(true);
        expect(body).not.toContain(LABEL.en);
        expect(body).not.toContain(LABEL.ar);
      } else {
        expect(formRecordExport.safeParse(res.body).success).toBe(true);
        expect(res.body.illustrativeLabel).toBeNull();
        expect(res.body.rows.length).toBeGreaterThan(0);
      }
    });
});
