// P5 operations declared in docs/api/openapi.yaml (contract-first, T-DG5-ARCH-01..06; ADR-0039 onward) that have no route
// yet. Same rule as p2-pending.ts, p3-pending.ts and p4-pending.ts: the contract test excludes ONLY these from "every
// operation has a route and is exercised" (and from the live sweeps), and fails when a listed operation is already
// routed or exercised, so the lists can only shrink. Each architecture task adds one import line here; the file is
// frozen after T-DG5-ARCH-06 (p5-plan §5.3). All lists MUST be empty when the DG5 candidate freezes.
import { P5_PENDING_ARCH_01 } from "./p5-pending-arch-01.ts";
import { P5_PENDING_ARCH_02 } from "./p5-pending-arch-02.ts";
import { P5_PENDING_ARCH_03 } from "./p5-pending-arch-03.ts";
import { P5_PENDING_ARCH_04 } from "./p5-pending-arch-04.ts";

export const P5_PENDING_OPERATIONS: readonly string[] = [
  ...P5_PENDING_ARCH_01,
  ...P5_PENDING_ARCH_02,
  ...P5_PENDING_ARCH_03,
  ...P5_PENDING_ARCH_04,
];
