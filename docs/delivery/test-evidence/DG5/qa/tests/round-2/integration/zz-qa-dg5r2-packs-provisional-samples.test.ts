// qa-verifier DG5 round 2 (T-DG5-REV-QA-R2; round-1 probe re-run with G1-G5 packs now that G1-G4 are seeded approved) independent probe. NOT part of the candidate: copied into a disposable
// clone's tests/qa/integration/ only for the run, then removed.
//
// P-S13-008: REQ-S13-008 acceptance "a pending benefit value is labelled provisional in the PDF pack". The candidate's
// own proof uses the benefits-register PDF (register notes: "a generated executive-pack PDF holding a pending benefit
// value is not staged by any test"). This probe stages it: the REAL synthetic demo dataset (its benefit measurements
// are SUBMITTED, i.e. pending Finance validation), the executive pack and a gate pack generated through the API, and
// the PDFs rendered by the REAL worker export runner, in en and ar.
// P-DLV-037: writes PDF/DOCX/XLSX/PPTX samples (en, ar) of the executive pack, a gate pack and the T15 RAID register to
// QA_SAMPLES_DIR for manual inspection. Everything is SYNTHETIC (illustrative example, not Mobily actual performance).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { lines } from "../../../packages/reporting/src/pdf/read.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { exportFile, ok, rtlLines, squash, viewOf, type Body, type Format } from "../support/a15.ts";

const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const SAMPLES = process.env["QA_SAMPLES_DIR"] ?? path.join("test-results", "qa-r2-samples");
const WORD = { en: "Provisional", ar: "مؤقت" } as const;

let api: TestApi;
let scratch: string | null = null;
let qa: Session;
const snaps = new Map<string, Body>();

