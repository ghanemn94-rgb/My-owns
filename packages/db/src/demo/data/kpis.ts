// The International Roaming dataset's KPIs (ADR-0050 §4; p5-work-split §J.3; T-DG5-KBE-H): the reporting periods, the
// three chain KPIs of B0147 with their P4 versions, RAG thresholds and approved target trajectories. The actuals and
// their calculated evaluations are in actuals.ts; the business cases in business-cases.ts; the benefit register in
// benefits.ts; the Finance decisions in finance.ts. This file also holds what those four share: the id scheme, the
// anchor ids of BE-T's records, the time helper and the guarded-update helper.
//
// EVERY NUMBER HERE IS SYNTHETIC: an illustrative example (B0144 "Illustrative example only. Replace assumptions with
// validated company data."), not Mobily actual performance (M0339). Every number is a decimal string (never a binary
// float); percentages are fractions (0.19 = 19 %). Unknown and Stale are never 0. Nothing here grants a real business,
// Finance or IT approval: a seeded approval is a synthetic decision by a demo user (M0412).
//
// The three chains (B0147), each diagnostic item -> TOM gap -> initiative -> KPI -> benefit, link to these KPIs:
//   1. Low activation        -> ... -> Attach rate / activation -> Revenue uplift      KPI K1, benefit B01
//   2. High complaints       -> ... -> Complaint rate           -> CX + care cost      KPI K2, benefit B02
//   3. Partner cost pressure -> ... -> Cost/MB, margin          -> Margin improvement  KPI K3, benefit B03
import { sql } from "kysely";
import { insertAuditEvent } from "../../audit.ts";
import { DEMO_TRANSFORMATION_ID } from "../coverage.ts";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";

// ------------------------------------------------------------------------------------------------ ids

/**
 * KBE-H's fixed ids: `01995000-4<block>-7000-8000-<n, 12 hex digits>`. The second group starts with 4 and is used by no
 * other module, so these ids never collide with BE-T's (whose second groups are its own). Blocks: 1xx kpis.ts, 2xx
 * actuals.ts, 3xx business-cases.ts, 4xx benefits.ts, 5xx finance.ts.
 */
