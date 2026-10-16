// The International Roaming transformation (ADR-0050 §2–§5; p5-work-split §J.2; T-DG5-BE-T): the organization, the
// demo role users, the one roaming transformation with its starter structure, the seven B0145 elements verbatim, the
// diagnostic findings, TOM gaps and initiatives of the three B0147 chains, and the governance records the coverage
// check needs. KBE-H's numbers (kpis.ts … finance.ts, orders 400–440) hang on the anchors created here (DEMO_ANCHORS);
// the chain links that need KBE-H's KPIs and benefits are in roaming-chains.ts (order 500).
//
// EVERYTHING here is SYNTHETIC: B0144 "Illustrative example only. Replace assumptions with validated company data."
// It is not Mobily actual performance (M0339). A seeded approval or decision is a synthetic decision by a demo user and
// approves nothing real (M0412); no real business, Finance or IT approval is granted. Product gate G6 never implies DG7.
// No demo credential is stored: the demo users' identities name the demo IdP issuer of the demo deployment only.
//
// Determinism (ADR-0050 §4): fixed literal ids (roaming-ids.ts, DEMO_ANCHORS), every time from the synthetic clock,
// rows in a fixed order (catalogue rows by their ordinal). The product's instantiation (p4_instantiate_transformation)
// would create the starter structure with generated ids and now(); the seed creates the same rows itself with fixed
// ids, then calls the function and requires that it creates nothing (so the structure is exactly the product's).
import { sql } from "kysely";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { DEMO_ANCHORS } from "./kpis.ts";
import { RT_BLOCK, rtId } from "./roaming-ids.ts";

const ORG = DEMO_ANCHORS.organizationId;
const BU = DEMO_ANCHORS.businessUnitId;
const T = DEMO_ANCHORS.transformationId;
const U = DEMO_ANCHORS.users;
const INI = DEMO_ANCHORS.initiatives;
/** The Transformation Office and Change Manager demo users (not KBE-H anchors). */
export const TO_USER = rtId(RT_BLOCK.appUser, 1);
export const CM_USER = rtId(RT_BLOCK.appUser, 2);

/** The demo IdP issuer named by the demo users' identities (configured only in a demo deployment; no secret here). */
export const DEMO_IDP_ISSUER = "https://demo-idp.mth.invalid/realms/roaming-demo";

/** B0144, shown verbatim on the transformation's overview (ADR-0050 §2). */
export const B0144_TEXT = "Illustrative example only. Replace assumptions with validated company data.";

/** The seven B0145 elements, verbatim (docs/source/playbook.md B0145). */
export const B0145 = {
  caseForChange:
    "Roaming has value leakage from low adoption, fragmented propositions, inconsistent digital activation and avoidable CX friction.",
  northStar: "Make international roaming effortless, trusted and economically accretive.",
  outcomes:
    "Revenue growth; higher attach/activation; improved partner economics; fewer complaints; higher digital self-service.",
  tomFocus:
    "Product/pricing, digital journey, partner management, network/service assurance, data/personalization, care operations, governance.",
  initiatives:
    "Pass architecture redesign; digital activation; proactive travel triggers; partner-cost optimization; QoS monitoring; care simplification; analytics.",
  governance:
    "Monthly executive review; bi-weekly transformation review; weekly workstreams; monthly value review with Finance.",
  benefits:
    "Incremental roaming revenue, margin improvement, complaint reduction, digital adoption, avoided care cost.",
} as const;

/** The three B0147 chains (diagnostic item -> TOM gap -> initiative -> KPI -> benefit), verbatim. */
export const B0147_CHAINS = [
  {
    key: "activation",
    problem: "Low activation",
    tomGap: "Proposition + journey",
    initiative: "Pass redesign + digital activation",
    kpi: "Attach rate / activation",
    benefit: "Revenue uplift",
    tomDimension: "customer_value_proposition",
    initiativeId: INI.passRedesign,
    initiativeCode: "INI-01",
  },
  {
    key: "complaints",
    problem: "High complaints",
    tomGap: "Journey + service assurance",
    initiative: "Proactive comms + QoS monitoring",
    kpi: "Complaint rate",
    benefit: "CX + care cost",
    tomDimension: "journeys_processes",
    initiativeId: INI.proactiveComms,
    initiativeCode: "INI-02",
  },
  {
    key: "partner",
    problem: "Partner cost pressure",
    tomGap: "Partner model + analytics",
    initiative: "Partner optimization",
    kpi: "Cost/MB, margin",
    benefit: "Margin improvement",
    tomDimension: "partners_sourcing",
    initiativeId: INI.partnerOptimization,
    initiativeCode: "INI-03",
  },
] as const;

