// The roaming transformation's product-gate history (T-DG5-BE-V3; F-DG5-120; D-170; ADR-0050 §4-§5; REQ-S18-002,
// REQ-S21-001; M0348, B0009, B0023). The transformation is End-to-End and in Transform, so the gates that close the
// four phases before it, G1-G4, are approved, and G5 and G6 are not submitted. The phase is reached the only way the
// product reaches it (apps/api/src/modules/transformations/phase.ts): the foundation creates the transformation in
// Diagnose, and each approved gate advances it by exactly one phase.
//
// AS THE PRODUCT RECORDS AN APPROVAL (apps/api/src/modules/workflows/gates.ts submitGate and decideGate), through the
// same tables and database guards, one audit event per write with the product's action names:
//   1. the evidence each gate's mandatory criteria read (B0023 "gate decision questions and evidence"), dated before
//      the gate: G1 the T01 diagnostic rows, a measured baseline with VERIFIED evidence (reviewed by someone other than
//      its author), a confirmed root-cause finding and a material value pool; G2 the B0037 thesis, the good outcome
//      test inputs (roaming.ts), the T02 trajectories approved by the Sponsor, a strategic guardrail; G3 a capability
//      gap and a future-state journey; G4 the Finance validation of the business case's baseline (demo Finance user);
//   2. G4's approved portfolio (T-DG5-BE-X2, D-172; F-DG5-120, F-DG5-122): after G3 is approved and before G4 is
//      submitted, roaming-portfolio.ts takes INI-01..INI-03 through submission, ranking snapshot, selection, Finance
//      validation of their initiative cases, funding, approved milestones and committed demand within capacity, as the
//      product records them. Every G4 criterion is complete on those records; NO gate exception is seeded (the two
//      exceptions of T-DG5-BE-V3 are removed). After G4 is approved, the funded initiatives are launched;
//   3. per gate: the submission (pending, by the Transformation Lead, the demo user who holds gate.submit; routed to the
//      gate's approver, the catalogue default role SP with no named user) with its frozen snapshot and criterion rows,
//      the gate instance moved draft -> submitted; then the decision by the routed approver, the demo Sponsor (never
//      the submitter; gate_decision_guard), its canonical decision row GD-nn, the three B0032 agreements for G1, the
//      submission decided, the gate approved, and the phase advanced.
// The outbox events (gate.submitted, gate.decided) are not written: their consumers would create approver tasks and
// enable phase steps from the real clock. The phase steps they enable are seeded by roaming-states.ts, which names the
// enabling decision of each phase (`enabled_by_gate_decision_id`) as the gates.decided consumer does.
//
// EVERY DECISION HERE IS SYNTHETIC: a demonstration decision by a demo user on demo data in a demo-initialized
// database, labelled "Synthetic demonstration - approves nothing real" (REQ-S21-001; M0412). No real business, Finance
// or IT approval is granted, and product gate G6 never implies the engineering gate DG7. Seeding is refused in
// production as all demo seeding is (guard.ts).
//
// Determinism (ADR-0050 §4): fixed 01995000-… ids, every time from the synthetic clock (`when`), rows in a fixed order,
// snapshot hashes computed from canonical JSON of fixed content.
import { createHash } from "node:crypto";
import { sql } from "kysely";
import { insertAuditEvent, type FieldChanges } from "../../audit.ts";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { DEMO_CASE_ID } from "./business-cases.ts";
import { SYNTHETIC_APPROVAL_NOTE } from "./finance.ts";
import { DEMO_ANCHORS, DEMO_KPIS, scoped, seedUpdate, stamps, when } from "./kpis.ts";
import { RT_BLOCK, rtId } from "./roaming-ids.ts";
import { launchApprovedPortfolio, seedApprovedPortfolio } from "./roaming-portfolio.ts";

const T = DEMO_ANCHORS.transformationId;
const U = DEMO_ANCHORS.users;
const ORG = DEMO_ANCHORS.organizationId;

/** REQ-S21-001: the label every demo G-approval carries, in English and Arabic (the web catalogue's wording). */
export const DEMO_GATE_LABEL_EN = SYNTHETIC_APPROVAL_NOTE;
export const DEMO_GATE_LABEL_AR = "عرض توضيحي اصطناعي - لا يعتمد أي شيء حقيقي";
const LABEL = `${DEMO_GATE_LABEL_EN} / ${DEMO_GATE_LABEL_AR}.`;

