// qa-verifier A15 "Reporting" (T-DG5-QA-C): the selected records and spreadsheet safety, literal from the acceptance
// texts of REQ-S13-005 ("an XLSX export of T15 contains exactly the filtered RAID rows; a PPTX gate pack contains the
// gate's criteria") and REQ-S13-006 ("a RAID description '=HYPERLINK(...)' exports as text"; "User text starting with
// =, +, -, @, tab or CR is escaped"). Through the REAL API (generateReportSnapshot with the registers parameters,
// createExport, downloadExport) and the REAL worker export runner; the files are read back with the package's test
// readers. Expected values come from the DG4 list routes (GET …/raid?type=risk, GET …/gates/G1), never from the
// snapshot itself. All data is SYNTHETIC; the G1 submission is a synthetic in-product demo action and approves nothing.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  gateVersion,
  ifm,
  makeG1Ready,
  setupP2World,
  type P2World,
} from "../../../apps/api/test/support/p2-fixtures.ts";
import { seedWorld } from "../../../apps/api/test/support/harness.ts";
import { call, startApi, type TestApi } from "../support/api.ts";
import { contains, exportFile, ok, viewOf, type Body } from "../support/a15.ts";

let api: TestApi;
let p: P2World;
let T: string;
let riskRows: Body[] = [];
let issueRows: Body[] = [];
let snapshot: Body;
const created: { text: string; status: number; code?: string }[] = [];

/** Text that a spreadsheet would run as a formula if written raw (REQ-S13-006: =, +, -, @, tab, CR). */
const DANGEROUS = [
  '=HYPERLINK("http://example.invalid/qa-a15","open")',
  "+SUM(1,2) QA-A15 plus-prefixed risk text",
  "-2+3 QA-A15 minus-prefixed risk text",
  "@SUM(1,2) QA-A15 at-prefixed risk text",
  "\tQA-A15 tab-prefixed risk text",
  "\rQA-A15 CR-prefixed risk text",
];
const ISSUE_TEXT = "QA-A15 synthetic issue: must not appear in the risk-filtered export";
const PLAIN_RISK = 'QA-A15 synthetic risk, with a comma and "quotes"';

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  for (const [type, text] of [
    ...DANGEROUS.map((d) => ["risk", d] as const),
    ["risk", PLAIN_RISK] as const,
    ["issue", ISSUE_TEXT] as const,
  ]) {
    const r = await call<Body>(api.app, "POST", `${T}/raid`, {
      session: p.lead.session,
      body: {
        type,
        description: text,
        impact: "medium",
        ...(type === "risk" ? { probability: "low" } : {}),
        ownerUserId: p.lead.id,
      },
    });
    created.push({ text, status: r.status, ...(r.status === 201 ? {} : { code: r.body.code }) });
  }
  riskRows = ok(
    await call<Body>(api.app, "GET", `${T}/raid?type=risk&limit=100`, { session: p.lead.session }),
    200,
    "",
  ).items;
  issueRows = ok(
    await call<Body>(api.app, "GET", `${T}/raid?type=issue&limit=100`, { session: p.lead.session }),
    200,
    "",
  ).items;
  snapshot = ok(
    await call<Body>(api.app, "POST", `${T}/reports/registers/generate`, {
      session: p.lead.session,
      body: { parameters: { register: "raid", filters: { type: "risk" } } },
    }),
    201,
    "generate registers raid type=risk",
  );
}, 180_000);
afterAll(() => api?.close());

/** The texts the API accepted (a refused text, e.g. a control character, is reported, never silently dropped). */
const accepted = () => created.filter((c) => c.status === 201).map((c) => c.text);

describe("REQ-S13-005: an XLSX export of the RAID register contains exactly the filtered rows", () => {
  it("the dangerous texts and the plain risk were accepted by the API (the refusals, if any, are listed)", () => {
    // `=`, `+`, `-` and `@` are ordinary text a user may type; the API must store them (escaping is the exporter's job).
    const refused = created.filter((c) => c.status !== 201);
    // Evidence: which texts the API stored (201) and which it refused (status and problem code).
    console.info(
      `A15 RAID texts: ${JSON.stringify(created.map((c) => [JSON.stringify(c.text).slice(0, 24), c.status, c.code ?? null]))}`,
    );
    expect(refused.filter((r) => !/^[\t\r]/.test(r.text))).toEqual([]);
    expect(riskRows.length).toBe(accepted().length - 1); // every accepted text except the issue is a risk
    expect(issueRows.map((r) => r.description)).toEqual([ISSUE_TEXT]);
  });

  for (const language of ["en", "ar"] as const)
    it(`XLSX (${language}): the RAID codes in the workbook are exactly GET /raid?type=risk; no issue row`, async () => {
      const out = await exportFile(api, p.lead.session, { snapshotId: snapshot.id, format: "xlsx", language });
      const v = await viewOf("xlsx", out.bytes);
      const allCodes = new Set([...riskRows, ...issueRows].map((r) => r.code as string));
      const shown = new Set(v.pieces.filter((t) => allCodes.has(t)));
      expect([...shown].sort()).toEqual(riskRows.map((r) => r.code as string).sort());
      expect(contains(v, ISSUE_TEXT)).toBe(false);
      for (const r of riskRows) expect(v.pieces, `risk ${r.code}`).toContain(r.description);
      // One data row per risk: the row of each code carries that risk's own description.
      const sheet = v.xlsx!.sheets.find((s) => s.rows.some((row) => row.some((c) => allCodes.has(c.text ?? ""))))!;
      for (const r of riskRows) {
        const rows = sheet.rows.filter((row) => row.some((c) => c.text === r.code));
        expect(rows, `rows of ${r.code}`).toHaveLength(1);
        expect(rows[0]!.map((c) => c.text)).toContain(r.description);
      }
      expect(sheet.rtl).toBe(language === "ar");
    });
});

