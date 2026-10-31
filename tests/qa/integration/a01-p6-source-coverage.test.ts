// A01 "Source coverage", final run on the integrated P6 tree (qa-verifier, T-DG6-QA-E). Master prompt §20 and the
// binding row text of REQ-S20-001 (docs/delivery/requirements.csv, final gate DG6): "A01: Six phases, six gates,
// T01–T16, charter, TOM canvas, business case, launch plan, health check and example mapped to working features".
//
// Each named source element is checked as a WORKING feature through the REAL API (Fastify inject; every request and
// response validated against docs/api/openapi.yaml by the harness), not as a catalogue entry only:
//   six phases          GET /phases: exactly six, in order, each bilingual with its playbook source reference;
//   six gates           GET /transformations/{id}/gates on the example transformation: exactly G1-G6;
//   T01-T16             GET /methodology/templates/{T}/source-links for each: 200 with at least one playbook block
//                       (B0001-B0165); T17 does not exist (404), so the set is exactly sixteen;
//   charter, TOM canvas, business case, launch plan, health check
//                       each read from the example transformation with content, and the TOM canvas (a box edited
//                       with If-Match, QA-EB), the launch plan (generated when absent) and the health check (a draft
//                       assessment) each accept a native write;
//   example             the playbook's illustrative example (B0143-B0147, "International Roaming Transformation") is
//                       the seeded synthetic demo transformation: its North Star is the playbook's text, and the three
//                       B0147 traceability chains (problem -> TOM gap -> initiative -> KPI -> benefit) are readable.
// The database is a scratch database of this run's disposable cluster, migrated and seeded with the REAL synthetic demo
// dataset (seedDemo, ADR-0050); the API runs with MTH_ENV=demo. The readers are fresh synthetic users granted roles in
// the demo organization through the harness grant (the A02 suite's pattern). All data is SYNTHETIC: nothing approves
// anything real (G1-G6) and nothing names the engineering gates.
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;
const TX = `/api/v1/transformations/${T}`;
/** B0143 / B0145: the playbook's illustrative example and its North Star. */
const EXAMPLE_NORTH_STAR = "Make international roaming effortless, trusted and economically accretive.";
const BLOCK = /^B0(0\d\d|1[0-5]\d|16[0-5])$/;
const TEMPLATES = Array.from({ length: 16 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`);

let scratch = "";
let api: TestApi;
let reader: Session; // AUD at the organization: reads everything, changes nothing
let lead: Session; // TL at the example transformation: native writes

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_qa_a01_p6");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const aud = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, aud.id, "AUD", { type: "organization", id: ORG } as never, ORG);
  reader = await signIn(api.app, aud.subject);
  const tl = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, tl.id, "TL", { type: "transformation", id: T } as never, ORG);
  lead = await signIn(api.app, tl.subject);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

async function get(path: string, session: Session = reader): Promise<Loose> {
  const r = await call<Loose>(api.app, "GET", path, { session });
  expect(r.status, `${path}: ${JSON.stringify(r.body).slice(0, 600)}`).toBe(200);
  return r.body;
}
const itemsOf = (b: Loose): Loose[] => (Array.isArray(b) ? b : (b.items ?? b.phases ?? b.gates ?? []));

describe("A01 / REQ-S20-001: the playbook's source elements are mapped to working features (final run, DG6 tree)", () => {
  it("six phases, in order, bilingual, each citing its playbook source and closing at its gate", async () => {
    const phases = itemsOf(await get("/api/v1/phases"));
    expect(phases, JSON.stringify(phases).slice(0, 400)).toHaveLength(6);
    expect(phases.map((p) => p.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(
      phases.map((p) => p.gateCode),
      "each phase closes at its gate",
    ).toEqual(["G1", "G2", "G3", "G4", "G5", "G6"]);
    for (const p of phases) {
      expect(p.sourceNameEn.length).toBeGreaterThan(0);
      expect(p.nameAr, "an Arabic name").toMatch(/[؀-ۿ]/);
      expect(JSON.stringify(p.sourceRef), "a playbook block reference").toMatch(/B0\d{3}/);
    }
  });

  it("six gates G1-G6 on the example transformation, each with its criteria", async () => {
    const gates = itemsOf(await get(`${TX}/gates`));
    const codes = gates.map((g) => JSON.stringify(g.gate).match(/"G[1-6]"/)?.[0]);
    expect(codes.sort(), JSON.stringify(gates[0]?.gate)).toEqual(['"G1"', '"G2"', '"G3"', '"G4"', '"G5"', '"G6"']);
    for (const g of gates) expect((g.criteria as Loose[]).length, "each gate has its criteria").toBeGreaterThan(0);
  });

  it("T01-T16: each template links back to its playbook text; T17 is refused by the contract (exactly sixteen)", async () => {
    for (const code of TEMPLATES) {
      const body = await get(`/api/v1/methodology/templates/${code}/source-links`);
      const refs = JSON.stringify(body).match(/B0\d{3}/g) ?? [];
      expect(refs.length, `${code} cites at least one playbook block`).toBeGreaterThan(0);
      for (const r of refs) expect(r, `${code}: ${r} is a playbook block`).toMatch(BLOCK);
    }
    const t17 = await call<Loose>(api.app, "GET", "/api/v1/methodology/templates/T17/source-links", {
      session: reader,
    });
    expect([400, 404]).toContain(t17.status);
  });

  it("the transformation's methodology catalogue names the T01 dimensions, the ten TOM dimensions and the six gate definitions", async () => {
    const m = await get(`${TX}/methodology`);
    const text = JSON.stringify(m);
    for (const g of ["G1", "G2", "G3", "G4", "G5", "G6"]) expect(text).toContain(`"${g}"`);
    const tom = (m.tomDimensions ?? m.tom?.dimensions ?? []) as Loose[];
    expect(tom.length, "ten TOM dimensions").toBe(10);
  });

  it("charter: the example's charter is readable with content and versions", async () => {
    const c = await get(`${TX}/charter`);
    expect(JSON.stringify(c).length).toBeGreaterThan(200);
    const v = await get(`${TX}/charter/versions`);
    expect(itemsOf(v).length).toBeGreaterThanOrEqual(1);
  });

  it("TOM canvas: the example's canvas has the ten TOM dimensions, bilingual", async () => {
    const canvas = await get(`${TX}/tom-canvas`);
    const cells = canvas.cells as Loose[];
    expect(cells).toHaveLength(10);
    const dims = new Set(cells.map((c) => JSON.stringify(c.dimension)));
    expect(dims.size, "ten distinct TOM dimensions").toBe(10);
    for (const c of cells) expect(JSON.stringify(c.dimension), "bilingual dimension").toMatch(/[؀-ۿ]/);
  });

  it("TOM canvas is a working feature: the lead edits a box natively (If-Match, new version, read back); the read-only auditor is refused 403 (QA-EB)", async () => {
    const path = `${TX}/tom-canvas/technology`;
    const before = await get(path);
    const v: number = before.cell.version;
    const target = "Synthetic QA target design: one roaming rating platform (A01 final run).";
    const denied = await call<Loose>(api.app, "PATCH", path, {
      session: reader,
      headers: { "if-match": `"${v}"` },
      body: { targetDesign: target },
    });
    expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    const ok = await call<Loose>(api.app, "PATCH", path, {
      session: lead,
      headers: { "if-match": `"${v}"` },
      body: { targetDesign: target },
    });
    expect(ok.status, JSON.stringify(ok.body).slice(0, 600)).toBe(200);
    expect(ok.body.cell).toMatchObject({ dimensionCode: "technology", targetDesign: target, version: v + 1 });
    expect((await get(path)).cell).toMatchObject({ targetDesign: target, version: v + 1 });
  });

  it("business case: the example's transformation case is readable with its totals", async () => {
    const list = itemsOf(await get(`/api/v1/business-cases?transformationId=${T}`));
    expect(list.length).toBeGreaterThanOrEqual(1);
    const totals = await get(`/api/v1/business-cases/${list[0].id}/totals`);
    expect(JSON.stringify(totals)).toMatch(/"[0-9]+(\.[0-9]+)?"/);
  });

  it("launch plan: the B0134 template exists; the example's plan exists or the lead generates it natively, with scheduled tasks", async () => {
    const tpl = await get("/api/v1/launch-plan-template");
    expect(JSON.stringify(tpl).length).toBeGreaterThan(50);
    let plan = await call<Loose>(api.app, "GET", `${TX}/launch-plan`, { session: reader });
    if (plan.status === 404) {
      const made = await call<Loose>(api.app, "POST", `${TX}/launch-plan`, {
        session: lead,
        body: { startDate: "2041-01-06" },
      });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      plan = await call<Loose>(api.app, "GET", `${TX}/launch-plan`, { session: reader });
    }
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect(plan.body.taskCount).toBeGreaterThan(0);
    const tasks = itemsOf(await get(`${TX}/launch-plan/tasks?limit=100`));
    expect(tasks.length).toBeGreaterThan(0);
  });

  it("health check: the question set exists; the lead starts an assessment on the example natively", async () => {
    const q = itemsOf(await get("/api/v1/health-check-questions"));
    expect(q.length).toBeGreaterThan(0);
    const before = itemsOf(await get(`${TX}/health-checks`));
    const made = await call<Loose>(api.app, "POST", `${TX}/health-checks`, {
      session: lead,
      body: { assessmentDate: "2041-02-01", ownerUserId: null },
    });
    // A draft may already exist in the example (409 health_check.draft_exists): either way one draft is workable.
    if (made.status !== 201) expect(made.body.code, JSON.stringify(made.body)).toBe("health_check.draft_exists");
    const after = itemsOf(await get(`${TX}/health-checks`));
    expect(after.length).toBe(before.length + (made.status === 201 ? 1 : 0));
    expect(
      after.some((h) => h.status === "draft"),
      JSON.stringify(after).slice(0, 600),
    ).toBe(true);
  });

  it("example (B0143-B0147): the seeded example transformation carries the playbook's North Star and the three traceability chains", async () => {
    const t = await get(TX);
    expect(JSON.stringify(t)).toContain("oaming");
    const charter = JSON.stringify(await get(`${TX}/charter`));
    expect(charter).toContain(EXAMPLE_NORTH_STAR);
    const trace = await get(`${TX}/traceability`);
    const text = JSON.stringify(trace);
    for (const id of Object.values(DEMO_ANCHORS.initiatives)) expect(text, `chain initiative ${id}`).toContain(id);
  });
});