/** The product's phases (packages/shared PHASES). */
type Phase = "diagnose" | "define" | "design" | "mobilize" | "transform" | "realize";

/** The seeded gate history: G1-G4, in phase order, on the synthetic clock (2026-09-01T06:00Z). */
export interface DemoGateHistory {
  readonly gateCode: "G1" | "G2" | "G3" | "G4";
  readonly no: number;
  readonly phase: Phase;
  readonly nextPhase: Phase;
  readonly submittedAt: string;
  readonly decidedAt: string;
  readonly submissionNote: string;
  readonly rationale: string;
}

export const DEMO_GATE_HISTORY: readonly DemoGateHistory[] = [
  {
    gateCode: "G1",
    no: 1,
    phase: "diagnose",
    nextPhase: "define",
    submittedAt: "2026-05-21T07:00:00Z",
    decidedAt: "2026-05-22T07:00:00Z",
    submissionNote: "Case for Change: diagnostic, baseline, root causes and value pools (synthetic demonstration).",
    rationale:
      "We agree on the problem: roaming value leaks through low activation, high complaints and partner cost " +
      "pressure; the attach-rate baseline is measured and the value pools are material. Proceed to Define.",
  },
  {
    gateCode: "G2",
    no: 2,
    phase: "define",
    nextPhase: "design",
    submittedAt: "2026-05-29T07:00:00Z",
    decidedAt: "2026-05-30T07:00:00Z",
    submissionNote: "Direction: North Star, outcome tree, KPI definitions, trajectories and guardrails (synthetic).",
    rationale:
      "The three outcomes are specific enough to steer decisions: each has an approved KPI trajectory, an owner and " +
      "a causal chain, inside the agreed guardrail. Proceed to Design.",
  },
  {
    gateCode: "G3",
    no: 3,
    phase: "design",
    nextPhase: "mobilize",
    submittedAt: "2026-06-01T07:00:00Z",
    decidedAt: "2026-06-02T07:00:00Z",
    submissionNote: "Target State: TOM canvas, gap matrix, capability gaps, future journey (synthetic).",
    rationale:
      "We know what must be different operationally: the ten TOM boxes are ready, the gaps are owned, the digital " +
      "activation capability gap and the future travel journey are defined. Proceed to Mobilize.",
  },
  {
    gateCode: "G4",
    no: 4,
    phase: "mobilize",
    nextPhase: "transform",
    submittedAt: "2026-06-08T07:00:00Z",
    decidedAt: "2026-06-10T07:00:00Z",
    submissionNote:
      "Mobilization: initiative cards, ranking and selection, business cases, Finance validation, funding, roadmap, " +
      "owners, capacity (synthetic demonstration).",
    rationale:
      "The portfolio is executable and value-backed: INI-01, INI-02 and INI-03 are ranked, selected and funded, each " +
      "with a Finance-validated initiative business case, owners, approved milestones and committed capacity within " +
      "the plan; Finance validated the transformation case baseline and the three formulas. Proceed to Transform.",
  },
];

/** Evidence and gate-history ids (exported for the dataset tests). */
export const DEMO_GATE_IDS = {
  baseline: rtId(RT_BLOCK.baseline, 1),
  evidence: rtId(RT_BLOCK.evidence, 1),
  rootCauseFinding: rtId(RT_BLOCK.diagnosticFinding, 4),
  valuePool: rtId(RT_BLOCK.valuePool, 1),
  guardrail: rtId(RT_BLOCK.guardrail, 1),
  capability: rtId(RT_BLOCK.capability, 1),
  journey: rtId(RT_BLOCK.journey, 1),
  gateInstance: (no: number) => rtId(RT_BLOCK.gateInstance, no),
  submission: (no: number) => rtId(RT_BLOCK.gateSubmission, no),
  gateDecision: (no: number) => rtId(RT_BLOCK.gateDecision, no),
  /** The canonical decision row (kind gate, GD-nn) behind each gate decision; after D-01 and DEC-01. */
  decision: (no: number) => rtId(RT_BLOCK.decision, 2 + no),
} as const;

// ------------------------------------------------------------------------------------------------ helpers

const CLI = { actorType: "system", actorUserId: null, source: "cli", requestId: null } as const;
const REASON = "Synthetic demonstration data (illustrative example; not Mobily actual performance)";

