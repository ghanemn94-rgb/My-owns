// qa-verifier A15 "Reporting" on the DEMO transformation (T-DG5-QA-C). Literal from the acceptance texts of
// REQ-S13-004 ("each of the ten outputs ... generates from the demo transformation and contains that transformation's
// ID and records"), REQ-PB-089 ("every demo record and exported demo report shows the illustrative label in en and
// ar"; ADR-0050 §2 (d): every report and export generated in a demo database carries the illustrative label
// "Illustrative example — synthetic" / "مثال توضيحي — اصطناعي" in its header and on every page or sheet, and the
// snapshot records `synthetic: true`), REQ-S13-006 ("a system SUM total remains a formula") and REQ-S13-008 ("a pending
// benefit value is labelled provisional" in the PDF).
// The database is a scratch database of this run's disposable cluster, migrated and seeded with the REAL synthetic
// demo dataset (`seedDemo`, the International Roaming transformation; ADR-0050), and the REAL API runs on it with
// MTH_ENV=demo. A QA user with TO and TL grants in the demo organization generates and exports through the API; the
// worker export runner renders. Everything is SYNTHETIC: an illustrative example, not Mobily actual performance; any
// approval in the dataset is a synthetic in-product demonstration that approves nothing real. Nothing names DG0-DG7.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { DEMO_ANCHORS } from "../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { ifm } from "../../../apps/api/test/support/p2-fixtures.ts";
import { call, createUser, grant, signIn, startApi, type Session, type TestApi } from "../support/api.ts";
import { contains, exportFile, ok, viewOf, type Body, type Format, type FileView } from "../support/a15.ts";

const ORG = DEMO_ANCHORS.organizationId;
const T_ID = DEMO_ANCHORS.transformationId;
const T = `/api/v1/transformations/${T_ID}`;
const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const TEN = [
  "charter",
  "diagnostic",
  "tom",
  "business_cases",
  "roadmap",
  "registers",
  "meeting_minutes",
  "gate_pack",
  "executive_dashboard",
  "handover",
] as const;

let api: TestApi;
let scratch: string | null = null;
let qa: Session;
let qaId: string;
let transformation: Body;
let definitions: Body[] = [];
const snapshots = new Map<string, Body>();
/** Outputs that could not be generated on the demo transformation, with the API's answer (never silently skipped). */
const notGenerated: Record<string, string> = {};

async function gen(code: string, body: Record<string, unknown>): Promise<void> {
  const r = await call<Body>(api.app, "POST", `${T}/reports/${code}/generate`, { session: qa, body });
  if (r.status === 201) snapshots.set(code, r.body);
  else notGenerated[code] = `${r.status} ${r.body.code ?? ""} ${String(r.body.detail ?? "").slice(0, 200)}`;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_a15_demo");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const u = await createUser(api.db, ORG);
  qaId = u.id;
  for (const role of ["TO", "TL"])
    await grant(api.db, DEMO_ANCHORS.users.sp, u.id, role, { type: "organization", id: ORG }, ORG);
  qa = await signIn(api.app, u.subject);

  const env = ok(await call<Body>(api.app, "GET", "/api/v1/environment", { session: qa }), 200, "environment");
  expect(env).toMatchObject({ kind: "demo", synthetic: true });
  transformation = ok(await call<Body>(api.app, "GET", T, { session: qa }), 200, "demo transformation");
  definitions = ok(await call<Body>(api.app, "GET", "/api/v1/report-definitions", { session: qa }), 200, "").items;

  // A reporting period for the executive dashboard (none is part of the dataset).
  const base = `/api/v1/organizations/${ORG}/reporting-periods`;
  const period = ok(
    await call<Body>(api.app, "POST", base, {
      session: qa,
      body: {
        frequency: "monthly",
        periodLabel: "2041-07",
        periodStart: "2041-07-01",
        periodEnd: "2041-07-31",
        updateDueDate: "2041-08-10",
      },
    }),
    201,
    "period",
  );
  ok(await call<Body>(api.app, "POST", `${base}/${period.id}/open`, { session: qa, headers: ifm(1) }), 200, "open");

  for (const code of ["charter", "diagnostic", "tom", "business_cases", "roadmap"]) await gen(code, {});
  await gen("registers", { parameters: { register: "benefits" } });
  await gen("executive_dashboard", { reportingPeriodId: period.id });
  // The subjects come from the API: the demo transformation's G1 gate and its BAU handover (HO-01).
  const g1 = ok(await call<Body>(api.app, "GET", `${T}/gates/G1`, { session: qa }), 200, "G1");
  await gen("gate_pack", { subjectId: g1.gate.id });
  const handovers = ok(await call<Body>(api.app, "GET", `${T}/bau-handovers`, { session: qa }), 200, "handovers");
  expect(handovers.items.length).toBeGreaterThan(0);
  await gen("handover", { subjectId: handovers.items[0].id });
  // Meeting minutes need a meeting of the demo transformation; the dataset has forums but no meeting, so one is
  // created through the API (Transformation Review forum, chaired by the QA user).
  const forums = await call<Body>(api.app, "GET", `${T}/forums`, { session: qa });
  const forum = forums.status === 200 ? (forums.body.items as Body[])[0] : undefined;
  const meeting =
    forum === undefined
      ? { status: forums.status, body: forums.body }
      : await call<Body>(api.app, "POST", `${T}/meetings`, {
          session: qa,
          body: {
            forumId: forum.id,
            scheduledDate: "2041-07-15",
            startTime: "10:00",
            durationMinutes: 60,
            chairUserId: qaId,
          },
        });
  if (meeting.status === 201) await gen("meeting_minutes", { subjectId: meeting.body.id });
  else notGenerated["meeting_minutes"] = `meeting not created: ${meeting.status} ${meeting.body?.code ?? ""}`;
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch !== null) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

