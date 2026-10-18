// qa-verifier DG5 round 1 probe (T-DG5-REV-QA-R1B; outside the frozen candidate; run from a scratch copy in the
// disposable clone's tests/qa/integration/). Literal probes of:
//  - REQ-S13-008 "a pending benefit value is labelled provisional in the PDF pack": the register note discloses that
//    no test stages a generated PACK holding a pending benefit value (QA-C gap G2). Here the executive_pack and the
//    gate_pack of the seeded synthetic demo transformation are generated; the probe looks for a benefit value whose
//    validation is provisional in the pack content, and for the Provisional / مؤقت label in the PDF (en and ar).
//  - REQ-DLV-037 "exported PDF/DOCX/XLSX/PPTX samples are inspected in both languages": writes one sample of each
//    format in en and ar to QA_DG5R1_SAMPLES for visual inspection (rendered separately with LibreOffice).
// The demo dataset is SYNTHETIC (illustrative example, not Mobily actual performance); nothing approves anything.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { contains, exportFile, ok, viewOf, type Body } from "../support/a15.ts";

const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const OUT = process.env["QA_DG5R1_SAMPLES"] ?? join(process.env["TMPDIR"] ?? ".", "qa-dg5r1-samples");

let api: TestApi;
let scratch: string | null = null;
let qa: Session;
let periodId: string;

/** Every value object in a snapshot's content that carries a `validation` label, with its path. */
function labelled(node: unknown, path: string, out: { path: string; v: Body }[]): void {
  if (Array.isArray(node)) node.forEach((n, i) => labelled(n, `${path}[${i}]`, out));
  else if (node !== null && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o["validation"] === "string") out.push({ path, v: o });
    for (const [k, v] of Object.entries(o)) labelled(v, `${path}.${k}`, out);
  }
}

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_dg5r1_pack");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"]) await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);
  const base = `/api/v1/organizations/${ORG}/reporting-periods`;
  // The demo dataset already holds the monthly period 2026-08 (the submitted revenue_uplift.2026-08 line is in it).
  const periods = ok(await call<Body>(api.app, "GET", `${base}?limit=100`, { session: qa }), 200, "periods").items as Body[];
  console.info(`QA-DG5R1 demo periods: ${JSON.stringify(periods.map((p) => [p.periodLabel, p.status]))}`);
  const period = periods.find((p) => p.periodLabel === "2026-08");
  expect(period, "demo period 2026-08").toBeDefined();
  periodId = period.id;
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("REQ-S13-008 probe: a pending benefit value in a generated PDF PACK", () => {
  for (const [code, body] of [
    ["executive_pack", () => ({ reportingPeriodId: periodId })],
    ["executive_dashboard", () => ({ reportingPeriodId: periodId })],
  ] as const)
    it(`${code}: provisional benefit values in the content, and the label in the PDF (en, ar)`, async () => {
      const s = ok(await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: qa, body: body() }), 201, code);
      const all: { path: string; v: Body }[] = [];
      labelled(s.content, "content", all);
      const prov = all.filter((x) => x.v.validation === "provisional");
      // A field is {key, label..., value}; the value's parent field names the headline. A pending (submitted, not yet
      // Finance-validated) benefit value is a currency value with valueBasis "submitted".
      const fieldOf = (path: string) => path.replace(/\.value$/, "");
      const get = (path: string): Body =>
        path.replace(/^content/, "").split(/\.|\[|\]/).filter(Boolean).reduce((o: Body, k) => o?.[k], s.content);
      const benefitProv = prov
        .filter((x) => x.v.valueBasis === "submitted")
        .map((x) => ({ path: x.path, field: JSON.stringify(get(fieldOf(x.path))).slice(0, 400) }));
      console.info(`QA-DG5R1 ${code}: pending (submitted) provisional values: ${JSON.stringify(benefitProv)}`);
      const nonZeroPending = prov.filter((x) => x.v.valueBasis === "submitted" && x.v.value !== "0");
      console.info(`QA-DG5R1 ${code}: non-zero pending values: ${nonZeroPending.length}`);
      console.info(
        `QA-DG5R1 ${code}: labelled=${all.length} provisional=${prov.length} benefit-provisional=${benefitProv.length} ` +
          `provisionalValueCount=${s.provisionalValueCount}; first provisional: ${JSON.stringify(prov.slice(0, 3)).slice(0, 900)}`,
      );
      for (const language of ["en", "ar"] as const) {
        const out = await exportFile(api, qa, { snapshotId: s.id, format: "pdf", language });
        writeFileSync(join(OUT, `${code}-${language}.pdf`), out.bytes);
        const v = await viewOf("pdf", out.bytes);
        const word = language === "en" ? "Provisional" : "مؤقت";
        const n = v.text.split(word).length - 1;
        console.info(`QA-DG5R1 ${code} ${language}: "${word}" occurrences=${n}; rtl=${v.rtl}`);
        expect(v.rtl).toBe(language === "ar");
        const charter = ok(await call<Body>(api.app, "POST", `${T}/reports/charter/generate`, { session: qa, body: {} }), 201, "charter");
        const base = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: charter.id, format: "pdf", language })).bytes);
        const nb = base.text.split(word).length - 1;
        console.info(`QA-DG5R1 ${code} ${language}: legend-only baseline (charter PDF) occurrences=${nb}`);
        expect(n, `${code}/${language} prints the provisional label beyond the legend`).toBeGreaterThan(nb);
      }
      expect(benefitProv.length, `${code}: at least one pending benefit value`).toBeGreaterThan(0);
      expect(nonZeroPending.length, `${code}: a non-zero pending benefit value (period 2026-08 holds a submitted line)`).toBeGreaterThan(0);
    }, 300_000);
});

