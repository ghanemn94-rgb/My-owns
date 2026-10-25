// The roaming transformation's workflow states the coverage check needs (ADR-0050 §4–§5; p5-work-split §J.2;
// T-DG5-BE-T): the phase steps of the six phases (with the MISSING mandatory evidence: steps whose rule is
// "evidence_linked" and that have no evidence attached), the 90-day launch plan (B0134) with its template tasks and
// its Day-90 leadership test (B0135-B0141; F-DG5-121: created with the plan, as plan.ts does for every plan), a
// performance area with a draft BAU handover, one submitted 25-question health check and (T-DG5-BE-T5) one pending
// business approval in the demo Business Owner's inbox. Runs after the chains (order 600).
// SYNTHETIC: an illustrative example, not Mobily actual performance; a seeded approval or decision approves nothing
// real (M0412).
import { sql } from "kysely";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { DEMO_ANCHORS, seedUpdate } from "./kpis.ts";
import { RT_BLOCK, rtId } from "./roaming-ids.ts";
import { demoEnablingGateDecision } from "./roaming-gates.ts";

const T = DEMO_ANCHORS.transformationId;
const U = DEMO_ANCHORS.users;
const scope = { organization_id: DEMO_ANCHORS.organizationId, transformation_id: T };
const st = (at: Date, by: string): Record<string, unknown> => ({
  created_at: at,
  created_by: by,
  updated_at: at,
  updated_by: by,
});

/** The launch plan starts 60 days before the synthetic clock (2026-07-03), so its first windows are under way. */
export const LAUNCH_PLAN_START_OFFSET_DAYS = -60;
/** The template item of the Day-90 leadership test (B0135): its due day is the test's day (90; plan.ts DAY_NINETY). */
export const DAY_NINETY_TEMPLATE_ITEM = "day_ninety_test";

async function seedPhaseSteps(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -100 });
  const defs = (
    await sql<{ key: string; phase_code: string }>`
      SELECT d.key, d.phase_code FROM phase_step_definition d
        JOIN phase_definition p ON p.code = d.phase_code
       ORDER BY p.ordinal, d.ordinal`.execute(ctx.tx)
  ).rows;
  let n = 0;
  for (const d of defs) {
    n += 1;
    const enabled = demoEnablingGateDecision(ctx, d.phase_code);
    await ctx.insert("phase_step", `roaming.phase_step.${d.key}`, {
      id: rtId(RT_BLOCK.phaseStep, n),
      ...scope,
      step_key: d.key,
      phase_code: d.phase_code,
      owner_user_id: U.tl,
      status: "not_started",
      // F-DG5-120 (D-170): the approved gate that enabled the phase (the gates.decided consumer); Diagnose and the
      // phases after Transform name none.
      enabled_by_gate_decision_id: enabled?.gateDecisionId ?? null,
      ...st(enabled?.at ?? at, U.tl),
    });
  }
}

