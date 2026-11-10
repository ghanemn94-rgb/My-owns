// P6 operations declared in docs/api/openapi.yaml (contract-first, T-DG6-ARCH-01..06; ADR-0051 onward) that have no route
// yet. Same rule as p2-pending.ts to p5-pending.ts: the contract test excludes ONLY these from "every operation has a
// route and is exercised" (and from the live sweeps), and fails when a listed operation is already routed or exercised,
// so the lists can only shrink. Each architecture task adds one import line here; the file is frozen after
// T-DG6-ARCH-06 (p6-plan §5.3). All lists MUST be empty when the DG6 candidate freezes.
import { P6_PENDING_ARCH_01 } from "./p6-pending-arch-01.ts";
import { P6_PENDING_ARCH_02 } from "./p6-pending-arch-02.ts";
import { P6_PENDING_ARCH_03 } from "./p6-pending-arch-03.ts";
import { P6_PENDING_ARCH_04 } from "./p6-pending-arch-04.ts";
import { P6_PENDING_ARCH_05 } from "./p6-pending-arch-05.ts";
import { P6_PENDING_ARCH_06 } from "./p6-pending-arch-06.ts";

export const P6_PENDING_OPERATIONS: readonly string[] = [
  ...P6_PENDING_ARCH_01,
  ...P6_PENDING_ARCH_02,
  ...P6_PENDING_ARCH_03,
  ...P6_PENDING_ARCH_04,
  ...P6_PENDING_ARCH_05,
  ...P6_PENDING_ARCH_06,
];