/** The demo role users (`roaming.user.<role>`), in seed order. The six of DEMO_ANCHORS, then TO and CM. */
export const DEMO_USERS: readonly { key: string; id: string; role: string; name: string }[] = [
  { key: "sp", id: U.sp, role: "SP", name: "roaming.user.sp" },
  { key: "tl", id: U.tl, role: "TL", name: "roaming.user.tl" },
  { key: "bo", id: U.bo, role: "BO", name: "roaming.user.bo" },
  { key: "fin", id: U.fin, role: "FIN", name: "roaming.user.fin" },
  { key: "kds", id: U.kds, role: "KDS", name: "roaming.user.kds" },
  { key: "wl", id: U.wl, role: "WL", name: "roaming.user.wl" },
  { key: "to", id: TO_USER, role: "TO", name: "roaming.user.to" },
  { key: "cm", id: CM_USER, role: "CM", name: "roaming.user.cm" },
];

const REASON = "Synthetic demonstration role (illustrative example; approves nothing real)";

type Row = Record<string, unknown>;

async function rows<R extends Row>(ctx: DemoSeedContext, q: ReturnType<typeof sql<R>>): Promise<R[]> {
  return (await q.execute(ctx.tx)).rows;
}

/** P2 stamps: created/updated at `at` by `by`. */
function st(at: Date, by: string): Row {
  return { created_at: at, created_by: by, updated_at: at, updated_by: by };
}

const scope = { organization_id: ORG, transformation_id: T };

// ------------------------------------------------------------------------------------------------ foundation

async function seedFoundation(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -120 });
  await ctx.insert("organization", "roaming.organization", {
    id: ORG,
    code: "SYN-ROAMING",
    name_en: "Synthetic Demo Operator",
    name_ar: "مشغل عرض توضيحي اصطناعي",
    default_timezone: "Asia/Riyadh",
    default_currency: "SAR",
    default_locale: "en",
    created_at: at,
    updated_at: at,
    created_by: null,
    updated_by: null,
  });
  for (const u of DEMO_USERS)
    await ctx.insert("app_user", `roaming.user.${u.key}`, {
      id: u.id,
      organization_id: ORG,
      display_name: `${u.name} (synthetic)`,
      email: null,
      preferred_locale: "en",
      created_at: at,
      updated_at: at,
      created_by: null,
      updated_by: null,
    });
  let n = 0;
  for (const u of DEMO_USERS) {
    n += 1;
    await ctx.insert(
      "user_identity",
      `roaming.user_identity.${u.key}`,
      { id: rtId(RT_BLOCK.userIdentity, n), user_id: u.id, issuer: DEMO_IDP_ISSUER, subject: u.name, created_at: at },
      { organizationId: ORG },
    );
  }
  await ctx.insert("business_unit", "roaming.business_unit", {
    id: BU,
    organization_id: ORG,
    parent_business_unit_id: null,
    code: "CONSUMER",
    name_en: "Consumer (synthetic)",
    name_ar: "قطاع الأفراد (اصطناعي)",
    created_at: at,
    updated_at: at,
    created_by: null,
    updated_by: null,
  });
  await ctx.insert("transformation", "roaming.transformation", {
    id: T,
    organization_id: ORG,
    business_unit_id: BU,
    code: "ROAMING",
    name: "International Roaming Transformation",
    description: B0144_TEXT,
    mode: "end_to_end",
    entry_phase: null,
    status: "active",
    current_phase: "transform",
    sponsor_user_id: U.sp,
    lead_user_id: U.tl,
    timezone: "Asia/Riyadh",
    currency: "SAR",
    version: 1,
    ...st(at, U.tl),
  });
  // Each demo user holds their role on the roaming transformation (transformation scope).
  const roleIds = new Map(
    (await rows<{ code: string; id: string }>(ctx, sql`SELECT code, id::text AS id FROM role`)).map((r) => [
      r.code,
      r.id,
    ]),
  );
  n = 0;
  for (const u of DEMO_USERS) {
    n += 1;
    const roleId = roleIds.get(u.role);
    if (roleId === undefined) throw new Error(`demo seed: role ${u.role} missing`);
    await ctx.insert(
      "scoped_assignment",
      `roaming.assignment.${u.key}`,
      {
        id: rtId(RT_BLOCK.scopedAssignment, n),
        organization_id: ORG,
        user_id: u.id,
        role_id: roleId,
        scope_type: "transformation",
        scope_id: T,
        effective_from: at,
        reason: REASON,
        granted_by: U.tl,
        created_at: at,
        updated_at: at,
        created_by: U.tl,
        updated_by: U.tl,
      },
      { transformationId: T },
    );
  }
}

