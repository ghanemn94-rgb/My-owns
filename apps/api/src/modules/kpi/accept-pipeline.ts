// The accept pipeline, API half (ADR-0027 §8 step 1; REQ-S07-012, REQ-S07-013, REQ-S12-006; T-DG4-KBE-C).
//
// Accepting a value (acceptKpiActual on the review route, or the direct-accept route of submitKpiActual and
// addKpiActualValue) is ONE transaction that writes, under the slot lock (ADVISORY_LOCK_CLASSES.kpiActualSlot; the kpi_actual_guard trigger takes it):
//   - one kpi_actual_review row (outcome accept | direct_accept) for the current value number;
//   - one slot update (status accepted, accepted_value_no = current value, decided_by/at);
//   - exactly one audit event on kpi_actual (action kpi_actual.accepted), written by the caller once per user action;
//   - exactly one outbox event kpi.actual_accepted (aggregate kpi_actual, idempotency key
//     kpi.actual_accepted:<actualId>:<valueNo>, payload { kpiActualId, valueNo, kpiDefinitionId, transformationId,
//     scopeKind, scopeId, reportingPeriodId }).
// No remote I/O. The worker's kpi.recalculate consumer (apps/worker/src/handlers/kpi.ts) then validates, recalculates,
// evaluates deviations and writes exactly one calculation run for that value (unique trigger key), with no audit event.
// The routes themselves are in actuals.ts; this file registers none.
import type { KpiActualRow, Tx } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import type { ModuleDeps } from "../platform/index.ts";
import { enqueueKpiEvent } from "./kpi-outbox.ts";

/** Who decides and when (the business date of the decision, ADR-0025 §2). */
export interface Decider {
  readonly userId: string;
  readonly onBehalfOfUserId: string | null;
  readonly businessDate: string;
}

/** Inserts the one review row of the slot's current value (append-only; at most one per value). */
export async function insertReview(
  tx: Tx,
  slot: Pick<KpiActualRow, "id" | "organization_id" | "transformation_id" | "current_value_no">,
  outcome: "accept" | "reject" | "direct_accept",
  reason: string | null,
  decider: Decider,
): Promise<void> {
  await tx
    .insertInto("kpi_actual_review")
    .values({
      id: uuidv7(),
      organization_id: slot.organization_id,
      transformation_id: slot.transformation_id,
      kpi_actual_id: slot.id,
      value_no: slot.current_value_no,
      outcome,
      reason,
      decided_by: decider.userId,
      on_behalf_of_user_id: decider.onBehalfOfUserId,
      business_date: decider.businessDate,
    })
    .execute();
}

/** The idempotency key of an accepted value (one recalculation per value; ADR-0027 §8). */
export const actualAcceptedKey = (actualId: string, valueNo: number) => `kpi.actual_accepted:${actualId}:${valueNo}`;

/** Writes the one kpi.actual_accepted outbox event of an accepted slot, in the accepting transaction. */
export async function enqueueActualAccepted(tx: Tx, slot: KpiActualRow): Promise<string> {
  const valueNo = slot.accepted_value_no;
  if (slot.status !== "accepted" || valueNo === null)
    throw new Error("enqueueActualAccepted: the slot is not accepted");
  return enqueueKpiEvent(tx, {
    organizationId: slot.organization_id,
    aggregateType: "kpi_actual",
    aggregateId: slot.id,
    eventType: "kpi.actual_accepted",
    schemaVersion: 1,
    payload: {
      kpiActualId: slot.id,
      valueNo,
      kpiDefinitionId: slot.kpi_definition_id,
      transformationId: slot.transformation_id,
      scopeKind: slot.scope_kind,
      scopeId: slot.scope_id,
      reportingPeriodId: slot.reporting_period_id,
    },
    idempotencyKey: actualAcceptedKey(slot.id, valueNo),
  });
}

/** Registers no route: the accept transaction is called from actuals.ts (acceptKpiActual, direct-accept submits). */
export function registerAcceptPipelineRoutes(_app: FastifyInstance, _deps: ModuleDeps): string[] {
  return [];
}
