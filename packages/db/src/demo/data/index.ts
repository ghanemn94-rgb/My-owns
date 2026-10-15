// The demo dataset's modules (ADR-0050 §4; p5-work-split §J.2 and §J.3). Stub created by T-DG5-BE-S; owned and filled
// by BE-T (the roaming transformation, its chains, records and demo users) and KBE-H (its numbers, in their own files
// imported here). Every module inserts through `ctx.insert` (fixed 01995000-… ids, synthetic clock, audit event and
// registration), so the seed stays deterministic. Everything is SYNTHETIC; a demo approval approves nothing real.
import type { DemoDatasetModule } from "../seed.ts";

export const DEMO_DATASET_MODULES: readonly DemoDatasetModule[] = [];
