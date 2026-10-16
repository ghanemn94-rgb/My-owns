// qa-verifier A15 "Reporting" (T-DG5-QA-C; master prompt §20 A15: "Executive pack and relevant PDF/DOCX/XLSX/PPTX
// outputs contain current selected data, correct provenance and readable Arabic/English layout").
// Derived from the acceptance texts of REQ-S13-004, REQ-S13-005, REQ-S13-006, REQ-S13-009, REQ-S20-015 and
// docs/api/openapi.yaml (listReportDefinitions, generateReportSnapshot, createExport, getExport, downloadExport,
// getMethodologyProvenance), not from the implementation. Through the REAL API on the run's disposable PostgreSQL and
// the REAL worker export runner (tests/qa/support/a15.ts), for EVERY report definition the API lists, EVERY format it
// offers, in English AND Arabic, the downloaded file is read back and must show:
//  - the transformation's ID (its code) and the subject's own records (current selected data);
//  - the snapshot it was rendered from (its id) and the B0004 provenance statement in the export language, exactly as
//    GET /methodology/provenance returns it;
//  - English: the English title, left-to-right; Arabic: the Arabic title, right-to-left, and NO English fallback of a
//    frame or content label (D-157 a);
// plus the refusals the contract names (format not offered, an export of another user's job).
// The world fixtures (P2, meeting and sustainment worlds) are the backend's synthetic test fixtures, reused only to
// stage records through the DG4 API; every assertion here is the acceptance suite's own. All data is SYNTHETIC; a G1
// submission here is a synthetic in-product demo action that approves nothing real. Nothing here names DG0-DG7.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedSustainmentWorld } from "../../../apps/api/test/integration/contract/p4-exercises-be-i.ts";
import { setupMeetingWorld } from "../../../apps/api/test/integration/governance/meeting-fixtures.ts";
import { draftHandover, richMeetings } from "../../../apps/api/test/integration/reporting/kbe-d2-fixtures.ts";
import {
  gateVersion,
  ifm,
  makeG1Ready,
  setupP2World,
  type P2World,
} from "../../../apps/api/test/support/p2-fixtures.ts";
import { seedWorld, type World } from "../../../apps/api/test/support/harness.ts";
import { call, createUser, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import {
  CONTENT_TYPES,
  contains,
  englishFallbacks,
  exportFile,
  ok,
  viewOf,
  type Body,
  type FileView,
  type Format,
  type Lang,
} from "../support/a15.ts";

let api: TestApi;
let w: World;
let p: P2World;
let definitions: Body[] = [];
let provenance: { en: string; ar: string };

interface Case {
  readonly snapshot: Body;
  readonly session: Session;
  /** The transformation the output is about: its id and code (the ID a reader sees). */
  readonly transformation: { id: string; code: string; name: string };
  /** Literal texts of the subject's own records that the output must carry (current selected data). */
  readonly records: string[];
}
const cases: Case[] = [];
/** Files (definition/format/language) that do not print the B0004 provenance statement in their language. */
const provenanceMissing: string[] = [];
let matrixRan = false;

const RAID_TEXT = "QA-A15 synthetic risk: roaming partner settlement delay";
const REVIEW_ITEM = "Synthetic: integrated status of the roaming workstream";

async function transformationOf(id: string, session: Session) {
  const t = ok(await call<Body>(api.app, "GET", `/api/v1/transformations/${id}`, { session }), 200, "transformation");
  return { id, code: t.code as string, name: t.name as string };
}

async function generate(t: string, code: string, session: Session, body: Record<string, unknown> = {}) {
  return ok(
    await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/reports/${code}/generate`, { session, body }),
    201,
    `generate ${code}`,
  );
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  const T = p.transformationId;
  await makeG1Ready(api, p);
  const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
  definitions = ok(await send("GET", "/api/v1/report-definitions", { session: p.lead.session }), 200, "defs").items;
  const prov = ok(await send("GET", "/api/v1/methodology/provenance", { session: p.lead.session }), 200, "prov");
  expect(prov.statement.blockRef).toBe("B0004");
  provenance = { en: prov.statement.textEn, ar: prov.statement.textAr };

  // A monthly reporting period (executive dashboard and pack need one) and a workstream.
  const office = await signIn(api.app, w.office.subject);
  const base = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const period = ok(
    await send("POST", base, {
      session: office,
      body: {
        frequency: "monthly",
        periodLabel: "2041-05",
        periodStart: "2041-05-01",
        periodEnd: "2041-05-31",
        updateDueDate: "2041-06-10",
      },
    }),
    201,
    "period",
  );
  ok(await send("POST", `${base}/${period.id}/open`, { session: office, headers: ifm(1) }), 200, "open period");
  ok(
    await send("POST", `/api/v1/transformations/${T}/workstreams`, {
      session: p.lead.session,
      body: { name: "QA-A15 synthetic workstream", leadUserId: null },
    }),
    201,
    "workstream",
  );
  ok(
    await send("POST", `/api/v1/transformations/${T}/raid`, {
      session: p.lead.session,
      body: { type: "risk", description: RAID_TEXT, impact: "high", probability: "medium", ownerUserId: p.lead.id },
    }),
    201,
    "raid",
  );

  const tP2 = await transformationOf(T, p.lead.session);
  const add = (snapshot: Body, records: string[], session = p.lead.session, t = tP2) =>
    cases.push({ snapshot, session, transformation: t, records });
  for (const code of ["charter", "diagnostic", "tom", "business_cases", "roadmap"])
    add(await generate(T, code, p.lead.session), []);
  add(await generate(T, "registers", p.lead.session, { parameters: { register: "raid" } }), [RAID_TEXT]);
  for (const code of ["executive_dashboard", "executive_pack"])
    add(await generate(T, code, p.lead.session, { reportingPeriodId: period.id }), ["2041-05"]);
  const g1 = ok(await send("GET", `/api/v1/transformations/${T}/gates/G1`, { session: p.lead.session }), 200, "G1");
  ok(
    await send("POST", `/api/v1/transformations/${T}/gates/G1/submissions`, {
      session: p.lead.session,
      headers: ifm(await gateVersion(api, p, "G1")),
      body: {},
    }),
    201,
    "submit G1 (synthetic in-product demo submission; approves nothing)",
  );
  add(await generate(T, "gate_pack", p.lead.session, { subjectId: g1.gate.id }), ["G1"]);

  const x = await setupMeetingWorld(api, w);
  const m = await richMeetings(api, x);
  const tM = await transformationOf(x.transformationId, x.lead.session);
  add(
    await generate(x.transformationId, "meeting_minutes", x.lead.session, { subjectId: m.review.id }),
    [REVIEW_ITEM],
    x.lead.session,
    tM,
  );
  add(
    await generate(x.transformationId, "meeting_pack", x.lead.session, { subjectId: m.steerco.id }),
    [],
    x.lead.session,
    tM,
  );

  const s = await seedSustainmentWorld(api, w);
  const h = await draftHandover(api, s);
  const tS = await transformationOf(s.b.transformationId, s.wl.session);
  add(await generate(s.b.transformationId, "handover", s.wl.session, { subjectId: h.id }), [], s.wl.session, tS);
}, 300_000);
afterAll(() => api?.close());

/** Every check of one file; returns the failed checks (empty = the file is as the acceptance text requires). */
function checkFile(c: Case, def: Body, format: Format, lang: Lang, v: FileView, headers: Record<string, unknown>) {
  const fails: string[] = [];
  const need = (cond: boolean, what: string) => {
    if (!cond) fails.push(what);
  };
  need(String(headers["content-type"]).startsWith(CONTENT_TYPES[format]), `content-type ${headers["content-type"]}`);
  need(/^attachment; filename="[^"]+\.\w+"$/.test(String(headers["content-disposition"])), "attachment");
  // Current selected data: the transformation's ID and the subject's own records.
  need(contains(v, c.transformation.code), `transformation ID ${c.transformation.code}`);
  for (const r of c.records) need(contains(v, r), `record text "${r}"`);
  // Provenance: the snapshot it was rendered from and the B0004 statement in the export language.
  need(contains(v, c.snapshot.id), `snapshot id ${c.snapshot.id}`);
  // (the B0004 statement is checked per format in its own test below: provenanceMissing)
  if (!contains(v, provenance[lang])) provenanceMissing.push(`${def.code}/${format}/${lang}`);
  // Readable layout in the selected language.
  if (lang === "ar") {
    need(contains(v, def.labelAr), `Arabic title "${def.labelAr}"`);
    need(!v.pieces.some((piece) => piece.trim() === def.labelEn), `English title "${def.labelEn}" in an Arabic file`);
    const fallbacks = englishFallbacks(v);
    need(fallbacks.length === 0, `English label fallbacks: ${JSON.stringify(fallbacks.slice(0, 12))}`);
    if (format !== "csv") need(v.rtl === true, `right-to-left layout (read: ${v.rtl})`);
  } else {
    need(contains(v, def.labelEn), `English title "${def.labelEn}"`);
    if (format !== "csv") need(v.rtl === false, `left-to-right layout (read: ${v.rtl})`);
  }
  return fails;
}

describe("A15: every report definition, every offered format, en and ar (REQ-S13-004/005/009, REQ-S20-015)", () => {
  it("the API lists the twelve definitions and each one was generated here", () => {
    expect(definitions.map((d) => d.code).sort()).toEqual(
      [
        "business_cases",
        "charter",
        "diagnostic",
        "executive_dashboard",
        "executive_pack",
        "gate_pack",
        "handover",
        "meeting_minutes",
        "meeting_pack",
        "registers",
        "roadmap",
        "tom",
      ].sort(),
    );
    expect(new Set(cases.map((c) => c.snapshot.definitionCode))).toEqual(new Set(definitions.map((d) => d.code)));
    // The ten M0253 outputs are generated outputs; every generated snapshot names its transformation.
    expect(definitions.filter((d) => d.outputKind === "generated_output")).toHaveLength(10);
    for (const c of cases) expect(c.snapshot.content.transformation.id).toBe(c.transformation.id);
  });

  it("every file carries its data, provenance and readable en/ar layout", async () => {
    const failures: Record<string, string[]> = {};
    const dumpDir = process.env["QA_A15_DUMP"];
    let files = 0;
    for (const c of cases) {
      const def = definitions.find((d) => d.code === c.snapshot.definitionCode)!;
      for (const format of def.formats as Format[])
        for (const lang of ["en", "ar"] as const) {
          const out = await exportFile(api, c.session, { snapshotId: c.snapshot.id, format, language: lang });
          files++;
          expect(out.job).toMatchObject({ snapshotId: c.snapshot.id, format, language: lang, status: "succeeded" });
          const v = await viewOf(format, out.bytes);
          const fails = checkFile(c, def, format, lang, v, out.headers);
          const key = `${def.code}/${format}/${lang}`;
          if (fails.length > 0) failures[key] = fails;
          if (dumpDir) {
            mkdirSync(dumpDir, { recursive: true });
            writeFileSync(join(dumpDir, `${def.code}-${c.snapshot.id.slice(-6)}.${lang}.${format}`), out.bytes);
          }
        }
    }
    expect(files).toBeGreaterThanOrEqual(2 * definitions.reduce((n, d) => n + d.formats.length, 0));
    matrixRan = true;
    expect(failures).toEqual({});
  }, 600_000);

  it("every file, in every format, prints the B0004 provenance statement in its language (ADR-0046 §2, REQ-PB-001)", () => {
    expect(matrixRan, "the export matrix above must have run").toBe(true);
    expect(provenanceMissing).toEqual([]);
  });

  it("a format the definition does not offer is refused (422 export.format_not_offered); nothing is queued", async () => {
    const charter = cases.find((c) => c.snapshot.definitionCode === "charter")!;
    const def = definitions.find((d) => d.code === "charter")!;
    const notOffered = (["pdf", "docx", "xlsx", "pptx", "csv"] as const).find((f) => !def.formats.includes(f))!;
    const before = await api.db.selectFrom("export_job").select("id").execute();
    const res = await call<Body>(api.app, "POST", "/api/v1/exports", {
      session: p.lead.session,
      body: { snapshotId: charter.snapshot.id, format: notOffered, language: "ar" },
    });
    expect([res.status, res.body.code]).toEqual([422, "export.format_not_offered"]);
    expect((await api.db.selectFrom("export_job").select("id").execute()).length).toBe(before.length);
  });

  it("an export is the requester's own: another user of the organization gets 404 on the job and the file", async () => {
    const charter = cases.find((c) => c.snapshot.definitionCode === "charter")!;
    const out = await exportFile(api, p.lead.session, {
      snapshotId: charter.snapshot.id,
      format: "pdf",
      language: "en",
    });
    const other = await createUser(api.db, w.orgA.id);
    const s = await signIn(api.app, other.subject);
    for (const suffix of ["", "/download"]) {
      const r = await call<Body>(api.app, "GET", `/api/v1/exports/${out.job.id}${suffix}`, { session: s });
      expect(r.status).toBe(404);
    }
  });
});
