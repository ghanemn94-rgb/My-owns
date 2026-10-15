// Output adapter of an evidence record (ADR-0042 §3, §5; T-DG5-BE-G): uploaded or written through the DG2 evidence
// operations. Verify-and-link only (kit.ts header).
import { outputAdapter } from "./kit.ts";

/** `evidence`, link (or create): an active (not archived) evidence record of the instance's transformation. */
export const evidenceOutput = outputAdapter({
  recordType: "evidence",
  stateColumns: ["status"],
  created: (r) => r.state["status"] === "active",
  linked: (r) => r.state["status"] === "active",
});
