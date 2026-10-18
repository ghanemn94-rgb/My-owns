// The roaming transformation's APPROVED PORTFOLIO behind its G4 approval (T-DG5-BE-X2; D-172; F-DG5-120 remaining part,
// F-DG5-122; ADR-0050 §4-§5; ADR-0021 §3, §7; ADR-0022 §4; ADR-0023 §2, §6, §7; ADR-0024 §1, §5; REQ-S18-002,
// REQ-PB-019; M0348, B0023 G4 "Is the portfolio executable and value-backed?": "Initiative cards, business cases,
// roadmap, owners, capacity").
//
// The three illustrative B0147 initiatives INI-01..INI-03 are taken through the portfolio path AS THE PRODUCT RECORDS
// IT (apps/api/src/modules/portfolio: transitions.ts, rankings.ts, selections.ts, funding.ts, milestones.ts,
// capacity.ts, resource-demands.ts; kpi/business-cases.ts), through the same tables and database guards, one audit
// event per write, by the demo role user who holds the product permission, in Mobilize, between G3 (approved
// 2026-06-02) and the G4 submission (2026-06-08), on the synthetic clock:
//   2026-06-03 07:00  TL submits each initiative for prioritization (draft -> submitted; initiative.edit). Each has a
//                     complete card (name, objective, scope in), a gap link and a KPI contribution (roaming.ts,
//                     roaming-chains.ts), and G1 is approved (the submit preconditions);
//   2026-06-03 09:00  TL proposes ranking snapshot 1 under the active weight set v1 (prioritization.edit): each
//                     initiative's result is computed from its five T06 scores and appended (cause `initial`), the
//                     complete ones are ranked by weighted score desc then code, and each moves submitted -> ranked;
//   2026-06-04 07:00  the demo Sponsor selects each from that ranking (portfolio.select; ranked -> selected), with a
//                     rationale; a person's business approval inside the product, synthetic here;
//   2026-06-05 09:30  the demo Finance user validates each initiative case's baseline (finance.validate; never the
//                     case's author, the TL; business_case_validator_not_author);
//   2026-06-05 11:00  the demo Finance user records an approved funding decision per initiative (funding.approve; FIN):
//                     the canonical decision DEC-02..DEC-04 (kind executive) and the funding_decision row, amount =
//                     the initiative case's cash investment; selected -> funded;
//   2026-06-05 13:00  TL creates the resourcing roles and their monthly capacity (capacity.edit) for July-December 2026;
//                     WL plans each initiative's monthly demand (capacity.edit);
//   2026-06-05 14:00  TL creates two milestones per initiative (initiative.edit), inside the initiative's planned window,
//                     after the synthetic clock, the last of INI-03 before DEP-01's needed-by date (no schedule
//                     conflict; schedule.ts);
//   2026-06-06 08:00  the Business Owner commits the demand (capacity.commit): committed demand never exceeds the
//                     capacity of its role and month (no capacity conflict, no Unknown capacity);
//   2026-06-06 09:00  TL approves the milestone dates (roadmap.approve), with a reason.
// After G4 is approved (2026-06-10), TL launches each funded initiative on its planned start, 2026-07-03
// (initiative.launch; G2 and G3 approved, funded): the transformation is in Transform.
//
// The totals the demo shows are unchanged: the funding amounts are the initiative cases' existing cash investment lines
// (business-cases.ts), and no benefit or line figure is added. Committed demand (5.5 FTE a month) stays within the
// 6.5 internal FTE of the transformation case.
//
// EVERY DECISION HERE IS SYNTHETIC: a demonstration decision by a demo user on demo data, labelled "Synthetic
// demonstration - approves nothing real" (REQ-S21-001; M0412). No real business, Finance or IT approval is granted, and
// product gate G4 never implies an engineering gate DG0-DG7. Determinism (ADR-0050 §4): fixed 01995000-… ids, every
// time from the synthetic clock, rows in a fixed order, literal decimal strings (this package may not import the
// scoring engine, ADR-0002 rule 5; demo-gate-history.test.ts recomputes the weighted scores with @mth/shared).
import { sql } from "kysely";
import type { DemoSeedContext } from "../seed.ts";
import { DEMO_INITIATIVE_CASES, type DemoInitiativeCase } from "./business-cases.ts";
import { SYNTHETIC_APPROVAL_NOTE } from "./finance.ts";
import { DEMO_ANCHORS, scoped, seedUpdate, stamps, when } from "./kpis.ts";
import { RT_BLOCK, rtId } from "./roaming-ids.ts";

