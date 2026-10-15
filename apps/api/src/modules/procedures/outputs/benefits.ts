// Output adapter of the Finance validation of a benefit value (ADR-0042 §3, §5; T-DG5-BE-G): queued by the DG4 benefit
// submission and decided by Finance through the DG4 Finance queue. A Finance decision is a human action by FIN;
// nothing here makes one. Verify-and-link only (kit.ts header).
import { outputAdapter } from "./kit.ts";

/**
 * `finance_validation`, create: DECIDED (approved or rejected) by Finance since launch; a queued or
 * withdrawn validation is not the step's output.
 */
export const financeValidationOutput = outputAdapter({
  recordType: "finance_validation",
  stateColumns: ["status", "decided_by", "decided_at"],
  producedAt: (r) => (r.state["decided_at"] as Date | string | null) ?? null,
  created: (r) => ["approved", "rejected"].includes(r.state["status"] as string),
});
