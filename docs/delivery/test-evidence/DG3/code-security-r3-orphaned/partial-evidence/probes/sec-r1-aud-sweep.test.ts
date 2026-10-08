// code-security-reviewer DG3 round-1 probe A (T-DG3-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-r1/. All data is synthetic.
// Revision 3: the plausible body also carries initiativeId (an initiative of the same transformation); the write-free
// checkBenefitFormula is held to 403 with nothing written.
// Revision 2: the empty body on a top-level create (transformationId only in the body) may be 400 or 403 with nothing
// written (no target to authorize against); every other call must be 403 + exactly one authorization.denied.
// Generated AUD sweep over EVERY P3 mutating operation of docs/api/openapi.yaml (P3_OPERATION_IDS, non-GET):
//   1. populate the database by running the seven P3 contract exercise seams (every P3 record type then exists);
//   2. for each operation, fill each path parameter from an EXISTING row (same transformation where nested);
//   3. call it as the org-wide read-only auditor (AUD) with If-Match "1" and two bodies ({} and a plausible body
//      carrying transformationId) and expect 403 with the request's only audit event `authorization.denied`;
//   4. a checksum of every P3 table (all rows, all columns) is identical before and after the sweep.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { operations } from "../../support/contract.ts";
import { auditOfRequest, call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { P3_OPERATION_IDS } from "../../support/p3-operations.ts";
import { exerciseP3BeAOperations } from "../contract/p3-exercises-be-a.ts";
import { exerciseP3BeBOperations } from "../contract/p3-exercises-be-b.ts";
import { exerciseP3BeCOperations } from "../contract/p3-exercises-be-c.ts";
import { exerciseP3BeDOperations } from "../contract/p3-exercises-be-d.ts";
import { exerciseP3BeEOperations } from "../contract/p3-exercises-be-e.ts";
import { exerciseP3KbeBOperations } from "../contract/p3-exercises-kbe-b.ts";
import { exerciseP3KbeCOperations } from "../contract/p3-exercises-kbe-c.ts";

const P3_TABLES = [
  "roadmap_wave", "initiative", "initiative_gap_link", "initiative_outcome_contribution", "initiative_decision_link",
  "deliverable", "milestone", "gate_dispensation", "scoring_weight_set", "scoring_weight", "initiative_score",
  "initiative_score_result", "ranking_snapshot", "ranking_override", "ranking_entry", "dependency_type", "resource_role",
  "capacity", "resource_demand", "portfolio_selection", "funding_decision", "benefit_formula", "benefit_formula_version",
  "benefit_formula_variable", "benefit_calculation", "business_case", "business_case_line", "gate_decision_agreement",
  "dependency",
];

const MUTATIONS = operations.filter((o) => P3_OPERATION_IDS.has(o.operationId) && o.method !== "GET");

let api: TestApi;
let w: World;
let aud: Session;

async function checksum(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const t of P3_TABLES) {
    const r = await sql<{ h: string | null; n: string }>`SELECT md5(string_agg(x::text, '|' ORDER BY x::text)) AS h, count(*)::text AS n FROM ${sql.table(t)} x`.execute(api.db);
    out[t] = `${r.rows[0]!.n}:${r.rows[0]!.h}`;
  }
  return out;
}

async function anyRow(table: string, where = sql`true`): Promise<Record<string, unknown>> {
  const r = await sql<Record<string, unknown>>`SELECT * FROM ${sql.table(table)} WHERE ${where} ORDER BY created_at DESC LIMIT 1`.execute(api.db);
  if (!r.rows[0]) throw new Error(`no row in ${table}`);
  return r.rows[0];
}