// ------------------------------------------------------------------------------------------------ starter structure

/** The product's starter structure (0018/0024/0030/0044/0065 instantiation and the forms pin), with fixed ids. */
async function seedStarterStructure(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -120 });
  const by = U.tl;
  // Config pins: methodology, scoring defaults, forms (ADR-0039 §5, ADR-0040 §5, ADR-0041 §4).
  const pins = await rows<{ kind: string; id: string }>(
    ctx,
    sql`SELECT k.kind, (SELECT v.id::text FROM methodology_version v
                          WHERE v.status = 'published' AND v.key = k.key AND (k.config_kind IS NULL OR v.config_kind = k.config_kind)
                          ORDER BY v.version_no DESC LIMIT 1) AS id
          FROM (VALUES (1, 'methodology', 'playbook', NULL::text), (2, 'scoring_defaults', 'scoring-defaults', 'scoring_defaults'),
                       (3, 'form_schema', 'forms', 'form_schema')) AS k(o, kind, key, config_kind)
         ORDER BY k.o`,
  );
  let n = 0;
  for (const p of pins) {
    n += 1;
    if (p.id === null) continue;
    await ctx.insert("transformation_config_pin", `roaming.pin.${p.kind}`, {
      id: rtId(RT_BLOCK.configPin, n),
      ...scope,
      kind: p.kind,
      methodology_version_id: p.id,
      pinned_at: at,
      pinned_by: by,
      ...st(at, by),
    });
  }
  // T01: the seeded diagnostic rows (one per source-seeded dimension).
  n = 0;
  for (const d of await rows<{ code: string }>(
    ctx,
    sql`SELECT code FROM diagnostic_dimension WHERE is_source_seeded AND status = 'active' ORDER BY ordinal`,
  )) {
    n += 1;
    await ctx.insert("diagnostic_item", `roaming.t01.${d.code}`, {
      id: rtId(RT_BLOCK.diagnosticItem, n),
      ...scope,
      dimension_code: d.code,
      is_seeded: true,
      ...st(at, by),
    });
  }
  // The ten TOM canvas cells; the B0145 TOM focus is written into the seven dimensions it names.
  n = 0;
  for (const d of await rows<{ code: string; name: string }>(
    ctx,
    sql`SELECT code, source_name_en AS name FROM tom_dimension ORDER BY ordinal`,
  )) {
    n += 1;
    await ctx.insert("tom_canvas_cell", `roaming.tom.${d.code}`, {
      id: rtId(RT_BLOCK.tomCanvasCell, n),
      ...scope,
      dimension_code: d.code,
      current_design: `Current ${d.name} for international roaming (synthetic illustrative example).`,
      target_design: `Target ${d.name} for international roaming. TOM focus: ${B0145.tomFocus}`,
      owner_user_id: U.tl,
      status: "ready",
      ...st(at, by),
    });
  }
  // G1–G6 product gate instances (business approvals inside the product; never DG0–DG7).
  n = 0;
  for (const g of await rows<{ code: string; role: string }>(
    ctx,
    sql`SELECT code, default_approver_role_code AS role FROM gate_definition ORDER BY ordinal`,
  )) {
    n += 1;
    await ctx.insert("gate_instance", `roaming.gate.${g.code.toLowerCase()}`, {
      id: rtId(RT_BLOCK.gateInstance, n),
      ...scope,
      gate_code: g.code,
      approver_role_code: g.role,
      ...st(at, by),
    });
  }
  // The four B0079 waves (verbatim, as 0024 seeds them; Arabic provisional).
  const waves: readonly (readonly [
    string,
    number,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    string,
    number,
    number,
  ])[] = [
    [
      "wave_0",
      0,
      "Wave 0 — Mobilize",
      "الموجة 0 — التعبئة",
      "Baseline, governance, design decisions",
      "الخط الأساسي، والحوكمة، وقرارات التصميم",
      "0-6 weeks",
      "0-6 أسابيع",
      "Sponsor + charter",
      "الراعي + الميثاق",
      "Approved case, owners, stage gates",
      "دراسة معتمدة، ومالكون، وبوابات مراحل",
      0,
      6,
    ],
    [
      "wave_1",
      1,
      "Wave 1 — Prove",
      "الموجة 1 — الإثبات",
      "Quick wins / pilots / de-risking",
      "مكاسب سريعة / تجارب / تقليل المخاطر",
      "1-3 months",
      "1-3 أشهر",
      "Prioritized initiatives",
      "مبادرات ذات أولوية",
      "Measured pilot results",
      "نتائج تجارب مقاسة",
      4,
      13,
    ],
    [
      "wave_2",
      2,
      "Wave 2 — Scale",
      "الموجة 2 — التوسّع",
      "Scale validated changes",
      "توسيع التغييرات المُتحقق منها",
      "3-9 months",
      "3-9 أشهر",
      "Evidence + capacity",
      "أدلة + طاقة استيعابية",
      "Adoption + KPI movement",
      "التبنّي + تحرك مؤشرات الأداء",
      13,
      39,
    ],
    [
      "wave_3",
      3,
      "Wave 3 — Embed",
      "الموجة 3 — الترسيخ",
      "BAU integration / optimization",
      "الدمج في العمليات الاعتيادية / التحسين",
      "6-18 months",
      "6-18 شهراً",
      "Stable solution",
      "حل مستقر",
      "Benefits sustained, ownership transferred",
      "استدامة المنافع، ونقل الملكية",
      26,
      78,
    ],
  ];
  n = 0;
  for (const w of waves) {
    n += 1;
    await ctx.insert("roadmap_wave", `roaming.t07.${w[0]}`, {
      id: rtId(RT_BLOCK.roadmapWave, n),
      ...scope,
      code: w[0],
      ordinal: w[1],
      is_source_seeded: true,
      source_ref: "B0079",
      name_en: w[2],
      name_ar: w[3],
      purpose_en: w[4],
      purpose_ar: w[5],
      horizon_en: w[6],
      horizon_ar: w[7],
      entry_criteria_en: w[8],
      entry_criteria_ar: w[9],
      exit_evidence_en: w[10],
      exit_evidence_ar: w[11],
      horizon_from_weeks: w[12],
      horizon_to_weeks: w[13],
      ...st(at, by),
    });
  }
  // T06 weight set v1: the source default weights (B0076), as 0024/0065 create it.
  const ws = rtId(RT_BLOCK.scoringWeightSet, 1);
  const weights: readonly (readonly [string, string])[] = [
    ["strategic_fit", "25.00"],
    ["financial_value", "25.00"],
    ["customer_impact", "20.00"],
    ["feasibility", "15.00"],
    ["time_to_value", "15.00"],
  ];
  await ctx.insert("scoring_weight_set", "roaming.t06.weight_set", {
    id: ws,
    ...scope,
    version_no: 1,
    status: "active",
    approval_basis: "source_default",
    rationale:
      "Source default weights (B0076): strategic fit 25%, financial value 25%, customer impact 20%, feasibility 15%, time-to-value 15%.",
    activated_at: at,
    ...st(at, by),
  });
  n = 0;
  for (const [code, w] of weights) {
    n += 1;
    await ctx.insert("scoring_weight", `roaming.t06.weight.${code}`, {
      id: rtId(RT_BLOCK.scoringWeight, n),
      ...scope,
      weight_set_id: ws,
      criterion_code: code,
      weight_percent: w,
      created_at: at,
      created_by: by,
    });
  }
  // T11/T12: the governance matrices, the four decision rights and the six RACI deliverables with their cells (0030).
  n = 0;
  for (const kind of ["decision_rights", "raci"]) {
    n += 1;
    await ctx.insert("governance_matrix", `roaming.governance.${kind}`, {
      id: rtId(RT_BLOCK.governanceMatrix, n),
      ...scope,
      kind,
      ...st(at, by),
    });
  }
  n = 0;
  for (const r of await rows<Row & { key: string }>(ctx, sql`SELECT * FROM decision_right_template ORDER BY ordinal`)) {
    n += 1;
    await ctx.insert("transformation_decision_right", `roaming.t11.${r.key}`, {
      id: rtId(RT_BLOCK.decisionRight, n),
      ...scope,
      template_key: r.key,
      ordinal: r["ordinal"],
      decision_en: r["source_decision_en"],
      decision_ar: r["decision_ar"],
      recommend_label: r["source_recommend_en"],
      approve_label: r["source_approve_en"],
      consult_label: r["source_consult_en"],
      inform_label: r["source_inform_en"],
      sla_label: r["source_sla_en"],
      recommend_parties: r["recommend_parties"],
      approve_party_code: r["approve_party_code"],
      consult_parties: r["consult_parties"],
      inform_parties: r["inform_parties"],
      sla_type: r["sla_type"],
      sla_working_days: r["sla_working_days"],
      escalation_chain: r["escalation_chain"],
      ...st(at, by),
    });
  }
  n = 0;
  let cell = 0;
  for (const r of await rows<Row & { key: string }>(
    ctx,
    sql`SELECT * FROM raci_template_deliverable ORDER BY ordinal`,
  )) {
    n += 1;
    const did = rtId(RT_BLOCK.raciDeliverable, n);
    await ctx.insert("transformation_raci_deliverable", `roaming.t12.${r.key}`, {
      id: did,
      ...scope,
      template_key: r.key,
      ordinal: r["ordinal"],
      label_en: r["source_deliverable_en"],
      label_ar: r["deliverable_ar"],
      ...st(at, by),
    });
    for (const c of await rows<{ party_code: string; value: string | null }>(
      ctx,
      sql`SELECT cell.party_code, cell.value FROM raci_template_cell cell
            JOIN governance_party g ON g.code = cell.party_code
           WHERE cell.deliverable_key = ${r.key} ORDER BY g.ordinal`,
    )) {
      cell += 1;
      await ctx.insert("transformation_raci_assignment", `roaming.t12.${r.key}.${c.party_code.toLowerCase()}`, {
        id: rtId(RT_BLOCK.raciAssignment, cell),
        ...scope,
        deliverable_id: did,
        party_code: c.party_code,
        value: c.value,
        ...st(at, by),
      });
    }
  }
  // The five B0093 forum layers (0044).
  n = 0;
  for (const r of await rows<Row & { key: string }>(ctx, sql`SELECT * FROM forum_template ORDER BY ordinal`)) {
    n += 1;
    await ctx.insert("forum", `roaming.forum.${r.key}`, {
      id: rtId(RT_BLOCK.forum, n),
      ...scope,
      template_key: r.key,
      ordinal: r["ordinal"],
      name_en: r["source_layer_en"],
      name_ar: r["layer_ar"],
      cadence_label: r["source_cadence_en"],
      purpose: r["source_purpose_en"],
      participants_label: r["source_participants_en"],
      outputs_label: r["source_outputs_en"],
      chair_party_code: r["chair_party_code"],
      participant_parties: r["participant_parties"],
      output_kinds: r["output_kinds"],
      publish_requires_any_output: r["publish_requires_any_output"],
      executive_asks_only: r["executive_asks_only"],
      ...st(at, by),
    });
  }
  // The product's own instantiation must now find everything in place (it would otherwise add generated ids).
  const created = await sql<{ n: number }>`
    SELECT p4_instantiate_transformation(${T}::uuid, ${by}::uuid, NULL, 'cli') AS n`.execute(ctx.tx);
  if (Number(created.rows[0]?.n) !== 0)
    throw new Error(`demo seed: the starter structure is incomplete (${String(created.rows[0]?.n)} rows added)`);
}

