// The International Roaming dataset's Finance decisions (ADR-0050 §4; p5-work-split §J.3; T-DG5-KBE-H; ADR-0030):
//   - the Finance validation of the three formula versions and of the B01 and B03 baselines (the comparison basis a
//     value needs before it can be validated, REQ-S08-008); B02's baseline stays unvalidated;
//   - the Finance queue item of every submitted measurement (exactly one each, with the immutable six-key content
//     snapshot the worker builds, buildFinanceContent);
//   - two SYNTHETIC approvals (B01 July, B03 July: all six REQ-S08-015 items accepted, approved amount = measured
//     amount, decided by the demo Finance user, never the submitter), which make those measurements validated value;
//   - ONE PENDING FINANCE VALIDATION (p5-work-split §J.3): the B01 August measurement, queued for the demo Finance
//     user. It is submitted value, never validated value (REQ-S07-014, REQ-S08-016).
//
// Every decision here is a SYNTHETIC DEMONSTRATION by a demo user and approves nothing real (M0412): "Synthetic
// demonstration - approves nothing real". No agent, seed or job grants a real business, Finance or IT approval.
import { buildFinanceContent } from "@mth/shared/schemas";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { ACTUALS_MODULE } from "./actuals.ts";
import { BENEFITS_MODULE, DEMO_BENEFITS, measurementId, type DemoBenefit, type DemoMeasurement } from "./benefits.ts";
import { BUSINESS_CASES_MODULE, DEMO_FORMULAS } from "./business-cases.ts";
import {
  DEMO_ANCHORS,
  ID_BLOCK,
  KBE_H_FIRST_ORDER,
  kbeId,
  KPIS_MODULE,
  scoped,
  seedUpdate,
  stamps,
  when,
} from "./kpis.ts";

export const SYNTHETIC_APPROVAL_NOTE = "Synthetic demonstration - approves nothing real";

const FORMULAS_VALIDATED_AT = "2026-06-05T08:00:00Z";
const BASELINES_VALIDATED_AT = "2026-06-05T08:30:00Z";

export const financeValidationId = (m: DemoMeasurement): string => kbeId(ID_BLOCK.financeValidation, m.no);

async function queueItem(ctx: DemoSeedContext, b: DemoBenefit, m: DemoMeasurement): Promise<void> {
  const id = measurementId(m);
  const benefit = await ctx.tx.selectFrom("benefit").selectAll().where("id", "=", b.id).executeTakeFirstOrThrow();
  const measurement = await ctx.tx
    .selectFrom("benefit_measurement")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  const inputs = await ctx.tx
    .selectFrom("benefit_measurement_input")
    .selectAll()
    .where("measurement_id", "=", id)
    .orderBy("variable_name")
    .execute();
  const content = buildFinanceContent({
    benefit,
    measurement,
    inputs: inputs.map((r) => ({
      variableName: r.variable_name,
      kpiActualId: r.kpi_actual_id,
      kpiValueNo: r.kpi_value_no,
      value: canonical(r.value),
      periodStart: r.period_start,
      periodEnd: r.period_end,
    })),
    evidenceIds: [],
  });
  const queued = when(ctx, m.submittedAt);
  await ctx.insert("finance_validation", `kbe.finance.${m.key}`, {
    id: financeValidationId(m),
    ...scoped(),
    benefit_id: b.id,
    benefit_measurement_id: id,
    kind: "validation",
    corrects_validation_id: null,
    idempotency_key: `demo:benefit.measurement_submitted:${id}`,
    assignee_user_id: DEMO_ANCHORS.users.fin,
    status: "queued",
    content: JSON.stringify(content),
    measurement_period_start: m.start,
    measurement_period_end: m.end,
    version: 1,
    ...stamps(queued, DEMO_ANCHORS.users.bo),
  });
}

/** Canonical decimal text of a numeric column value (no trailing zeros), as the worker's snapshot stores it. */
function canonical(v: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(v)) throw new Error(`demo seed: ${v} is not a decimal`);
  if (!v.includes(".")) return v;
  const t = v.replace(/0+$/, "").replace(/\.$/, "");
  return t === "-0" ? "0" : t;
}

async function approve(ctx: DemoSeedContext, m: DemoMeasurement): Promise<void> {
  const { fin } = DEMO_ANCHORS.users;
  if (m.decidedAt === null) throw new Error(`demo seed: ${m.key} has no decision time`);
  const decided = when(ctx, m.decidedAt);
  const accepted = "accepted";
  await seedUpdate(
    ctx,
    "finance_validation",
    financeValidationId(m),
    "approve",
    {
      status: "approved",
      baseline_decision: accepted,
      attribution_decision: accepted,
      calculation_decision: accepted,
      evidence_decision: accepted,
      period_decision: accepted,
      assumptions_decision: accepted,
      approved_amount: m.amount,
      decision_note: SYNTHETIC_APPROVAL_NOTE,
      decided_by: fin,
      decided_at: decided,
    },
    decided,
    fin,
  );
  await seedUpdate(
    ctx,
    "benefit_measurement",
    measurementId(m),
    "validate",
    {
      status: "validated",
      validated_amount: m.amount,
      decided_by: fin,
      decided_at: decided,
      reason: SYNTHETIC_APPROVAL_NOTE,
    },
    decided,
    fin,
  );
}

/** Module: formula and baseline validations, then each measurement's queue item and its decision (if any). */
export const FINANCE_MODULE: DemoDatasetModule = {
  key: "kbe.finance",
  order: KBE_H_FIRST_ORDER + 40,
  async seed(ctx) {
    const { fin } = DEMO_ANCHORS.users;
    const formulasAt = when(ctx, FORMULAS_VALIDATED_AT);
    for (const f of DEMO_FORMULAS)
      await seedUpdate(
        ctx,
        "benefit_formula_version",
        f.versionId,
        "validate",
        {
          validation_status: "validated",
          validated_by: fin,
          validated_at: formulasAt,
          validation_note: SYNTHETIC_APPROVAL_NOTE,
        },
        formulasAt,
        fin,
      );
    const baselinesAt = when(ctx, BASELINES_VALIDATED_AT);
    for (const b of DEMO_BENEFITS.filter((x) => x.baselineValidated))
      await seedUpdate(
        ctx,
        "benefit",
        b.id,
        "validate_baseline",
        {
          baseline_validation_status: "validated",
          baseline_validated_by: fin,
          baseline_validated_at: baselinesAt,
          baseline_validation_note: SYNTHETIC_APPROVAL_NOTE,
        },
        baselinesAt,
        fin,
      );
    for (const b of DEMO_BENEFITS)
      for (const m of b.measurements) {
        await queueItem(ctx, b, m);
        if (m.finance === "validated") await approve(ctx, m);
      }
  },
};

/**
 * KBE-H's five modules of the dataset, for BE-T to list in `DEMO_DATASET_MODULES` (data/index.ts) once its anchor
 * records (DEMO_ANCHORS) exist: `...KBE_H_DATASET_MODULES`. They run after BE-T's modules (orders 400 to 440).
 */
export const KBE_H_DATASET_MODULES: readonly DemoDatasetModule[] = [
  KPIS_MODULE,
  ACTUALS_MODULE,
  BUSINESS_CASES_MODULE,
  BENEFITS_MODULE,
  FINANCE_MODULE,
];
