// zod mirrors of the P4 slice D T16 Executive Decision Log, decision-SLA escalations, blocker RAG by cycle and the
// escalation rules (OpenAPI tags "executive-decisions", "escalations"; ADR-0032 §6-§8, §11; REQ-PB-081, REQ-PB-082,
// REQ-S10-012, REQ-S12-011; T-DG4-BE-G), plus the `blocker_status.recorded` outbox payload and the pure red-cycle rule
// that the API and the worker share. Recording a T16 Outcome is a person's business decision inside the product; an
// escalation never decides, and nothing here relates to the engineering gates DG0-DG7.
import { z } from "zod";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { decisionOption } from "./decision.ts";
import { partyCode } from "./groups.ts";
import { businessDate } from "./kpi.ts";

export const EXECUTIVE_DECISION_STATUSES = ["open", "decided", "deferred", "cancelled"] as const;
export const executiveDecisionStatus = z.enum(EXECUTIVE_DECISION_STATUSES);
/** `earlier_record` = a pre-P4 or DG3 funding decision of kind executive (ask_origin NULL). */
export const askOrigin = z.enum(["api", "agenda", "blocker_escalation", "earlier_record"]);
export type AskOrigin = z.infer<typeof askOrigin>;
export const BLOCKER_RECORD_TYPES = ["raid_entry", "dependency", "corrective_case", "initiative", "milestone"] as const;
export const blockerRecordType = z.enum(BLOCKER_RECORD_TYPES);
export type BlockerRecordType = z.infer<typeof blockerRecordType>;
export const blockerRag = z.enum(["red", "amber", "green", "unknown"]);
export type BlockerRag = z.infer<typeof blockerRag>;
export const slaUnknownReason = z.enum(["calendar_not_configured", "no_steerco_scheduled", "no_release_date"]);
export const escalationRoutingError = z.enum(["party_unmapped", "party_not_executive", "no_next_authority"]);
export type EscalationRoutingError = z.infer<typeof escalationRoutingError>;
export const escalationRuleKind = z.enum(["decision_sla", "blocker_red"]);
export type EscalationRuleKind = z.infer<typeof escalationRuleKind>;
/** The seven elements of an executive ask (B0102 + REQ-S10-012), in the order the ADR lists them. */
export const EXECUTIVE_ASK_ELEMENTS = [
  "decision_required",
  "why_now",
  "options",
  "recommendation",
  "impact_of_delay",
  "decision_owner",
  "required_date",
] as const;
export const executiveAskElement = z.enum(EXECUTIVE_ASK_ELEMENTS);
export type ExecutiveAskElement = z.infer<typeof executiveAskElement>;

const optionLabel = z.string().regex(/^[A-Z]$/, "validation.option_label");
const narrative = freeText(1, 4000);

// ------------------------------------------------------------------------------------------------ requests

export const executiveDecisionOptionInput = z.strictObject({
  title: freeText(1, 300),
  description: freeText(1, 4000).nullable().optional(),
});
export type ExecutiveDecisionOptionInput = z.infer<typeof executiveDecisionOptionInput>;

/** POST …/executive-decisions: all seven elements are required (REQ-S10-012); options are labelled A, B, C … */
export const executiveDecisionCreate = z.strictObject({
  title: freeText(1, 500),
  whyNow: narrative,
  options: z.array(executiveDecisionOptionInput).min(2).max(26),
  recommendation: narrative,
  impactOfDelay: narrative,
  ownerUserId: uuid,
  requiredDate: businessDate,
  context: freeText(1, 20000).optional(),
  decisionRightId: uuid.optional(),
  blockerRecordType: blockerRecordType.optional(),
  blockerRecordId: uuid.optional(),
});
export type ExecutiveDecisionCreate = z.infer<typeof executiveDecisionCreate>;