async function seedLaunchPlan(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: LAUNCH_PLAN_START_OFFSET_DAYS });
  const planId = rtId(RT_BLOCK.launchPlan, 1);
  await ctx.insert("launch_plan", "roaming.launch_plan", {
    id: planId,
    ...scope,
    start_date: ctx.date(LAUNCH_PLAN_START_OFFSET_DAYS),
    template_ref: "B0134",
    generated_via: "request",
    idempotency_key: `launch_plan:${T}`,
    ...st(at, U.tl),
  });
  const items = (
    await sql<{
      code: string;
      window_code: string;
      item_kind: string;
      text_en: string;
      start_day: number;
      due_day: number;
      output_record_type: string | null;
    }>`SELECT code, window_code, item_kind, text_en, start_day, due_day, output_record_type
         FROM launch_template_item ORDER BY ordinal, code`.execute(ctx.tx)
  ).rows;
  let n = 0;
  let dayNinety: number | null = null;
  for (const i of items) {
    n += 1;
    if (i.code === DAY_NINETY_TEMPLATE_ITEM) dayNinety = i.due_day;
    await ctx.insert("launch_task", `roaming.launch_task.${i.code}`, {
      id: rtId(RT_BLOCK.launchPlan, 0x100 + n),
      ...scope,
      plan_id: planId,
      ordinal: n,
      template_item_code: i.code,
      window_code: i.window_code,
      task_kind: i.item_kind,
      title: i.text_en,
      output_record_type: i.output_record_type,
      start_date: ctx.date(LAUNCH_PLAN_START_OFFSET_DAYS + i.start_day),
      due_date: ctx.date(LAUNCH_PLAN_START_OFFSET_DAYS + i.due_day),
      owner_user_id: U.tl,
      status: "not_started",
      ...st(at, U.tl),
    });
  }
  // F-DG5-121: the plan's Day-90 leadership test, the row apps/api/src/modules/launch/plan.ts generateLaunchPlanInTx
  // creates with every plan (REQ-PB-087, M0261): open, no response yet (answered_count 0, the table's defaults and its
  // created-open guard), scheduled on the plan's start date + 90 calendar days (the template item's due day). Its
  // six B0136-B0141 questions are the catalogue rows of day_ninety_question; none is answered in the demo.
  if (dayNinety === null) throw new Error(`demo seed: the launch template has no ${DAY_NINETY_TEMPLATE_ITEM} item`);
  await ctx.insert("day_ninety_test", "roaming.day_ninety_test", {
    id: rtId(RT_BLOCK.launchPlan, 2),
    ...scope,
    plan_id: planId,
    scheduled_date: ctx.date(LAUNCH_PLAN_START_OFFSET_DAYS + dayNinety),
    ...st(at, U.tl),
  });
}

async function seedBauHandover(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -20 });
  const area = rtId(RT_BLOCK.bauHandover, 1);
  await ctx.insert("performance_area", "roaming.performance_area", {
    id: area,
    ...scope,
    code: "PA-01",
    name: "International roaming performance (synthetic)",
    description: "Synthetic illustrative performance area for the roaming KPIs after handover.",
    business_unit_id: DEMO_ANCHORS.businessUnitId,
    sponsor_user_id: U.sp,
    bau_owner_user_id: U.bo,
    kpi_owner_user_id: U.kds,
    review_frequency: "monthly",
    review_interval: 1,
    cycle_no: 1,
    status: "establishing",
    ...st(at, U.tl),
  });
  await ctx.insert("performance_area_cycle", "roaming.performance_area.cycle_1", {
    id: rtId(RT_BLOCK.bauHandover, 2),
    ...scope,
    performance_area_id: area,
    cycle_no: 1,
    opened_at: at,
    opened_by: U.tl,
    created_at: at,
    created_by: U.tl,
  });
  await ctx.insert("bau_handover", "roaming.bau_handover", {
    id: rtId(RT_BLOCK.bauHandover, 3),
    ...scope,
    performance_area_id: area,
    cycle_no: 1,
    code: "HO-01",
    receiving_owner_user_id: U.bo,
    kpi_owner_user_id: U.kds,
    operating_procedures: "Roaming pass operations runbook v1 (synthetic).",
    capability_readiness: "Care and digital teams trained on the new pass journeys (synthetic).",
    unresolved_accepted_risks: "R-01 partner settlement data latency (synthetic).",
    benefit_monitoring_cadence: "monthly",
    data_access: "Roaming KPI dashboard and partner settlement feed (synthetic).",
    improvement_backlog_summary: "Personalized travel offers; partner QoS scorecards (synthetic).",
    status: "draft",
    ...st(at, U.tl),
  });
  // A draft: submitting needs an active control of the area and an attached evidence file (bau_handover_guard);
  // the demo users submit and accept it through the native workflow (walkthrough step 11).
}

/** The 25 answers of the submitted health check (q01–q25; synthetic): twenty-two yes and three no (the scheme answers yes or no). */
const HEALTH_RESPONSES: readonly string[] = [
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "no",
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "no",
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "yes",
  "no",
  "yes",
  "yes",
  "yes",
  "yes",
];

