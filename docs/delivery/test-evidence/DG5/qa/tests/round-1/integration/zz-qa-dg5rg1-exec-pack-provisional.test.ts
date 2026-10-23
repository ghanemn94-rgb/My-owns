// qa-verifier DG5 clean re-gate round 1 (T-DG5-RG-QA-R1) — independent integration probe (copied into the disposable
// clone's tests/qa/integration/ for the run only; the candidate is frozen).
//  P1 REQ-S13-008 (A10/A15) "a pending benefit value is labelled provisional in the PDF PACK": the register notes
//     disclose that the proof is on the benefits-register PDF and that "a generated executive-pack PDF holding a
//     pending benefit value is not staged by any test". Here the REAL synthetic demo dataset (it holds submitted, i.e.
//     pending, benefit values) is seeded into a scratch database, the REAL API runs on it (MTH_ENV=demo), and the
//     EXECUTIVE PACK is generated for an open reporting period. The probe asserts: the snapshot holds at least one
//     benefit value whose state is submitted (pending) and labelled provisional; the PDF in en and ar prints the
//     provisional label ("Provisional" / "مؤقت") more often than a legend-only baseline (the charter PDF of the same
//     database), i.e. at least once next to a value.
//  P2 REQ-DLV-037 "exported PDF/DOCX/XLSX/PPTX samples are inspected in both languages": every format the executive
//     pack, the gate pack and the benefits register offer is exported in en and ar and written to $QA_SAMPLES_DIR for
//     visual inspection (rendered with LibreOffice outside this test). Each file must also carry the illustrative
//     demo label and the B0004 provenance statement in its language, and declare RTL in Arabic (null for CSV).
// Everything is SYNTHETIC (an illustrative example, not Mobily actual performance); nothing names DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { contains, exportFile, ok, viewOf, type Body, type Format } from "../support/a15.ts";

const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const WORD = { en: "Provisional", ar: "مؤقت" } as const;
const SAMPLES = process.env["QA_SAMPLES_DIR"];

let api: TestApi;
let scratch: string | null = null;
let qa: Session;
let provenance: { en: string; ar: string };
const snaps = new Map<string, Body>();

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_rg1_execpack");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"]) await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);
  const prov = ok(await call<Body>(api.app, "GET", "/api/v1/methodology/provenance", { session: qa }), 200, "provenance");
  provenance = { en: prov.statement.textEn, ar: prov.statement.textAr };
  const base = `/api/v1/organizations/${ORG}/reporting-periods`;
  const period = ok(
    await call<Body>(api.app, "POST", base, {
      session: qa,
      body: { frequency: "monthly", periodLabel: "2041-09", periodStart: "2041-09-01", periodEnd: "2041-09-30", updateDueDate: "2041-10-10" },
    }),
    201,
    "period",
  );
  ok(await call<Body>(api.app, "POST", `${base}/${period.id}/open`, { session: qa, headers: ifm(1) }), 200, "open");
  const gen = async (code: string, body: Record<string, unknown>) =>
    snaps.set(code, ok(await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: qa, body }), 201, `generate ${code}`));
  await gen("executive_pack", { reportingPeriodId: period.id });
  await gen("charter", {});
  await gen("registers", { parameters: { register: "benefits" } });
  const g1 = ok(await call<Body>(api.app, "GET", `${T}/gates/G1`, { session: qa }), 200, "G1");
  await gen("gate_pack", { subjectId: g1.gate.id });
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
});

/** Every value object in the snapshot content: { value | amount, validation, ... } with its JSON path. */
function valueStates(node: unknown, path = "$", out: { path: string; v: Body }[] = []): { path: string; v: Body }[] {
  if (Array.isArray(node)) node.forEach((x, i) => valueStates(x, `${path}[${i}]`, out));
  else if (node && typeof node === "object") {
    const o = node as Body;
    if (typeof o.validation === "string") out.push({ path, v: o });
    for (const [k, x] of Object.entries(o)) valueStates(x, `${path}.${k}`, out);
  }
  return out;
}