/** One guarded update with the product's audit action, prior/new version and changes (seedUpdate plus changes). */
async function change(
  ctx: DemoSeedContext,
  table: string,
  id: string,
  action: string,
  set: Readonly<Record<string, unknown>>,
  at: Date,
  by: string,
  audit: { readonly changes?: FieldChanges; readonly reason?: string } = {},
): Promise<number> {
  const columns = Object.keys(set);
  const r = await sql<{ version: number }>`
    UPDATE ${sql.table(table)}
       SET ${sql.join([
         ...columns.map((c) => sql`${sql.ref(c)} = ${sql.val(set[c])}`),
         sql`version = version + 1`,
         sql`updated_at = ${at}`,
         sql`updated_by = ${by}`,
       ])}
     WHERE id = ${id} RETURNING version`.execute(ctx.tx);
  const row = r.rows[0];
  if (row === undefined) throw new Error(`demo seed: ${table} ${id} not found`);
  await insertAuditEvent(ctx.tx, CLI, {
    action,
    recordType: table,
    recordId: id,
    organizationId: ORG,
    transformationId: T,
    priorVersion: row.version - 1,
    newVersion: row.version,
    reason: audit.reason ?? REASON,
    changes: audit.changes ?? null,
  });
  return row.version;
}

/** Canonical JSON (sorted keys), as gates.ts hashes a submission snapshot. */
function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

// ------------------------------------------------------------------------------------------------ the gates' evidence