const HEALTH_ACTIONS: readonly string[] = [
  "Agree a settlement data cut-off with the top roaming partners (synthetic).",
  "Name an owner for the digital activation adoption curve (synthetic).",
  "Schedule the monthly value review with Finance (synthetic).",
];

/** One submitted 25-question health check (ADR-0048), scored by the published scheme in the database. */
async function seedHealthAssessment(ctx: DemoSeedContext): Promise<void> {
  const at = ctx.at({ days: -7 });
  const scheme = (
    await sql<{ id: string }>`
      SELECT id::text FROM methodology_version
       WHERE config_kind = 'health_check_scheme' AND key = 'health-check' AND status = 'published'
       ORDER BY version_no DESC LIMIT 1`.execute(ctx.tx)
  ).rows[0];
  if (scheme === undefined) throw new Error("demo seed: no published health-check scheme");
  const id = rtId(RT_BLOCK.healthAssessment, 1);
  await ctx.insert("health_assessment", "roaming.health_assessment", {
    id,
    ...scope,
    sequence_no: 1,
    scheme_version_id: scheme.id,
    assessment_date: ctx.date(-7),
    owner_user_id: U.tl,
    status: "draft",
    answered_count: 0,
    ...st(at, U.tl),
  });
  let n = 0;
  for (const response of HEALTH_RESPONSES) {
    n += 1;
    await ctx.insert("health_assessment_answer", `roaming.health_answer.q${String(n).padStart(2, "0")}`, {
      id: rtId(RT_BLOCK.healthAssessment, 0x100 + n),
      ...scope,
      assessment_id: id,
      question_code: `q${String(n).padStart(2, "0")}`,
      response,
      evidence_note: "Synthetic illustrative answer.",
      ...(response === "no"
        ? { owner_user_id: U.tl, action_note: "Owner agreed; see the top actions (synthetic)." }
        : {}),
      answered_by: U.tl,
      ...st(at, U.tl),
    });
  }
  n = 0;
  for (const text of HEALTH_ACTIONS) {
    n += 1;
    await ctx.insert("health_assessment_action", `roaming.health_action.${n}`, {
      id: rtId(RT_BLOCK.healthAssessment, 0x200 + n),
      ...scope,
      assessment_id: id,
      rank: n,
      action_text: text,
      owner_user_id: U.tl,
      due_date: ctx.date(30),
      ...st(at, U.tl),
    });
  }
  // Submit with the scheme's own result (p5_health_assessment_result), as the product does.
  const r = (
    await sql<{ score: string; score_max: string; band_key: string | null }>`
      SELECT score::text, score_max::text, band_key FROM p5_health_assessment_result(${id}::uuid)`.execute(ctx.tx)
  ).rows[0];
  if (r === undefined || r.score === null) throw new Error("demo seed: the health check is not computable");
  await seedUpdate(
    ctx,
    "health_assessment",
    id,
    "submit",
    {
      answered_count: HEALTH_RESPONSES.length,
      status: "submitted",
      score: r.score,
      score_max: r.score_max,
      band_key: r.band_key,
      submitted_at: at,
      submitted_by: U.tl,
    },
    at,
    U.tl,
  );
}

/** The seeded pending approval (T-DG5-BE-T5, D-167; QA-E2 O-1), with its decision-rights row and design decision. */
export const DEMO_PENDING_APPROVAL = {
  id: rtId(RT_BLOCK.approval, 1),
  /** The T04 design decision D-01 (roaming.ts, roaming.t04.design_decision). */
  decisionId: rtId(RT_BLOCK.decision, 1),
  /** The T11 row `target_state_design` (third template row): Approve = BO (Business owner), 10 working days. */
  decisionRightId: rtId(RT_BLOCK.decisionRight, 3),
  partyCode: "BO",
  /** roaming.user.bo, the demo Business Owner: the person the BO party is mapped to on the roaming transformation. */
  assigneeUserId: U.bo,
  requestedBy: U.tl,
} as const;

