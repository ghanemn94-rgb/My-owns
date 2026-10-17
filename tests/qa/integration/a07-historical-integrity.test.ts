// A07 "Historical integrity" (qa-verifier, T-DG5-QA-B). Scenario (master prompt §20 A07): "Target/formula changes show
// impact and reapproval; previous period reports and approved snapshots remain intact".
//
// Every assertion is derived from the acceptance texts of the A07 rows in docs/delivery/requirements.csv and from
// docs/api/openapi.yaml, never from the implementation:
//  - REQ-S07-016: "a prospective target change leaves last quarter's RAG unchanged; a restatement of Q1 without
//    authority is rejected; the Q1 report issued earlier is unchanged and a reissue creates version 2";
//  - REQ-S13-007: "after a later KPI change, the issued snapshot still shows the old values and their versions";
//  - REQ-S12-018: "proposing a formula change lists affected benefits and creates a review task";
//  - REQ-S06-008: "after publishing v2, an existing transformation still renders v1 forms; the migration preview lists
//    the new required field and a required G2 reapproval; historical records remain unchanged" (the history part:
//    an approved gate decision and the approved gate pack issued before the migration);
//  - REQ-S06-009: "after rollback, records created under the rolled-back version remain retrievable and the audit
//    trail shows the rollback";
//  - REQ-S20-007 / REQ-DLV-037: the A07 executable test itself.
// "Previous period reports and approved snapshots remain intact" (assignment note) is checked literally: four issued
// snapshots (the Q1 executive dashboard, the KPI and benefit registers, the APPROVED G2 gate pack) and five files
// exported from them before any change (PDF en, XLSX ar, DOCX ar) are re-read after EACH of a target change, a formula
// change, a methodology migration and a KPI restatement: the snapshot reads are equal field by field (content,
// contentSha256, as-of, period, methodology version, approval state, version references) and every exported file
// downloads byte-identical (sha-256 of the bytes equal to the sha recorded before and to the job's fileSha256).
//
// Through the REAL Fastify app on a disposable PostgreSQL (tests/qa/support/with-pg.sh). The configuration is changed
// ONLY through the Studio API operations the UI calls (draft -> checks -> configured review -> publish). Each publish
// changes the SHARED seeded keys (`forms`, `playbook`), so the suite runs on its OWN scratch database migrated from the
// same files (the A06 pattern). The export job is run by the REAL worker export runner and an approved restatement by
// the REAL worker kpi.recalculate consumer, delivered through the harness (no worker process in the test API).
// Amounts are compared as decimal strings. All data is SYNTHETIC. Every approval here (gate decisions by a synthetic
// Sponsor, a change request and a restatement decided by a synthetic Business Owner, a configuration review by the
// office) is a synthetic in-product action on test data: it approves nothing real, and product gates G1-G6 are
// business approvals inside the product that never touch the engineering delivery gates.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate } from "../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { runRestatementEvents } from "../../../apps/api/test/integration/kpi-restatements/decision-fixtures.ts";
import {
  acceptedActual,
  quarter,
  quarterlyKpi,
  RESTATED_FLOW,
  stepQuarter,
  type Quarter,
} from "../../../apps/api/test/integration/kpi-restatements/fixtures.ts";
import { postVersion } from "../../../apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts";
import { call, createUser, grant, signIn, startApi, type Res, type Session, type TestApi } from "../support/api.ts";
import { exportFile, type Format, type Lang } from "../support/a15.ts";
import { QUESTION_CODES } from "../support/a16.ts";
import { passGatesNatively, seedNativeGateWorld, type NativeGateWorld } from "../support/gates-native.ts";
import {
  approvedTrajectory,
  asBenefitWorld,
  canon,
  dashboardWorld,
  financialBody,
  mapPartyTo,
  runRecalculation,
  seedWorld,
  type KpiWorld,
  type World,
} from "../support/p4.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const V = "/api/v1/admin/methodology-versions";
const F = "/api/v1/benefit-formulas";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** The KPI's calculation version: flow, sum, direct accept, target 100 by the end of 2085 (after the quarters used). */
const FLOW_2085 = Object.freeze({ ...RESTATED_FLOW, targetDate: "2085-12-31" });

let api: TestApi;
let scratchDb: string;
let w: World;
let adm: Session; // ADM_METHOD (methodology admin): drafts, publishes, plans migrations
let admId: string;
let office: Session; // TO: the organization's office, the configured configuration reviewer, opens/closes periods
let k: KpiWorld; // transformation K: a quarterly KPI, an outcome, a benefit on a formula
let g: NativeGateWorld; // transformation G: G1 and G2 approved natively (synthetic Sponsor)
let q1: Quarter;
let q2: Quarter;
let kpi: { id: string; v1: Body };
let outcomeKpiId: string;
let formula: { id: string; version: number };
let benefitId: string;
let lead: Session; // TL at BU a1 (creates transformation R for the rollback case)

let lastCall = "";
const send = (method: string, url: string, session: Session, body?: unknown, headers?: Record<string, string>) =>
  ((lastCall = `${method} ${url}`), call<Body>)(api.app, method, url, {
    session,
    ...(body !== undefined ? { body } : {}),
    ...(headers ? { headers } : {}),
  });
const show = (r: Res<Body>) => `${lastCall} -> ${r.status} ${JSON.stringify(r.body).slice(0, 900)}`;
function expectStatus(r: Res<Body>, status: number | number[]): Body {
  const ok = Array.isArray(status) ? status : [status];
  expect(ok, show(r)).toContain(r.status);
  return r.body;
}
function expectCode(r: Res<Body>, status: number, code: string): void {
  expect(r.status, show(r)).toBe(status);
  expect(String(r.headers["content-type"])).toContain("application/problem+json");
  expect(r.body.code, show(r)).toBe(code);
}

// ------------------------------------------------------------------------------------------------ snapshot ledger

/** What must never change about an issued snapshot: its read (minus the supersession fields) and its versions. */
interface Issued {
  readonly label: string;
  readonly base: string;
  readonly id: string;
  readonly session: Session;
  readonly read: Body;
  readonly versions: Body[];
  readonly sources: Body;
}
interface ExportedFile {
  readonly label: string;
  readonly jobId: string;
  readonly session: Session;
  readonly sha256: string;
  readonly size: number;
}
const issued: Issued[] = [];
const files: ExportedFile[] = [];

/** The fields of a snapshot read that a reissue may set (supersession only); everything else is frozen at issue. */
const frozen = (s: Body) => {
  const { status, supersededAt: _at, supersededById: _by, version: _version, ...rest } = s;
  return { ...rest, status: status === "superseded" ? "issued" : status };
};
const S = (base: string) => `${base}/report-snapshots`;

