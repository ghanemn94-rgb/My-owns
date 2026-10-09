// P4 operations declared in docs/api/openapi.yaml (contract-first, T-DG4-ARCH-01..08; ADR-0025 onward) that have no route
// yet. Same rule as p2-pending.ts and p3-pending.ts: the contract test excludes ONLY these from "every operation has a
// route and is exercised" (and from the live sweeps), and fails when a listed operation is already routed or exercised,
// so the lists can only shrink. Each architecture task adds one import line here; the file is frozen after
// T-DG4-ARCH-08 (p4-plan §5.3). All lists MUST be empty when the DG4 candidate freezes.
import { P4_PENDING_ARCH_01 } from "./p4-pending-arch-01.ts";
import { P4_PENDING_ARCH_02 } from "./p4-pending-arch-02.ts";
import { P4_PENDING_ARCH_03 } from "./p4-pending-arch-03.ts";
import { P4_PENDING_ARCH_04 } from "./p4-pending-arch-04.ts";
import { P4_PENDING_ARCH_05 } from "./p4-pending-arch-05.ts";
import { P4_PENDING_ARCH_06 } from "./p4-pending-arch-06.ts";
import { P4_PENDING_ARCH_07 } from "./p4-pending-arch-07.ts";

export const P4_PENDING_OPERATIONS: readonly string[] = [
  ...P4_PENDING_ARCH_01,
  ...P4_PENDING_ARCH_02,
  ...P4_PENDING_ARCH_03,
  ...P4_PENDING_ARCH_04,
  ...P4_PENDING_ARCH_05,
  ...P4_PENDING_ARCH_06,
  ...P4_PENDING_ARCH_07,
];
