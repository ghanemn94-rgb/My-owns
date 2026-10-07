// P3 operations declared in docs/api/openapi.yaml (T-DG3-ARCH-01, contract-first; ADR-0021..0024) that have no route
// yet. Same rule as p2-pending.ts: the contract test excludes ONLY these from "every operation has a route and is
// exercised" (and from the live sweeps), and fails when a listed operation is already routed or exercised, so the
// lists can only shrink. Each task owns its own p3-pending-<task>.ts (docs/architecture/p3-work-split.md); this
// aggregate is frozen (solution-architect). All lists MUST be empty when the DG3 candidate freezes.
import { P3_PENDING_BE_A } from "./p3-pending-be-a.ts";
import { P3_PENDING_BE_B } from "./p3-pending-be-b.ts";
import { P3_PENDING_BE_C } from "./p3-pending-be-c.ts";
import { P3_PENDING_BE_D } from "./p3-pending-be-d.ts";
import { P3_PENDING_BE_E } from "./p3-pending-be-e.ts";
import { P3_PENDING_KBE_B } from "./p3-pending-kbe-b.ts";
import { P3_PENDING_KBE_C } from "./p3-pending-kbe-c.ts";

export const P3_PENDING_OPERATIONS: readonly string[] = [
  ...P3_PENDING_BE_A,
  ...P3_PENDING_BE_B,
  ...P3_PENDING_BE_C,
  ...P3_PENDING_BE_D,
  ...P3_PENDING_BE_E,
  ...P3_PENDING_KBE_B,
  ...P3_PENDING_KBE_C,
];
