// PDF, DOCX and PPTX exports end to end (T-DG5-BE-N; ADR-0046 §2, §3, §9; p5-work-split §F.6): a snapshot generated
// through the API, exported through POST /exports, rendered by the worker's export runner (apps/worker reports.export)
// and downloaded through GET /exports/{id}/download, against the run's disposable PostgreSQL. Proves:
//  - REQ-S13-005: a PPTX gate pack contains each criterion of the gate (read back from the PPTX XML, against the
//    snapshot's criteria and the gate definition); the RAID register PDF contains exactly the filtered rows;
//  - REQ-S13-009: an Arabic PDF of a register has a right-to-left base direction, embeds IBM Plex Sans Arabic, and
//    keeps its identifiers (RAID-nnn) and numbers in left-to-right order; an English PDF is left to right; Arabic DOCX
//    paragraphs are bidi;
//  - REQ-S13-008: a pending benefit value prints "Provisional"/"مؤقت" in the PDF; a generated (not issued) snapshot
//    carries "Draft — not an issued report".
// All data is SYNTHETIC. Product gates G1-G6 are business approvals inside the product; nothing here submits,
// approves or decides a gate, and nothing touches the engineering gates.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readOoxml, xmlTexts } from "../../../../../packages/reporting/src/ooxml-read.ts";
import { drawsArabic, lines, readPdf } from "../../../../../packages/reporting/src/pdf/read.ts";
import { FilesystemExportStore } from "../../../../../packages/reporting/src/storage.ts";
import { runExport } from "../../../../worker/src/reports/export-runner.ts";
import {
  call,
  seedWorld,
  startApi,
  testEvidenceDir,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { benefitAt, insertSubmittedMeasurement, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let p: P2World;
let b: BenefitWorld;
const riskCodes: string[] = [];
let issueCode: string;

const ok = (res: { status: number; body: unknown }, status: number, what: string): Body => {
  expect(res.status, `${what}: ${JSON.stringify(res.body).slice(0, 800)}`).toBe(status);
  return res.body as Body;
};

/** Exports a snapshot, runs the worker's handler once, and returns the downloaded bytes. */
async function exported(snapshotId: string, format: string, language: string, session: Session): Promise<Buffer> {
  const job = ok(
    await call<Body>(api.app, "POST", "/api/v1/exports", { session, body: { snapshotId, format, language } }),
    202,
    `export ${format} ${language}`,
  );
  const row = await api.db
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
  const outcome = await runExport(
    api.db,
    envelope,
    row.id,
    { retryCount: 0, retryLimit: 5 },
    { store: new FilesystemExportStore(testEvidenceDir()) },
  );
  expect(outcome, `${format} ${language}`).toMatchObject({ outcome: "succeeded" });
  const done = ok(await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}`, { session }), 200, "getExport");
  expect(done).toMatchObject({ status: "succeeded", stage: "done", percent: 100 });
  const file = await call<Body>(api.app, "GET", `/api/v1/exports/${job.id}/download`, { session });
  expect(file.status).toBe(200);
  const bytes = Buffer.from(file.raw.rawPayload);
  // Opt-in: keep the downloaded files as A15 samples (MTH_SAMPLES_DIR; never set in the suites).
  const samples = process.env["MTH_SAMPLES_DIR"];
  if (samples !== undefined && samples !== "") writeFileSync(join(samples, `${done.fileName as string}`), bytes);
  return bytes;
}

async function generate(base: string, code: string, body: Record<string, unknown>, session: Session): Promise<Body> {
  return ok(
    await call<Body>(api.app, "POST", `${base}/reports/${code}/generate`, { session, body }),
    201,
    `generate ${code}`,
  );
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  b = await seedBenefitWorld(api, w);
  const raid = async (type: string, description: string) =>
    ok(
      await call<Body>(api.app, "POST", `${b.base}/raid`, {
        session: b.s.tl,
        body: {
          type,
          description,
          impact: "medium",
          ...(type === "risk" ? { probability: "medium" } : {}),
          ownerUserId: b.users.bo.id,
        },
      }),
      201,
      "createRaidEntry",
    );
  riskCodes.push((await raid("risk", "مخاطرة تأخر مورد التجوال بقيمة 1,250.50")).code);
  riskCodes.push((await raid("risk", "Synthetic roaming partner delay")).code);
  issueCode = (await raid("issue", "Synthetic issue outside the filter")).code;
  const m = await benefitAt(api, b, "measure");
  await insertSubmittedMeasurement(api.db, b, m.id, "1000");
}, 120_000);
afterAll(() => api.close());

describe("PDF register exports (REQ-S13-009, REQ-S13-005)", () => {
  it("Arabic: RTL base direction, IBM Plex Sans Arabic embedded, identifiers and numbers left to right; only the filtered rows", async () => {
    const s = await generate(
      b.base,
      "registers",
      { parameters: { register: "raid", filters: { type: "risk" } } },
      b.s.tl,
    );
    const pdf = readPdf(await exported(s.id, "pdf", "ar", b.s.tl));
    expect(pdf.raw).toContain("/Lang (ar-SA)");
    expect(pdf.raw).toMatch(/\/Direction \/R2L/);
    for (const font of new Set(pdf.shown.map((x) => x.baseFont)))
      expect(font).toMatch(/^[A-Z]{6}\+IBMPlexSansArabic-(Regular|Bold)$/);
    const all = lines(pdf);
    // Each risk's identifier (e.g. RAID-001) in its own order; the issue (filtered out) is absent.
    for (const c of riskCodes)
      expect(
        all.some((l) => l.includes(c)),
        c,
      ).toBe(true);
    expect(all.some((l) => l.includes(issueCode))).toBe(false);
    // The Arabic description: its number keeps its order, its words read right to left.
    expect(all.some((l) => l.includes("1,250.50"))).toBe(true);
    for (const word of ["مخاطرة", "تأخر", "مورد", "التجوال", "بقيمة"]) expect(drawsArabic(pdf, word), word).toBe(true);
    expect(all.some((l) => l.includes(s.id))).toBe(true);
    // A generated snapshot: the Arabic Draft line.
    expect(drawsArabic(pdf, "مسودة")).toBe(true);
  });

  it("English: left to right with IBM Plex Sans; 'Draft — not an issued report'", async () => {
    const s = await generate(
      b.base,
      "registers",
      { parameters: { register: "raid", filters: { type: "risk" } } },
      b.s.tl,
    );
    const pdf = readPdf(await exported(s.id, "pdf", "en", b.s.tl));
    expect(pdf.raw).toContain("/Lang (en-GB)");
    expect(pdf.raw).not.toContain("/Direction /R2L");
    expect(pdf.shown.find((x) => x.text.includes("Mobily"))!.baseFont).toMatch(/IBMPlexSans-Bold$/);
    expect(lines(pdf).some((l) => l.includes("Draft — not an issued report"))).toBe(true);
  });
});

describe("REQ-S13-008: a pending benefit value is labelled provisional in the PDF", () => {
  it("prints Provisional (en) and مؤقت (ar) for the pending value", async () => {
    const s = await generate(b.base, "registers", { parameters: { register: "benefits" } }, b.s.tl);
    const table = s.content.sections.find((x: Body) => x.kind === "table");
    const pending = table.rows.flatMap((r: Body) => r.cells).find((c: Body) => c.valueBasis === "submitted");
    expect(pending).toMatchObject({ value: "1000.0000", validation: "provisional" });
    // The legend prints each label once; every further "Provisional" run labels a value (the pending amount and its
    // count), so a value labelled provisional means at least two runs.
    const en = readPdf(await exported(s.id, "pdf", "en", b.s.tl));
    expect(lines(en).some((l) => l.includes("1,000"))).toBe(true);
    expect(en.shown.filter((x) => x.text.trim() === "Provisional").length).toBeGreaterThanOrEqual(2);
    const ar = readPdf(await exported(s.id, "pdf", "ar", b.s.tl));
    expect(drawsArabic(ar, "مؤقت")).toBe(true);
    expect(ar.shown.filter((x) => x.logical.trim() === "مؤقت").length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});

describe("REQ-S13-005: a PPTX gate pack contains each criterion of the gate", () => {
  it("every criterion of G2 (key, English and Arabic label) is in the PPTX, in both languages; DOCX Arabic is bidi", async () => {
    const T = `/api/v1/transformations/${p.transformationId}`;
    const view = ok(await call<Body>(api.app, "GET", `${T}/gates/G2`, { session: p.lead.session }), 200, "gate G2");
    const s = await generate(T, "gate_pack", { subjectId: view.gate.id }, p.lead.session);
    const criteria = s.content.sections.find((x: Body) => x.key === "criteria");
    const col = (key: string) => criteria.columns.findIndex((c: Body) => c.key === key);
    const keys = criteria.rows.map((r: Body) => r.cells[col("criterion")].value);
    expect(keys).toEqual(view.definition.criteria.map((c: Body) => c.key));
    expect(keys.length).toBeGreaterThan(0);
    for (const language of ["en", "ar"]) {
      const pptx = await readOoxml(
        await exported(s.id, "pptx", language, p.lead.session),
        /^ppt\/slides\/slide\d+\.xml$/,
      );
      const xml = [...pptx.parts.values()].join("");
      const texts = xmlTexts(xml);
      for (const r of criteria.rows) {
        expect(texts, `${language} ${r.cells[col("criterion")].value}`).toContain(r.cells[col("criterion")].value);
        expect(texts).toContain(r.cells[col("label_en")].value);
        expect(texts).toContain(r.cells[col("label_ar")].value);
      }
      if (language === "ar") expect(xml).toMatch(/<a:pPr[^>]*rtl="1"/);
    }
    const docx = await readOoxml(await exported(s.id, "docx", "ar", p.lead.session), /^word\/document\.xml$/);
    const body = docx.parts.get("word/document.xml")!;
    expect(body).toContain("<w:bidi/>");
    expect(body).toContain("<w:bidiVisual/>");
    for (const r of criteria.rows) expect(body).toContain(r.cells[col("criterion")].value);
  }, 90_000);
});
