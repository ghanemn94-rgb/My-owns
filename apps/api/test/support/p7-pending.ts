// P7 operations declared in docs/api/openapi.yaml (contract-first, T-DG7-ARCH-02..06; ADR-0064 onward) that have no
// route yet. Same rule as p2-pending.ts to p6-pending.ts: the contract test excludes ONLY these from "every operation has
// a route and is exercised" (and from the live sweeps), and fails when a listed operation is already routed or
// exercised, so the lists can only shrink. Each architecture task adds one import line here; the file is frozen after
// T-DG7-ARCH-06 (p7-plan §5.3). All lists MUST be empty when the DG7 candidate freezes.
import { P7_PENDING_ARCH_02 } from "./p7-pending-arch-02.ts";
import { P7_PENDING_ARCH_03 } from "./p7-pending-arch-03.ts";
import { P7_PENDING_ARCH_04 } from "./p7-pending-arch-04.ts";

export const P7_PENDING_OPERATIONS: readonly string[] = [
  ...P7_PENDING_ARCH_02,
  ...P7_PENDING_ARCH_03,
  ...P7_PENDING_ARCH_04,
];
