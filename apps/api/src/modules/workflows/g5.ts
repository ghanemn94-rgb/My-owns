// Product gate G5 "Scale - Are pilots/results sufficient to scale?" (B0023 "Performance evidence, adoption, risk
// closure, decision log."; M0122; ADR-0035 §2; REQ-PB-015, REQ-PB-020, REQ-S04-007; T-DG4-BE-K): the four g5.*
// evaluators as pure functions of the facts, the G5 fact loader and the G5 snapshot member.
//
// Facts come through the GateFactsProvider members raid, adoption and governance (implemented in those modules'
// gate-facts.ts and wired by server.ts; workflows imports none of them), plus two reads of tables this module and kpi
// already share with the G1-G3 evaluators: the outcome KPIs with their accepted actuals and latest evaluations, and the
// verified evidence linked to the Transform step "deliver pilots" (phase_step_evidence, slice H).
//
// Fail closed: facts that were not loaded make the criterion incomplete; an Unknown, Stale or Not computable KPI or
// indicator is never counted as met; a T16 row without a decision date is "date missing", never on time. Every missing
// item's message starts with the criterion label (ADR-0035 §2), so a refused submission (422) names it literally, e.g.
// "Risk closure: R-03 has High impact and is neither closed nor dispositioned.".
//
// G5 is a BUSINESS approval inside the product, decided by a person (SP, or BO when configured); nothing here approves
// anything, and it never implies an engineering gate DG0-DG7.
import { sql, type DbOrTx } from "@mth/db";
import { withReadTimeStaleness, type KpiReasonCode, type KpiValueStatus } from "@mth/shared/calc";
import type { Warning } from "@mth/shared/schemas";
import type { AdoptionGateFacts, GateFactsProvider, GovernanceGateFacts, RaidGateFacts } from "./g4.ts";

/** The KPI freshness window when the KPI has no active version (the kpi/adoption default). */
const DEFAULT_STALE_AFTER_DAYS = 45;
/** The Transform step whose verified evidence is the pilot evidence (ADR-0035 §1, phase_step_definition). */
export const PILOT_STEP_KEY = "transform.deliver_pilots";

export interface G5KpiFact {
  readonly kpiDefinitionId: string;
  readonly name: string;
  readonly hasAcceptedActual: boolean;
  readonly evaluationId: string | null;
  /** The latest evaluation's status after the read-time staleness rule; "unknown" without one. */
  readonly valueStatus: string;
}

export interface G5Facts {
  readonly kpis?: readonly G5KpiFact[];
  /** Verified evidence ids linked (active link) to the step transform.deliver_pilots. */
  readonly pilotEvidenceIds?: readonly string[];
  readonly raid: RaidGateFacts;
  readonly adoption: AdoptionGateFacts;
  readonly governance: GovernanceGateFacts;
}