// ------------------------------------------------------------------------------------------------ direction, chains

/** The B0145 elements, the chain records up to the initiatives, and the T04/T06/T08/T13/T15/T16 records. */
async function seedElementsAndChains(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -110 });
  // North Star (B0145 verbatim; REQ-PB-088) and the charter carrying the case for change, the outcomes, the
  // governance and the benefits elements verbatim (one saved version).
  const ns = rtId(RT_BLOCK.northStar, 1);
  await ctx.insert("north_star", "roaming.north_star", {
    id: ns,
    ...scope,
    statement: B0145.northStar,
    status: "current",
    ...st(at, U.tl),
  });
  const charterId = rtId(RT_BLOCK.charter, 1);
  const charterContent = {
    transformation_name: "International Roaming Transformation",
    executive_sponsor_user_id: U.sp,
    transformation_lead_user_id: U.tl,
    case_for_change: B0145.caseForChange,
    north_star_id: ns,
    in_scope: `Outcomes: ${B0145.outcomes} Initiatives: ${B0145.initiatives}`,
    out_of_scope: "Domestic tariffs and non-roaming propositions (synthetic illustrative example).",
    baseline_date: ctx.date(-92),
    target_horizon_value: 18,
    target_horizon_unit: "months",
    governance_forum: B0145.governance,
    decision_rights: "Per the T11 decision rights matrix of this transformation (synthetic).",
    success_definition: `Benefits: ${B0145.benefits}`,
  };
  await ctx.insert("charter", "roaming.charter", { id: charterId, ...scope, ...charterContent, ...st(at, U.tl) });
  await ctx.insert("charter_version", "roaming.charter.v1", {
    id: rtId(RT_BLOCK.charterVersion, 1),
    ...scope,
    charter_id: charterId,
    version_no: 1,
    ...charterContent,
    north_star_statement: B0145.northStar,
    top_outcomes_snapshot: "[]",
    guardrails_snapshot: "[]",
    change_summary: "Synthetic demonstration charter (illustrative example).",
    saved_by: U.tl,
    saved_at: at,
  });

  let n = 0;
  for (const c of B0147_CHAINS) {
    n += 1;
    // Outcome whose statement is the B0147 KPI column (the chain's KPI step in the traceability view).
    await ctx.insert("outcome", `roaming.outcome.${c.key}`, {
      id: rtId(RT_BLOCK.outcome, n),
      ...scope,
      statement: c.kpi,
      description: `${B0145.outcomes} (synthetic illustrative example)`,
      owner_user_id: U.bo,
      is_top_outcome: true,
      top_rank: n,
      status: "active",
      ...st(at, U.tl),
    });
    // Diagnosed issue (T01 finding) -> TOM gap (T03) -> issue_gap trace link.
    await ctx.insert("diagnostic_finding", `roaming.finding.${c.key}`, {
      id: rtId(RT_BLOCK.diagnosticFinding, n),
      ...scope,
      workstream_code: "customer",
      diagnostic_item_id: null,
      kind: "symptom",
      statement: c.problem,
      detail: `${B0145.caseForChange} (synthetic illustrative example)`,
      confidence: "M",
      owner_user_id: U.tl,
      status: "confirmed",
      ...st(at, U.tl),
    });
    await ctx.insert("tom_gap", `roaming.tom_gap.${c.key}`, {
      id: rtId(RT_BLOCK.tomGap, n),
      ...scope,
      dimension_code: c.tomDimension,
      current_state: `${c.problem} (synthetic illustrative example).`,
      target_state: `TOM focus: ${B0145.tomFocus}`,
      gap: c.tomGap,
      owner_user_id: U.tl,
      status: "open",
      ...st(at, U.tl),
    });
    await ctx.insert("trace_link", `roaming.trace.issue_gap.${c.key}`, {
      id: rtId(RT_BLOCK.traceLink, n),
      ...scope,
      link_kind: "issue_gap",
      diagnostic_finding_id: rtId(RT_BLOCK.diagnosticFinding, n),
      tom_gap_id: rtId(RT_BLOCK.tomGap, n),
      contribution_statement: `${c.problem} -> ${c.tomGap} (B0147, synthetic illustrative example).`,
      status: "active",
      ...st(at, U.tl),
    });
    // T05 initiative (DEMO_ANCHORS id) -> its gap.
    await ctx.insert("initiative", `roaming.initiative.${c.key}`, {
      id: c.initiativeId,
      ...scope,
      code: c.initiativeCode,
      name: c.initiative,
      executive_owner_user_id: U.sp,
      workstream_lead_user_id: U.wl,
      problem_statement: c.problem,
      objective: `${c.kpi} -> ${c.benefit} (B0147, synthetic illustrative example).`,
      wave_id: rtId(RT_BLOCK.roadmapWave, 2),
      planned_start: ctx.date(-60),
      planned_end: ctx.date(120),
      status: "draft",
      // The adoption gap (M0348): the first initiative's adoption is behind plan.
      ...(n === 1
        ? {
            adoption_status: "at_risk",
            adoption_status_note: "Digital activation uptake is behind the adoption curve (synthetic).",
            adoption_status_set_at: ctx.at({ days: -5 }),
            adoption_status_set_by: U.wl,
          }
        : {}),
      version: 1,
      ...st(at, U.tl),
    });
    await ctx.insert("initiative_gap_link", `roaming.gap_link.${c.key}`, {
      id: rtId(RT_BLOCK.initiativeGapLink, n),
      ...scope,
      initiative_id: c.initiativeId,
      target_type: "tom_gap",
      tom_gap_id: rtId(RT_BLOCK.tomGap, n),
      note: `${c.tomGap} -> ${c.initiative} (B0147, synthetic illustrative example).`,
      status: "active",
      ...st(at, U.tl),
    });
    // T06: one score per criterion of the active weight set.
    let k = 0;
    for (const [code, score] of [
      ["strategic_fit", 5],
      ["financial_value", 4],
      ["customer_impact", 4],
      ["feasibility", 3],
      ["time_to_value", 3],
    ] as const) {
      k += 1;
      await ctx.insert("initiative_score", `roaming.t06.score.${c.key}.${code}`, {
        id: rtId(RT_BLOCK.initiativeScore, (n - 1) * 5 + k),
        ...scope,
        initiative_id: c.initiativeId,
        criterion_code: code,
        score: n === 3 && code === "feasibility" ? 4 : score,
        note: "Synthetic illustrative score.",
        scored_by: U.tl,
        scored_at: ctx.at({ days: -100 }),
        ...st(at, U.tl),
      });
    }
  }

  // T04 design decision log: one decided design decision with two options.
  const d1 = rtId(RT_BLOCK.decision, 1);
  await ctx.insert("decision", "roaming.t04.design_decision", {
    id: d1,
    ...scope,
    kind: "design",
    code: "D-01",
    title: "Roaming pass architecture: daily passes or bundled travel packs (synthetic)",
    context: "Synthetic illustrative design decision for the Proposition + journey gap.",
    owner_user_id: U.tl,
    due_date: ctx.date(-90),
    status: "open",
    tom_dimension_code: "customer_value_proposition",
    ...st(at, U.tl),
  });
  for (const [i, label, title] of [
    [1, "A", "Daily passes with digital activation"],
    [2, "B", "Bundled travel packs only"],
  ] as const)
    await ctx.insert("decision_option", `roaming.t04.design_decision.option_${label.toLowerCase()}`, {
      id: rtId(RT_BLOCK.decisionOption, i),
      ...scope,
      decision_id: d1,
      label,
      title,
      ordinal: i,
      status: "active",
      ...st(at, U.tl),
    });
  // T16 executive decision log: the OVERDUE executive decision (M0348; due before the synthetic clock, still open).
  await ctx.insert("decision", "roaming.t16.overdue_decision", {
    id: rtId(RT_BLOCK.decision, 2),
    ...scope,
    kind: "executive",
    code: "DEC-01",
    title: "Approve the partner renegotiation mandate for the top roaming partners (synthetic)",
    context: "Synthetic illustrative executive ask for the Partner optimization initiative.",
    owner_user_id: U.sp,
    due_date: ctx.date(-10),
    status: "open",
    recommendation_text: "Approve a negotiation mandate for the five highest-cost partners (synthetic).",
    why_now: "Partner contracts renew next quarter (synthetic).",
    impact_of_delay: "Margin improvement slips by one quarter (synthetic).",
    ask_origin: "api",
    created_source: "api",
    sla_due_date: ctx.date(-10),
    ...st(at, U.tl),
  });
  for (const [i, label, title] of [
    [3, "A", "Approve the mandate for the five highest-cost partners"],
    [4, "B", "Defer until the next contract cycle"],
  ] as const)
    await ctx.insert("decision_option", `roaming.t16.overdue_decision.option_${label.toLowerCase()}`, {
      id: rtId(RT_BLOCK.decisionOption, i),
      ...scope,
      decision_id: rtId(RT_BLOCK.decision, 2),
      label,
      title,
      ordinal: i - 2,
      status: "active",
      ...st(at, U.tl),
    });
  // T08 dependency map: INI-01 needs INI-03's partner data feed.
  await ctx.insert("dependency", "roaming.t08.dependency", {
    id: rtId(RT_BLOCK.dependency, 1),
    ...scope,
    code: "DEP-01",
    description: "Digital activation needs the partner usage feed from Partner optimization (synthetic).",
    from_kind: "initiative",
    from_initiative_id: INI.partnerOptimization,
    to_kind: "initiative",
    to_initiative_id: INI.passRedesign,
    dependency_type: "data",
    needed_by: ctx.date(30),
    owner_user_id: U.wl,
    status: "open",
    impact: "medium",
    ...st(at, U.tl),
  });
  // T15 RAID: one risk.
  await ctx.insert("raid_entry", "roaming.t15.risk", {
    id: rtId(RT_BLOCK.raidEntry, 1),
    ...scope,
    entry_type: "risk",
    code: "R-01",
    description: "Partner settlement data arrives late, so cost/MB is reported stale (synthetic).",
    impact: "medium",
    probability: "high",
    owner_user_id: U.kds,
    due_date: ctx.date(20),
    mitigation: "Agree a settlement data cut-off with the top partners (synthetic).",
    initiative_id: INI.partnerOptimization,
    status: "open",
    ...st(at, U.tl),
  });
  // T13 stakeholder and adoption plan: one group (resisting; the adoption gap) and one intervention.
  const sg = rtId(RT_BLOCK.stakeholderGroup, 1);
  await ctx.insert("stakeholder_group", "roaming.t13.stakeholder_group", {
    id: sg,
    ...scope,
    code: "SG-01",
    name: "Frequent travellers (synthetic)",
    description: "Synthetic illustrative stakeholder group.",
    influence: "M",
    impact: "H",
    current_stance: "neutral",
    required_behavior: "Activate a roaming pass digitally before travelling (synthetic).",
    intervention_types: ["comms", "incentive"],
    owner_user_id: CM_USER,
    status: "active",
    ...st(at, U.tl),
  });
  await ctx.insert("adoption_intervention", "roaming.t13.intervention", {
    id: rtId(RT_BLOCK.adoptionIntervention, 1),
    ...scope,
    code: "AI-01",
    stakeholder_group_id: sg,
    intervention_type: "comms",
    title: "Pre-travel activation reminder campaign (synthetic)",
    owner_user_id: CM_USER,
    due_date: ctx.date(14),
    status: "planned",
    origin: "manual",
    created_source: "api",
    ...st(at, CM_USER),
  });
}

export const ROAMING_ELEMENTS_MODULE: DemoDatasetModule = {
  key: "roaming.elements",
  order: 110,
  seed: seedElementsAndChains,
};

export const ROAMING_FOUNDATION_MODULE: DemoDatasetModule = {
  key: "roaming.foundation",
  order: 100,
  async seed(ctx) {
    await seedFoundation(ctx);
    await seedStarterStructure(ctx);
  },
};
