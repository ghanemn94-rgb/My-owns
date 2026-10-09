// benefits route registration (P4; p4-plan §5.1): KBE-D's lines first, then KBE-D2's, then KBE-E's (sequential edits, never
// concurrent). T-DG4-BE-A created every file below as a stub.
import type { FastifyInstance } from "fastify";
import type { ModuleDeps } from "../platform/index.ts";
import { registerBenefitRegisterRoutes } from "./register.ts";
import { registerBenefitLifecycleRoutes } from "./lifecycle.ts";
import { registerBenefitAllocationRoutes } from "./allocations.ts";
import { registerBenefitGroupRoutes } from "./groups.ts";
import { registerBenefitOverlapRoutes } from "./overlaps.ts";
import { registerBenefitScenarioRoutes } from "./scenarios.ts";
import { registerBenefitValuationMethodRoutes } from "./valuation-methods.ts";
import { registerBenefitMeasurementRoutes } from "./measurements.ts";
import { registerFinanceValidationRoutes } from "./finance-validation.ts";
import { registerBenefitCorrectionRoutes } from "./corrections.ts";
import { registerBenefitTotalRoutes } from "./totals.ts";
// T-DG4-KBE-E (p4-work-split §B.3): value series and planned/forecast values (a file of its own, after KBE-D2's lines).
import { registerBenefitValueRoutes } from "./values.ts";

/** Registers every benefits route file and returns the routes as "METHOD /path". */
export function registerBenefitRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return [
    // KBE-D: register, lifecycle, allocations, groups, overlaps, scenarios.
    ...registerBenefitRegisterRoutes(app, deps),
    ...registerBenefitLifecycleRoutes(app, deps),
    ...registerBenefitAllocationRoutes(app, deps),
    ...registerBenefitGroupRoutes(app, deps),
    ...registerBenefitOverlapRoutes(app, deps),
    ...registerBenefitScenarioRoutes(app, deps),
    // KBE-D2 (T-DG4-KBE-D2; p4-work-split §B.2): valuation methods (overlaps and scenarios fill the stubs above).
    ...registerBenefitValuationMethodRoutes(app, deps),
    // KBE-E (T-DG4-KBE-E; p4-work-split §B.3): values, measurements, Finance validation, corrections, totals.
    ...registerBenefitValueRoutes(app, deps),
    ...registerBenefitMeasurementRoutes(app, deps),
    ...registerFinanceValidationRoutes(app, deps),
    ...registerBenefitCorrectionRoutes(app, deps),
    ...registerBenefitTotalRoutes(app, deps),
  ];
}