export async function loadG5Facts(db: DbOrTx, provider: GateFactsProvider, transformationId: string): Promise<G5Facts> {
  const none = { transformationId };
  const ctx = await sql<{ tz: string }>`
    SELECT coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = t.organization_id AND c.is_default AND c.status = 'active' LIMIT 1),
      o.default_timezone) AS tz
      FROM transformation t JOIN organization o ON o.id = t.organization_id
     WHERE t.id = ${transformationId}::uuid`.execute(db);
  const tz = ctx.rows[0]?.tz ?? "Asia/Riyadh";
  const businessDate = (await sql<{ d: string }>`SELECT p4_business_date(now(), ${tz})::text AS d`.execute(db)).rows[0]!
    .d;
  const outcomeKpis = await db
    .selectFrom("outcome_kpi as ok")
    .innerJoin("kpi_definition as k", "k.id", "ok.kpi_definition_id")
    .select(["k.id", "k.name"])
    .distinct()
    .where("ok.transformation_id", "=", transformationId)
    .where("ok.status", "=", "active")
    .orderBy("k.name")
    .orderBy("k.id")
    .execute();
  const kpis: G5KpiFact[] = [];
  for (const k of outcomeKpis) {
    const accepted = await db
      .selectFrom("kpi_actual")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("kpi_definition_id", "=", k.id)
      .where("accepted_value_no", "is not", null)
      .limit(1)
      .executeTakeFirst();
    const version = await db
      .selectFrom("kpi_version")
      .select("dq_stale_after_days")
      .where("kpi_definition_id", "=", k.id)
      .where("status", "=", "active")
      .executeTakeFirst();
    const evaluation = await db
      .selectFrom("kpi_evaluation as e")
      .innerJoin("calculation_run as r", "r.id", "e.calculation_run_id")
      .selectAll("e")
      .where("e.transformation_id", "=", transformationId)
      .where("e.kpi_definition_id", "=", k.id)
      .where("e.scope_kind", "=", "transformation")
      .where("e.value_basis", "=", "period")
      .orderBy("r.seq", "desc")
      .limit(1)
      .executeTakeFirst();
    const status = evaluation
      ? withReadTimeStaleness(
          {
            value: evaluation.value,
            valueStatus: evaluation.value_status as KpiValueStatus,
            valueReason: evaluation.value_reason as KpiReasonCode | null,
            calculatedRag: evaluation.calculated_rag as never,
            explanationKey: evaluation.explanation_key as never,
            dataAsOf: evaluation.data_as_of,
          },
          version?.dq_stale_after_days ?? DEFAULT_STALE_AFTER_DAYS,
          businessDate,
        ).valueStatus
      : "unknown";
    kpis.push({
      kpiDefinitionId: k.id,
      name: k.name,
      hasAcceptedActual: accepted !== undefined,
      evaluationId: evaluation?.id ?? null,
      valueStatus: status,
    });
  }
  const pilot = await db
    .selectFrom("phase_step_evidence as l")
    .innerJoin("phase_step as s", "s.id", "l.phase_step_id")
    .innerJoin("evidence as e", "e.id", "l.evidence_id")
    .select("e.id")
    .where("l.transformation_id", "=", transformationId)
    .where("s.step_key", "=", PILOT_STEP_KEY)
    .where("l.status", "=", "active")
    .where("e.review_status", "=", "verified")
    .orderBy("e.id")
    .execute();
  return {
    kpis,
    pilotEvidenceIds: [...new Set(pilot.map((p) => p.id))],
    raid: provider.raid ? await provider.raid(db, transformationId) : none,
    adoption: provider.adoption ? await provider.adoption(db, transformationId) : none,
    governance: provider.governance ? await provider.governance(db, transformationId) : none,
  };
}

// ------------------------------------------------------------------------------------------------ evaluators

interface GateOutcome {
  readonly missing: Warning[];
}
export type G5Evaluator = (f: G5Facts | undefined) => GateOutcome;

const item = (code: string, message: string, pointer?: string): Warning =>
  pointer === undefined ? { code, message } : { code, message, pointer };
const notLoaded = (label: string, code: string): GateOutcome => ({
  missing: [item(code, `${label}: the facts could not be read.`)],
});
/** A status that is a usable value; Unknown, Stale and Not computable never count (ADR-0035 §10). */
const known = (status: string) => status === "ok";

