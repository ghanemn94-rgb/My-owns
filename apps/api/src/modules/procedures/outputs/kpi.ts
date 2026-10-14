// Output adapters of the kpi module's records (ADR-0042 §3, §5; T-DG5-BE-G): `baseline` (created through the DG2
// createBaseline operation, then validated by Finance through the DG2/DG3 baseline validation) and `kpi_actual`
// (submitted through the DG4 KPI actual operations, then accepted by the KPI data steward). Verify-and-link only
// (kit.ts header): Finance validation and acceptance are human actions recorded by kpi; nothing here performs them.
import { outputAdapter } from "./kit.ts";

/** `baseline`: create = recorded since launch and active; advance = validated by Finance. */
export const baselineOutput = outputAdapter({
  recordType: "baseline",
  stateColumns: ["status", "validation_status"],
  created: (r) => r.state["status"] === "active",
  advanced: (r) => r.state["status"] === "active" && r.state["validation_status"] === "validated",
});

/** `kpi_actual`: create = submitted (or already decided) since launch; advance = accepted. */
export const kpiActualOutput = outputAdapter({
  recordType: "kpi_actual",
  stateColumns: ["status", "submitted_by", "submitted_at"],
  producedAt: (r) => (r.state["submitted_at"] as Date | string | null) ?? null,
  created: (r) => ["submitted", "accepted", "rejected"].includes(r.state["status"] as string),
  advanced: (r) => r.state["status"] === "accepted",
});