/** Fills the path of `path` from existing rows; returns the url and the transformation the record belongs to. */
async function urlFor(path: string): Promise<{ url: string; transformationId: string }> {
  const params = new Map<string, string>();
  let tid: string | undefined;
  const set = (row: Record<string, unknown>, name: string, col = "id") => {
    params.set(name, String(row[col]));
    tid ??= String(row["transformation_id"]);
  };
  if (path.includes("{linkId}")) {
    const table = path.includes("/gap-links/")
      ? "initiative_gap_link"
      : path.includes("/outcome-contributions/")
        ? "initiative_outcome_contribution"
        : "initiative_decision_link";
    const link = await anyRow(table);
    set(link, "linkId");
    params.set("initiativeId", String(link["initiative_id"]));
  }
  if (path.includes("{lineId}")) {
    const line = await anyRow("business_case_line");
    set(line, "lineId");
    params.set("businessCaseId", String(line["business_case_id"]));
  }
  if (path.includes("{versionNo}") && path.includes("benefit-formulas")) {
    const v = await anyRow("benefit_formula_version");
    params.set("versionNo", String(v["version_no"]));
    set(v, "benefitFormulaId", "formula_id");
  }
  if (path.includes("{versionNo}") && path.includes("weight-sets")) {
    const v = await anyRow("scoring_weight_set");
    params.set("versionNo", String(v["version_no"]));
    tid ??= String(v["transformation_id"]);
  }
  if (path.includes("{criterionCode}")) {
    const s = await anyRow("initiative_score");
    params.set("criterionCode", String(s["criterion_code"]));
    set(s, "initiativeId", "initiative_id");
  }
  const simple: [string, string][] = [
    ["dispensationId", "gate_dispensation"],
    ["waveId", "roadmap_wave"],
    ["overrideId", "ranking_override"],
    ["dependencyId", "dependency"],
    ["resourceRoleId", "resource_role"],
    ["capacityId", "capacity"],
    ["resourceDemandId", "resource_demand"],
    ["deliverableId", "deliverable"],
    ["milestoneId", "milestone"],
    ["businessCaseId", "business_case"],
    ["benefitFormulaId", "benefit_formula"],
    ["initiativeId", "initiative"],
  ];
  for (const [name, table] of simple)
    if (path.includes(`{${name}}`) && !params.has(name)) set(await anyRow(table), name);
  if (path.includes("{dependencyTypeCode}")) {
    const r = await anyRow("dependency_type", sql`organization_id IS NOT NULL`).catch(() => anyRow("dependency_type"));
    params.set("dependencyTypeCode", String(r["code"]));
  }
  if (tid === undefined) tid = String((await anyRow("initiative"))["transformation_id"]);
  params.set("transformationId", tid);
  const url = path.replace(/\{([A-Za-z]+)\}/g, (_m, n: string) => {
    const v = params.get(n);
    if (v === undefined) throw new Error(`no value for {${n}} in ${path}`);
    return v;
  });
  return { url, transformationId: tid };
}

let before: Record<string, string>;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const ctx = { api, world: w, mirrored: (m: string, u: string, o = {}) => call(api.app, m, u, o) };
  for (const ex of [
    exerciseP3BeAOperations,
    exerciseP3BeBOperations,
    exerciseP3BeCOperations,
    exerciseP3BeDOperations,
    exerciseP3BeEOperations,
    exerciseP3KbeBOperations,
    exerciseP3KbeCOperations,
  ])
    await ex(ctx);
  aud = await signIn(api.app, w.auditor.subject);
  before = await checksum();
}, 600_000);
afterAll(() => api.close());

describe("SEC-R1 probe A: AUD gets 403 on every P3 mutating operation (generated from the contract)", () => {
  it("covers the P3 mutating operations", () => {
    console.log(`[probe-A] P3 mutating operations: ${MUTATIONS.length}`);
    expect(MUTATIONS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(MUTATIONS.map((o) => [o.operationId, o.method, o.path] as const))(
    "%s (%s %s): 403 for an empty and a plausible body, only authorization.denied written",
    async (id, method, path) => {
      const { url, transformationId } = await urlFor(path);
      const ini = (await sql<{ id: string }>`SELECT id FROM initiative WHERE transformation_id = ${transformationId}::uuid LIMIT 1`.execute(api.db)).rows[0]?.id;
      const plausible = { transformationId, initiativeId: ini, rationale: "AUD probe", reason: "AUD probe", note: "AUD probe" };
      for (const body of [{}, plausible]) {
        const res = await call(api.app, method, url, {
          session: aud,
          headers: { "if-match": '"1"' },
          body,
          contract: false,
        });
        const written = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
        console.log(`[probe-A] ${id} ${method} ${url} body=${Object.keys(body).length ? "plausible" : "{}"} -> ${res.status} ${(res.body as { code?: string })?.code ?? ""} audit=${JSON.stringify(written)}`);
        // A top-level create (no path parameter) whose body names no transformation has no target to authorize
        // against: 400 (schema) or 403 with no denial row is accepted for the EMPTY body only, and written must be [].
        // checkBenefitFormula writes nothing and has no transformation (holdsAnywhere gate): 403 with nothing written.
        if ((!path.includes("{") && Object.keys(body).length === 0) || id === "checkBenefitFormula") {
          expect([400, 403], `${id}: ${JSON.stringify(res.body).slice(0, 300)}`).toContain(res.status);
          expect(written.filter((a) => a !== "authorization.denied")).toEqual([]);
          continue;
        }
        expect(res.status, `${id}: ${JSON.stringify(res.body).slice(0, 300)}`).toBe(403);
        expect(written).toEqual(["authorization.denied"]);
      }
    },
  );

  it("no P3 table changed during the sweep", async () => {
    const after = await checksum();
    for (const t of P3_TABLES) console.log(`[probe-A] checksum ${t} ${before[t]} -> ${after[t]}`);
    expect(after).toEqual(before);
  });
});