const U = DEMO_ANCHORS.users;
const INI = DEMO_ANCHORS.initiatives;
const LABEL = `${SYNTHETIC_APPROVAL_NOTE} / عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي.`;

/** The synthetic times of the portfolio path (UTC), in order, between G3 (2026-06-02) and G4 (2026-06-08). */
export const DEMO_PORTFOLIO_TIMES = {
  submitted: "2026-06-03T07:00:00Z",
  ranked: "2026-06-03T09:00:00Z",
  selected: "2026-06-04T07:00:00Z",
  casesValidated: "2026-06-05T09:30:00Z",
  funded: "2026-06-05T11:00:00Z",
  resourced: "2026-06-05T13:00:00Z",
  milestonesCreated: "2026-06-05T14:00:00Z",
  committed: "2026-06-06T08:00:00Z",
  milestonesApproved: "2026-06-06T09:00:00Z",
  /** After G4 (2026-06-10): the planned start of the three initiatives (roaming.ts planned_start, clock - 60 days). */
  launched: "2026-07-03T08:00:00Z",
} as const;

/** The weight set v1 (roaming.ts; B0076 source defaults), in criterion-catalogue order. */
const WEIGHTS: readonly (readonly [string, string])[] = [
  ["strategic_fit", "25.00"],
  ["financial_value", "25.00"],
  ["customer_impact", "20.00"],
  ["feasibility", "15.00"],
  ["time_to_value", "15.00"],
];

/** One initiative of the approved portfolio, with the literal facts the seed records for it. */
export interface DemoPortfolioInitiative {
  readonly no: number;
  readonly id: string;
  readonly code: "INI-01" | "INI-02" | "INI-03";
  readonly caseKey: DemoInitiativeCase["key"];
  /** Its five T06 scores (roaming.ts), in WEIGHTS order. */
  readonly scores: readonly number[];
  /** Literal: the scoring engine's weighted score of `scores` under v1 (numeric(7,4)). */
  readonly weightedScore: string;
  /** Rank in snapshot 1: weighted score desc, then code asc. */
  readonly rank: number;
  readonly milestones: readonly { readonly title: string; readonly date: string }[];
  readonly role: { readonly code: string; readonly labelEn: string; readonly labelAr: string; readonly fte: string };
  /** Monthly committed FTE of the initiative's role (decimal string, numeric(6,2)). */
  readonly demandFte: string;
}

