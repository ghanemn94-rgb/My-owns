// The two starter escalation rules of slice D (ADR-0032 §8.1; D-089 Q7, R5 "code-defined handlers with configuration
// values in data"; REQ-S12-011, REQ-PB-082; T-DG4-BE-G). A transformation stores at most one row per kind in
// `governance_escalation_rule`; without one the code defaults below apply and the API reports them as `isDefault`:
//   decision_sla  escalation chain ['SP'], enabled            (the chain of an ask without a T11 row)
//   blocker_red   2 red cycles, a deadline of 10 working days, owner party SP, enabled
// The worker (apps/worker/src/handlers/escalations.ts) reads the same row with the same defaults from
// @mth/shared/schemas ESCALATION_RULE_DEFAULTS (the worker imports no API code, ADR-0002 rule 5). A rule escalates;
// it never decides, and nothing here touches DG0-DG7.
import type { DbOrTx, GovernanceEscalationRuleRow } from "@mth/db";
import { ESCALATION_RULE_DEFAULTS, type EscalationRule, type EscalationRuleKind } from "@mth/shared/schemas";
import { iso } from "../platform/index.ts";

export { ESCALATION_RULE_DEFAULTS };

/** The decision-SLA chain used when neither a T11 row nor a stored rule names one (ADR-0032 §7 step 1). */
export const DEFAULT_DECISION_SLA_CHAIN: readonly string[] = ESCALATION_RULE_DEFAULTS.decision_sla.escalationChain;
export const DEFAULT_BLOCKER_RED_CYCLES = ESCALATION_RULE_DEFAULTS.blocker_red.redCycles;
export const DEFAULT_BLOCKER_DEADLINE_WORKING_DAYS = ESCALATION_RULE_DEFAULTS.blocker_red.deadlineWorkingDays;
export const DEFAULT_BLOCKER_OWNER_PARTY = ESCALATION_RULE_DEFAULTS.blocker_red.ownerPartyCode;

export const ESCALATION_RULE_KINDS: readonly EscalationRuleKind[] = ["decision_sla", "blocker_red"];

/** A stored rule in its API shape. */
export const toEscalationRule = (r: GovernanceEscalationRuleRow): EscalationRule => ({
  id: r.id,
  ruleKind: r.rule_kind as EscalationRuleKind,
  isDefault: false,
  enabled: r.enabled,
  escalationChain: r.escalation_chain,
  redCycles: r.red_cycles,
  deadlineWorkingDays: r.deadline_working_days,
  ownerPartyCode: r.owner_party_code,
  version: r.version,
  createdAt: iso(r.created_at),
  updatedAt: iso(r.updated_at),
});

/** The code default of a kind in its API shape (no stored row: id, version and stamps are null). */
export function defaultEscalationRule(kind: EscalationRuleKind): EscalationRule {
  const base = { id: null, ruleKind: kind, isDefault: true, version: null, createdAt: null, updatedAt: null } as const;
  if (kind === "decision_sla")
    return {
      ...base,
      enabled: ESCALATION_RULE_DEFAULTS.decision_sla.enabled,
      escalationChain: [...ESCALATION_RULE_DEFAULTS.decision_sla.escalationChain],
      redCycles: null,
      deadlineWorkingDays: null,
      ownerPartyCode: null,
    };
  return {
    ...base,
    enabled: ESCALATION_RULE_DEFAULTS.blocker_red.enabled,
    escalationChain: null,
    redCycles: ESCALATION_RULE_DEFAULTS.blocker_red.redCycles,
    deadlineWorkingDays: ESCALATION_RULE_DEFAULTS.blocker_red.deadlineWorkingDays,
    ownerPartyCode: ESCALATION_RULE_DEFAULTS.blocker_red.ownerPartyCode,
  };
}

/** The rule in force for a kind: the stored row, else the code default. */
export async function effectiveEscalationRule(
  db: DbOrTx,
  transformationId: string,
  kind: EscalationRuleKind,
): Promise<EscalationRule> {
  const row = await db
    .selectFrom("governance_escalation_rule")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("rule_kind", "=", kind)
    .executeTakeFirst();
  return row ? toEscalationRule(row) : defaultEscalationRule(kind);
}

/** Both kinds in force, decision_sla first (listEscalationRules). */
export async function escalationRulesInForce(db: DbOrTx, transformationId: string): Promise<EscalationRule[]> {
  const rows = await db
    .selectFrom("governance_escalation_rule")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .execute();
  return ESCALATION_RULE_KINDS.map((kind) => {
    const row = rows.find((r) => r.rule_kind === kind);
    return row ? toEscalationRule(row) : defaultEscalationRule(kind);
  });
}