async function generateAndIssue(base: string, session: Session, code: string, body: Body): Promise<Body> {
  const gen = expectStatus(await send("POST", `${base}/reports/${code}/generate`, session, body), 201);
  const iss = expectStatus(
    await send(
      "POST",
      `${S(base)}/${gen.id}/issue`,
      session,
      { note: `Synthetic A07 issue of ${code}` },
      ifm(gen.version),
    ),
    200,
  );
  expect([iss.status, iss.issueVersion]).toEqual(["issued", 1]);
  return iss;
}
async function remember(label: string, base: string, id: string, session: Session): Promise<Issued> {
  const read = expectStatus(await send("GET", `${S(base)}/${id}`, session), 200);
  const versions = expectStatus(await send("GET", `${S(base)}/${id}/versions`, session), 200).items as Body[];
  const sources = expectStatus(await send("GET", `${S(base)}/${id}/sources`, session), 200);
  const rec = { label, base, id, session, read, versions, sources };
  issued.push(rec);
  return rec;
}
async function exportOnce(label: string, session: Session, snapshotId: string, format: Format, language: Lang) {
  const out = await exportFile(api, session, { snapshotId, format, language });
  const digest = sha(out.bytes);
  expect(out.job.fileSha256, `${label}: the job records the file's sha-256`).toBe(digest);
  files.push({ label, jobId: out.job.id, session, sha256: digest, size: out.bytes.byteLength });
}

/** Every issued snapshot reads as it did when issued, and every exported file downloads byte-identical. */
async function expectHistoryIntact(after: string): Promise<void> {
  for (const s of issued) {
    const now = expectStatus(await send("GET", `${S(s.base)}/${s.id}`, s.session), 200);
    expect(frozen(now), `${s.label} after ${after}`).toEqual(frozen(s.read));
    expect(now.contentSha256, `${s.label} hash after ${after}`).toBe(s.read.contentSha256);
    const versions = expectStatus(await send("GET", `${S(s.base)}/${s.id}/versions`, s.session), 200).items;
    expect(versions, `${s.label} versions after ${after}`).toEqual(s.versions);
    const sources = expectStatus(await send("GET", `${S(s.base)}/${s.id}/sources`, s.session), 200);
    expect(sources, `${s.label} sources after ${after}`).toEqual(s.sources);
  }
  for (const f of files) {
    const job = expectStatus(await send("GET", `/api/v1/exports/${f.jobId}`, f.session), 200);
    expect([job.status, job.fileSha256, job.fileSizeBytes], `${f.label} job after ${after}`).toEqual([
      "succeeded",
      f.sha256,
      f.size,
    ]);
    const res = await call<Body>(api.app, "GET", `/api/v1/exports/${f.jobId}/download`, { session: f.session });
    expect(res.status, `${f.label} download after ${after}`).toBe(200);
    expect(sha(new Uint8Array(res.raw.rawPayload)), `${f.label} bytes after ${after}`).toBe(f.sha256);
  }
}

// ------------------------------------------------------------------------------------------------ report readers

/** The Q1 dashboard row of the KPI (the outcome KPI item): its RAG cell and its value cells. */
function dashboardKpiRow(doc: Body): { rag: Body; values: string[] } {
  const section = (doc.sections as Body[]).find((x) => x.key === "items_outcomes");
  expect(section, `items_outcomes among ${(doc.sections as Body[]).map((x) => x.key).join(",")}`).toBeDefined();
  const row = (section.rows as Body[]).find((r) => r.recordId === outcomeKpiId);
  expect(row, "the KPI's row in the Q1 dashboard").toBeDefined();
  const ragAt = (section.columns as Body[]).findIndex((c) => c.key === "rag");
  expect(ragAt).toBeGreaterThanOrEqual(0);
  const values = (row.cells as Body[])
    .filter((c) => typeof c.value === "string" && /^-?\d+(\.\d+)?$/.test(c.value))
    .map((c) => canon(c.value)!);
  return { rag: row.cells[ragAt], values };
}
/** Every decimal string carried by the register rows about record `id`. */
function registerDecimals(doc: Body, id: string): string[] {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (typeof x === "string" && /^-?\d+(\.\d+)?$/.test(x)) out.push(canon(x)!);
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x !== null && typeof x === "object") Object.values(x).forEach(walk);
  };
  for (const sec of doc.sections as Body[]) for (const r of sec.rows ?? []) if (r.recordId === id) walk(r);
  return out;
}
const kpiStatus = async (period: Quarter) =>
  expectStatus(
    await send("GET", `${k.base}/kpi-definitions/${kpi.id}/status?reportingPeriodId=${period.id}`, k.s.auditor),
    200,
  );

// ------------------------------------------------------------------------------------------------ Studio helpers

const versionOf = async (id: string): Promise<Body> => expectStatus(await send("GET", `${V}/${id}`, adm), 200);
async function newestPublished(kind: string, key: string): Promise<Body> {
  const items = expectStatus(await send("GET", `${V}?kind=${kind}&status=published`, adm), 200).items as Body[];
  const hit = items.find((v) => v.key === key && v.isNewestPublished);
  expect(hit, `newest published ${kind}/${key}`).toBeDefined();
  return hit;
}
async function step(id: string, path: string, body?: Body, status: number | number[] = [200, 201]) {
  const cur = await versionOf(id);
  return expectStatus(await send("POST", `${V}/${id}/${path}`, adm, body, ifm(cur.version)), status);
}
/** The UI pipeline: compatibility (+ source coverage for methodology), preview, review by the office, publish. */
async function publishPipeline(id: string, kind: string): Promise<Body> {
  expect(["pass", "warn"]).toContain((await step(id, "compatibility-checks")).result);
  if (kind === "methodology")
    expect(["pass", "warn"]).toContain(
      expectStatus(await send("POST", "/api/v1/admin/source-coverage/runs", adm, { versionId: id }), [200, 201]).result,
    );
  expect((await step(id, "preview", { samples: [] })).result).not.toBe("fail");
  const review = await step(id, "submit-review", { note: "Synthetic A07 change for review" });
  expectStatus(
    await send(
      "POST",
      `${V}/${id}/reviews/${review.id}/decision`,
      office,
      { outcome: "approve", note: "Synthetic review" },
      ifm(review.version),
    ),
    200,
  );
  const p = await step(id, "publish", undefined, 200);
  expect([p.status, p.isNewestPublished]).toEqual(["published", true]);
  return p;
}
async function putElement(id: string, type: string, key: string, attributes: Body) {
  const cur = await versionOf(id);
  return send("PUT", `${V}/${id}/elements/${type}/${encodeURIComponent(key)}`, adm, { attributes }, ifm(cur.version));
}

