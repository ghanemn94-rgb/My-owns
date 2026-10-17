// The International Roaming dataset against a real, disposable PostgreSQL (ADR-0050 §2–§5; p5-work-split §J.2;
// T-DG5-BE-T). The DEFAULT dataset (demo/data/index.ts: BE-T's modules and KBE-H's numbers) is seeded through BE-S's
// seed transaction (every engine guard and deferred constraint runs at commit) into a scratch database of this run's
// disposable cluster. Literal tests of §J.2:
//   - REQ-PB-088: the demo transformation's North Star equals "Make international roaming effortless, trusted and
//     economically accretive.";
//   - REQ-PB-090: the traceability view (traceability_edge, ADR-0038 §1) carries the three B0147 chains;
//   - REQ-S18-002: the seed-coverage check finds at least one record for each listed condition.
// Everything is SYNTHETIC; a demo approval approves nothing real.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_COVERAGE_CONDITIONS, DEMO_TRANSFORMATION_ID } from "../../src/demo/coverage.ts";
import { DEMO_ANCHORS, DEMO_KPIS } from "../../src/demo/data/kpis.ts";
import { DEMO_BENEFITS } from "../../src/demo/data/benefits.ts";
import {
  B0144_TEXT,
  B0145,
  B0147_CHAINS,
  DEMO_BUSINESS_UNIT_GRANTS,
  DEMO_IDP_ISSUER,
  DEMO_SIGN_IN_USERS,
  DEMO_USERS,
} from "../../src/demo/data/roaming.ts";
import { DEMO_ID_PATTERN, seedDemo, type DemoRunSummary } from "../../src/demo/seed.ts";
import { migrate } from "../../src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../helpers.ts";

const { adminUrl } = testDatabase();
const T = DEMO_TRANSFORMATION_ID;
const dropAtEnd: string[] = [];
let summary: DemoRunSummary;
let client: pg.Client;

async function rows<R extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<R[]> {
  return (await client.query<R>(text, values)).rows;
}

async function seedScratch(prefix: string): Promise<{ ownerUrl: string; summary: DemoRunSummary }> {
  const name = await createScratchDatabase(adminUrl, prefix);
  dropAtEnd.push(name);
  const ownerUrl = roleUrl(adminUrl, name, "mth_owner");
  await migrate(ownerUrl);
  const s = await seedDemo(ownerUrl, { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null });
  return { ownerUrl, summary: s };
}

beforeAll(async () => {
  const seeded = await seedScratch("mth_demo_roaming");
  summary = seeded.summary;
  client = new pg.Client({ connectionString: seeded.ownerUrl });
  await client.connect();
}, 180_000);

afterAll(async () => {
  await client?.end();
  for (const n of dropAtEnd.reverse()) await dropScratchDatabase(adminUrl, n);
});

