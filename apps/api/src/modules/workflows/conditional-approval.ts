// Conditional approval as a Studio extension (ADR-0044 §3; REQ-S04-011, M0124; D-142 Q2; p5-work-split §E.2;
// T-DG5-BE-K): the switch, its check on a G5 decision, and the registration of the tracked-conditions routes
// (gate-conditions.ts).
//
// The switch is the `gate` element attribute `conditionalApprovalEnabled` of the transformation's PINNED methodology
// version (ADR-0039 §2). When the attribute is absent the catalogue default applies: true for G5 (DG4's behaviour,
// ADR-0035 §5, kept for every transformation pinned to v1: D-142 Q2 option (a)) and false for G1-G4 and G6 ("disabled by
// default"). Off: a G5 approval whose scaleScope carries conditions is refused 422 gate.conditional_approval_disabled,
// before anything is written. A conditional approval never authorizes unrestricted scaling: the approved G5 always
// carries its scale scope (DG4 422 gate.scale_scope_required, unchanged) and a scale transition outside it stays refused.
// G5 is a BUSINESS approval decided by a person; nothing here decides anything or touches DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { FastifyInstance } from "fastify";
import { createConfigResolver, type ConfigResolver } from "../methodology/index.ts";
import { HttpProblem, type ModuleDeps } from "../platform/index.ts";
import { registerGateConditionRoutes } from "./gate-conditions.ts";

const resolver: ConfigResolver = createConfigResolver();

/** The catalogue default of the switch per gate (ADR-0044 §3): on for G5 only. */
export const CONDITIONAL_APPROVAL_CATALOGUE_DEFAULT: ReadonlyMap<string, boolean> = new Map([
  ["G1", false],
  ["G2", false],
  ["G3", false],
  ["G4", false],
  ["G5", true],
  ["G6", false],
]);

/** The resolved switch of a gate for a transformation: the pinned version's attribute, else the catalogue default. */
export async function conditionalApprovalEnabled(
  db: DbOrTx,
  transformationId: string,
  gateCode: string,
): Promise<boolean> {
  const pinned = await resolver.pinnedVersion(db, transformationId, "methodology");
  const gate = await resolver.element(db, pinned.versionId, "gate", gateCode);
  const value = gate === null ? undefined : new Map(Object.entries(gate.attributes)).get("conditionalApprovalEnabled");
  if (typeof value === "boolean") return value;
  return CONDITIONAL_APPROVAL_CATALOGUE_DEFAULT.get(gateCode) ?? false;
}

export const conditionalApprovalRefusals = {
  disabled: () =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "gate.conditional_approval_disabled",
      title: "Business rule violated",
      detail: "Conditional approval is not enabled for this gate in the published methodology.",
      errors: [
        {
          pointer: "/scaleScope/conditions",
          code: "gate.conditional_approval_disabled",
          message: "Conditional approval is not enabled for this gate in the published methodology.",
        },
      ],
    }),
} as const;

/**
 * The decision-time check (called by gates.ts after the DG4 scale-scope rule, before any write): conditions on a gate
 * whose resolved switch is off are refused. No conditions -> nothing is read (DG4 path unchanged).
 */
export async function assertConditionalApprovalAllowed(
  db: DbOrTx,
  transformationId: string,
  gateCode: string,
  conditionCount: number,
): Promise<void> {
  if (conditionCount === 0) return;
  if (!(await conditionalApprovalEnabled(db, transformationId, gateCode))) throw conditionalApprovalRefusals.disabled();
}

/** Registers this file's routes (the tracked conditions, gate-conditions.ts) and returns them as "METHOD /path". */
export function registerConditionalApprovalRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  return registerGateConditionRoutes(app, deps);
}