export function kbeId(block: number, n: number): string {
  if (!Number.isInteger(block) || block < 0x100 || block > 0xfff) throw new Error(`kbeId: invalid block ${block}`);
  if (!Number.isInteger(n) || n < 1 || n > 0xffff) throw new Error(`kbeId: invalid number ${n}`);
  return `01995000-4${block.toString(16).padStart(3, "0")}-7000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const ID_BLOCK = {
  reportingPeriod: 0x101,
  kpiDefinition: 0x102,
  kpiVersion: 0x103,
  ragThreshold: 0x104,
  trajectory: 0x105,
  trajectoryPoint: 0x106,
  kpiActual: 0x201,
  kpiActualValue: 0x202,
  kpiActualReview: 0x203,
  calculationRun: 0x204,
  kpiEvaluation: 0x205,
  dataQualityFinding: 0x206,
  benefitFormula: 0x301,
  formulaVersion: 0x302,
  formulaVariable: 0x303,
  benefitCalculation: 0x304,
  businessCase: 0x305,
  businessCaseLine: 0x306,
  benefit: 0x401,
  benefitEnabler: 0x402,
  benefitAllocation: 0x403,
  benefitPlanValue: 0x404,
  benefitMeasurement: 0x405,
  measurementInput: 0x406,
  financeValidation: 0x501,
} as const;

/**
 * The records of BE-T's part of the dataset (p5-work-split §J.2) that these numbers hang on: the organization, the
 * business unit, the roaming transformation, the demo role users (`roaming.user.<role>`) and the three chain
 * initiatives. BE-T creates them with exactly these ids (the transformation's is coverage.ts's DEMO_TRANSFORMATION_ID),
 * in modules with an order below KBE_H_FIRST_ORDER; this object is the one place to change should BE-T choose others.
 */
export const DEMO_ANCHORS = {
  organizationId: "01995000-0000-7000-8000-000000000002",
  businessUnitId: "01995000-0000-7000-8000-000000000003",
  transformationId: DEMO_TRANSFORMATION_ID,
  users: {
    /** roaming.user.sp: Executive Sponsor; approves the target trajectories (kpi_target.approve). */
    sp: "01995000-0000-7000-8000-000000000011",
    /** roaming.user.tl: Transformation Lead; author of the business case. */
    tl: "01995000-0000-7000-8000-000000000012",
    /** roaming.user.bo: Business Owner; accountable owner of the benefits, submits the measurements. */
    bo: "01995000-0000-7000-8000-000000000013",
    /** roaming.user.fin: Finance / Value Office; the synthetic Finance validator. */
    fin: "01995000-0000-7000-8000-000000000014",
    /** roaming.user.kds: KPI/Data Steward; owns the KPI dictionary and enters the actuals. */
    kds: "01995000-0000-7000-8000-000000000015",
    /** roaming.user.wl: Workstream Lead. */
    wl: "01995000-0000-7000-8000-000000000016",
  },
  initiatives: {
    /** INI-01 "Pass redesign + digital activation" (chain 1). */
    passRedesign: "01995000-0000-7000-8000-000000000021",
    /** INI-02 "Proactive comms + QoS monitoring" (chain 2). */
    proactiveComms: "01995000-0000-7000-8000-000000000022",
    /** INI-03 "Partner optimization" (chain 3). */
    partnerOptimization: "01995000-0000-7000-8000-000000000023",
  },
} as const;

/** KBE-H's modules run after every BE-T module that creates the anchors (BE-T keeps its orders below this). */
export const KBE_H_FIRST_ORDER = 400;

/**
 * The engine versions recorded on the seeded lineage rows: the DG3 formula engine's ENGINE_VERSION and the DG4 KPI
 * library's KPI_RULES_VERSION (@mth/shared/calc, which this package may not import, ADR-0002 rule 5; the integration
 * test asserts both equal the engine's constants).
 */
export const FORMULA_ENGINE_VERSION = "mth-formula/1.0.0";
export const KPI_RULES_VERSION = "mth-kpi/1.0.0";

export const SYNTHETIC_NOTE = "Synthetic demonstration value (illustrative example; not Mobily actual performance).";

// ------------------------------------------------------------------------------------------------ time

/**
 * A seeded instant, written as its UTC calendar time for review and derived from the synthetic clock (ctx.at with the
 * fixed offset in minutes). Never the real clock.
 */
export function when(ctx: DemoSeedContext, isoUtc: string): Date {
  const t = Date.parse(isoUtc);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(isoUtc) || Number.isNaN(t))
    throw new Error(`demo seed: invalid instant ${isoUtc}`);
  const minutes = (t - ctx.clock.getTime()) / 60_000;
  if (!Number.isInteger(minutes)) throw new Error(`demo seed: ${isoUtc} is not a whole minute from the clock`);
  return ctx.at({ minutes });
}

// ------------------------------------------------------------------------------------------------ guarded updates

/**
 * One guarded state change of a seeded row, as the product makes it: the engines' triggers admit most rows only in
 * their initial state (a KPI version starts as a draft, a benefit at Identify, a trajectory as a draft), so the seeded
 * state is reached through the same transitions. Steps `version` by one (p2_row_guard) and writes the row's audit event
 * `<table>.<verb>` with the new version (p2_audit_required), in the seed transaction. The seed context has no update
 * path of its own (BE-S's ctx.insert creates only); the audit actor is the seed's CLI actor, the actor of
 * `mth-db seed-demo` and `reset-demo` (the in-app reset's rows are attributed to the worker by ctx.insert, and these
 * updates to cli; see the T-DG5-KBE-H handback).
 */
export async function seedUpdate(
  ctx: DemoSeedContext,
  table: string,
  id: string,
  verb: string,
  set: Readonly<Record<string, unknown>>,
  at: Date,
  by: string | null,
): Promise<number> {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(table) || !/^[a-z][a-z_]{0,40}$/.test(verb))
    throw new Error(`demo seed: invalid update ${table}.${verb}`);
  const columns = Object.keys(set);
  for (const c of columns) if (!/^[a-z][a-z0-9_]{0,62}$/.test(c)) throw new Error(`demo seed: invalid column ${c}`);
  const assignments = [
    ...columns.map((c) => sql`${sql.ref(c)} = ${sql.val(set[c])}`),
    sql`version = version + 1`,
    sql`updated_at = ${at}`,
    ...(by === null ? [] : [sql`updated_by = ${by}`]),
  ];
  // reporting_period is organization-scoped (no transformation_id column).
  const transformationColumn = table === "reporting_period" ? sql`NULL::uuid` : sql`transformation_id`;
  const r = await sql<{ version: number; organization_id: string; transformation_id: string | null }>`
    UPDATE ${sql.table(table)} SET ${sql.join(assignments)} WHERE id = ${id}
    RETURNING version, organization_id, ${transformationColumn} AS transformation_id`.execute(ctx.tx);
  const row = r.rows[0];
  if (row === undefined) throw new Error(`demo seed: ${table} ${id} not found`);
  await insertAuditEvent(
    ctx.tx,
    { actorType: "system", actorUserId: null, source: "cli", requestId: null },
    {
      action: `${table}.${verb}`,
      recordType: table,
      recordId: id,
      organizationId: row.organization_id,
      transformationId: row.transformation_id,
      priorVersion: row.version - 1,
      newVersion: row.version,
      reason: "Synthetic demonstration data (illustrative example; not Mobily actual performance)",
    },
  );
  return row.version;
}

/** The common columns of a seeded P2-style row (fixed actor and synthetic times). */
export function stamps(at: Date, by: string): Record<string, unknown> {
  return { created_at: at, created_by: by, updated_at: at, updated_by: by };
}

/** The organization and transformation columns of every seeded row. */
export function scoped(): { organization_id: string; transformation_id: string } {
  return { organization_id: DEMO_ANCHORS.organizationId, transformation_id: DEMO_ANCHORS.transformationId };
}

// ------------------------------------------------------------------------------------------------ reporting periods

export interface DemoPeriod {
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly start: string;
  readonly end: string;
  readonly dueDate: string;
  /** The status the dataset leaves it in (closed periods are closed after their actuals, in actuals.ts). */
  readonly finalStatus: "scheduled" | "open" | "closed";
  readonly openedAt: string | null;
  readonly closedAt: string | null;
}

/** Monthly periods (the three KPIs are monthly). September is still scheduled at the synthetic clock (2026-09-01). */
export const DEMO_PERIODS: readonly DemoPeriod[] = [
  {
    key: "2026-06",
    id: kbeId(ID_BLOCK.reportingPeriod, 1),
    label: "2026-06",
    start: "2026-06-01",
    end: "2026-06-30",
    dueDate: "2026-07-05",
    finalStatus: "closed",
    openedAt: "2026-07-01T05:00:00Z",
    closedAt: "2026-07-10T05:00:00Z",
  },
  {
    key: "2026-07",
    id: kbeId(ID_BLOCK.reportingPeriod, 2),
    label: "2026-07",
    start: "2026-07-01",
    end: "2026-07-31",
    dueDate: "2026-08-05",
    finalStatus: "closed",
    openedAt: "2026-08-01T05:00:00Z",
    closedAt: "2026-08-10T05:00:00Z",
  },
  {
    key: "2026-08",
    id: kbeId(ID_BLOCK.reportingPeriod, 3),
    label: "2026-08",
    start: "2026-08-01",
    end: "2026-08-31",
    dueDate: "2026-09-05",
    finalStatus: "open",
    openedAt: "2026-09-01T05:00:00Z",
    closedAt: null,
  },
  {
    key: "2026-09",
    id: kbeId(ID_BLOCK.reportingPeriod, 4),
    label: "2026-09",
    start: "2026-09-01",
    end: "2026-09-30",
    dueDate: "2026-10-05",
    finalStatus: "scheduled",
    openedAt: null,
    closedAt: null,
  },
];

export function demoPeriod(key: string): DemoPeriod {
  const p = DEMO_PERIODS.find((x) => x.key === key);
  if (p === undefined) throw new Error(`demo seed: no period ${key}`);
  return p;
}

// ------------------------------------------------------------------------------------------------ KPIs

export interface DemoKpi {
  readonly key: "attach_rate" | "complaint_rate" | "cost_per_mb";
  readonly no: number;
  readonly definitionId: string;
  readonly versionId: string;
  readonly chain: 1 | 2 | 3;
  readonly name: string;
  readonly description: string;
  readonly businessPurpose: string;
  readonly unitKind: "percentage" | "currency";
  readonly unitLabel: string;
  readonly currency: string | null;
  readonly measureType: "higher_is_better" | "lower_is_better";
  readonly numeratorLabel: string;
  readonly denominatorLabel: string;
  readonly dataSource: string;
  readonly baselineValue: string;
  readonly baselineDate: string;
  readonly targetValue: string;
  readonly targetDate: string;
  readonly staleAfterDays: number;
  readonly validMin: string;
  readonly validMax: string;
  /**
   * The configured RAG threshold version 1, or null: the documented defaults apply (relative 0.05 / 0.10). Written in
   * the numeric(24,6) text form the worker reads back, so the explanation parameters name them exactly as it does.
   */
  readonly threshold: {
    readonly id: string;
    readonly mode: "relative" | "absolute";
    readonly amber: string;
    readonly red: string;
    readonly reason: string;
  } | null;
  /** The approved target trajectory (scope transformation, basis period, linear), version 1. */
  readonly trajectory: {
    readonly id: string;
    readonly points: readonly { readonly date: string; readonly value: string }[];
  };
}

/** The three chain KPIs (B0147: "Attach rate / activation", "Complaint rate", "Cost/MB, margin"). All synthetic. */
export const DEMO_KPIS: readonly DemoKpi[] = [
  {
    key: "attach_rate",
    no: 1,
    definitionId: kbeId(ID_BLOCK.kpiDefinition, 1),
    versionId: kbeId(ID_BLOCK.kpiVersion, 1),
    chain: 1,
    name: "Roaming attach rate",
    description: "Share of travelling customers with an active roaming pass in the month. " + SYNTHETIC_NOTE,
    businessPurpose:
      "Measures activation of the redesigned roaming passes (chain 1: low activation -> revenue uplift).",
    unitKind: "percentage",
    unitLabel: "%",
    currency: null,
    measureType: "higher_is_better",
    numeratorLabel: "Travelling customers with an active roaming pass",
    denominatorLabel: "Travelling customers",
    dataSource: "Synthetic roaming usage extract (demonstration)",
    baselineValue: "0.18",
    baselineDate: "2026-05-31",
    targetValue: "0.24",
    targetDate: "2026-12-31",
    staleAfterDays: 45,
    validMin: "0",
    validMax: "1",
    threshold: {
      id: kbeId(ID_BLOCK.ragThreshold, 1),
      mode: "relative",
      amber: "0.050000",
      red: "0.100000",
      reason: "Agreed tolerance for the attach-rate trajectory (synthetic demonstration).",
    },
    trajectory: {
      id: kbeId(ID_BLOCK.trajectory, 1),
      points: [
        { date: "2026-06-30", value: "0.19" },
        { date: "2026-07-31", value: "0.2" },
        { date: "2026-08-31", value: "0.21" },
        { date: "2026-09-30", value: "0.22" },
        { date: "2026-10-31", value: "0.23" },
        { date: "2026-11-30", value: "0.235" },
        { date: "2026-12-31", value: "0.24" },
      ],
    },
  },
  {
    key: "complaint_rate",
    no: 2,
    definitionId: kbeId(ID_BLOCK.kpiDefinition, 2),
    versionId: kbeId(ID_BLOCK.kpiVersion, 2),
    chain: 2,
    name: "Roaming complaint rate",
    description: "Roaming complaints per travelling customer in the month. " + SYNTHETIC_NOTE,
    businessPurpose:
      "Measures the effect of proactive communications and QoS monitoring (chain 2: high complaints -> CX + care cost).",
    unitKind: "percentage",
    unitLabel: "%",
    currency: null,
    measureType: "lower_is_better",
    numeratorLabel: "Roaming complaints",
    denominatorLabel: "Travelling customers",
    dataSource: "Synthetic care case extract (demonstration)",
    baselineValue: "0.035",
    baselineDate: "2026-05-31",
    targetValue: "0.025",
    targetDate: "2026-12-31",
    staleAfterDays: 45,
    validMin: "0",
    validMax: "1",
    threshold: null,
    trajectory: {
      id: kbeId(ID_BLOCK.trajectory, 2),
      points: [
        { date: "2026-06-30", value: "0.034" },
        { date: "2026-07-31", value: "0.032" },
        { date: "2026-08-31", value: "0.03" },
        { date: "2026-09-30", value: "0.029" },
        { date: "2026-10-31", value: "0.027" },
        { date: "2026-11-30", value: "0.026" },
        { date: "2026-12-31", value: "0.025" },
      ],
    },
  },
  {
    key: "cost_per_mb",
    no: 3,
    definitionId: kbeId(ID_BLOCK.kpiDefinition, 3),
    versionId: kbeId(ID_BLOCK.kpiVersion, 3),
    chain: 3,
    name: "Partner wholesale cost per MB",
    description: "Partner wholesale roaming cost per MB of roaming data in the month. " + SYNTHETIC_NOTE,
    businessPurpose:
      "Measures partner optimization and analytics (chain 3: partner cost pressure -> margin improvement).",
    unitKind: "currency",
    unitLabel: "SAR/MB",
    currency: "SAR",
    measureType: "lower_is_better",
    numeratorLabel: "Partner wholesale cost (SAR)",
    denominatorLabel: "Roaming data volume (MB)",
    dataSource: "Synthetic partner settlement (TAP) extract (demonstration)",
    baselineValue: "0.012",
    baselineDate: "2026-05-31",
    targetValue: "0.01",
    targetDate: "2026-12-31",
    staleAfterDays: 45,
    validMin: "0",
    validMax: "1",
    threshold: {
      id: kbeId(ID_BLOCK.ragThreshold, 2),
      mode: "absolute",
      amber: "0.000300",
      red: "0.000800",
      reason: "Absolute tolerance in SAR per MB agreed with partner management (synthetic demonstration).",
    },
    trajectory: {
      id: kbeId(ID_BLOCK.trajectory, 3),
      points: [
        { date: "2026-06-30", value: "0.012" },
        { date: "2026-07-31", value: "0.0115" },
        { date: "2026-08-31", value: "0.011" },
        { date: "2026-09-30", value: "0.0105" },
        { date: "2026-10-31", value: "0.01" },
        { date: "2026-11-30", value: "0.01" },
        { date: "2026-12-31", value: "0.01" },
      ],
    },
  },
];

export function demoKpi(key: DemoKpi["key"]): DemoKpi {
  const k = DEMO_KPIS.find((x) => x.key === key);
  if (k === undefined) throw new Error(`demo seed: no KPI ${key}`);
  return k;
}

const KPIS_CREATED_AT = "2026-05-20T07:00:00Z";
const VERSIONS_ACTIVATED_AT = "2026-05-25T07:00:00Z";
const TRAJECTORIES_APPROVED_AT = "2026-05-28T08:00:00Z";

async function seedPeriods(ctx: DemoSeedContext): Promise<void> {
  const by = DEMO_ANCHORS.users.kds;
  for (const p of DEMO_PERIODS) {
    const at = when(ctx, KPIS_CREATED_AT);
    // A period is created scheduled; an actual is entered only while it is open (kpi_actual_period_open), so the
    // three past periods open here and June and July close after their actuals (actuals.ts).
    await ctx.insert(
      "reporting_period",
      `kbe.period.${p.key}`,
      {
        id: p.id,
        organization_id: DEMO_ANCHORS.organizationId,
        frequency: "monthly",
        period_label: p.label,
        period_start: p.start,
        period_end: p.end,
        basis: "calendar",
        week_count: null,
        update_due_date: p.dueDate,
        status: "scheduled",
        opened_at: null,
        closed_at: null,
        version: 1,
        ...stamps(at, by),
      },
      { organizationId: DEMO_ANCHORS.organizationId, transformationId: null },
    );
    if (p.openedAt !== null) {
      const opened = when(ctx, p.openedAt);
      await seedUpdate(ctx, "reporting_period", p.id, "open", { status: "open", opened_at: opened }, opened, null);
    }
  }
}

async function seedKpi(ctx: DemoSeedContext, k: DemoKpi): Promise<void> {
  const { kds, sp } = DEMO_ANCHORS.users;
  const created = when(ctx, KPIS_CREATED_AT);
  await ctx.insert("kpi_definition", `kbe.kpi.${k.key}`, {
    id: k.definitionId,
    ...scoped(),
    name: k.name,
    description: k.description,
    business_purpose: k.businessPurpose,
    unit_kind: k.unitKind,
    unit_label: k.unitLabel,
    currency: k.currency,
    polarity: k.measureType,
    frequency: "monthly",
    is_leading: false,
    data_source: k.dataSource,
    owner_user_id: kds,
    steward_user_id: kds,
    status: "active",
    version: 1,
    ...stamps(created, kds),
  });
  await ctx.insert("kpi_version", `kbe.kpi.${k.key}.v1`, {
    id: k.versionId,
    ...scoped(),
    kpi_definition_id: k.definitionId,
    version_no: 1,
    status: "draft",
    measure_type: k.measureType,
    value_nature: "ratio",
    entry_scope_kind: "transformation",
    unit_kind: k.unitKind,
    unit_label: k.unitLabel,
    currency: k.currency,
    frequency: "monthly",
    numerator_label: k.numeratorLabel,
    denominator_label: k.denominatorLabel,
    calculation_method: "entered",
    calculation_description: `${k.numeratorLabel} / ${k.denominatorLabel} (a weighted ratio, never an average of percentages).`,
    aggregation_rule: "weighted_ratio",
    stock_additive_across_scopes: false,
    ytd_start_month: 1,
    baseline_value: k.baselineValue,
    baseline_date: k.baselineDate,
    target_value: k.targetValue,
    target_date: k.targetDate,
    dq_stale_after_days: k.staleAfterDays,
    dq_valid_min: k.validMin,
    dq_valid_max: k.validMax,
    dq_evidence_required: false,
    submission_route: "direct_accept",
    reviewer_party_code: null,
    definition_approval: "direct",
    version: 1,
    ...stamps(created, kds),
  });
  const activated = when(ctx, VERSIONS_ACTIVATED_AT);
  await seedUpdate(
    ctx,
    "kpi_version",
    k.versionId,
    "activate",
    { status: "active", activated_at: activated, activated_by: kds },
    activated,
    kds,
  );
  if (k.threshold !== null)
    await ctx.insert("kpi_rag_threshold", `kbe.kpi.${k.key}.threshold.v1`, {
      id: k.threshold.id,
      ...scoped(),
      kpi_definition_id: k.definitionId,
      version_no: 1,
      tolerance_mode: k.threshold.mode,
      amber_threshold: k.threshold.amber,
      red_threshold: k.threshold.red,
      reason: k.threshold.reason,
      status: "active",
      version: 1,
      ...stamps(activated, kds),
    });
  // The trajectory is proposed by the steward and approved by the Sponsor (never by its creator).
  await ctx.insert("target_trajectory", `kbe.kpi.${k.key}.trajectory.v1`, {
    id: k.trajectory.id,
    ...scoped(),
    kpi_definition_id: k.definitionId,
    scope_kind: "transformation",
    scope_id: DEMO_ANCHORS.transformationId,
    version_no: 1,
    basis: "period",
    interpolation: "linear",
    source: "api",
    status: "draft",
    version: 1,
    ...stamps(activated, kds),
  });
  let n = 0;
  for (const p of k.trajectory.points) {
    n += 1;
    await ctx.insert("target_trajectory_point", `kbe.kpi.${k.key}.trajectory.v1.${p.date}`, {
      id: kbeId(ID_BLOCK.trajectoryPoint, k.no * 0x100 + n),
      ...scoped(),
      target_trajectory_id: k.trajectory.id,
      point_date: p.date,
      expected_value: p.value,
      created_at: activated,
      created_by: kds,
    });
  }
  const approved = when(ctx, TRAJECTORIES_APPROVED_AT);
  await seedUpdate(
    ctx,
    "target_trajectory",
    k.trajectory.id,
    "approve",
    { status: "approved", approved_by: sp, approved_at: approved, approved_record_version: 1 },
    approved,
    sp,
  );
}

/** Module: periods, then each KPI with its version, threshold and trajectory (fixed order). */
export const KPIS_MODULE: DemoDatasetModule = {
  key: "kbe.kpis",
  order: KBE_H_FIRST_ORDER,
  async seed(ctx) {
    await seedPeriods(ctx);
    for (const k of DEMO_KPIS) await seedKpi(ctx, k);
  },
};