describe("REQ-DLV-037 probe: export samples in both languages for inspection", () => {
  it("writes PDF, DOCX, XLSX and PPTX samples (en, ar) of the gate pack and the benefits register", async () => {
    const g1 = ok(await call<Body>(api.app, "GET", `${T}/gates/G1`, { session: qa }), 200, "G1");
    const gate = ok(await call<Body>(api.app, "POST", `${T}/reports/gate_pack/generate`, { session: qa, body: { subjectId: g1.gate.id } }), 201, "gate_pack");
    const reg = ok(await call<Body>(api.app, "POST", `${T}/reports/registers/generate`, { session: qa, body: { parameters: { register: "benefits" } } }), 201, "registers");
    const defs = ok(await call<Body>(api.app, "GET", "/api/v1/report-definitions", { session: qa }), 200, "defs").items as Body[];
    const written: string[] = [];
    for (const [code, snap] of [["gate_pack", gate], ["registers", reg]] as const) {
      const formats = defs.find((d) => d.code === code)!.formats as string[];
      console.info(`QA-DG5R1 ${code} formats: ${formats.join(",")}`);
      for (const format of ["pdf", "docx", "xlsx", "pptx"] as const) {
        if (!formats.includes(format)) continue;
        for (const language of ["en", "ar"] as const) {
          const out = await exportFile(api, qa, { snapshotId: snap.id, format, language });
          const f = `${code}-${language}.${format}`;
          writeFileSync(join(OUT, f), out.bytes);
          const v = await viewOf(format, out.bytes);
          expect(v.rtl, f).toBe(language === "ar");
          expect(contains(v, language === "en" ? "Illustrative example — synthetic" : "مثال توضيحي — اصطناعي"), `${f} demo label`).toBe(true);
          written.push(`${f} ${out.bytes.byteLength}B`);
        }
      }
    }
    console.info(`QA-DG5R1 samples written: ${written.join("; ")}`);
    expect(written.length).toBeGreaterThanOrEqual(8);
  }, 600_000);
});