/** The resolved elements of a version (every page), as (type, key, removed, attributes), sorted. */
async function elementsOf(id: string): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  do {
    const page = expectStatus(
      await send("GET", `${V}/${id}/elements?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, adm),
      200,
    );
    for (const e of page.items as Body[])
      out.push({ t: e.elementType, k: e.stableKey, removed: e.removed, a: e.attributes, c: e.catalogueAttributes });
    cursor = page.nextCursor;
  } while (cursor);
  return out.sort((x, y) => `${x.t}:${x.k}`.localeCompare(`${y.t}:${y.k}`));
}

// ------------------------------------------------------------------------------------------------ world

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_qa_a07");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  const a = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, a.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  admId = a.id;
  adm = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  const l = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, l.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  lead = await signIn(api.app, l.subject);

  // Transformation K: quarterly KPI (target 100, higher is better), Q1 2085 actual 90 accepted while Q1 was open.
  k = await dashboardWorld(api, w);
  q1 = await quarter(api, w, 2085, 1, office);
  q2 = await quarter(api, w, 2085, 2, office);
  await stepQuarter(api, w, q1, "open", office);
  kpi = await quarterlyKpi(api, k, FLOW_2085);
  // An approved trajectory (expected 100 at the end of Q1), so the Q1 RAG is a calculated colour, not Unknown.
  await approvedTrajectory(api, k, kpi.id, [
    { pointDate: "2085-03-31", expectedValue: "100" },
    { pointDate: "2085-12-31", expectedValue: "100" },
  ]);
  outcomeKpiId = expectStatus(
    await send("POST", `${k.base}/outcome-kpis`, k.s.tl, {
      outcomeId: k.outcomeId,
      kpiDefinitionId: kpi.id,
      targetDate: "2085-12-31",
    }),
    201,
  ).id;
  await acceptedActual(api, k, kpi.id, q1, "90");
  await stepQuarter(api, w, q1, "close", office);
  await stepQuarter(api, w, q2, "open", office);

  // A benefit of K valued by a T09 formula (version 1).
  const b = asBenefitWorld(k, w, kpi.id);
  const f = expectStatus(
    await send("POST", F, k.s.tl, {
      transformationId: k.transformationId,
      benefitName: "Synthetic A07 roaming uplift",
      initialVersion: {
        expression: "eligible_customers * uplift",
        variables: [
          { name: "eligible_customers", kind: "number", period: "none", value: "1000" },
          { name: "uplift", kind: "number", period: "none", value: "2.5" },
        ],
      },
    }),
    201,
  );
  formula = { id: f.id, version: f.version };
  benefitId = expectStatus(
    await send(
      "POST",
      `${k.base}/benefits`,
      k.s.tl,
      financialBody(b as never, { title: "Synthetic A07 roaming uplift", benefitFormulaId: f.id }),
    ),
    201,
  ).id;

  // Transformation G: G1 and G2 approved natively, pinned to the shipped methodology.
  g = await seedNativeGateWorld(api, w, "A07");
  await passGatesNatively(api, g, ["G1", "G2"], "2030-12-31");

  // The history that must remain intact: four issued snapshots and five files exported from them.
  const dash = await generateAndIssue(k.base, k.s.tl, "executive_dashboard", { reportingPeriodId: q1.id });
  await remember("Q1 executive dashboard", k.base, dash.id, k.s.tl);
  const kpis = await generateAndIssue(k.base, k.s.tl, "registers", { parameters: { register: "kpis" } });
  await remember("KPI register", k.base, kpis.id, k.s.tl);
  const bens = await generateAndIssue(k.base, k.s.tl, "registers", { parameters: { register: "benefits" } });
  await remember("benefit register", k.base, bens.id, k.s.tl);
  const g2 = expectStatus(await send("GET", `${g.gates}/G2`, g.tl.session), 200);
  const pack = await generateAndIssue(g.base, g.tl.session, "gate_pack", { subjectId: g2.gate.id });
  await remember("approved G2 gate pack", g.base, pack.id, g.tl.session);
  await exportOnce("Q1 dashboard PDF (en)", k.s.tl, dash.id, "pdf", "en");
  await exportOnce("Q1 dashboard XLSX (ar)", k.s.tl, dash.id, "xlsx", "ar");
  await exportOnce("KPI register PDF (ar)", k.s.tl, kpis.id, "pdf", "ar");
  await exportOnce("benefit register XLSX (en)", k.s.tl, bens.id, "xlsx", "en");
  await exportOnce("G2 gate pack DOCX (ar)", g.tl.session, pack.id, "docx", "ar");
}, 600_000);
afterAll(async () => {
  await api?.close();
  if (scratchDb) await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
}, 60_000);

// ------------------------------------------------------------------------------------------------ the scenario

describe("A07 historical integrity: target, formula, methodology and restatement changes leave history intact", () => {
  let q1Before: Body;
  let v2: Body;
  let changeRequestId: string;

  it("REQ-S13-007: an issued snapshot retains as-of, period, source revisions, methodology and calculation versions and approval state", async () => {
    const [dash, kpis, , pack] = issued;
    for (const s of issued) {
      expect(s.read.status).toBe("issued");
      expect(s.read.asOf, s.label).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(s.read.methodologyVersionId, s.label).toMatch(/^[0-9a-f-]{36}$/);
      expect(s.read.contentSha256, s.label).toMatch(/^[0-9a-f]{64}$/);
    }
    expect([
      dash!.read.reportingPeriodId,
      dash!.read.periodLabel,
      dash!.read.periodStart,
      dash!.read.periodEnd,
    ]).toEqual([q1.id, "2085-Q1", "2085-01-01", "2085-03-31"]);
    // The KPI register records the calculation version its values were computed with: the KPI's version 1.
    expect(kpis!.versions.filter((x) => x.versionKind === "kpi_version").map((x) => x.referenceId)).toContain(
      kpi.v1.id,
    );
    for (const s of issued)
      expect(
        s.versions.filter((x) => x.versionKind === "methodology_version").map((x) => x.referenceId),
        s.label,
      ).toContain(s.read.methodologyVersionId);
    // The approved snapshot: the gate pack of an approved G2.
    expect(pack!.read.approvalState).toBe("approved");
    // The Q1 values as issued: actual 90 against target 100, with a known RAG.
    const row = dashboardKpiRow(dash!.read.content);
    expect(row.values).toContain("90");
    q1Before = await kpiStatus(q1);
    expect([canon(q1Before.actual), canon(q1Before.finalTarget), q1Before.kpiVersionId]).toEqual([
      "90",
      "100",
      kpi.v1.id,
    ]);
    expect(["red", "amber", "green"]).toContain(q1Before.calculatedRag);
    expect(row.rag.value).toBe(q1Before.calculatedRag);
    expect(registerDecimals(kpis!.read.content, kpi.id)).toContain("100");
  });

  it("REQ-S13-007: the issued Q1 dashboard retains the calculation version and source revision of the KPI value it shows", () => {
    const dash = issued[0]!;
    // The dashboard shows the KPI's Q1 actual (90; checked above), so it must retain the KPI version that value was
    // calculated with and the KPI among its source records (row text: "source record revisions ... calculation
    // versions").
    expect(dashboardKpiRow(dash.read.content).values).toContain("90");
    expect(
      dash.versions.filter((x) => x.versionKind === "kpi_version").map((x) => x.referenceId),
      `the Q1 dashboard's versions: ${JSON.stringify(dash.versions)}`,
    ).toContain(kpi.v1.id);
    const sourceTypes = (dash.sources.items as Body[]).map((x) => `${x.recordType}:${x.recordId}`);
    expect(
      sourceTypes.some((x) => x.includes(kpi.id) || x.startsWith("kpi_")),
      `a KPI source record among ${JSON.stringify(sourceTypes)}`,
    ).toBe(true);
  });

  it("REQ-S07-016: a prospective target change (100 -> 120, approved) leaves last quarter's RAG unchanged; history intact", async () => {
    v2 = expectStatus(
      await postVersion(api, k, kpi.id, { ...FLOW_2085, targetValue: "120", changeReason: "Synthetic A07 stretch" }),
      201,
    );
    await mapPartyTo(api, k, "BO", k.users.bo.id);
    const def = expectStatus(await send("GET", `${k.base}/kpi-definitions/${kpi.id}`, k.s.tl), 200);
    const CR = `${k.base}/change-requests`;
    const cr = expectStatus(
      await send("POST", CR, k.s.tl, {
        changeKind: "target",
        subjectType: "kpi_definition",
        subjectId: kpi.id,
        subjectVersion: def.version,
        proposedRecordType: "kpi_version",
        proposedRecordId: v2.id,
        proposedChange: { targetValue: { from: "100", to: "120" } },
        reason: "Synthetic A07: a stretch target agreed by the business owner",
      }),
      201,
    );
    changeRequestId = cr.id;
    // The change shows its impact before the decision: material, and the KPI's outcome changes value.
    const impact = expectStatus(await send("GET", `${CR}/${cr.id}/impact-preview`, k.s.tl), 200);
    expect(impact.materiality).toBe("material");
    const outcomeItem = (impact.items as Body[]).find((i) => i.recordId === k.outcomeId);
    expect(outcomeItem, JSON.stringify(impact.items)).toBeDefined();
    expect(outcomeItem.effect).toBe("value_changes");
    // ... and it needs a (re)approval before it applies: the submission routes it to a business decision.
    const sub = expectStatus(await send("POST", `${CR}/${cr.id}/submit`, k.s.tl, undefined, ifm(cr.version)), 200);
    expect(sub.approvalId, "an approval routed for the material target change").toMatch(/^[0-9a-f-]{36}$/);
    const pending = expectStatus(await send("GET", `${k.base}/kpi-versions/${v2.id}`, k.s.tl), 200);
    expect(pending.status, "v2 is not in force before the decision").not.toBe("active");
    const appr = expectStatus(await send("GET", `/api/v1/approvals/${sub.approvalId}`, k.s.bo), 200);
    expectStatus(
      await send(
        "POST",
        `/api/v1/approvals/${sub.approvalId}/decisions`,
        k.s.bo,
        { outcome: "approve", rationale: "Synthetic A07 decision.", subjectVersion: appr.subjectVersion },
        ifm(appr.version),
      ),
      200,
    );
    await runRecalculation(api, v2.id);
    const now = expectStatus(await send("GET", `${k.base}/kpi-versions/${v2.id}`, k.s.tl), 200);
    expect([now.status, canon(now.targetValue)]).toEqual(["active", "120"]);

    // Last quarter (Q1, closed) keeps its RAG and its evaluation: the change applies prospectively.
    const q1After = await kpiStatus(q1);
    expect([q1After.calculatedRag, q1After.displayedRag, q1After.evaluationId, canon(q1After.actual)]).toEqual([
      q1Before.calculatedRag,
      q1Before.displayedRag,
      q1Before.evaluationId,
      "90",
    ]);
    // The Q1 evaluation in force is still the one calculated with version 1 against target 100.
    const evaluation = await api.db
      .selectFrom("kpi_evaluation")
      .select(["kpi_version_id", "final_target", "calculated_rag"])
      .where("id", "=", q1After.evaluationId)
      .executeTakeFirstOrThrow();
    expect([evaluation.kpi_version_id, canon(String(evaluation.final_target)), evaluation.calculated_rag]).toEqual([
      kpi.v1.id,
      "100",
      q1Before.calculatedRag,
    ]);
    // The live Q1 dashboard (refreshing, not a snapshot) shows the same Q1 RAG.
    const live = expectStatus(
      await send("GET", `${k.base}/reports/executive_dashboard/live?reportingPeriodId=${q1.id}`, k.s.tl),
      200,
    );
    expect(live.snapshotId).toBeNull();
    expect(dashboardKpiRow(live.document).rag.value).toBe(q1Before.calculatedRag);
    // The issued KPI register still shows the old target 100 and cites version 1, never 120 / version 2.
    const reg = issued[1]!;
    const regNow = expectStatus(await send("GET", `${S(reg.base)}/${reg.id}`, k.s.tl), 200);
    expect(registerDecimals(regNow.content, kpi.id)).toContain("100");
    expect(registerDecimals(regNow.content, kpi.id)).not.toContain("120");
    const versions = expectStatus(await send("GET", `${S(reg.base)}/${reg.id}/versions`, k.s.tl), 200).items as Body[];
    expect(versions.map((x) => x.referenceId)).not.toContain(v2.id);
    await expectHistoryIntact("the target change");
  });

  it("REQ-S12-018: proposing a formula change lists the affected benefit and creates a review task; history intact", async () => {
    const res = expectStatus(
      await send(
        "POST",
        `${F}/${formula.id}/versions`,
        k.s.tl,
        {
          expression: "eligible_customers * uplift",
          variables: [
            { name: "eligible_customers", kind: "number", period: "none", value: "1000" },
            { name: "uplift", kind: "number", period: "none", value: "3.0" },
          ],
          changeNote: "Synthetic A07: revised uplift assumption",
        },
        ifm(formula.version),
      ),
      201,
    );
    const proposals = expectStatus(
      await send(
        "GET",
        `/api/v1/admin/revision-proposals?subjectType=benefit_formula_version&subjectId=${res.id}`,
        k.s.auditor,
      ),
      200,
    ).items as Body[];
    expect(proposals).toHaveLength(1);
    const p = proposals[0];
    expect([p.subjectType, p.subjectId, p.transformationId, p.validationResult]).toEqual([
      "benefit_formula_version",
      res.id,
      k.transformationId,
      "pass",
    ]);
    expect((p.impact.affectedBenefits as Body[]).map((x) => x.benefitId)).toContain(benefitId);
    expect(p.reviewTaskCount).toBeGreaterThanOrEqual(1);
    // The review task is in the configured reviewer's (FIN's) own My Work, about the proposed formula version.
    const mine = expectStatus(await send("GET", "/api/v1/me/work-items?limit=100", k.s.fin), 200).items as Body[];
    const task = mine.find((x) => x.subjectId === res.id);
    expect(
      task,
      `a review task for ${res.id} among ${JSON.stringify(mine.map((x) => [x.kind, x.subjectId]))}`,
    ).toBeDefined();
    expect([task.kind, task.status, task.assigneeUserId]).toEqual(["config_review", "open", k.users.fin.id]);
    // The editor is not its own reviewer.
    const editor = expectStatus(await send("GET", "/api/v1/me/work-items?limit=100", k.s.tl), 200).items as Body[];
    expect(editor.some((x) => x.subjectId === res.id)).toBe(false);
    await expectHistoryIntact("the formula change");
  });

  it("REQ-S06-008: a methodology change requiring G2 re-approval is migrated; the approved G2 decision and pack stay intact", async () => {
    const before = expectStatus(await send("GET", `${g.base}/config-pins`, adm), 200).items as Body[];
    const fromVersion = before.find((x) => x.kind === "methodology")!.versionId;
    const decisionsBefore = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", g.transformationId)
      .orderBy("id")
      .execute();
    expect(decisionsBefore.length).toBeGreaterThanOrEqual(2);

    // v2 of the playbook: a G2 criterion's mandatory flag flips (published through the pipeline).
    const base = await newestPublished("methodology", "playbook");
    const d = expectStatus(
      await send("POST", V, adm, { basedOnVersionId: base.id, changeSummary: "Synthetic A07: G2 criterion change" }),
      201,
    );
    const crit = expectStatus(await send("GET", `${V}/${d.id}/elements?elementType=gate_criterion`, adm), 200);
    const g2 = (crit.items as Body[]).find((c) => (c.attributes.gateCode ?? c.catalogueAttributes.gateCode) === "G2");
    expect(g2, "a G2 criterion").toBeDefined();
    const mandatory = (g2.attributes.mandatory ?? g2.catalogueAttributes.mandatory) === true;
    expectStatus(await putElement(d.id, "gate_criterion", g2.stableKey, { mandatory: !mandatory }), 200);
    const v2m = await publishPipeline(d.id, "methodology");

    // The existing transformation is still pinned to its version until the deliberate migration.
    const still = expectStatus(await send("GET", `${g.base}/config-pins`, adm), 200).items as Body[];
    expect(still.find((x) => x.kind === "methodology")!.versionId).toBe(fromVersion);
    const T = g.base;
    const m = expectStatus(
      await send("POST", `${T}/methodology-migrations`, adm, {
        configKind: "methodology",
        toVersionId: v2m.id,
        reason: "Synthetic A07: move to the changed G2 criterion",
      }),
      201,
    );
    expect(m.fromVersionId).toBe(fromVersion);
    const reapprovals = (m.items as Body[]).filter((i) => i.itemKind === "reapproval").map((i) => i.gateCode);
    expect(reapprovals, JSON.stringify(m.items).slice(0, 800)).toContain("G2");
    const sub = expectStatus(
      await send("POST", `${T}/methodology-migrations/${m.id}/submit`, adm, undefined, ifm(m.version)),
      200,
    );
    const dec = expectStatus(
      await send(
        "POST",
        `${T}/methodology-migrations/${m.id}/decision`,
        g.sp.session,
        { outcome: "approve", rationale: "Synthetic A07 approval of a test migration" },
        ifm(sub.version),
      ),
      200,
    );
    const ex = expectStatus(
      await send("POST", `${T}/methodology-migrations/${m.id}/execute`, adm, undefined, ifm(dec.version)),
      200,
    );
    expect(ex.status).toBe("executed");
    // The re-approval is required now; the approved decisions themselves are not rewritten.
    const ra = expectStatus(await send("GET", `${T}/gate-reapprovals`, g.tl.session), 200);
    expect(JSON.stringify(ra)).toContain('"G2"');
    const decisionsAfter = await api.db
      .selectFrom("gate_decision")
      .selectAll()
      .where("transformation_id", "=", g.transformationId)
      .orderBy("id")
      .execute();
    expect(decisionsAfter).toEqual(decisionsBefore);
    const pins = expectStatus(await send("GET", `${T}/config-pins`, adm), 200).items as Body[];
    expect(pins.find((x) => x.kind === "methodology")!.versionId).toBe(v2m.id);
    // The approved G2 gate pack still cites the methodology version it was issued under and stays approved.
    const pack = issued[3]!;
    const now = expectStatus(await send("GET", `${S(pack.base)}/${pack.id}`, g.tl.session), 200);
    expect([now.approvalState, now.methodologyVersionId]).toEqual(["approved", pack.read.methodologyVersionId]);
    expect(now.methodologyVersionId).not.toBe(v2m.id);
    await expectHistoryIntact("the methodology migration");
  });

  describe("REQ-S07-016: a restatement of Q1 needs authority; the Q1 report issued earlier is unchanged; a reissue is version 2", () => {
    let restatementId: string;

    it("a Q1 restatement decided without kpi_restatement.approve (TL) or by its requester is rejected and changes nothing", async () => {
      const created = expectStatus(
        await send("POST", `${k.base}/kpi-definitions/${kpi.id}/restatements`, k.s.finKds, {
          kpiVersionId: v2.id,
          reportingPeriodIds: [q1.id],
          reason: "Synthetic A07: apply the 120 target to Q1",
          changeRequestId,
        }),
        201,
      );
      restatementId = created.id;
      const submitted = expectStatus(
        await send(
          "POST",
          `${k.base}/kpi-restatements/${created.id}/submit`,
          k.s.finKds,
          undefined,
          ifm(created.version),
        ),
        200,
      );
      expect(submitted.status).toBe("submitted");
      const url = `${k.base}/kpi-restatements/${created.id}/decision`;
      expectCode(
        await send("POST", url, k.s.tl, { decision: "approve" }, ifm(submitted.version)),
        403,
        "kpi_restatement.no_authority",
      );
      // KDS (no approval right) is refused for authority as well.
      expectCode(
        await send("POST", url, k.s.kds, { decision: "approve" }, ifm(submitted.version)),
        403,
        "kpi_restatement.no_authority",
      );
      // The requester holds the approval right (FIN) but never decides their own restatement.
      expectCode(
        await send("POST", url, k.s.finKds, { decision: "approve" }, ifm(submitted.version)),
        403,
        "kpi_restatement.self_decision",
      );
      const still = expectStatus(await send("GET", `${k.base}/kpi-restatements/${created.id}`, k.s.auditor), 200);
      expect([still.status, still.version]).toEqual(["submitted", submitted.version]);
      // Q1 keeps its value, target, RAG and version.
      const q1Now = await kpiStatus(q1);
      expect([q1Now.calculatedRag, q1Now.evaluationId]).toEqual([q1Before.calculatedRag, q1Before.evaluationId]);
      await expectHistoryIntact("the refused restatement decisions");
    });

    it("approved by an authority (BO): Q1 is restated, the Q1 report issued earlier is unchanged, a reissue creates version 2", async () => {
      const cur = expectStatus(await send("GET", `${k.base}/kpi-restatements/${restatementId}`, k.s.auditor), 200);
      const approved = expectStatus(
        await send(
          "POST",
          `${k.base}/kpi-restatements/${restatementId}/decision`,
          k.s.bo,
          { decision: "approve", note: "Synthetic A07 approval" },
          ifm(cur.version),
        ),
        200,
      );
      expect([approved.status, approved.decidedBy, approved.authorityPermission]).toEqual([
        "approved",
        k.users.bo.id,
        "kpi_restatement.approve",
      ]);
      const runs = await runRestatementEvents(api, restatementId);
      expect(runs.map((r) => r.outcome)).toEqual(["done"]);
      // The retained reconciliation records Q1 before (100, v1) and after (120, v2).
      const rec = expectStatus(
        await send("GET", `${k.base}/kpi-restatements/${restatementId}/reconciliation`, k.s.auditor),
        200,
      );
      expect(rec.retained).toBe(true);
      const q1Row = (rec.rows as Body[]).find((r) => r.reportingPeriodId === q1.id);
      expect([canon(q1Row.before.target), canon(q1Row.after.target)]).toEqual(["100", "120"]);
      const q1Now = await kpiStatus(q1);
      expect(q1Now.evaluationId, "Q1 has a restated evaluation").not.toBe(q1Before.evaluationId);
      const restated = await api.db
        .selectFrom("kpi_evaluation")
        .select(["kpi_version_id", "final_target"])
        .where("id", "=", q1Now.evaluationId)
        .executeTakeFirstOrThrow();
      expect([restated.kpi_version_id, canon(String(restated.final_target))]).toEqual([v2.id, "120"]);

      // The Q1 report issued earlier is unchanged (and so are its exported files).
      await expectHistoryIntact("the approved restatement");
      const dash = issued[0]!;
      expect(dashboardKpiRow(dash.read.content).rag.value).toBe(q1Before.calculatedRag);
      // The issued KPI register (which recorded version 1) is offered for reissue.
      const offers = expectStatus(
        await send("GET", `${k.base}/kpi-restatements/${restatementId}/reissue-offers`, k.s.auditor),
        200,
      ).items as Body[];
      expect(offers.map((o) => o.snapshotId)).toContain(issued[1]!.id);

      // The reissue: a new snapshot in the same series, version 2 once issued; version 1 stays as issued.
      const re = expectStatus(
        await send(
          "POST",
          `${S(dash.base)}/${dash.id}/reissue`,
          k.s.tl,
          { reason: "Synthetic A07: Q1 restated to the 120 target" },
          ifm((await send("GET", `${S(dash.base)}/${dash.id}`, k.s.tl)).body.version),
        ),
        201,
      );
      expect([re.status, re.seriesId, re.reissueOfId, re.reportingPeriodId]).toEqual([
        "generated",
        dash.read.seriesId,
        dash.id,
        q1.id,
      ]);
      const before = expectStatus(await send("GET", `${S(dash.base)}/${dash.id}`, k.s.tl), 200);
      expect(before.status, "the issued snapshot stays issued until the reissue is issued").toBe("issued");
      const v2Issued = expectStatus(
        await send(
          "POST",
          `${S(dash.base)}/${re.id}/issue`,
          k.s.tl,
          { note: "Synthetic A07 reissue" },
          ifm(re.version),
        ),
        200,
      );
      expect([v2Issued.status, v2Issued.issueVersion, v2Issued.seriesId]).toEqual(["issued", 2, dash.read.seriesId]);
      expect(v2Issued.contentSha256).not.toBe(dash.read.contentSha256);
      expect(v2Issued.content.period.id).toBe(q1.id);
      const v1Now = expectStatus(await send("GET", `${S(dash.base)}/${dash.id}`, k.s.tl), 200);
      expect([v1Now.status, v1Now.supersededById, v1Now.issueVersion]).toEqual(["superseded", re.id, 1]);
      // Version 1's content, hash and versions are exactly as issued, and its files still download byte-identical.
      await expectHistoryIntact("the reissue");
      // Version 2 still shows the Q1 actual (90): a restatement changes targets and RAG, not the reported actual.
      expect(dashboardKpiRow(v2Issued.content).values).toContain("90");
    });

    it("the Q1 report issued earlier (the Q1 dashboard showing the KPI) is offered for reissue after the approved restatement", async () => {
      const dash = issued[0]!;
      const offers = expectStatus(
        await send("GET", `${k.base}/kpi-restatements/${restatementId}/reissue-offers`, k.s.auditor),
        200,
      ).items as Body[];
      const offer = offers.find((o) => o.snapshotId === dash.id);
      expect(offer, `offers: ${JSON.stringify(offers)}`).toBeDefined();
      expect([offer.issueVersion, offer.periodLabel]).toEqual([1, "2085-Q1"]);
    });
  });
});