/**
 * One pending business approval in the demo Business Owner's inbox (REQ-S18-002 "pending approval"; QA-E2 O-1): the
 * Transformation Lead asks for the T04 design decision D-01 to be decided through the T11 row "Target-state design",
 * whose Approve party is BO. As the product records it (approvals.ts requestApprovalInTx): the BO party mapped to
 * roaming.user.bo (role mapping), the approval (pending, round 1, routed to that person, SoD requester excluded; the
 * 10-working-day SLA has no due date because the demo organization has no business calendar: Unknown,
 * `calendar_not_configured`, never a guessed date), and the `approval_decision` task with its inbox notification.
 * SYNTHETIC: a demo request by a demo user; nobody has decided it, and deciding it approves nothing real (M0412).
 */
async function seedPendingApproval(ctx: DemoSeedContext): Promise<void> {
  const a = DEMO_PENDING_APPROVAL;
  const at = ctx.at({ days: -3 });
  await ctx.insert("role_mapping", "roaming.role_mapping.bo", {
    id: rtId(RT_BLOCK.roleMapping, 1),
    ...scope,
    party_code: a.partyCode,
    target_kind: "user",
    user_id: a.assigneeUserId,
    ...st(at, a.requestedBy),
  });
  const title = "Decide D-01: roaming pass architecture (synthetic)";
  await ctx.insert("approval", "roaming.approval.pending", {
    id: a.id,
    ...scope,
    approval_type: "decision_request",
    subject_type: "decision",
    subject_id: a.decisionId,
    subject_version: 1,
    decision_right_id: a.decisionRightId,
    title,
    request_note: "Synthetic demo request: please decide the roaming pass architecture (illustrative example).",
    requested_by: a.requestedBy,
    requested_at: at,
    request_business_date: ctx.date(-3),
    assignee_party_code: a.partyCode,
    assignee_user_id: a.assigneeUserId,
    sla_type: "working_days",
    due_date: null,
    due_unknown_reason: "calendar_not_configured",
    sod_policy: "requester_excluded",
    ...st(at, a.requestedBy),
  });
  const dedupe = `approval.assign:${a.id}:1:unknown:${a.assigneeUserId}`;
  const linkPath = `/my-work/approvals/${a.id}`;
  const params = JSON.stringify({ title, approvalType: "decision_request", roundNo: 1, dueDate: null });
  const workItem = rtId(RT_BLOCK.workItem, 1);
  await ctx.insert("work_item", "roaming.work_item.approval_decision", {
    id: workItem,
    ...scope,
    kind: "approval_decision",
    assignee_user_id: a.assigneeUserId,
    subject_type: "approval",
    subject_id: a.id,
    link_path: linkPath,
    message_key: "approvals.task.decide",
    message_params: params,
    due_date: null,
    dedupe_key: dedupe,
    created_source: "api",
    ...st(at, a.requestedBy),
  });
  await ctx.insert("inbox_notification", "roaming.inbox_notification.approval_decision", {
    id: rtId(RT_BLOCK.inboxNotification, 1),
    ...scope,
    recipient_user_id: a.assigneeUserId,
    work_item_id: workItem,
    link_path: linkPath,
    message_key: "approvals.task.decide",
    message_params: params,
    dedupe_key: dedupe,
    urgency: "normal",
    delivery_state: "delivered",
    ...st(at, a.requestedBy),
  });
}

export const ROAMING_STATES_MODULE: DemoDatasetModule = {
  key: "roaming.states",
  order: 600,
  async seed(ctx) {
    await seedPhaseSteps(ctx);
    await seedLaunchPlan(ctx);
    await seedBauHandover(ctx);
    await seedHealthAssessment(ctx);
    await seedPendingApproval(ctx); // T-DG5-BE-T5 (D-167; QA-E2 O-1)
  },
};
