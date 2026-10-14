// The slice G and H operations declared by T-DG5-ARCH-05 (ADR-0047, ADR-0048) that have no route yet, one list per owning
// implementer task (docs/architecture/p5-work-split.md §G, §H). This file only aggregates them and is frozen
// (solution-architect); each task edits only its own p5-pending-<task>.ts.
import { P5_PENDING_KBE_E } from "./p5-pending-kbe-e.ts";
import { P5_PENDING_KBE_E2 } from "./p5-pending-kbe-e2.ts";
import { P5_PENDING_KBE_F } from "./p5-pending-kbe-f.ts";
import { P5_PENDING_BE_P } from "./p5-pending-be-p.ts";
import { P5_PENDING_BE_P2 } from "./p5-pending-be-p2.ts";
import { P5_PENDING_KBE_G } from "./p5-pending-kbe-g.ts";
import { P5_PENDING_KBE_G2 } from "./p5-pending-kbe-g2.ts";

export const P5_PENDING_ARCH_05: readonly string[] = [
  ...P5_PENDING_KBE_E,
  ...P5_PENDING_KBE_E2,
  ...P5_PENDING_KBE_F,
  ...P5_PENDING_BE_P,
  ...P5_PENDING_BE_P2,
  ...P5_PENDING_KBE_G,
  ...P5_PENDING_KBE_G2,
];