describe("REQ-S06-009: rollback restores a prior version; records created under the rolled-back version remain", () => {
  it("after rolling forms back, a T13 value stored under the rolled-back version is retrievable and the audit trail shows the rollback", async () => {
    const FIELD = "qa_a07_rollback_score";
    const base = await newestPublished("form_schema", "forms");
    const d = expectStatus(
      await send("POST", V, adm, { basedOnVersionId: base.id, changeSummary: "Synthetic A07: a T13 score field" }),
      201,
    );
    expectStatus(
      await putElement(d.id, "form_field", `T13.${FIELD}`, {
        labelEn: "Synthetic A07 rollback score",
        labelAr: "درجة تجريبية للتراجع",
        fieldType: "number",
        min: "0",
        max: "10",
        scale: 0,
      }),
      200,
    );
    const formsV2 = await publishPipeline(d.id, "form_schema");

    // A transformation created under the version (pinned to it) stores a value in the new field.
    const tx = expectStatus(
      await send("POST", "/api/v1/transformations", lead, {
        businessUnitId: w.a1,
        name: "Synthetic A07 rollback",
        mode: "end_to_end",
      }),
      201,
    ).id as string;
    const leadId = (await send("GET", "/api/v1/me", lead)).body.user.id as string;
    const group = expectStatus(
      await send("POST", `/api/v1/transformations/${tx}/stakeholder-groups`, lead, {
        name: "Synthetic A07 group",
        impact: "H",
        currentStance: "neutral",
        requiredBehavior: "Synthetic behaviour: use the new process",
        interventionTypes: ["training"],
        ownerUserId: leadId,
      }),
      201,
    ).id as string;
    const url = `/api/v1/transformations/${tx}/form-records/T13/${group}/custom-fields`;
    // If-Match 0 creates the values (contract: IfMatchOrZero).
    const saved = expectStatus(await send("PUT", url, lead, { values: { [FIELD]: "7" } }, ifm(0)), 200);
    expect([saved.values[FIELD], saved.formSchemaVersionId]).toEqual(["7", formsV2.id]);

    // Rollback: the prior version restored as a new draft (origin rollback), reviewed and published.
    const baseNow = await versionOf(base.id);
    const rb = expectStatus(
      await send(
        "POST",
        `${V}/${base.id}/rollback`,
        adm,
        { reason: "Synthetic A07: withdraw the score field" },
        ifm(baseNow.version),
      ),
      201,
    );
    expect([rb.status, rb.origin, rb.rollbackOfVersionId]).toEqual(["draft", "rollback", base.id]);
    const restored = await publishPipeline(rb.id, "form_schema");
    expect(restored.definition).toEqual(baseNow.definition);
    expect(await elementsOf(restored.id), "the rollback version's elements equal the prior version's").toEqual(
      await elementsOf(base.id),
    );
    expect(restored.id).not.toBe(base.id);
    // Nothing erased: both earlier versions remain readable as published.
    expect((await versionOf(formsV2.id)).status).toBe("published");
    expect((await versionOf(base.id)).status).toBe("published");

    // The record created under the rolled-back version remains retrievable with its value and version.
    const after = expectStatus(await send("GET", url, lead), 200);
    expect([after.values[FIELD], after.formSchemaVersionId]).toEqual(["7", formsV2.id]);
    // A transformation created after the rollback gets the restored form (no score field).
    const tx2 = expectStatus(
      await send("POST", "/api/v1/transformations", lead, {
        businessUnitId: w.a1,
        name: "Synthetic A07 after rollback",
        mode: "end_to_end",
      }),
      201,
    ).id as string;
    const schema = expectStatus(await send("GET", `/api/v1/transformations/${tx2}/form-schemas/T13`, lead), 200);
    expect((schema.fields as Body[]).some((f) => f.key === FIELD)).toBe(false);

    // The audit trail shows the rollback: who, which version was restored, and the publish of the rollback version.
    const audit = await api.db
      .selectFrom("audit_event")
      .select(["action", "actor_user_id", "record_id"])
      .where("record_id", "=", rb.id)
      .orderBy("occurred_at")
      .orderBy("id")
      .execute();
    const actions = audit.map((a) => a.action);
    expect(
      actions.some((a) => /rollback/.test(a)),
      JSON.stringify(actions),
    ).toBe(true);
    expect(
      actions.some((a) => /publish/.test(a)),
      JSON.stringify(actions),
    ).toBe(true);
    expect(audit.find((a) => /rollback/.test(a.action))!.actor_user_id).toBe(admId);
  });
});

