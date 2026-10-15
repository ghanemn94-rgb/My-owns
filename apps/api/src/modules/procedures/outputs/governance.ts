// Output adapter of the governance module's executive decision (T16; ADR-0042 §3, §5; T-DG5-BE-G): raised through the
// DG4 executive decision operation and decided by its decision right holder. Verify-and-link only (kit.ts header).
import { outputAdapter } from "./kit.ts";

/** `decision`: create = raised since launch (open or already decided); advance = decided. */
export const decisionOutput = outputAdapter({
  recordType: "decision",
  stateColumns: ["status"],
  created: (r) => ["open", "decided", "deferred"].includes(r.state["status"] as string),
  advanced: (r) => r.state["status"] === "decided",
});
