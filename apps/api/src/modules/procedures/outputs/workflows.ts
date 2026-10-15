// Output adapters of the workflows module's records (ADR-0042 §3, §5; T-DG5-BE-G): `gate_submission` (submitted through
// the DG2 gate submission operation; decided by its business approver through the product gate's canonical approval)
// and `change_request` (raised through the DG4 change request operations; decided by its business approver).
// Verify-and-link only (kit.ts header); procedures imports no workflows code (architecture test). The product gates
// G1-G6 are business approvals inside the product: nothing here decides one, and nothing touches DG0-DG7.
import { outputAdapter } from "./kit.ts";

/**
 * `gate_submission`: create = submitted since launch, for the gate the instance names in its
 * `gateCode` input, and not withdrawn or superseded; advance = decided by the business approver (the gate decision).
 */
export const gateSubmissionOutput = outputAdapter({
  recordType: "gate_submission",
  stateColumns: ["status", "gate_code", "submitted_by", "submitted_at"],
  producedAt: (r) => r.state["submitted_at"] as Date | string,
  created: (r, ctx) => {
    const named = (ctx.instance.input_values as Record<string, unknown> | null)?.["gateCode"];
    return (
      ["pending", "decided"].includes(r.state["status"] as string) &&
      (typeof named !== "string" || named === r.state["gate_code"])
    );
  },
  advanced: (r) => r.state["status"] === "decided",
});

/** `change_request`: create = raised (submitted, not a draft or withdrawn); advance = approved or rejected. */
export const changeRequestOutput = outputAdapter({
  recordType: "change_request",
  stateColumns: ["status"],
  created: (r) => !["draft", "withdrawn"].includes(r.state["status"] as string),
  advanced: (r) => ["approved", "rejected", "executed"].includes(r.state["status"] as string),
});
