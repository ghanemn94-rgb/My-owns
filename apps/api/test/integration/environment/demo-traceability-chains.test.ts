// REQ-PB-090 (B0146–B0147, M0347; p5-work-split §J.2; T-DG5-BE-T6, D-168): the traceability view shows the three
// roaming chains exactly as the playbook writes them. The REAL synthetic demo dataset (`seedDemo`, International
// Roaming) is seeded into a scratch database of this run's disposable cluster, the REAL API runs on it (MTH_ENV=demo),
// and the test reads `getTraceability` (GET /transformations/{t}/traceability), the operation the web traceability
// screen calls (apps/web/src/pages/traceability/api.ts `useTraceGraph`): once for the whole transformation and once
// from each chain's diagnosed issue, downstream. Each chain's line follows one edge of each step of ADR-0038 §1
// (issue -> gap -> initiative -> KPI -> benefit) and must read, literally:
//   Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift
//   High complaints -> Journey + service assurance -> Proactive comms + QoS monitoring -> Complaint rate -> CX + care cost
//   Partner cost pressure -> Partner model + analytics -> Partner optimization -> Cost/MB, margin -> Margin improvement
// The expected lines are the B0147 table written out here, never derived from the dataset under test.
// Everything is SYNTHETIC: an illustrative example, not Mobily actual performance; nothing here is a business approval
// and nothing names the engineering gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_ACCESS_ADMIN, DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

interface Node {
  readonly recordType: string;
  readonly recordId: string;
  readonly label: string | null;
  readonly href: string;
}
interface Edge {
  readonly edgeKind: string;
  readonly fromType: string;
  readonly fromId: string;
  readonly toType: string;
  readonly toId: string;
}
interface Graph {
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly truncated: boolean;
}

const T = DEMO_ANCHORS.transformationId;
const GRAPH = `/api/v1/transformations/${T}/traceability`;
/** B0147, row by row (Problem, TOM gap, Initiative, KPI, Benefit). */
const B0147 = [
  [
    "Low activation",
    "Proposition + journey",
    "Pass redesign + digital activation",
    "Attach rate / activation",
    "Revenue uplift",
  ],
  [
    "High complaints",
    "Journey + service assurance",
    "Proactive comms + QoS monitoring",
    "Complaint rate",
    "CX + care cost",
  ],
  [
    "Partner cost pressure",
    "Partner model + analytics",
    "Partner optimization",
    "Cost/MB, margin",
    "Margin improvement",
  ],
] as const;
const LINES = [
  "Low activation -> Proposition + journey -> Pass redesign + digital activation -> Attach rate / activation -> Revenue uplift",
  "High complaints -> Journey + service assurance -> Proactive comms + QoS monitoring -> Complaint rate -> CX + care cost",
  "Partner cost pressure -> Partner model + analytics -> Partner optimization -> Cost/MB, margin -> Margin improvement",
] as const;
/** The chain steps of ADR-0038 §1 that B0147's five columns take (a KPI measures a benefit through its definition). */
const STEPS = [
  { kinds: ["issue_gap"], to: "tom_gap" },
  { kinds: ["gap_initiative"], to: "initiative" },
  { kinds: ["initiative_kpi"], to: "outcome_kpi" },
  { kinds: ["kpi_benefit_measure", "kpi_benefit"], to: "benefit" },
] as const;

let api: TestApi;
let scratch: string | null = null;
let tl: Session;
let whole: Graph;

/** The line from `rootId`: one edge of each step, each step exactly one edge (a branch would make it no line). */
function lineOf(g: Graph, rootId: string): Node[] {
  const byId = new Map(g.nodes.map((n) => [n.recordId, n]));
  const path = [byId.get(rootId)!];
  for (const step of STEPS) {
    const last = path[path.length - 1]!;
    const next = g.edges.filter(
      (e) => e.fromId === last.recordId && (step.kinds as readonly string[]).includes(e.edgeKind),
    );
    expect(next.length, `${last.label} -${step.kinds.join("|")}->`).toBe(1);
    expect(next[0]!.toType).toBe(step.to);
    const node = byId.get(next[0]!.toId);
    expect(node, `node ${next[0]!.toId} is in the graph`).toBeDefined();
    path.push(node!);
  }
  return path;
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_demo_trace_chains");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  tl = await signIn(api.app, DEMO_USERS.find((u) => u.role === "TL")!.name);
  const res = await call<Graph>(api.app, "GET", GRAPH, { session: tl });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  whole = res.body;
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("REQ-PB-090: getTraceability shows the three B0147 chains as the playbook writes them", () => {
  it("the whole-transformation graph is complete (not truncated) and holds each chain's diagnosed issue once", () => {
    expect(whole.truncated).toBe(false);
    for (const row of B0147)
      expect(
        whole.nodes.filter((n) => n.recordType === "diagnostic_finding" && n.label === row[0]),
        row[0],
      ).toHaveLength(1);
  });

  for (const [i, row] of B0147.entries()) {
    it(`chain ${i + 1}: "${LINES[i]}" (downstream from the issue, and in the whole graph)`, async () => {
      const root = whole.nodes.find((n) => n.recordType === "diagnostic_finding" && n.label === row[0])!;
      const res = await call<Graph>(
        api.app,
        "GET",
        `${GRAPH}?rootType=diagnostic_finding&rootId=${root.recordId}&direction=downstream`,
        { session: tl },
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      for (const g of [res.body, whole]) {
        const path = lineOf(g, root.recordId);
        expect(path.map((n) => n.recordType)).toEqual([
          "diagnostic_finding",
          "tom_gap",
          "initiative",
          "outcome_kpi",
          "benefit",
        ]);
        expect(path.map((n) => n.label)).toEqual([...row]);
        expect(path.map((n) => n.label).join(" -> ")).toBe(LINES[i]);
        // Every node of the line is clickable (the href of its record's read operation).
        for (const n of path) expect(n.href, n.recordType).toMatch(/^\/api\/v1\//);
      }
      // The initiative's contribution names its outcome KPI: no step through the outcome, so exactly five nodes.
      const initiative = lineOf(res.body, root.recordId)[2]!;
      expect(
        res.body.edges.filter(
          (e) => e.fromId === initiative.recordId && e.edgeKind === "initiative_kpi" && e.toType === "outcome",
        ),
      ).toEqual([]);
    });
  }

  it("negative: a demo user without a read right on the transformation cannot read the view", async () => {
    const admin = await signIn(api.app, DEMO_ACCESS_ADMIN.name);
    const res = await call(api.app, "GET", GRAPH, { session: admin });
    expect([403, 404]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain("Low activation");
  });

  it("negative: an anonymous request is refused (401)", async () => {
    const res = await call(api.app, "GET", GRAPH);
    expect(res.status).toBe(401);
  });
});