/** Every object in the snapshot content whose `validation` is provisional, with its JSON path. */
function provisionalValues(node: unknown, at = "content"): Array<{ at: string; v: Body }> {
  if (node === null || typeof node !== "object") return [];
  const out: Array<{ at: string; v: Body }> = [];
  const o = node as Record<string, unknown>;
  if (o["validation"] === "provisional") out.push({ at, v: o });
  for (const [k, child] of Object.entries(o)) out.push(...provisionalValues(child, `${at}.${k}`));
  return out;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_r2_packs");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  for (const role of ["TO", "TL"])
    await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);
  const base = `/api/v1/organizations/${ORG}/reporting-periods`;
  // The demo dataset already has its reporting periods: use its newest one (the dataset's own owner updates and
  // benefit measurements belong to it). Only when there is none, create and open 2041-07 (as the A15 demo suite does).
  const periods = ok(await call<Body>(api.app, "GET", `${base}?limit=100`, { session: qa }), 200, "periods");
  console.info(`probe demo periods: ${JSON.stringify((periods.items as Body[]).map((p) => [p.periodLabel, p.status]))}`);
  let period = (periods.items as Body[]).sort((x, y) => String(y.periodStart).localeCompare(String(x.periodStart)))[0];
  if (period === undefined) {
    period = ok(
      await call<Body>(api.app, "POST", base, {
        session: qa,
        body: { frequency: "monthly", periodLabel: "2041-07", periodStart: "2041-07-01", periodEnd: "2041-07-31", updateDueDate: "2041-08-10" },
      }),
      201,
      "period",
    );
    ok(await call<Body>(api.app, "POST", `${base}/${period.id}/open`, { session: qa, headers: ifm(1) }), 200, "open");
  }
  const gen = async (key: string, code: string, body: Record<string, unknown>) => {
    const r = await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: qa, body });
    expect(r.status, `${key}: ${JSON.stringify(r.body).slice(0, 400)}`).toBe(201);
    snaps.set(key, r.body);
  };
  await gen("executive_pack", "executive_pack", { reportingPeriodId: period.id });
  for (const gk of ["G1", "G2", "G3", "G4", "G5"]) {
    const g = await call<Body>(api.app, "GET", `${T}/gates/${gk}`, { session: qa });
    if (g.status === 200) await gen(`gate_pack_${gk}`, "gate_pack", { subjectId: g.body.gate.id });
    else console.info(`probe: gate ${gk} not readable: ${g.status}`);
  }
  await gen("registers_raid", "registers", { parameters: { register: "raid" } });
  await gen("registers_benefits", "registers", { parameters: { register: "benefits" } });
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("P-S13-008: a pending benefit value is labelled provisional in the PDF pack", () => {
  it("the executive pack's snapshot holds provisional benefit values (submitted value, pending Finance)", () => {
    const s = snaps.get("executive_pack")!;
    const prov = provisionalValues(s.content);
    console.info(`probe exec pack provisional values (${prov.length}): ${JSON.stringify(prov.slice(0, 12).map((p) => [p.at, p.v.label ?? p.v.labelEn ?? p.v.key ?? null, p.v.value ?? p.v.amount ?? null]))}`);
    console.info(`probe exec pack provisionalValueCount=${s.provisionalValueCount}`);
    expect(prov.length).toBeGreaterThan(0);
  });

  for (const key of ["executive_pack", "gate_pack_G1", "gate_pack_G2", "gate_pack_G3", "gate_pack_G4", "gate_pack_G5"])
    it(`${key}: every PDF (en, ar) prints the provisional label on the lines of its provisional values`, async () => {
      const s = snaps.get(key);
      if (s === undefined) return; // gate not readable: logged in beforeAll
      const prov = provisionalValues(s.content);
      for (const language of ["en", "ar"] as const) {
        const v = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: s.id, format: "pdf", language })).bytes);
        // en: the visual lines; ar: the lines read right to left with each Arabic run in logical order (rtlLines,
        // the reader the A15 suites use for Arabic PDFs), compared without diacritics/tatweel (squash).
        const ls = language === "ar" ? rtlLines(v.pdf!) : lines(v.pdf!);
        const labelled = ls.filter((l) => l.includes(WORD[language]) || squash(l).includes(squash(WORD[language])));
        console.info(`probe ${key}/${language}: provisional values in snapshot=${prov.length}; PDF lines with "${WORD[language]}" (${labelled.length}): ${JSON.stringify(labelled.slice(0, 10))}`);
        // The legend prints the word once on every PDF; a provisional value must add at least one more.
        if (prov.length > 0) expect(labelled.length, `${key}/${language}`).toBeGreaterThan(1);
      }
    }, 180_000);
});

describe("P-DLV-037: PDF/DOCX/XLSX/PPTX samples in en and ar for manual inspection", () => {
  it("writes the samples and checks each is non-empty, RTL in ar and LTR in en", async () => {
    mkdirSync(SAMPLES, { recursive: true });
    const plan: Array<[string, Format[]]> = [
      ["executive_pack", ["pdf", "docx", "pptx"]],
      ["gate_pack_G1", ["pdf", "docx", "pptx"]],
      ["gate_pack_G4", ["pdf", "docx", "pptx"]],
      ["registers_raid", ["pdf", "xlsx", "csv"]],
      ["registers_benefits", ["xlsx"]],
    ];
    const summary: string[] = [];
    for (const [key, formats] of plan) {
      const s = snaps.get(key)!;
      for (const format of formats)
        for (const language of ["en", "ar"] as const) {
          const out = await exportFile(api, qa, { snapshotId: s.id, format, language });
          const file = path.join(SAMPLES, `${key}-${language}.${format}`);
          writeFileSync(file, out.bytes);
          const v = await viewOf(format, out.bytes);
          summary.push(`${key}-${language}.${format}: ${out.bytes.byteLength} B, rtl=${v.rtl}, pieces=${v.pieces.length}`);
          expect(out.bytes.byteLength).toBeGreaterThan(500);
          if (v.rtl !== null) expect(v.rtl, `${key}/${format}/${language}`).toBe(language === "ar");
        }
    }
    console.info(`probe samples:\n${summary.join("\n")}`);
  }, 600_000);
});