/** G1-G4 evidence the criteria read (step 1). Dated in phase order, before each gate's submission. */
async function seedGateEvidence(ctx: DemoSeedContext): Promise<void> {
  const { tl, kds, bo, sp, fin } = U;
  const diagnosed = ctx.at({ days: -105 }); // 2026-05-19, Diagnose
  const kpi = DEMO_KPIS[0]!;
  // G1 baseline: the attach-rate baseline the T01 rows and the case point to, with a value, a source and a date.
  await ctx.insert("baseline", "roaming.g1.baseline", {
    id: DEMO_GATE_IDS.baseline,
    ...scoped(),
    metric: `${kpi.name} baseline (synthetic)`,
    kpi_definition_id: kpi.definitionId,
    value: kpi.baselineValue,
    unit: kpi.unitLabel,
    currency: null,
    source: "Roaming activation extract, May 2026 (synthetic illustrative example).",
    baseline_date: "2026-05-15",
    scope: "revenue",
    owner_user_id: kds,
    ...stamps(diagnosed, tl),
  });
  // VERIFIED evidence (a note; REQ-S13-012): authored by the TL, reviewed by the KPI steward (never its author).
  await ctx.insert("evidence", "roaming.g1.evidence", {
    id: DEMO_GATE_IDS.evidence,
    ...scoped(),
    kind: "note",
    title: "Roaming diagnostic pack, May 2026 (synthetic)",
    description: "Synthetic illustrative evidence for the G1 Case for Change.",
    evidence_type: "analysis",
    source: "Synthetic demonstration dataset",
    owner_user_id: tl,
    note_body:
      "Attach rate 18 % (May 2026), complaint rate 3.5 %, partner cost 0.012 SAR per MB, from the synthetic " +
      "activation, care and settlement extracts. Illustrative example only. Replace assumptions with validated " +
      "company data.",
    ...stamps(diagnosed, tl),
  });
  const reviewed = ctx.at({ days: -104 });
  await seedUpdate(
    ctx,
    "evidence",
    DEMO_GATE_IDS.evidence,
    "review",
    {
      review_status: "verified",
      accessibility_status: "accessible",
      reviewed_by: kds,
      reviewed_at: reviewed,
      review_note: "Synthetic demonstration review: the note matches the synthetic extracts.",
    },
    reviewed,
    kds,
  );
  // The six T01 rows: current state, root cause, impact, confidence, and the baseline they rest on.
  const items = (
    await sql<{ id: string; code: string; name: string }>`
      SELECT i.id::text AS id, i.dimension_code AS code, d.label_en AS name
        FROM diagnostic_item i JOIN diagnostic_dimension d ON d.code = i.dimension_code
       WHERE i.transformation_id = ${T}::uuid AND i.is_seeded ORDER BY d.ordinal`.execute(ctx.tx)
  ).rows;
  let n = 0;
  for (const i of items) {
    n += 1;
    await seedUpdate(
      ctx,
      "diagnostic_item",
      i.id,
      "update",
      {
        current_state: `${i.name}: roaming value leaks through low adoption and avoidable friction (synthetic).`,
        root_cause: `${i.name}: fragmented propositions and inconsistent digital activation (synthetic).`,
        impact_text: "Lower roaming revenue and higher care cost (synthetic illustrative example).",
        confidence: "M",
        baseline_id: DEMO_GATE_IDS.baseline,
        owner_user_id: tl,
      },
      diagnosed,
      tl,
    );
    await ctx.insert("evidence_link", `roaming.g1.evidence_link.${i.code}`, {
      id: rtId(RT_BLOCK.evidenceLink, n),
      ...scoped(),
      evidence_id: DEMO_GATE_IDS.evidence,
      record_type: "diagnostic_item",
      record_id: i.id,
      ...stamps(diagnosed, tl),
    });
  }
  await ctx.insert("evidence_link", "roaming.g1.evidence_link.baseline", {
    id: rtId(RT_BLOCK.evidenceLink, n + 1),
    ...scoped(),
    evidence_id: DEMO_GATE_IDS.evidence,
    record_type: "baseline",
    record_id: DEMO_GATE_IDS.baseline,
    ...stamps(diagnosed, tl),
  });
  // A confirmed finding classified as the root cause, and a material, quantified value pool.
  await ctx.insert("diagnostic_finding", "roaming.g1.root_cause", {
    id: DEMO_GATE_IDS.rootCauseFinding,
    ...scoped(),
    workstream_code: "customer",
    diagnostic_item_id: null,
    kind: "root_cause",
    statement: "Fragmented roaming propositions and an inconsistent digital activation journey",
    detail: "Root cause behind the three B0147 problems (synthetic illustrative example).",
    confidence: "M",
    owner_user_id: tl,
    status: "confirmed",
    ...stamps(diagnosed, tl),
  });
  await ctx.insert("value_pool", "roaming.g1.value_pool", {
    id: DEMO_GATE_IDS.valuePool,
    ...scoped(),
    name: "Roaming activation and partner margin (synthetic)",
    driver: "Attach rate, complaint rate and partner cost per MB (synthetic illustrative example).",
    workstream_code: "customer",
    quantification_status: "quantified",
    upside_amount: "10632000.0000",
    downside_amount: "6000000.0000",
    currency: "SAR",
    materiality: "material",
    confidence: "M",
    owner_user_id: bo,
    ...stamps(diagnosed, tl),
  });
  // G2: the T02 trajectories, approved by the Sponsor (never their creator), and one strategic guardrail.
  const directed = when(ctx, "2026-05-28T09:00:00Z");
  for (let k = 1; k <= 3; k += 1) {
    const id = rtId(RT_BLOCK.outcomeKpi, k);
    // The approval covers the row's version after this update (kpi/gate-facts.ts: approved only for that version).
    const current = (
      await sql<{ version: number }>`SELECT version FROM outcome_kpi WHERE id = ${id}::uuid`.execute(ctx.tx)
    ).rows[0];
    if (current === undefined) throw new Error(`demo seed: T02 row ${id} is missing`);
    await seedUpdate(
      ctx,
      "outcome_kpi",
      id,
      "approve_trajectory",
      {
        trajectory_status: "approved",
        trajectory_approved_by: sp,
        trajectory_approved_at: directed,
        trajectory_approved_version: current.version + 1,
      },
      directed,
      sp,
    );
  }
  await ctx.insert("strategic_guardrail", "roaming.g2.guardrail", {
    id: DEMO_GATE_IDS.guardrail,
    ...scoped(),
    title: "No bill shock (synthetic)",
    category: "cx",
    statement: "No roaming proposition may create an unexpected charge without an in-journey consent (synthetic).",
    owner_user_id: sp,
    status: "active",
    ...stamps(ctx.at({ days: -100 }), tl),
  });
  // G3: one rated capability gap and one future-state journey.
  const designed = when(ctx, "2026-05-31T07:00:00Z");
  await ctx.insert("capability", "roaming.g3.capability", {
    id: DEMO_GATE_IDS.capability,
    ...scoped(),
    name: "Digital roaming activation (synthetic)",
    description: "Activate a roaming pass in the app before and during travel (synthetic illustrative example).",
    dimension_code: "customer_value_proposition",
    current_level: 2,
    target_level: 4,
    sourcing_need: "build",
    owner_user_id: U.wl,
    tom_gap_id: rtId(RT_BLOCK.tomGap, 1),
    status: "active",
    ...stamps(designed, tl),
  });
  await ctx.insert("journey", "roaming.g3.journey", {
    id: DEMO_GATE_IDS.journey,
    ...scoped(),
    name: "Travel with a roaming pass (future state, synthetic)",
    kind: "journey",
    state: "future",
    description: "Proactive pre-travel offer, one-tap activation, usage alerts (synthetic illustrative example).",
    dimension_code: "journeys_processes",
    owner_user_id: U.wl,
    status: "active",
    ...stamps(designed, tl),
  });
  // G4: the Finance validation of the business case's baseline section (demo Finance user, never its author).
  const validated = when(ctx, "2026-06-05T09:00:00Z");
  const sha = (
    await sql<{ sha: string }>`
      SELECT encode(sha256(convert_to(coalesce(baseline_summary, ''), 'UTF8')), 'hex') AS sha
        FROM business_case WHERE id = ${DEMO_CASE_ID}::uuid`.execute(ctx.tx)
  ).rows[0];
  if (sha === undefined) throw new Error("demo seed: the business case is missing");
  await seedUpdate(
    ctx,
    "business_case",
    DEMO_CASE_ID,
    "validate_baseline",
    {
      baseline_validation_status: "validated",
      baseline_validated_by: fin,
      baseline_validated_at: validated,
      baseline_validation_note: SYNTHETIC_APPROVAL_NOTE,
      baseline_validated_sha256: sha.sha,
    },
    validated,
    fin,
  );
}