const labelShown = (v: FileView, lang: "en" | "ar") => contains(v, LABEL[lang]);

describe("REQ-S13-004 on the demo transformation: the ten outputs generate and contain its ID and records", () => {
  it("each of the ten outputs generates from the demo transformation", () => {
    console.info(`A15 demo: not generated: ${JSON.stringify(notGenerated)}`);
    expect(notGenerated).toEqual({});
    expect([...snapshots.keys()].sort()).toEqual([...TEN].sort());
  });

  it("each generated output names the demo transformation and cites its records as sources", async () => {
    for (const [code, s] of snapshots) {
      expect(s.transformationId, code).toBe(T_ID);
      expect(s.content.transformation.id, code).toBe(T_ID);
      const src = ok(
        await call<Body>(api.app, "GET", `${T}/report-snapshots/${s.id}/sources?limit=100`, { session: qa }),
        200,
        `sources ${code}`,
      );
      expect(src.items.length, `${code} cites at least one record`).toBeGreaterThan(0);
    }
  });

  it("each output's PDF (en and ar) contains the demo transformation's ID", async () => {
    const missing: string[] = [];
    for (const [code, s] of snapshots)
      for (const language of ["en", "ar"] as const) {
        const v = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: s.id, format: "pdf", language })).bytes);
        if (!contains(v, transformation.code)) missing.push(`${code}/${language}`);
      }
    expect(missing).toEqual([]);
  }, 300_000);
});

describe("REQ-PB-089: every exported demo report shows the illustrative label in en and ar (ADR-0050 §2 d)", () => {
  it("every generated demo snapshot records that it is synthetic", () => {
    const notMarked = [...snapshots].filter(([, s]) => s.content.synthetic !== true).map(([c]) => c);
    console.info(
      `A15 demo: snapshot content keys: ${JSON.stringify(Object.keys(snapshots.get("charter")?.content ?? {}))}`,
    );
    expect(notMarked).toEqual([]);
  });

  it("every format of every demo output, en and ar, prints the illustrative label", async () => {
    const unlabelled: string[] = [];
    const anyWording: string[] = [];
    for (const [code, s] of snapshots) {
      const def = definitions.find((d) => d.code === code)!;
      for (const format of def.formats as Format[])
        for (const language of ["en", "ar"] as const) {
          const out = await exportFile(api, qa, { snapshotId: s.id, format, language });
          const v = await viewOf(format, out.bytes);
          if (!labelShown(v, language)) unlabelled.push(`${code}/${format}/${language}`);
          // Evidence for the handback: does the file print the label in ANY wording (illustrative / توضيحي)?
          if (/illustrative/i.test(v.text) || v.text.includes("توضيحي"))
            anyWording.push(`${code}/${format}/${language}`);
        }
    }
    console.info(`A15 demo: files with any illustrative wording: ${JSON.stringify(anyWording)}`);
    expect(unlabelled).toEqual([]);
  }, 600_000);
});

describe("REQ-S13-006 / REQ-S13-008 on demo data with business cases and benefit values", () => {
  it("a system SUM total remains a formula in the XLSX of the business cases and of the benefits register", async () => {
    const found: Record<string, string[]> = {};
    for (const code of ["business_cases", "registers"]) {
      const s = snapshots.get(code);
      expect(s, code).toBeDefined();
      const v = await viewOf(
        "xlsx",
        (await exportFile(api, qa, { snapshotId: s!.id, format: "xlsx", language: "en" })).bytes,
      );
      found[code] = v
        .xlsx!.sheets.flatMap((sh) => sh.rows.flat())
        .flatMap((c) => (c.formula === null ? [] : [c.formula]));
    }
    console.info(`A15 demo XLSX formulas: ${JSON.stringify(found)}`);
    // Every formula the exporter writes is a SUM over one column range; at least one money/value column is totalled.
    for (const list of Object.values(found)) for (const f of list) expect(f).toMatch(/^SUM\([A-Z]+\d+:[A-Z]+\d+\)$/);
    expect(Object.values(found).flat().length).toBeGreaterThan(0);
  }, 120_000);

  it("a benefit value that is not validated is labelled provisional in the PDF (en and ar)", async () => {
    const s = snapshots.get("registers")!;
    // The register itself reports provisional values (a recorded count of the snapshot, ADR-0045 §5).
    expect(s.provisionalValueCount).toBeGreaterThan(0);
    // Every PDF prints the word once in its legend; a provisional VALUE adds its label next to the value. So the
    // benefits register shows the label more often than the charter (same environment, same legend).
    const count = (v: FileView, word: string) => v.text.split(word).length - 1;
    const charter = snapshots.get("charter")!;
    for (const [language, word] of [
      ["en", "Provisional"],
      ["ar", "مؤقت"],
    ] as const) {
      const reg = await viewOf("pdf", (await exportFile(api, qa, { snapshotId: s.id, format: "pdf", language })).bytes);
      const base = await viewOf(
        "pdf",
        (await exportFile(api, qa, { snapshotId: charter.id, format: "pdf", language })).bytes,
      );
      expect(count(reg, word), `${language}: "${word}" in the register vs the legend-only baseline`).toBeGreaterThan(
        count(base, word),
      );
    }
  }, 120_000);
});