export const G5_EVALUATORS: ReadonlyArray<readonly [string, G5Evaluator]> = [
  [
    "g5.performance_evidence",
    (f) => {
      const L = "Performance evidence";
      if (f?.kpis === undefined || f.pilotEvidenceIds === undefined) return notLoaded(L, "g5.performance_not_loaded");
      const missing: Warning[] = [];
      if (f.kpis.length === 0)
        missing.push(item("g5.performance_no_kpi", `${L}: no KPI is linked to an outcome of the transformation.`));
      for (const k of f.kpis) {
        const at = `/kpiDefinitions/${k.kpiDefinitionId}`;
        if (!k.hasAcceptedActual)
          missing.push(item("g5.performance_no_accepted_actual", `${L}: ${k.name} has no accepted actual.`, at));
        else if (!known(k.valueStatus))
          missing.push(
            item("g5.performance_kpi_not_known", `${L}: ${k.name} is ${k.valueStatus.replace("_", " ")}.`, at),
          );
      }
      if (f.pilotEvidenceIds.length === 0)
        missing.push(
          item(
            "g5.performance_pilot_evidence_missing",
            `${L}: no verified evidence is linked to the Transform step "deliver pilots".`,
            `/phase-steps/${PILOT_STEP_KEY}`,
          ),
        );
      return { missing };
    },
  ],
  [
    "g5.adoption",
    (f) => {
      const L = "Adoption";
      const indicators = f?.adoption.indicators;
      if (indicators === undefined) return notLoaded(L, "g5.adoption_not_loaded");
      if (indicators.length === 0)
        return { missing: [item("g5.adoption_none", `${L}: no adoption indicator is linked to the transformation.`)] };
      return {
        missing: indicators
          .filter((i) => !known(i.valueStatus))
          .map((i) =>
            item(
              "g5.adoption_indicator_unknown",
              `${L}: indicator ${i.templateKey} has no current value (${i.valueStatus}).`,
              `/adoptionMetricLinks/${i.metricLinkId}`,
            ),
          ),
      };
    },
  ],
  [
    "g5.risk_closure",
    (f) => {
      const L = "Risk closure";
      const risks = f?.raid.highRisks;
      if (risks === undefined) return notLoaded(L, "g5.risk_closure_not_loaded");
      return {
        missing: risks
          .filter((r) => r.status !== "closed" && !r.dispositions.some((d) => d.approvalStatus === "approved"))
          .map((r) =>
            item(
              "g5.risk_open",
              `${L}: ${r.code} has High impact and is neither closed nor dispositioned.`,
              `/raidEntries/${r.id}`,
            ),
          ),
      };
    },
  ],
  [
    "g5.decision_log",
    (f) => {
      const L = "Decision log";
      const rows = f?.governance.decisions;
      const today = f?.governance.businessDate;
      if (rows === undefined || today === undefined) return notLoaded(L, "g5.decision_log_not_loaded");
      const missing: Warning[] = [];
      if (rows.length === 0) missing.push(item("g5.decision_log_empty", `${L}: the T16 decision log has no entry.`));
      for (const d of rows) {
        if (d.status !== "open") continue;
        const name = d.t16Id ?? d.id;
        if (d.decisionDate === null)
          missing.push(
            item(
              "g5.decision_date_missing",
              `${L}: ${name} is open and its decision date is missing.`,
              `/decisions/${d.id}`,
            ),
          );
        else if (d.decisionDate < today)
          missing.push(
            item(
              "g5.decision_overdue",
              `${L}: ${name} is open past its decision date ${d.decisionDate}.`,
              `/decisions/${d.id}`,
            ),
          );
      }
      return { missing };
    },
  ],
];

// ------------------------------------------------------------------------------------------------ snapshot

/**
 * The `g5` member of a G5 submission's frozen snapshot (ADR-0035 §2 "Snapshot"; REQ-S04-002): KPI ids with their
 * evaluation ids and statuses, pilot evidence ids, indicator ids with statuses, High risks with their disposition and
 * approval ids, and the T16 ids. Only G5 calls it, so G1-G4 snapshots stay byte-stable.
 */
export function g5SnapshotOf(f: G5Facts): Record<string, unknown> {
  return {
    kpis: (f.kpis ?? []).map((k) => ({
      kpiDefinitionId: k.kpiDefinitionId,
      evaluationId: k.evaluationId,
      valueStatus: k.valueStatus,
      hasAcceptedActual: k.hasAcceptedActual,
    })),
    pilotEvidenceIds: [...(f.pilotEvidenceIds ?? [])],
    indicators: (f.adoption.indicators ?? []).map((i) => ({
      metricLinkId: i.metricLinkId,
      valueStatus: i.valueStatus,
    })),
    risks: (f.raid.highRisks ?? []).map((r) => ({
      id: r.id,
      code: r.code,
      status: r.status,
      dispositions: r.dispositions.map((d) => ({
        id: d.id,
        approvalId: d.approvalId,
        approvalStatus: d.approvalStatus,
      })),
    })),
    t16: (f.governance.decisions ?? []).map((d) => ({ id: d.id, t16Id: d.t16Id, status: d.status })),
  };
}