describe("QA P1 REQ-S13-008: the executive-pack PDF labels a pending benefit value provisional", () => {
  it("the demo executive pack holds a pending (submitted) benefit value labelled provisional", () => {
    const pack = snaps.get("executive_pack")!;
    const states = valueStates(pack.content);
    const prov = states.filter((s) => s.v.validation === "provisional");
    const pendingBenefit = prov.filter((s) => /benefit|value/i.test(s.path) && /submitted/i.test(JSON.stringify(s.v) + s.path));
    console.info(`QA-P1 executive_pack: ${states.length} value states, ${prov.length} provisional; pending-benefit candidates:`);
    for (const s of pendingBenefit.slice(0, 8)) console.info(`  ${s.path} ${JSON.stringify(s.v).slice(0, 240)}`);
    console.info(`QA-P1 executive_pack provisionalValueCount=${pack.provisionalValueCount}`);
    expect(prov.length).toBeGreaterThan(0);
    expect(pendingBenefit.length, "a submitted (pending) benefit value in the pack, labelled provisional").toBeGreaterThan(0);
  });

  it("the executive-pack PDF prints the provisional label next to a value, in en and ar", async () => {
    const count = (text: string, w: string) => text.split(w).length - 1;
    for (const lang of ["en", "ar"] as const) {
      const pack = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: snaps.get("executive_pack")!.id, format: "pdf", language: lang })).bytes);
      const base = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: snaps.get("charter")!.id, format: "pdf", language: lang })).bytes);
      const runs = (v: typeof pack) => (v.pdf?.shown ?? []).filter((x) => x.text.trim() === WORD[lang] || x.logical?.trim() === WORD[lang]).length;
      console.info(
        `QA-P1 ${lang}: "${WORD[lang]}" text count pack=${count(pack.text, WORD[lang])} charter=${count(base.text, WORD[lang])}; drawn runs pack=${runs(pack)} charter=${runs(base)}`,
      );
      expect(count(pack.text, WORD[lang])).toBeGreaterThan(count(base.text, WORD[lang]));
    }
  }, 240_000);
});

describe("QA P2 REQ-DLV-037: export samples in every offered format, en and ar, for visual inspection", () => {
  it("each sample carries the demo label and the B0004 provenance, and declares RTL in Arabic", async () => {
    const defs = ok(await call<Body>(api.app, "GET", "/api/v1/report-definitions", { session: qa }), 200, "defs").items as Body[];
    const failures: string[] = [];
    let n = 0;
    for (const code of ["executive_pack", "gate_pack", "registers"]) {
      const def = defs.find((d) => d.code === code)!;
      for (const format of def.formats as Format[])
        for (const lang of ["en", "ar"] as const) {
          const out = await exportFile(api, qa, { snapshotId: snaps.get(code)!.id, format, language: lang });
          n += 1;
          if (SAMPLES) {
            mkdirSync(SAMPLES, { recursive: true });
            writeFileSync(join(SAMPLES, `${code}.${lang}.${format}`), out.bytes);
          }
          const v = await viewOf(format, out.bytes);
          // Attempt 1 used a plain substring test, which cannot read Arabic PDF runs (shaped, visual order) or a DOCX
          // statement split across runs; the QA support matcher `contains` (the A15 suites' own) normalizes both.
          const has = (s: string) => contains(v, s);
          const rtlOk = format === "csv" ? v.rtl === null : v.rtl === (lang === "ar");
          console.info(
            `QA-P2 ${code}.${lang}.${format}: ${out.bytes.byteLength} bytes, label=${has(LABEL[lang])} provenance=${has(provenance[lang])} rtl=${v.rtl}`,
          );
          if (!has(LABEL[lang])) failures.push(`${code}.${lang}.${format}: no illustrative label`);
          if (!has(provenance[lang])) failures.push(`${code}.${lang}.${format}: no B0004 provenance`);
          if (!rtlOk) failures.push(`${code}.${lang}.${format}: rtl=${v.rtl}`);
        }
    }
    console.info(`QA-P2: ${n} files, ${failures.length} problem(s)`);
    expect(failures).toEqual([]);
  }, 600_000);
});