describe("REQ-PB-088: the roaming transformation and the seven B0145 elements", () => {
  it('the North Star equals "Make international roaming effortless, trusted and economically accretive."', async () => {
    const ns = await rows<{ statement: string }>(
      "SELECT statement FROM north_star WHERE transformation_id = $1 AND status = 'current'",
      [T],
    );
    expect(ns).toEqual([{ statement: "Make international roaming effortless, trusted and economically accretive." }]);
    const [charter] = await rows<{ north_star_id: string; statement: string }>(
      "SELECT c.north_star_id, n.statement FROM charter c JOIN north_star n ON n.id = c.north_star_id WHERE c.transformation_id = $1",
      [T],
    );
    expect(charter!.statement).toBe(B0145.northStar);
  });

  it("carries the seven B0145 elements verbatim and the B0144 sentence on the overview", async () => {
    const [c] = await rows<Record<string, string>>(
      "SELECT case_for_change, in_scope, governance_forum, success_definition FROM charter WHERE transformation_id = $1",
      [T],
    );
    expect(c!["case_for_change"]).toBe(
      "Roaming has value leakage from low adoption, fragmented propositions, inconsistent digital activation and avoidable CX friction.",
    );
    expect(c!["in_scope"]).toContain(B0145.outcomes);
    expect(c!["in_scope"]).toContain(B0145.initiatives);
    expect(c!["governance_forum"]).toBe(B0145.governance);
    expect(c!["success_definition"]).toContain(B0145.benefits);
    const tom = await rows<{ n: string }>(
      "SELECT count(*) AS n FROM tom_canvas_cell WHERE transformation_id = $1 AND position($2 in target_design) > 0",
      [T, B0145.tomFocus],
    );
    expect(tom[0]!.n).toBe("10");
    const [t] = await rows<{ description: string; mode: string }>(
      "SELECT description, mode FROM transformation WHERE id = $1",
      [T],
    );
    expect(t).toEqual({ description: B0144_TEXT, mode: "end_to_end" });
  });

  it("registers one transformation only, every seeded id a fixed 01995000-… literal", async () => {
    expect((await rows<{ n: string }>("SELECT count(*) AS n FROM transformation"))[0]!.n).toBe("1");
    const ids = await rows<{ record_id: string }>("SELECT record_id::text FROM demo_seed_record");
    expect(ids.length).toBe(summary.seededRecords);
    for (const r of ids) expect(r.record_id).toMatch(DEMO_ID_PATTERN);
  });

  it("the demo role users roaming.user.<role> name the demo IdP issuer only, with no credential", async () => {
    const users = await rows<{ display_name: string; issuer: string; subject: string }>(
      `SELECT u.display_name, i.issuer, i.subject FROM app_user u JOIN user_identity i ON i.user_id = u.id ORDER BY i.subject`,
    );
    // The eight role users and (T-DG5-BE-T3, D-QA-E-1) the demo access administrator; no dev-issuer identity outside
    // a dev-mode stack (D-165; demo-dev-binding.test.ts).
    expect(DEMO_SIGN_IN_USERS.map((u) => u.name)).toEqual([
      ...DEMO_USERS.map((u) => u.name),
      "roaming.user.adm_access",
    ]);
    expect(users.map((u) => u.subject)).toEqual(DEMO_SIGN_IN_USERS.map((u) => u.name).sort());
    for (const u of users) {
      expect(u.issuer).toBe(DEMO_IDP_ISSUER);
      expect(u.display_name).toContain("(synthetic)");
    }
    expect((await rows<{ n: string }>("SELECT count(*) AS n FROM app_user"))[0]!.n).toBe(
      String(DEMO_SIGN_IN_USERS.length),
    );
  });

  it("T-DG5-BE-T3 (D-QA-E-1): the business-unit grants are exactly TL, TO and the demo access administrator", async () => {
    const grants = await rows<{ subject: string; role: string; scope_type: string; scope_id: string }>(
      `SELECT i.subject, r.code AS role, a.scope_type, a.scope_id::text
         FROM scoped_assignment a JOIN role r ON r.id = a.role_id
         JOIN user_identity i ON i.user_id = a.user_id
        WHERE a.revoked_at IS NULL ORDER BY a.scope_type, i.subject, r.code`,
    );
    const bu = grants.filter((g) => g.scope_type === "business_unit");
    expect(bu).toEqual(
      DEMO_BUSINESS_UNIT_GRANTS.map((g) => ({
        subject: DEMO_SIGN_IN_USERS.find((u) => u.id === g.userId)!.name,
        role: g.role,
        scope_type: "business_unit",
        scope_id: DEMO_ANCHORS.businessUnitId,
      })).sort((a, b) => (a.subject < b.subject ? -1 : 1)),
    );
    expect(bu.map((g) => g.role).sort()).toEqual(["ADM_ACCESS", "TL", "TO"]);
    // Every role user still holds their role on the seeded roaming transformation; nobody holds an organization grant.
    const onT = grants.filter((g) => g.scope_type === "transformation");
    expect(onT.map((g) => [g.subject, g.role])).toEqual(
      DEMO_USERS.map((u) => [u.name, u.role]).sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    );
    for (const g of onT) expect(g.scope_id).toBe(T);
    expect(grants.filter((g) => g.scope_type === "organization")).toEqual([]);
    // The demo access administrator holds no business-record or approval permission (a technical_admin role).
    const perms = await rows<{ code: string; category: string }>(
      `SELECT p.code, p.category FROM role_permission rp JOIN role r ON r.id = rp.role_id
         JOIN permission p ON p.code = rp.permission_code WHERE r.code = 'ADM_ACCESS'`,
    );
    expect(perms.filter((p) => ["business_approval", "finance_validation"].includes(p.category))).toEqual([]);
  });
});

