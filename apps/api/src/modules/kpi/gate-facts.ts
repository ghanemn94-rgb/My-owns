// Facts the product-gate criteria (G1 Diagnose, G2 Define; BE's `workflows` evaluators) read from the kpi module.
// The shape is the contract of docs/architecture/p2-work-split.md §3 - keep it exact. These are BUSINESS gates inside
// the product (G1-G6), unrelated to the engineering delivery gates DG0-DG7.
//
// Semantics, chosen so a gate can never read a gap as complete:
//  - archived rows are left out (they are history, not current state);
//  - baselines[].validationStatus is the DERIVED state of value.ts `validationState`: "validated" only when Finance
//    validated the CURRENT version; an edit after the decision yields "stale"; otherwise "unvalidated" / "rejected";
//  - outcomeKpis[].trajectoryStatus is "approved" only when the approval covers the current version (any edit returns
//    the row to "draft"; a mismatch, which the API never produces, reads "stale");
//  - kpiDefinitions[].hasUnit is false only for unit kind "other" without a unit label;
//  - hasValue / hasTarget are false for Unknown (NULL), never for a real zero.
import type { DbOrTx } from "@mth/db";
import { hasText, validationState } from "@mth/shared/schemas";

export interface KpiGateFacts {
  baselines: {
    id: string;
    hasValue: boolean;
    hasSource: boolean;
    hasDate: boolean;
    validationStatus: string;
    status: string;
  }[];
  valuePools: {
    id: string;
    quantificationStatus: "quantified" | "unquantified";
    materiality: string;
    status: string;
  }[];
  outcomeKpis: {
    id: string;
    outcomeId: string;
    kpiDefinitionId: string;
    hasTarget: boolean;
    targetDate: string;
    trajectoryStatus: string;
    status: string;
  }[];
  kpiDefinitions: { id: string; status: string; hasUnit: boolean; polarity: string; ownerUserId: string | null }[];
}

export async function loadKpiGateFacts(db: DbOrTx, transformationId: string): Promise<KpiGateFacts> {
  const [baselines, valuePools, outcomeKpis, kpiDefinitions] = await Promise.all([
    db
      .selectFrom("baseline")
      .select([
        "id",
        "value",
        "source",
        "baseline_date",
        "validation_status",
        "validated_record_version",
        "version",
        "status",
      ])
      .where("transformation_id", "=", transformationId)
      .where("status", "<>", "archived")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("value_pool")
      .select(["id", "quantification_status", "materiality", "status"])
      .where("transformation_id", "=", transformationId)
      .where("status", "<>", "archived")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("outcome_kpi")
      .select([
        "id",
        "outcome_id",
        "kpi_definition_id",
        "target_value",
        "target_date",
        "trajectory_status",
        "trajectory_approved_version",
        "version",
        "status",
      ])
      .where("transformation_id", "=", transformationId)
      .where("status", "<>", "archived")
      .orderBy("ordinal")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
    db
      .selectFrom("kpi_definition")
      .select(["id", "status", "unit_kind", "unit_label", "polarity", "owner_user_id"])
      .where("transformation_id", "=", transformationId)
      .where("status", "<>", "archived")
      .orderBy("created_at")
      .orderBy("id")
      .execute(),
  ]);
  return {
    baselines: baselines.map((b) => ({
      id: b.id,
      hasValue: b.value !== null,
      hasSource: hasText(b.source), // F-DG2-150: a blank source is not a source
      hasDate: b.baseline_date !== null,
      validationStatus: validationState({
        validationStatus: b.validation_status,
        validatedRecordVersion: b.validated_record_version,
        version: b.version,
      }),
      status: b.status,
    })),
    valuePools: valuePools.map((p) => ({
      id: p.id,
      quantificationStatus: p.quantification_status === "quantified" ? "quantified" : "unquantified",
      materiality: p.materiality,
      status: p.status,
    })),
    outcomeKpis: outcomeKpis.map((o) => ({
      id: o.id,
      outcomeId: o.outcome_id,
      kpiDefinitionId: o.kpi_definition_id,
      hasTarget: o.target_value !== null,
      targetDate: o.target_date,
      trajectoryStatus:
        o.trajectory_status !== "approved"
          ? o.trajectory_status
          : o.trajectory_approved_version === o.version
            ? "approved"
            : "stale",
      status: o.status,
    })),
    kpiDefinitions: kpiDefinitions.map((k) => ({
      id: k.id,
      status: k.status,
      hasUnit: k.unit_kind !== "other" || k.unit_label !== null,
      polarity: k.polarity,
      ownerUserId: k.owner_user_id,
    })),
  };
}
