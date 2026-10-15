// Output adapter of the sustainment module's BAU handover (ADR-0042 §3, §5; T-DG5-BE-G): prepared through the DG4
// handover operations and accepted by the receiving business owner (the DG4 `bau_handover.accept` holder).
// Verify-and-link only (kit.ts header): the acceptance is the business owner's own action.
import { outputAdapter } from "./kit.ts";

/** `bau_handover`: create = prepared since launch (not returned); advance = accepted. */
export const bauHandoverOutput = outputAdapter({
  recordType: "bau_handover",
  stateColumns: ["status"],
  created: (r) => ["draft", "submitted", "accepted"].includes(r.state["status"] as string),
  advanced: (r) => r.state["status"] === "accepted",
});