export const DEMO_PORTFOLIO: readonly DemoPortfolioInitiative[] = [
  {
    no: 1,
    id: INI.passRedesign,
    code: "INI-01",
    caseKey: "activation",
    scores: [5, 4, 4, 3, 3],
    weightedScore: "3.9500",
    rank: 2,
    milestones: [
      { title: "Roaming pass architecture redesigned (synthetic)", date: "2026-09-30" },
      { title: "One-tap digital activation live in the app (synthetic)", date: "2026-11-30" },
    ],
    role: {
      code: "product_digital",
      labelEn: "Product and digital journey",
      labelAr: "المنتج والرحلة الرقمية",
      fte: "3.00",
    },
    demandFte: "2.50",
  },
  {
    no: 2,
    id: INI.proactiveComms,
    code: "INI-02",
    caseKey: "complaints",
    scores: [5, 4, 4, 3, 3],
    weightedScore: "3.9500",
    rank: 3,
    milestones: [
      { title: "QoS monitoring live for the top roaming destinations (synthetic)", date: "2026-10-15" },
      { title: "Proactive travel notifications live (synthetic)", date: "2026-12-15" },
    ],
    role: {
      code: "service_assurance",
      labelEn: "Service assurance and care",
      labelAr: "ضمان الخدمة والرعاية",
      fte: "2.00",
    },
    demandFte: "1.50",
  },
  {
    no: 3,
    id: INI.partnerOptimization,
    code: "INI-03",
    caseKey: "partner",
    scores: [5, 4, 4, 4, 3],
    weightedScore: "4.1000",
    rank: 1,
    milestones: [
      { title: "Partner cost analytics baseline delivered (synthetic)", date: "2026-09-15" },
      // DEP-01: INI-01 needs INI-03's partner usage feed by 2026-10-01; INI-03's finish is its last milestone.
      { title: "Partner usage feed live for digital activation (synthetic)", date: "2026-09-28" },
    ],
    role: {
      code: "partner_analytics",
      labelEn: "Partner management and analytics",
      labelAr: "إدارة الشركاء والتحليلات",
      fte: "2.00",
    },
    demandFte: "1.50",
  },
];

/** The months of the capacity plan and of the committed demand (the initiatives' planned window, July-December). */
export const DEMO_CAPACITY_MONTHS = [
  "2026-07-01",
  "2026-08-01",
  "2026-09-01",
  "2026-10-01",
  "2026-11-01",
  "2026-12-01",
] as const;

/** Fixed ids of the portfolio records (exported for the dataset tests). */
export const DEMO_PORTFOLIO_IDS = {
  rankingSnapshot: rtId(RT_BLOCK.rankingSnapshot, 1),
  scoreResult: (no: number) => rtId(RT_BLOCK.scoreResult, no),
  rankingEntry: (no: number) => rtId(RT_BLOCK.rankingEntry, no),
  selection: (no: number) => rtId(RT_BLOCK.portfolioSelection, no),
  fundingDecision: (no: number) => rtId(RT_BLOCK.fundingDecision, no),
  /** The canonical decision row (kind executive, DEC-0(n+1)) behind each funding decision; after GD-01..GD-04. */
  fundingCanonicalDecision: (no: number) => rtId(RT_BLOCK.decision, 6 + no),
  milestone: (no: number, k: number) => rtId(RT_BLOCK.milestone, (no - 1) * 2 + k),
  resourceRole: (no: number) => rtId(RT_BLOCK.resourceRole, no),
  capacity: (no: number, m: number) => rtId(RT_BLOCK.capacity, (no - 1) * DEMO_CAPACITY_MONTHS.length + m),
  resourceDemand: (no: number, m: number) => rtId(RT_BLOCK.resourceDemand, (no - 1) * DEMO_CAPACITY_MONTHS.length + m),
} as const;

const WAVE_2 = rtId(RT_BLOCK.roadmapWave, 2);

function caseOf(p: DemoPortfolioInitiative): DemoInitiativeCase {
  const c = DEMO_INITIATIVE_CASES.find((x) => x.key === p.caseKey);
  if (c === undefined) throw new Error(`demo seed: no initiative case for ${p.code}`);
  return c;
}

async function initiativeName(ctx: DemoSeedContext, id: string): Promise<string> {
  const row = (await sql<{ name: string }>`SELECT name FROM initiative WHERE id = ${id}::uuid`.execute(ctx.tx)).rows[0];
  if (row === undefined) throw new Error(`demo seed: initiative ${id} is missing`);
  return row.name;
}