// ------------------------------------------------------------------------------------------------ submit and decide

interface CriterionDef {
  readonly key: string;
  readonly ordinal: number;
  readonly mandatory: boolean;
}

async function seedGateApproval(ctx: DemoSeedContext, g: DemoGateHistory): Promise<void> {
  const { tl, sp } = U;
  const instanceId = DEMO_GATE_IDS.gateInstance(g.no);
  const submissionId = DEMO_GATE_IDS.submission(g.no);
  const submitted = when(ctx, g.submittedAt);
  const decided = when(ctx, g.decidedAt);
  // The routed approver (gates.ts routedApproverOf): never configured, no named user, the catalogue default role.
  const instance = (
    await sql<{ approver_role_code: string; approver_user_id: string | null; default_role: string; version: number }>`
      SELECT i.approver_role_code, i.approver_user_id::text AS approver_user_id, d.default_approver_role_code AS default_role,
             i.version
        FROM gate_instance i JOIN gate_definition d ON d.code = i.gate_code
       WHERE i.id = ${instanceId}::uuid AND i.gate_code = ${g.gateCode} AND i.status = 'draft'
         AND NOT i.approver_configured`.execute(ctx.tx)
  ).rows[0];
  if (instance === undefined || instance.approver_user_id !== null || instance.approver_role_code !== "SP")
    throw new Error(`demo seed: ${g.gateCode} is not an unconfigured draft routed to SP`);
  const transformation = (
    await sql<{ code: string; name: string; current_phase: string; version: number }>`
      SELECT code, name, current_phase, version FROM transformation WHERE id = ${T}::uuid`.execute(ctx.tx)
  ).rows[0]!;
  if (transformation.current_phase !== g.phase)
    throw new Error(
      `demo seed: ${g.gateCode} closes ${g.phase}, the transformation is in ${transformation.current_phase}`,
    );
  const charter = (
    await sql<{ id: string; version_no: number }>`
      SELECT charter_id::text AS id, max(version_no) AS version_no FROM charter_version
       WHERE transformation_id = ${T}::uuid GROUP BY charter_id`.execute(ctx.tx)
  ).rows[0]!;
  const northStar = (
    await sql<{ id: string; version: number }>`
      SELECT id::text AS id, version FROM north_star WHERE transformation_id = ${T}::uuid AND status = 'current'`.execute(
      ctx.tx,
    )
  ).rows[0]!;
  const criteria = (
    await sql<CriterionDef>`
      SELECT c.key, c.ordinal, c.mandatory FROM gate_criterion_definition c
        JOIN gate_definition d ON d.id = c.gate_definition_id
       WHERE d.code = ${g.gateCode} ORDER BY c.ordinal`.execute(ctx.tx)
  ).rows;
  const approver = { roleCode: "SP", userId: null, basis: "default_role" } as const;
  // The verified evidence the G1 criteria read (gates.ts loads it for every gate: T01 rows and baselines).
  const evidence = (
    await sql<{ record_type: string; record_id: string }>`
      SELECT l.record_type, l.record_id::text AS record_id FROM evidence_link l
       WHERE l.transformation_id = ${T}::uuid AND l.status = 'active' ORDER BY l.id`.execute(ctx.tx)
  ).rows.map((l) => ({
    evidenceId: DEMO_GATE_IDS.evidence,
    record: `${l.record_type}:${l.record_id}`,
    verified: true,
  }));
  // G4 only (g4.ts buildG4Snapshot): the in-scope initiatives (the approved portfolio INI-01..03), the current ranking
  // snapshot, the active weight set, the cases with their baseline validation, the formula versions with their
  // validation, the funding decisions and the committed demand.
  const g4 = g.gateCode === "G4" ? await g4SnapshotOf(ctx) : null;
  const snapshot = {
    schema: "mth.gate-submission/1",
    gateCode: g.gateCode,
    submissionNo: 1,
    transformation: {
      id: T,
      code: transformation.code,
      name: transformation.name,
      currentPhase: transformation.current_phase,
      version: transformation.version,
    },
    charter: { id: charter.id, versionNo: charter.version_no },
    northStar: { id: northStar.id, version: northStar.version },
    approver,
    criteria: criteria.map((c) => ({
      key: c.key,
      completeness: "complete",
      missing: [],
      unverifiedEvidenceIds: [],
    })),
    evidence,
    ...(g4 !== null ? { g4 } : {}),
    note: "Product gate (business approval inside the product); unrelated to the engineering delivery gates DG0-DG7.",
  };
  const snapshotJson = canonicalJson(snapshot);
  const sha = createHash("sha256").update(snapshotJson).digest("hex");
  // 3a. The submission (pending), its frozen criteria, and the gate submitted.
  await ctx.insert("gate_submission", `roaming.gate_submission.${g.gateCode.toLowerCase()}`, {
    id: submissionId,
    ...scoped(),
    gate_instance_id: instanceId,
    gate_code: g.gateCode,
    submission_no: 1,
    status: "pending",
    submitted_by: tl,
    submitted_at: submitted,
    submission_note: `${g.submissionNote} ${LABEL}`,
    approver_role_code: approver.roleCode,
    approver_user_id: null,
    due_date: null,
    charter_id: charter.id,
    charter_version_no: charter.version_no,
    snapshot: snapshotJson,
    snapshot_sha256: sha,
    ...stamps(submitted, tl),
  });
  for (const c of criteria) {
    await ctx.insert(
      "gate_submission_criterion",
      `roaming.gate_submission.${g.gateCode.toLowerCase()}.${c.key.slice(3)}`,
      {
        id: rtId(RT_BLOCK.gateSubmissionCriterion, g.no * 0x10 + c.ordinal),
        ...scoped(),
        gate_submission_id: submissionId,
        criterion_key: c.key,
        ordinal: c.ordinal,
        mandatory: c.mandatory,
        completeness: "complete",
        detail: JSON.stringify({ missing: [], unverifiedEvidenceIds: [] }),
        evaluated_at: submitted,
        gate_exception_id: null,
      },
    );
  }
  await change(
    ctx,
    "gate_instance",
    instanceId,
    "gate_instance.submit",
    { status: "submitted", current_submission_id: submissionId, latest_submission_no: 1, approved_at: null },
    submitted,
    tl,
    { changes: { status: { from: "draft", to: "submitted" }, latestSubmissionNo: { from: 0, to: 1 } } },
  );

  // 3b. The decision by the routed approver (the demo Sponsor; never the submitter).
  const rationale = `${LABEL} ${g.rationale} (Synthetic decision of ${g.decidedAt.slice(0, 10)}.)`;
  const decisionId = DEMO_GATE_IDS.decision(g.no);
  const title = (
    await sql<{ name: string }>`SELECT source_name_en AS name FROM gate_definition WHERE code = ${g.gateCode}`.execute(
      ctx.tx,
    )
  ).rows[0]!.name;
  await ctx.insert("decision", `roaming.gate_decision.${g.gateCode.toLowerCase()}.decision`, {
    id: decisionId,
    ...scoped(),
    kind: "gate",
    code: `GD-0${g.no}`,
    title: `${title}: submission 1`,
    context: `${g.submissionNote} ${LABEL}`,
    owner_user_id: sp,
    status: "decided",
    outcome_text: `approved: ${rationale}`,
    decided_by: sp,
    decided_at: decided,
    ...stamps(decided, sp),
  });
  const gateDecisionId = DEMO_GATE_IDS.gateDecision(g.no);
  await ctx.insert("gate_decision", `roaming.gate_decision.${g.gateCode.toLowerCase()}`, {
    id: gateDecisionId,
    ...scoped(),
    gate_submission_id: submissionId,
    decision_id: decisionId,
    gate_code: g.gateCode,
    submission_no: 1,
    outcome: "approved",
    rationale,
    comments: LABEL,
    decided_by: sp,
    on_behalf_of_user_id: null,
    decided_at: decided,
    approver_basis: approver.basis,
    approver_role_code: approver.roleCode,
  });
  // The three B0032 leadership agreements of an approved G1 decision, confirmed by the decider (0024/0025 guards).
  if (g.gateCode === "G1") {
    let k = 0;
    for (const code of ["problem", "baseline", "material_value_pools"]) {
      k += 1;
      await ctx.insert("gate_decision_agreement", `roaming.gate_decision.g1.agreement.${code}`, {
        id: rtId(RT_BLOCK.gateDecisionAgreement, k),
        ...scoped(),
        gate_decision_id: gateDecisionId,
        agreement_code: code,
        confirmed_by: sp,
        confirmed_at: decided,
      });
    }
  }
  await change(ctx, "gate_submission", submissionId, "gate_submission.decide", { status: "decided" }, decided, sp, {
    changes: { status: { from: "pending", to: "decided" } },
  });
  await change(
    ctx,
    "gate_instance",
    instanceId,
    "gate_instance.decide",
    { status: "approved", approved_at: decided },
    decided,
    sp,
    { changes: { status: { from: "submitted", to: "approved" } }, reason: rationale },
  );
  // Approval advances the phase by exactly one step (phase.ts advancePhaseOnGateApproval).
  await change(ctx, "transformation", T, "transformation.phase_advance", { current_phase: g.nextPhase }, decided, sp, {
    changes: { currentPhase: { from: g.phase, to: g.nextPhase } },
    reason: `Product gate ${g.gateCode} approved (decision ${decisionId})`,
  });
}

