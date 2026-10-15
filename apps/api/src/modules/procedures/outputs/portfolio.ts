// Output adapter of the portfolio module's ranking snapshot (ADR-0042 §3, §5; T-DG5-BE-G): recorded through the DG3
// ranking snapshot operation. Verify-and-link only (kit.ts header).
import { outputAdapter } from "./kit.ts";

/** `ranking_snapshot`, create: recorded since launch and still the current snapshot. */
export const rankingSnapshotOutput = outputAdapter({
  recordType: "ranking_snapshot",
  stateColumns: ["status"],
  created: (r) => r.state["status"] === "current",
});