/** The product's status step of one initiative (`initiative.<verb>`, version + 1), from the expected status only. */
async function step(
  ctx: DemoSeedContext,
  p: DemoPortfolioInitiative,
  from: string,
  to: string,
  verb: string,
  at: Date,
  by: string,
  extra: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const row = (await sql<{ status: string }>`SELECT status FROM initiative WHERE id = ${p.id}::uuid`.execute(ctx.tx))
    .rows[0];
  if (row?.status !== from) throw new Error(`demo seed: ${p.code} is ${row?.status}, expected ${from} before ${verb}`);
  await seedUpdate(ctx, "initiative", p.id, verb, { status: to, ...extra }, at, by);
}

/**
 * The approved portfolio, up to (and not including) the G4 submission. roaming-gates.ts calls it after G3 is approved
 * and before G4 is submitted, so G4's frozen snapshot reads these records.
 */
export async function seedApprovedPortfolio(ctx: DemoSeedContext): Promise<void> {
  const { tl, sp, fin, bo, wl } = U;
  const t = (k: keyof typeof DEMO_PORTFOLIO_TIMES) => when(ctx, DEMO_PORTFOLIO_TIMES[k]);
  const weightSet = rtId(RT_BLOCK.scoringWeightSet, 1);

  // 1. Submit for prioritization (draft -> submitted; transitions.ts submit).
  for (const p of DEMO_PORTFOLIO) await step(ctx, p, "draft", "submitted", "submit", t("submitted"), tl);

  // 2. Ranking snapshot 1 under weight set v1 (rankings.ts createSnapshot): the results, the snapshot, its entries,
  //    and submitted -> ranked for every complete one.
  for (const p of DEMO_PORTFOLIO) {
    const inputs = Object.fromEntries(
      WEIGHTS.map(([code, weight], k) => [code, { score: String(p.scores[k]), weightPercent: weight }]),
    );
    await ctx.insert("initiative_score_result", `roaming.portfolio.score_result.${p.code.toLowerCase()}`, {
      id: DEMO_PORTFOLIO_IDS.scoreResult(p.no),
      ...scoped(),
      initiative_id: p.id,
      weight_set_id: weightSet,
      weight_set_version_no: 1,
      weighted_score: p.weightedScore,
      completeness: "complete",
      missing_criteria: [],
      inputs: JSON.stringify(inputs),
      cause: "initial",
      computed_at: t("ranked"),
      computed_by: tl,
    });
  }
  await ctx.insert("ranking_snapshot", "roaming.portfolio.ranking_snapshot.1", {
    id: DEMO_PORTFOLIO_IDS.rankingSnapshot,
    ...scoped(),
    snapshot_no: 1,
    weight_set_id: weightSet,
    status: "current",
    note: "Proposed ranking of the three B0147 initiatives under the source default weights (synthetic).",
    proposed_by: tl,
    proposed_at: t("ranked"),
    ...stamps(t("ranked"), tl),
  });
  for (const p of [...DEMO_PORTFOLIO].sort((a, b) => a.rank - b.rank))
    await ctx.insert("ranking_entry", `roaming.portfolio.ranking_entry.${p.code.toLowerCase()}`, {
      id: DEMO_PORTFOLIO_IDS.rankingEntry(p.no),
      ...scoped(),
      snapshot_id: DEMO_PORTFOLIO_IDS.rankingSnapshot,
      initiative_id: p.id,
      rank: p.rank,
      weighted_score: p.weightedScore,
      completeness: "complete",
      score_result_id: DEMO_PORTFOLIO_IDS.scoreResult(p.no),
      previous_rank: null,
      causes: ["new"],
      cause_detail: JSON.stringify({ weightSetVersionNo: 1 }),
      override_id: null,
      created_at: t("ranked"),
      created_by: tl,
    });
  for (const p of DEMO_PORTFOLIO) await step(ctx, p, "submitted", "ranked", "rank", t("ranked"), tl);

  // 3. Selection by the demo Sponsor from the current ranking (selections.ts select; ranked -> selected).
  for (const p of DEMO_PORTFOLIO) {
    const name = await initiativeName(ctx, p.id);
    await ctx.insert("portfolio_selection", `roaming.portfolio.selection.${p.code.toLowerCase()}`, {
      id: DEMO_PORTFOLIO_IDS.selection(p.no),
      ...scoped(),
      initiative_id: p.id,
      action: "selected",
      rationale: `${LABEL} ${p.code} ${name} is ranked ${p.rank} of 3 in ranking snapshot 1 and carries a B0147 chain to a measured KPI and benefit: selected for the approved portfolio.`,
      ranking_snapshot_id: DEMO_PORTFOLIO_IDS.rankingSnapshot,
      decided_by: sp,
      on_behalf_of_user_id: null,
      decided_at: t("selected"),
    });
    await step(ctx, p, "ranked", "selected", "select", t("selected"), sp);
  }

  // 4. The Finance validation of each initiative case's baseline (business-cases.ts baseline-validation; the demo Finance
  //    user, never the author).
  for (const c of DEMO_INITIATIVE_CASES) {
    const sha = (
      await sql<{ sha: string }>`
        SELECT encode(sha256(convert_to(coalesce(baseline_summary, ''), 'UTF8')), 'hex') AS sha
          FROM business_case WHERE id = ${c.id}::uuid`.execute(ctx.tx)
    ).rows[0];
    if (sha === undefined) throw new Error(`demo seed: initiative case ${c.code} is missing`);
    await seedUpdate(
      ctx,
      "business_case",
      c.id,
      "validate_baseline",
      {
        baseline_validation_status: "validated",
        baseline_validated_by: fin,
        baseline_validated_at: t("casesValidated"),
        baseline_validation_note: SYNTHETIC_APPROVAL_NOTE,
        baseline_validated_sha256: sha.sha,
      },
      t("casesValidated"),
      fin,
    );
  }

  // 5. The approved funding decision per initiative (funding.ts recordFunding; FIN; selected -> funded).
  for (const p of DEMO_PORTFOLIO) {
    const c = caseOf(p);
    const name = await initiativeName(ctx, p.id);
    const decisionId = DEMO_PORTFOLIO_IDS.fundingCanonicalDecision(p.no);
    const code = `DEC-0${p.no + 1}`;
    const rationale =
      `${LABEL} ${c.code} is complete and its baseline is Finance-validated; ${c.investmentSummary} ` +
      `Funded from the transformation budget (synthetic decision of ${DEMO_PORTFOLIO_TIMES.funded.slice(0, 10)}).`;
    await ctx.insert("decision", `roaming.portfolio.funding.${p.code.toLowerCase()}.decision`, {
      id: decisionId,
      ...scoped(),
      kind: "executive",
      code,
      title: `Funding decision: ${p.code} ${name}`,
      owner_user_id: fin,
      status: "decided",
      outcome_text: `approved: ${rationale}`,
      decided_by: fin,
      decided_at: t("funded"),
      ...stamps(t("funded"), fin),
    });
    await ctx.insert("funding_decision", `roaming.portfolio.funding.${p.code.toLowerCase()}`, {
      id: DEMO_PORTFOLIO_IDS.fundingDecision(p.no),
      ...scoped(),
      initiative_id: p.id,
      decision_id: decisionId,
      outcome: "approved",
      amount: c.fundingAmount,
      currency: "SAR",
      funding_source: "International Roaming transformation budget (synthetic)",
      conditions: "Release by milestone; report against the initiative case monthly (synthetic).",
      rationale,
      business_case_id: c.id,
      approver_role_code: "FIN",
      decided_by: fin,
      on_behalf_of_user_id: null,
      decided_at: t("funded"),
    });
    await step(ctx, p, "selected", "funded", "fund", t("funded"), fin);
  }

  // 6. Resourcing roles and their monthly capacity (capacity.ts; TL), and each initiative's planned demand (WL).
  for (const p of DEMO_PORTFOLIO)
    await ctx.insert("resource_role", `roaming.portfolio.resource_role.${p.role.code}`, {
      id: DEMO_PORTFOLIO_IDS.resourceRole(p.no),
      ...scoped(),
      code: p.role.code,
      label_en: p.role.labelEn,
      label_ar: p.role.labelAr,
      status: "active",
      ...stamps(t("resourced"), tl),
    });
  for (const p of DEMO_PORTFOLIO) {
    let m = 0;
    for (const month of DEMO_CAPACITY_MONTHS) {
      m += 1;
      await ctx.insert("capacity", `roaming.portfolio.capacity.${p.role.code}.${month.slice(0, 7)}`, {
        id: DEMO_PORTFOLIO_IDS.capacity(p.no, m),
        ...scoped(),
        resource_role_id: DEMO_PORTFOLIO_IDS.resourceRole(p.no),
        period_month: month,
        available_fte: p.role.fte,
        owner_user_id: bo,
        note: "Available internal FTE for the roaming transformation (synthetic).",
        status: "active",
        ...stamps(t("resourced"), tl),
      });
      await ctx.insert("resource_demand", `roaming.portfolio.demand.${p.code.toLowerCase()}.${month.slice(0, 7)}`, {
        id: DEMO_PORTFOLIO_IDS.resourceDemand(p.no, m),
        ...scoped(),
        initiative_id: p.id,
        resource_role_id: DEMO_PORTFOLIO_IDS.resourceRole(p.no),
        period_month: month,
        demand_fte: p.demandFte,
        owner_user_id: wl,
        note: `${p.code} delivery team (synthetic).`,
        status: "planned",
        ...stamps(t("resourced"), wl),
      });
    }
  }

  // 7. Two milestones per initiative (milestones.ts create; TL), in the initiative's wave.
  for (const p of DEMO_PORTFOLIO) {
    let k = 0;
    for (const ms of p.milestones) {
      k += 1;
      await ctx.insert("milestone", `roaming.portfolio.milestone.${p.code.toLowerCase()}.${k}`, {
        id: DEMO_PORTFOLIO_IDS.milestone(p.no, k),
        ...scoped(),
        initiative_id: p.id,
        wave_id: WAVE_2,
        title: ms.title,
        description: null,
        owner_user_id: wl,
        forecast_date: ms.date,
        status: "planned",
        ...stamps(t("milestonesCreated"), tl),
      });
    }
  }

  // 8. The Business Owner commits the demand (resource-demands.ts commit; capacity.commit; planned -> committed).
  for (const p of DEMO_PORTFOLIO) {
    let m = 0;
    for (const _month of DEMO_CAPACITY_MONTHS) {
      m += 1;
      await seedUpdate(
        ctx,
        "resource_demand",
        DEMO_PORTFOLIO_IDS.resourceDemand(p.no, m),
        "commit",
        { status: "committed", committed_by: bo, committed_at: t("committed") },
        t("committed"),
        bo,
      );
    }
  }

  // 9. TL approves the milestone dates (milestones.ts approve-date; roadmap.approve), with a reason.
  for (const p of DEMO_PORTFOLIO) {
    let k = 0;
    for (const ms of p.milestones) {
      k += 1;
      await seedUpdate(
        ctx,
        "milestone",
        DEMO_PORTFOLIO_IDS.milestone(p.no, k),
        "approve_date",
        {
          approved_date: ms.date,
          approved_by: tl,
          approved_at: t("milestonesApproved"),
          approval_reason: `Baseline date of the ${p.code} roadmap (synthetic demonstration).`,
        },
        t("milestonesApproved"),
        tl,
      );
    }
  }
}

/** After G4 is approved: TL launches each funded initiative on its planned start (transitions.ts launch). */
export async function launchApprovedPortfolio(ctx: DemoSeedContext): Promise<void> {
  const at = when(ctx, DEMO_PORTFOLIO_TIMES.launched);
  for (const p of DEMO_PORTFOLIO)
    await step(ctx, p, "funded", "launched", "launch", at, U.tl, { launched_at: at, launched_by: U.tl });
}