describe("REQ-PB-093: changed scoring defaults apply to new transformations; an existing one keeps its weight set and rubric", () => {
  const weights = (sf: string, fv: string, ci: string, fe: string, tv: string) => [
    { criterionCode: "strategic_fit", weightPercent: sf },
    { criterionCode: "financial_value", weightPercent: fv },
    { criterionCode: "customer_impact", weightPercent: ci },
    { criterionCode: "feasibility", weightPercent: fe },
    { criterionCode: "time_to_value", weightPercent: tv },
  ];
  const FEASIBILITY = {
    criterionCode: "feasibility",
    levels: [1, 2, 3, 4, 5].map((score) => ({
      score,
      descriptorEn: `Synthetic A07 feasibility ${score}`,
      descriptorAr: `قابلية تنفيذ تجريبية ${score}`,
    })),
  };
  const pct = (b: Body) =>
    Object.fromEntries((b.weights as Body[]).map((x) => [x.criterionCode, canon(x.weightPercent)]));
  const newTx = async (name: string) =>
    expectStatus(
      await send("POST", "/api/v1/transformations", lead, { businessUnitId: w.a1, name, mode: "end_to_end" }),
      201,
    ).id as string;
  const defaultsOf = async (tx: string) =>
    expectStatus(await send("GET", `/api/v1/transformations/${tx}/scoring-defaults`, lead), 200);
  const putDefaults = async (id: string, ws: Body) =>
    send(
      "PUT",
      `${V}/${id}/scoring-defaults`,
      adm,
      { weights: ws, rubrics: [FEASIBILITY] },
      ifm((await versionOf(id)).version),
    );

  it("defaults totalling 95% are refused at publish; 30/20/20/15/15 with a new Feasibility rubric reach only new transformations", async () => {
    const existing = await newTx("Synthetic A07 before the new scoring defaults");
    const before = await defaultsOf(existing);
    const base = await newestPublished("scoring_defaults", "scoring-defaults");
    expect(before.versionId).toBe(base.id);

    const bad = expectStatus(
      await send("POST", V, adm, { basedOnVersionId: base.id, changeSummary: "Synthetic A07: weights total 95" }),
      201,
    );
    expectStatus(await putDefaults(bad.id, weights("25", "20", "20", "15", "15")), 200);
    await step(bad.id, "compatibility-checks", undefined, [200, 201, 422]);
    await step(bad.id, "preview", { samples: [] }, [200, 201, 422]);
    // Whatever the configured review decides, publishing defaults that total 95% is rejected.
    const pre = await versionOf(bad.id);
    const review = await send("POST", `${V}/${bad.id}/submit-review`, adm, { note: "Synthetic A07" }, ifm(pre.version));
    if (review.status === 200 || review.status === 201)
      expectStatus(
        await send(
          "POST",
          `${V}/${bad.id}/reviews/${review.body.id}/decision`,
          office,
          { outcome: "approve", note: "Synthetic review" },
          ifm(review.body.version),
        ),
        200,
      );
    const cur = await versionOf(bad.id);
    expectCode(
      await send("POST", `${V}/${bad.id}/publish`, adm, undefined, ifm(cur.version)),
      422,
      "config_version.weights_total",
    );
    expect((await versionOf(bad.id)).status).toBe("draft");
    await step(bad.id, "discard", undefined, 200);

    const d = expectStatus(
      await send("POST", V, adm, { basedOnVersionId: base.id, changeSummary: "Synthetic A07: weights 30/20/20/15/15" }),
      201,
    );
    expect(canon(expectStatus(await putDefaults(d.id, weights("30", "20", "20", "15", "15")), 200).weightTotal)).toBe(
      "100",
    );
    await publishPipeline(d.id, "scoring_defaults");

    const created = await defaultsOf(await newTx("Synthetic A07 after the new scoring defaults"));
    expect(created.versionId).toBe(d.id);
    expect(pct(created)).toMatchObject({
      strategic_fit: "30",
      financial_value: "20",
      customer_impact: "20",
      feasibility: "15",
      time_to_value: "15",
    });
    const rubric = (created.rubrics as Body[]).find((r) => r.criterionCode === "feasibility");
    expect(rubric.levels.map((l: Body) => l.descriptorEn)).toEqual(FEASIBILITY.levels.map((l) => l.descriptorEn));
    // The existing transformation keeps its weight set and rubric version, exactly as read before.
    // (isNewestPublished describes the version, not the pin: it turns false once a newer version is published.)
    const { isNewestPublished: was, ...pinnedBefore } = before;
    const { isNewestPublished: is, ...pinnedNow } = await defaultsOf(existing);
    expect([was, is]).toEqual([true, false]);
    expect(pinnedNow).toEqual(pinnedBefore);
    expect(pct(pinnedNow)).toMatchObject({ strategic_fit: "25", financial_value: "25" });
  });
});