describe("REQ-S13-006: user text that starts like a formula exports as text (XLSX and CSV)", () => {
  it("XLSX: each such description is an inline string with a quote prefix, never a formula", async () => {
    const out = await exportFile(api, p.lead.session, { snapshotId: snapshot.id, format: "xlsx", language: "en" });
    const wb = (await viewOf("xlsx", out.bytes)).xlsx!;
    const cells = wb.sheets.flatMap((s) => s.rows.flat());
    // No formula anywhere carries user text (the HYPERLINK of the RAID description, or any other description).
    expect(cells.filter((c) => c.formula !== null && /HYPERLINK|QA-A15/i.test(c.formula))).toEqual([]);
    for (const text of accepted().filter((t) => DANGEROUS.includes(t))) {
      const cell = cells.find((c) => c.text === text);
      expect(cell, `cell for ${JSON.stringify(text)}`).toBeDefined();
      expect(cell!.formula).toBeNull();
      expect(cell!.type).toBe("inlineStr");
      expect(wb.quotePrefix[cell!.style], `quotePrefix for ${JSON.stringify(text)}`).toBe(true);
    }
    // A plain text keeps its exact characters and needs no prefix.
    const plainCell = cells.find((c) => c.text === PLAIN_RISK)!;
    expect(plainCell.formula).toBeNull();
  });

  it("CSV: each such description is written with a leading apostrophe; other text is unchanged", async () => {
    const out = await exportFile(api, p.lead.session, { snapshotId: snapshot.id, format: "csv", language: "en" });
    expect(Buffer.from(out.bytes).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf])); // UTF-8 BOM
    const v = await viewOf("csv", out.bytes);
    const fields = v.csvRows!.flat();
    for (const text of accepted().filter((t) => DANGEROUS.includes(t))) {
      expect(fields, `escaped ${JSON.stringify(text)}`).toContain(`'${text}`);
      expect(fields, `raw ${JSON.stringify(text)}`).not.toContain(text);
    }
    expect(fields).toContain(PLAIN_RISK);
    expect(fields.some((f) => f.includes(ISSUE_TEXT))).toBe(false);
    // No field starts with a formula trigger unless it is a declared number (CSV has no formulas, ADR-0046 §4).
    const triggers = fields.filter((f) => /^[=+@\t\r]/.test(f) || /^-(?!\d+(\.\d+)?$)/.test(f));
    expect(triggers).toEqual([]);
  });
});

describe("REQ-S13-005: a PPTX gate pack contains the gate's criteria", () => {
  let gate: Body;
  let pack: Body;
  beforeAll(async () => {
    await makeG1Ready(api, p);
    ok(
      await call<Body>(api.app, "POST", `${T}/gates/G1/submissions`, {
        session: p.lead.session,
        headers: ifm(await gateVersion(api, p, "G1")),
        body: {},
      }),
      201,
      "submit G1 (synthetic in-product demo submission; approves nothing)",
    );
    gate = ok(await call<Body>(api.app, "GET", `${T}/gates/G1`, { session: p.lead.session }), 200, "G1");
    pack = ok(
      await call<Body>(api.app, "POST", `${T}/reports/gate_pack/generate`, {
        session: p.lead.session,
        body: { subjectId: gate.gate.id },
      }),
      201,
      "gate_pack",
    );
  }, 120_000);

  for (const language of ["en", "ar"] as const)
    it(`PPTX (${language}) lists every criterion of G1 by its ${language} label`, async () => {
      expect(gate.criteria.length).toBeGreaterThan(0);
      const out = await exportFile(api, p.lead.session, { snapshotId: pack.id, format: "pptx", language });
      const v = await viewOf("pptx", out.bytes);
      const missing = gate.criteria
        .map((c: Body) => (language === "en" ? c.labelEn : c.labelAr) as string)
        .filter((label: string) => !contains(v, label));
      expect(missing).toEqual([]);
      expect(contains(v, "G1")).toBe(true);
      expect(v.rtl).toBe(language === "ar");
    });
});