/**
 * The G4 member of the snapshot, as g4.ts buildG4Snapshot builds it from the portfolio and kpi facts (gate-facts.ts,
 * p3-gate-facts.ts): the in-scope initiatives (status selected, funded or launched; code order), the current ranking
 * snapshot, the active weight set, the transformation case then the in-scope initiative cases (code order), the current
 * formula version of every active financial benefit line of those cases (line id order), the counted funding decision
 * of each initiative and its committed demand (id order). Read from the seeded records, never written by hand.
 */
async function g4SnapshotOf(ctx: DemoSeedContext): Promise<Record<string, unknown>> {
  const initiatives = (
    await sql<{ id: string; code: string; version: number; status: string; waveId: string | null }>`
      SELECT id::text AS id, code, version, status, wave_id::text AS "waveId" FROM initiative
       WHERE transformation_id = ${T}::uuid AND status IN ('selected', 'funded', 'launched') ORDER BY code`.execute(
      ctx.tx,
    )
  ).rows;
  const ranking = (
    await sql<{ id: string }>`
      SELECT id::text AS id FROM ranking_snapshot WHERE transformation_id = ${T}::uuid AND status = 'current'`.execute(
      ctx.tx,
    )
  ).rows[0];
  const weightSet = (
    await sql<{ id: string; versionNo: number }>`
      SELECT id::text AS id, version_no AS "versionNo" FROM scoring_weight_set
       WHERE transformation_id = ${T}::uuid AND status = 'active'`.execute(ctx.tx)
  ).rows[0];
  const ids = initiatives.map((i) => i.id);
  const cases = (
    await sql<{ id: string; code: string; version: number; level: string; initiative_id: string | null }>`
      SELECT id::text AS id, code, version, level, initiative_id::text AS initiative_id FROM business_case
       WHERE transformation_id = ${T}::uuid AND status <> 'archived' ORDER BY code`.execute(ctx.tx)
  ).rows.filter((c) => c.level === "transformation" || (c.initiative_id !== null && ids.includes(c.initiative_id)));
  const ordered = [
    ...cases.filter((c) => c.level === "transformation"),
    ...cases.filter((c) => c.level !== "transformation"),
  ];
  const caseIds = ordered.map((c) => c.id);
  const formulaVersions = (
    await sql<{ lineId: string; formulaId: string; versionId: string; versionNo: number; validation: string }>`
      SELECT l.id::text AS "lineId", f.id::text AS "formulaId", v.id::text AS "versionId", v.version_no AS "versionNo",
             v.validation_status AS validation
        FROM business_case_line l
        JOIN benefit_formula f ON f.id = l.benefit_formula_id
        JOIN benefit_formula_version v ON v.formula_id = f.id AND v.version_no = f.current_version_no
       WHERE l.business_case_id = ANY(${caseIds}::uuid[]) AND l.status = 'active' AND l.line_kind = 'benefit'
         AND l.benefit_class <> 'strategic_non_financial'
       ORDER BY l.id`.execute(ctx.tx)
  ).rows;
  const funding: string[] = [];
  const demand: string[] = [];
  for (const i of initiatives) {
    const f = (
      await sql<{ id: string }>`
        SELECT id::text AS id FROM funding_decision WHERE initiative_id = ${i.id}::uuid
           AND decided_at > COALESCE((SELECT max(s.decided_at) FROM portfolio_selection s
                                       WHERE s.initiative_id = ${i.id}::uuid AND s.action = 'selected'), '-infinity')
         ORDER BY decided_at DESC, id DESC LIMIT 1`.execute(ctx.tx)
    ).rows[0];
    if (f !== undefined) funding.push(f.id);
    demand.push(
      ...(
        await sql<{ id: string }>`
          SELECT id::text AS id FROM resource_demand WHERE initiative_id = ${i.id}::uuid AND status = 'committed'
           ORDER BY id`.execute(ctx.tx)
      ).rows.map((d) => d.id),
    );
  }
  if (initiatives.length !== 3 || ranking === undefined || funding.length !== 3)
    throw new Error("demo seed: G4 must be submitted on the approved portfolio INI-01..INI-03");
  return {
    initiatives: initiatives.map((i) => ({
      id: i.id,
      code: i.code,
      version: i.version,
      status: i.status,
      waveId: i.waveId,
    })),
    rankingSnapshotId: ranking.id,
    weightSet: weightSet ?? null,
    businessCases: ordered.map((c) => ({
      id: c.id,
      code: c.code,
      version: c.version,
      baselineValidation: "validated",
    })),
    formulaVersions,
    fundingDecisionIds: funding,
    committedDemandIds: demand,
  };
}