describe("REQ-S14-003: an N/A scheme without its own bands is refused; existing assessments keep their scheme version and band", () => {
  const SCHEMES = "/api/v1/admin/health-check-schemes";
  const HC = () => `${g.base}/health-checks`;
  const sample = (yes: number, no: number, na: number) => {
    const keys = [...Array<string>(yes).fill("yes"), ...Array<string>(no).fill("no"), ...Array<string>(na).fill("na")];
    return {
      kind: "record",
      recordType: "health_assessment",
      input: { answers: Object.fromEntries(keys.map((x, i) => [QUESTION_CODES[i]!, x])) },
    };
  };
  let assessment: Body;
  let v1: Body;

  beforeAll(async () => {
    // A health check of transformation G submitted under the shipped scheme v1: 19 Yes, 6 No.
    let a = expectStatus(await send("POST", HC(), g.tl.session, { assessmentDate: "2085-04-05" }), 201);
    for (const [i, code] of QUESTION_CODES.entries())
      a = expectStatus(
        await send(
          "PUT",
          `${HC()}/${a.id}/answers/${code}`,
          g.tl.session,
          { response: i < 19 ? "yes" : "no" },
          ifm(a.version),
        ),
        200,
      );
    a = expectStatus(
      await send(
        "PUT",
        `${HC()}/${a.id}/actions`,
        g.tl.session,
        { actions: [1, 2, 3].map((rank) => ({ rank, actionText: `Synthetic A07 improvement action ${rank}` })) },
        ifm(a.version),
      ),
      200,
    );
    assessment = expectStatus(
      await send("POST", `${HC()}/${a.id}/submit`, g.tl.session, undefined, ifm(a.version)),
      200,
    );
    v1 = (expectStatus(await send("GET", SCHEMES, g.tl.session), 200).items as Body[]).find(
      (x) => x.key === "health-check" && x.versionNo === 1,
    );
    expect(v1, "scheme health-check v1").toBeDefined();
    expect([assessment.status, assessment.schemeVersionId, canon(String(assessment.score))]).toEqual([
      "submitted",
      v1.versionId,
      "19",
    ]);
    expect(assessment.band).toBeTruthy();
  }, 120_000);

  it("adding N/A while keeping the four source bands fails the preview (own bands required) and cannot be published", async () => {
    const d = expectStatus(
      await send("POST", V, adm, { basedOnVersionId: v1.versionId, changeSummary: "Synthetic A07: N/A, no new bands" }),
      201,
    );
    expectStatus(
      await send(
        "PATCH",
        `${V}/${d.id}`,
        adm,
        { definition: { ...d.definition, scoreBasis: "percent_of_applicable", questionCount: 25 } },
        ifm(d.version),
      ),
      200,
    );
    expectStatus(
      await send(
        "PUT",
        `${V}/${d.id}/elements/health_response/na`,
        adm,
        { origin: "admin", attributes: { credit: null, labelEn: "N/A", labelAr: "لا ينطبق" } },
        ifm((await versionOf(d.id)).version),
      ),
      200,
    );
    const pv = await send(
      "POST",
      `${V}/${d.id}/preview`,
      adm,
      { samples: [sample(15, 3, 7)] },
      ifm((await versionOf(d.id)).version),
    );
    expectCode(pv, 422, "health_scheme.own_bands_required");
    await send("POST", `${V}/${d.id}/compatibility-checks`, adm, undefined, ifm((await versionOf(d.id)).version));
    const pub = await send("POST", `${V}/${d.id}/publish`, adm, undefined, ifm((await versionOf(d.id)).version));
    expect(pub.status, show(pub)).toBe(422);
    expect((await versionOf(d.id)).status).toBe("draft");
    expect((await send("GET", `${SCHEMES}/${d.id}`, g.tl.session)).status).toBe(404);

    // With its own bands it publishes; the assessment submitted earlier keeps its scheme version, score and band.
    for (const key of ["b0152_21_25", "b0152_16_20", "b0152_10_15", "b0152_0_9"])
      expectStatus(
        await send(
          "POST",
          `${V}/${d.id}/elements/health_band/${key}/remove`,
          adm,
          undefined,
          ifm((await versionOf(d.id)).version),
        ),
        200,
      );
    for (const [key, min, label] of [
      ["a07_high", "75", "75-100"],
      ["a07_mid", "50", "50-74.99"],
      ["a07_low", "0", "0-49.99"],
    ] as const)
      expectStatus(
        await send(
          "PUT",
          `${V}/${d.id}/elements/health_band/${key}`,
          adm,
          {
            origin: "admin",
            attributes: {
              minScore: min,
              rangeLabel: label,
              textEn: `Synthetic A07 band ${key}`,
              textAr: `نطاق تجريبي ${key}`,
            },
          },
          ifm((await versionOf(d.id)).version),
        ),
        200,
      );
    expect((await step(d.id, "preview", { samples: [sample(15, 3, 7)] })).result).toBe("pass");
    expect((await step(d.id, "compatibility-checks")).result).not.toBe("fail");
    const review = await step(d.id, "submit-review", { note: "Synthetic A07 scheme" });
    expectStatus(
      await send(
        "POST",
        `${V}/${d.id}/reviews/${review.id}/decision`,
        office,
        { outcome: "approve" },
        ifm(review.version),
      ),
      200,
    );
    expect((await step(d.id, "publish", undefined, 200)).status).toBe("published");
    expect((await send("GET", `${SCHEMES}/${d.id}`, g.tl.session)).status).toBe(200);
    const now = expectStatus(await send("GET", `${HC()}/${assessment.id}`, g.tl.session), 200);
    expect([now.schemeVersionId, now.schemeVersionNo, now.score, now.band]).toEqual([
      v1.versionId,
      1,
      assessment.score,
      assessment.band,
    ]);
    expect(expectStatus(await send("GET", `${SCHEMES}/${v1.versionId}`, g.tl.session), 200)).toEqual(v1);
  });
});

describe("contract (found while authoring A07): reading the extension values of a record that has none", () => {
  it("GET …/form-records/T13/{id}/custom-fields returns version 0 with an ETag the contract allows", async () => {
    const tx = expectStatus(
      await send("POST", "/api/v1/transformations", lead, {
        businessUnitId: w.a1,
        name: "Synthetic A07 empty values",
        mode: "end_to_end",
      }),
      201,
    ).id as string;
    const leadId = (await send("GET", "/api/v1/me", lead)).body.user.id as string;
    const group = expectStatus(
      await send("POST", `/api/v1/transformations/${tx}/stakeholder-groups`, lead, {
        name: "Synthetic A07 empty group",
        impact: "L",
        currentStance: "neutral",
        requiredBehavior: "Synthetic behaviour",
        interventionTypes: ["training"],
        ownerUserId: leadId,
      }),
      201,
    ).id as string;
    // The harness validates every response against docs/api/openapi.yaml (getFormRecordCustomFields: "version 0 when
    // none stored"; its ETag header is components/headers/ETag).
    const r = await send("GET", `/api/v1/transformations/${tx}/form-records/T13/${group}/custom-fields`, lead);
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(0);
  });
});
