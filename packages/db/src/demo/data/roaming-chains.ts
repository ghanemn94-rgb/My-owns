// The three B0147 chains' links that need KBE-H's KPIs and benefits (ADR-0050 §4; ADR-0038 §1; p5-work-split §J.2;
// T-DG5-BE-T; T-DG5-BE-T6, D-168). Each chain runs, in the DG4 traceability model (view `traceability_edge`), in
// exactly the five B0147 steps:
//   diagnostic finding "<Problem>"  -issue_gap->  TOM gap "<TOM gap>"  -gap_initiative->  initiative "<Initiative>"
//   -initiative_kpi->  outcome KPI "<KPI>" (the contribution names the outcome KPI, so the edge ends at it)
//   -kpi_benefit_measure->  benefit "<Benefit>" (KBE-H's chain benefit, measured by that KPI definition).
// The B0147 texts are verbatim (roaming.ts B0147_CHAINS); KBE-H's KPI names and benefit titles are B0147's KPI and
// Benefit columns (D-168). The outcome KPI still belongs to its outcome (outcome_kpi_of), which is not on the line.
// Runs after KBE-H's modules (order 500 > 440), and last the record code counters, so the product's next codes
// (INI-04, DEC-02 …) never collide with the seeded ones.
// SYNTHETIC: an illustrative example, not Mobily actual performance; approves nothing real.
import { sql } from "kysely";
import type { DemoDatasetModule } from "../seed.ts";
import { DEMO_BENEFITS } from "./benefits.ts";
import { DEMO_ANCHORS, DEMO_KPIS } from "./kpis.ts";
import { B0147_CHAINS } from "./roaming.ts";
import { RT_BLOCK, rtId } from "./roaming-ids.ts";

const scope = { organization_id: DEMO_ANCHORS.organizationId, transformation_id: DEMO_ANCHORS.transformationId };
const TL = DEMO_ANCHORS.users.tl;

export const ROAMING_CHAINS_MODULE: DemoDatasetModule = {
  key: "roaming.chains",
  order: 500,
  async seed(ctx) {
    const at = ctx.at({ days: -95 });
    const st = { created_at: at, created_by: TL, updated_at: at, updated_by: TL };
    let n = 0;
    for (const c of B0147_CHAINS) {
      n += 1;
      const kpi = DEMO_KPIS[n - 1];
      if (kpi === undefined || kpi.chain !== n) throw new Error(`demo seed: chain ${n} has no KPI`);
      const benefit = DEMO_BENEFITS[n - 1];
      // D-168: the line reads exactly as B0147 writes it, so the seeded names must be the B0147 columns.
      if (kpi.name !== c.kpi) throw new Error(`demo seed: chain ${n} KPI "${kpi.name}" is not B0147's "${c.kpi}"`);
      if (benefit === undefined || benefit.title !== c.benefit)
        throw new Error(`demo seed: chain ${n} benefit "${benefit?.title}" is not B0147's "${c.benefit}"`);
      await ctx.insert("outcome_kpi", `roaming.outcome_kpi.${c.key}`, {
        id: rtId(RT_BLOCK.outcomeKpi, n),
        ...scope,
        outcome_id: rtId(RT_BLOCK.outcome, n),
        kpi_definition_id: kpi.definitionId,
        baseline_value: kpi.baselineValue,
        target_value: kpi.targetValue,
        target_date: kpi.targetDate,
        owner_user_id: DEMO_ANCHORS.users.bo,
        ordinal: 1,
        status: "active",
        ...st,
      });
      await ctx.insert("initiative_outcome_contribution", `roaming.contribution.${c.key}`, {
        id: rtId(RT_BLOCK.contribution, n),
        ...scope,
        initiative_id: c.initiativeId,
        outcome_id: rtId(RT_BLOCK.outcome, n),
        outcome_kpi_id: rtId(RT_BLOCK.outcomeKpi, n),
        contribution_statement: `${c.initiative} -> ${c.kpi} -> ${c.benefit} (B0147, synthetic illustrative example).`,
        status: "active",
        ...st,
      });
    }
  },
};

/** The record code counters of the seeded codes (keyed by transformation and prefix; no id, so not registered). */
export const ROAMING_CODE_COUNTERS_MODULE: DemoDatasetModule = {
  key: "roaming.zz_code_counters",
  order: 900,
  async seed(ctx) {
    const t = DEMO_ANCHORS.transformationId;
    await sql`
      INSERT INTO record_code_counter (transformation_id, prefix, last_value)
      SELECT ${t}::uuid, prefix, max(n) FROM (
        SELECT substring(code from '^[A-Z]+') AS prefix, substring(code from '[0-9]+$')::int AS n FROM (
          SELECT code FROM decision WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM initiative WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM dependency WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM raid_entry WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM stakeholder_group WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM adoption_intervention WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM benefit WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM business_case WHERE transformation_id = ${t}::uuid
          UNION ALL SELECT code FROM benefit_formula WHERE transformation_id = ${t}::uuid
        ) c WHERE code ~ '^[A-Z]+-?[0-9]+$'
      ) x
      GROUP BY prefix ORDER BY prefix
      ON CONFLICT DO NOTHING`.execute(ctx.tx);
  },
};