export const executiveDecisionUpdate = z
  .strictObject({
    title: freeText(1, 500).optional(),
    whyNow: narrative.optional(),
    options: z.array(executiveDecisionOptionInput).min(2).max(26).optional(),
    recommendation: narrative.optional(),
    impactOfDelay: narrative.optional(),
    ownerUserId: uuid.optional(),
    requiredDate: businessDate.optional(),
    context: freeText(1, 20000).nullable().optional(),
    decisionRightId: uuid.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_update");
export type ExecutiveDecisionUpdate = z.infer<typeof executiveDecisionUpdate>;

export const executiveDecisionOutcome = z.strictObject({
  outcome: z.enum(["decided", "deferred", "cancelled"]),
  chosenOptionLabel: optionLabel.optional(),
  outcomeText: freeText(1, 8000).optional(),
  deferUntil: businessDate.optional(),
});
export type ExecutiveDecisionOutcome = z.infer<typeof executiveDecisionOutcome>;

export const executiveDecisionListQuery = z.strictObject({
  status: executiveDecisionStatus.optional(),
  overdue: z.stringbool({ truthy: ["true"], falsy: ["false"] }).optional(),
  origin: askOrigin.optional(),
});

export const decisionEscalationListQuery = z.strictObject({ decisionId: uuid.optional() });

export const escalationRuleCreate = z.strictObject({
  ruleKind: escalationRuleKind,
  enabled: z.boolean().optional(),
  escalationChain: z.array(partyCode).min(1).max(5).optional(),
  redCycles: z.number().int().min(2).max(12).optional(),
  deadlineWorkingDays: z.number().int().min(1).max(60).optional(),
  ownerPartyCode: partyCode.optional(),
});
export type EscalationRuleCreate = z.infer<typeof escalationRuleCreate>;

export const escalationRuleUpdate = z
  .strictObject({
    enabled: z.boolean().optional(),
    escalationChain: z.array(partyCode).min(1).max(5).optional(),
    redCycles: z.number().int().min(2).max(12).optional(),
    deadlineWorkingDays: z.number().int().min(1).max(60).optional(),
    ownerPartyCode: partyCode.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "validation.empty_update");
export type EscalationRuleUpdate = z.infer<typeof escalationRuleUpdate>;

export const blockerStatusCreate = z.strictObject({
  sourceRecordType: blockerRecordType,
  sourceRecordId: uuid,
  rag: blockerRag,
  note: freeText(1, 2000).optional(),
});
export type BlockerStatusCreate = z.infer<typeof blockerStatusCreate>;

// ------------------------------------------------------------------------------------------------ responses

export const executiveDecision = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^DEC-[0-9]{2,6}$/),
  decision: z.string().min(1).max(500),
  whyNow: z.string().min(1).max(4000).nullable(),
  options: z.array(decisionOption).max(26),
  recommendationOptionLabel: optionLabel.nullable(),
  recommendationText: z.string().min(1).max(4000).nullable(),
  ownerUserId: uuid.nullable(),
  ownerStatus: z.enum(["assigned", "unassigned"]),
  decisionDate: businessDate.nullable(),
  impactOfDelay: z.string().min(1).max(4000).nullable(),
  outcome: z.string().min(1).max(8000).nullable(),
  chosenOptionLabel: optionLabel.nullable(),
  status: executiveDecisionStatus,
  overdue: z.boolean(),
  askOrigin,
  createdSource: z.enum(["api", "worker"]).nullable(),
  sourceAgendaItemId: uuid.nullable(),
  decisionRightId: uuid.nullable(),
  slaDueDate: businessDate.nullable(),
  slaUnknownReason: slaUnknownReason.nullable(),
  blockerRecordType: blockerRecordType.nullable(),
  blockerRecordId: uuid.nullable(),
  missingElements: z.array(executiveAskElement).max(7),
  escalationLevel: z.number().int().min(0).max(5),
  decidedAt: timestamp.nullable(),
  decidedBy: uuid.nullable(),
  decidedOnBehalfOfUserId: uuid.nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type ExecutiveDecision = z.infer<typeof executiveDecision>;
export const executiveDecisionPage = z.strictObject({
  items: z.array(executiveDecision),
  nextCursor: z.string().nullable(),
});

export const decisionEscalation = z.strictObject({
  id: uuid,
  decisionId: uuid,
  decisionCode: z.string(),
  slaDueDate: businessDate,
  businessDate,
  level: z.number().int().min(1).max(5),
  partyCode: partyCode.nullable(),
  targetUserId: uuid.nullable(),
  targetGroupId: uuid.nullable(),
  routingError: escalationRoutingError.nullable(),
  delayImpact: z.string().min(1).max(4000).nullable(),
  escalatedAt: timestamp,
});
export type DecisionEscalation = z.infer<typeof decisionEscalation>;
export const decisionEscalationPage = z.strictObject({
  items: z.array(decisionEscalation),
  nextCursor: z.string().nullable(),
});

export const escalationRule = z.strictObject({
  id: uuid.nullable(),
  ruleKind: escalationRuleKind,
  isDefault: z.boolean(),
  enabled: z.boolean(),
  escalationChain: z.array(partyCode).min(1).max(5).nullable(),
  redCycles: z.number().int().min(2).max(12).nullable(),
  deadlineWorkingDays: z.number().int().min(1).max(60).nullable(),
  ownerPartyCode: partyCode.nullable(),
  version: z.number().int().min(1).nullable(),
  createdAt: timestamp.nullable(),
  updatedAt: timestamp.nullable(),
});
export type EscalationRule = z.infer<typeof escalationRule>;
export const escalationRulePage = z.strictObject({
  items: z.array(escalationRule),
  nextCursor: z.string().nullable(),
});

export const blockerStatus = z.strictObject({
  id: uuid,
  meetingId: uuid,
  forumId: uuid,
  cycleDate: businessDate,
  sourceRecordType: blockerRecordType,
  sourceRecordId: uuid,
  rag: blockerRag,
  note: z.string().min(1).max(2000).nullable(),
  createdAt: timestamp,
  createdBy: uuid,
});
export type BlockerStatus = z.infer<typeof blockerStatus>;
export const blockerStatusPage = z.strictObject({
  items: z.array(blockerStatus),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ outbox payload

/**
 * `blocker_status.recorded` v1 (ADR-0032 §8.3; the ADR-0031 §5.4 payload conventions): one per recorded observation,
 * idempotency key `blocker_status.recorded:<blockerStatusId>`. Consumer: `governance.blocker_escalation`.
 */
export const blockerStatusRecordedV1 = z.strictObject({
  blockerStatusId: uuid,
  transformationId: uuid,
  forumId: uuid,
  meetingId: uuid,
  cycleDate: businessDate,
  sourceRecordType: blockerRecordType,
  sourceRecordId: uuid,
  rag: blockerRag,
});
export type BlockerStatusRecordedV1 = z.infer<typeof blockerStatusRecordedV1>;

// ------------------------------------------------------------------------------------------------ the shared rules

/** ADR-0032 §8.1 defaults, used when a transformation stores no rule of the kind (`isDefault: true`). */
export const ESCALATION_RULE_DEFAULTS = Object.freeze({
  decision_sla: Object.freeze({ enabled: true, escalationChain: Object.freeze(["SP"]) as readonly string[] }),
  blocker_red: Object.freeze({ enabled: true, redCycles: 2, deadlineWorkingDays: 10, ownerPartyCode: "SP" }),
});

/**
 * ADR-0032 §8.3 step 2, pure: given the forum's latest `n` eligible cycles (newest first, each with the blocker's RAG
 * in that cycle or null when nothing was recorded), true only when there are `n` cycles and every one is observed
 * `red`. A cycle without an observation, or amber, green or unknown, ends the run (an Unknown cycle is never red).
 */
export function redForCycles(cycles: readonly (BlockerRag | null)[], n: number): boolean {
  if (!Number.isInteger(n) || n < 1 || cycles.length < n) return false;
  return cycles.slice(0, n).every((rag) => rag === "red");
}

/**
 * The executive-ask elements a T16 row lacks (ADR-0032 §3.2, §8.3 "Completing a blocker escalation"), in the order of
 * EXECUTIVE_ASK_ELEMENTS. An earlier record lists none: its missing T16 columns are Unknown, not gaps of an ask.
 */
export function missingAskElements(d: {
  readonly askOrigin: AskOrigin;
  readonly title: string | null;
  readonly whyNow: string | null;
  readonly activeOptionCount: number;
  readonly hasRecommendation: boolean;
  readonly impactOfDelay: string | null;
  readonly ownerUserId: string | null;
  readonly dueDate: string | null;
}): ExecutiveAskElement[] {
  if (d.askOrigin === "earlier_record") return [];
  const out: ExecutiveAskElement[] = [];
  if (d.title === null || d.title.length === 0) out.push("decision_required");
  if (d.whyNow === null) out.push("why_now");
  if (d.activeOptionCount < 2) out.push("options");
  if (!d.hasRecommendation) out.push("recommendation");
  if (d.impactOfDelay === null) out.push("impact_of_delay");
  if (d.ownerUserId === null) out.push("decision_owner");
  if (d.dueDate === null) out.push("required_date");
  return out;
}

/** The DEC-nn T16 code of counter value `n` (B0130 "DEC-01…"; the record_code_counter prefix DEC). */
export const decCode = (n: number): string => `DEC-${String(n).padStart(2, "0")}`;