describe("REQ-PB-090: the three B0147 chains in the traceability view", () => {
  async function label(type: string, id: string): Promise<string> {
    const q: Record<string, string> = {
      diagnostic_finding: "SELECT statement AS l FROM diagnostic_finding WHERE id = $1",
      tom_gap: "SELECT gap AS l FROM tom_gap WHERE id = $1",
      initiative: "SELECT name AS l FROM initiative WHERE id = $1",
      outcome: "SELECT statement AS l FROM outcome WHERE id = $1",
      outcome_kpi:
        "SELECT d.name AS l FROM outcome_kpi k JOIN kpi_definition d ON d.id = k.kpi_definition_id WHERE k.id = $1",
      benefit: "SELECT title AS l FROM benefit WHERE id = $1",
    };
    return (await rows<{ l: string }>(q[type]!, [id]))[0]!.l;
  }

  /** The chain from a finding, following one edge of each kind in the ADR-0038 §1 order. */
  async function walk(findingId: string): Promise<{ type: string; label: string; id: string }[]> {
    const order = ["issue_gap", "gap_initiative", "initiative_kpi", "outcome_kpi_of", "kpi_benefit_measure"];
    const path = [{ type: "diagnostic_finding", id: findingId, label: await label("diagnostic_finding", findingId) }];
    for (const kind of order) {
      const last = path[path.length - 1]!;
      const next = await rows<{ to_type: string; to_id: string }>(
        `SELECT to_type, to_id::text FROM traceability_edge
          WHERE transformation_id = $1 AND edge_kind = $2 AND from_type = $3 AND from_id = $4`,
        [T, kind, last.type, last.id],
      );
      expect(next.length, `${last.label} -${kind}->`).toBe(1);
      path.push({ type: next[0]!.to_type, id: next[0]!.to_id, label: await label(next[0]!.to_type, next[0]!.to_id) });
    }
    return path;
  }

  for (const [i, c] of B0147_CHAINS.entries()) {
    it(`shows "${c.problem} -> ${c.tomGap} -> ${c.initiative} -> ${c.kpi} -> ${c.benefit}" as one line`, async () => {
      const [f] = await rows<{ id: string }>(
        "SELECT id::text FROM diagnostic_finding WHERE transformation_id = $1 AND statement = $2",
        [T, c.problem],
      );
      const path = await walk(f!.id);
      expect(path.map((p) => p.type)).toEqual([
        "diagnostic_finding",
        "tom_gap",
        "initiative",
        "outcome",
        "outcome_kpi",
        "benefit",
      ]);
      // The B0147 Problem, TOM gap, Initiative and KPI columns verbatim.
      expect(path.slice(0, 4).map((p) => p.label)).toEqual([c.problem, c.tomGap, c.initiative, c.kpi]);
      // The KPI movement is the chain's KPI (KBE-H) and the end of the line is the chain's benefit (KBE-H, M0346).
      expect(path[4]!.label).toBe(DEMO_KPIS[i]!.name);
      expect(path[5]!.id).toBe(DEMO_BENEFITS[i]!.id);
      expect(path[5]!.label).toBe(DEMO_BENEFITS[i]!.title);
    });
  }
});

