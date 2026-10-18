// The demo dataset's modules (ADR-0050 §4; p5-work-split §J.2 and §J.3). Stub created by T-DG5-BE-S; filled by BE-T
// (the roaming transformation, its chains, records and demo users: roaming*.ts) and KBE-H (its numbers, in their own
// files: kpis.ts … finance.ts, orders 400–440). Every module inserts through `ctx.insert` (fixed 01995000-… ids,
// synthetic clock, audit event and registration), so the seed stays deterministic. Everything is SYNTHETIC; a demo
// approval approves nothing real.
import type { DemoDatasetModule } from "../seed.ts";
import { KBE_H_DATASET_MODULES } from "./finance.ts";
import { ROAMING_ELEMENTS_MODULE, ROAMING_FOUNDATION_MODULE } from "./roaming.ts";
import { ROAMING_CHAINS_MODULE, ROAMING_CODE_COUNTERS_MODULE } from "./roaming-chains.ts";
import { ROAMING_GATES_MODULE } from "./roaming-gates.ts";
import { ROAMING_STATES_MODULE } from "./roaming-states.ts";

export const DEMO_DATASET_MODULES: readonly DemoDatasetModule[] = [
  ROAMING_FOUNDATION_MODULE,
  ROAMING_ELEMENTS_MODULE,
  ...KBE_H_DATASET_MODULES,
  ROAMING_CHAINS_MODULE,
  ROAMING_GATES_MODULE,
  ROAMING_STATES_MODULE,
  ROAMING_CODE_COUNTERS_MODULE,
];
