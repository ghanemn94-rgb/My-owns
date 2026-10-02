// Registration of the transformations module's P2 routes (p2-work-split §2): the registers (register kit), the charter
// and the North Star. Every route declares its access; every mutation is policy-checked, validated, version-checked
// and audited in one transaction (register-kit.ts, charter.ts).
import type { Db } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { registerCharterRoutes } from "./charter.ts";
import { registerRegister } from "./register-kit.ts";
import {
  capabilityRegister,
  diagnosticFindingRegister,
  diagnosticItemRegister,
  journeyPainPointRegister,
  journeyRegister,
  outcomeRegister,
  strategicGuardrailRegister,
  tomGapRegister,
  workstreamOutputRegister,
} from "./registers.ts";

/** Registers the P2 routes; returns them as "METHOD path" for the module registration and tests. */
export function registerTransformationP2Routes(app: FastifyInstance, db: Db): string[] {
  return [
    ...registerRegister(app, db, strategicGuardrailRegister),
    ...registerRegister(app, db, outcomeRegister),
    ...registerRegister(app, db, diagnosticItemRegister),
    ...registerRegister(app, db, diagnosticFindingRegister),
    ...registerRegister(app, db, workstreamOutputRegister),
    ...registerRegister(app, db, tomGapRegister),
    ...registerRegister(app, db, capabilityRegister),
    ...registerRegister(app, db, journeyRegister),
    ...registerRegister(app, db, journeyPainPointRegister),
    ...registerCharterRoutes(app, db),
  ];
}