describe("REQ-S18-002: the seed-coverage check on the roaming dataset", () => {
  it("runs every condition's query (none unimplemented) and stores the result in run 1", async () => {
    expect(summary.coverageNotImplemented).toEqual([]);
    expect(Object.keys(summary.coverage)).toEqual(DEMO_COVERAGE_CONDITIONS.map((c) => c.code));
    const [run] = await rows<{ coverage: Record<string, number>; coverage_complete: boolean }>(
      "SELECT coverage, coverage_complete FROM demo_dataset_run WHERE run_no = 1",
    );
    expect(run!.coverage).toEqual(summary.coverage);
    expect(run!.coverage_complete).toBe(summary.coverageComplete);
  });

  it("is complete: every condition counts at least one record (coverage_complete)", () => {
    expect(summary.coverageComplete).toBe(true);
  });

  for (const c of DEMO_COVERAGE_CONDITIONS) {
    it(`${c.code}: ${c.requirement} (at least one linked record of the roaming transformation)`, () => {
      expect(summary.coverage[c.code], c.code).toBeGreaterThanOrEqual(1);
    });
  }

  it("the 25-question health assessment is submitted with all 25 answers and the scheme's score", async () => {
    const [h] = await rows<{ status: string; answered_count: number; n: string; score: string | null }>(
      `SELECT a.status, a.answered_count, a.score::text,
              (SELECT count(*) FROM health_assessment_answer x WHERE x.assessment_id = a.id) AS n
         FROM health_assessment a WHERE a.transformation_id = $1`,
      [T],
    );
    expect([h!.status, h!.answered_count, h!.n]).toEqual(["submitted", 25, "25"]);
    expect(h!.score).not.toBeNull();
  });

  it("the six phases each have their steps, and the missing evidence is a required-evidence step with none attached", async () => {
    const phases = await rows<{ phase_code: string }>(
      `SELECT DISTINCT s.phase_code FROM phase_step s WHERE s.transformation_id = $1 ORDER BY 1`,
      [T],
    );
    expect(phases.map((p) => p.phase_code)).toEqual([
      "define",
      "design",
      "diagnose",
      "mobilize",
      "realize",
      "transform",
    ]);
    const [m] = await rows<{ n: string }>(
      `SELECT count(*) AS n FROM phase_step s JOIN phase_step_definition d ON d.key = s.step_key
        WHERE s.transformation_id = $1 AND d.completion_rule = 'evidence_linked'
          AND NOT EXISTS (SELECT 1 FROM phase_step_evidence e WHERE e.phase_step_id = s.id AND e.status = 'active')`,
      [T],
    );
    expect(Number(m!.n)).toBe(summary.coverage["evidence.missing"]);
  });

  it("the launch plan (B0134) has every template task, dated from its start date", async () => {
    const [p] = await rows<{ start_date: string; tasks: string; items: string }>(
      `SELECT p.start_date::text, (SELECT count(*) FROM launch_task t WHERE t.plan_id = p.id) AS tasks,
              (SELECT count(*) FROM launch_template_item) AS items
         FROM launch_plan p WHERE p.transformation_id = $1`,
      [T],
    );
    expect(p!.start_date).toBe("2026-07-03");
    expect(p!.tasks).toBe(p!.items);
  });

  it("the overdue decision and the stale KPI are relative to the synthetic clock (2026-09-01)", async () => {
    const [d] = await rows<{ due_date: string }>(
      "SELECT due_date::text FROM decision WHERE transformation_id = $1 AND kind = 'executive' AND status = 'open'",
      [T],
    );
    expect(d!.due_date < "2026-09-01").toBe(true);
  });
});

describe("REQ-S18-001 (with BE-S): the roaming dataset is deterministic", () => {
  it("a second seed into a fresh database gives identical record counts and checksum", async () => {
    const again = await seedScratch("mth_demo_roaming_again");
    expect(again.summary.checksumSha256).toBe(summary.checksumSha256);
    expect(again.summary.recordCounts).toEqual(summary.recordCounts);
    expect(again.summary.seededRecords).toBe(summary.seededRecords);
    expect(again.summary.coverage).toEqual(summary.coverage);
  }, 180_000);
});