/**
 * The approved gate decision that enabled a phase's steps (the gates.decided consumer inserts them when the gate is
 * approved), with its time; null for Diagnose (the entry phase) and for the phases no seeded gate has opened yet.
 */
export function demoEnablingGateDecision(
  ctx: DemoSeedContext,
  phaseCode: string,
): { readonly gateDecisionId: string; readonly at: Date } | null {
  const g = DEMO_GATE_HISTORY.find((x) => x.nextPhase === phaseCode);
  return g === undefined ? null : { gateDecisionId: DEMO_GATE_IDS.gateDecision(g.no), at: when(ctx, g.decidedAt) };
}

export const ROAMING_GATES_MODULE: DemoDatasetModule = {
  key: "roaming.gates",
  // After the chains (500; the T02 rows exist) and KBE-H (400-440; the case and formulas), before the states (600).
  order: 550,
  async seed(ctx) {
    await seedGateEvidence(ctx);
    for (const g of DEMO_GATE_HISTORY) {
      // G4 closes Mobilize: the approved portfolio is recorded before it is submitted, and launched after it is approved.
      if (g.gateCode === "G4") await seedApprovedPortfolio(ctx);
      await seedGateApproval(ctx, g);
    }
    await launchApprovedPortfolio(ctx);
  },
};
