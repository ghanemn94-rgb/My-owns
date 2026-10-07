// Readiness view (REQ-PB-007, B0012; ADR-0021 §9; T-DG3-BE-A) - a DG2 extension on a NEW path:
//   GET /transformations/{id}/readiness    (transformation.read; read only)
// - gates G1-G4 with their status and their dispensations (inherited approvals / waivers; never a gate decision);
// - the five B0012 diagnostic areas mapped to the six T01 dimensions (B0031), each covered when every dimension behind
//   it has its seeded T01 row stating current state, root cause, impact and confidence - the CONTENT half of
//   g1.diagnostic (ADR-0015), without the verified-evidence half: readiness warns early; G1 itself still requires
//   verified evidence;
// - `missingDiagnosticAreas` (what the acceptance reads) and the sequencing blockers of ADR-0021 §3 (sequencing.ts).
// Product gates G1-G6 are business approvals inside the product; nothing here touches DG0-DG7.
import type { DbOrTx } from "@mth/db";
import type { DiagnosticArea, DiagnosticAreaCoverage, TransformationReadiness } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { parse, problems, type ModuleDeps } from "../platform/index.ts";
import { loadGateFacts } from "../workflows/index.ts";
import { loadDispensations } from "./dispensations.ts";
import { sequencingState, type DispensationFact, type SequencingGate } from "./sequencing.ts";

const PATH = "/api/v1/transformations/:transformationId/readiness";
const tParams = z.strictObject({ transformationId: z.uuid() });

/** B0012 area -> T01 dimension codes (ADR-0021 §9). An area is covered when EVERY listed dimension is covered. */
export const DIAGNOSTIC_AREA_DIMENSIONS: Readonly<Record<DiagnosticArea, readonly string[]>> = Object.freeze({
  economics: ["financial"],
  customer: ["customer"],
  operations: ["process"],
  capability: ["people_org"],
  technology: ["technology", "data"],
});
const AREA_ORDER: readonly DiagnosticArea[] = ["economics", "customer", "operations", "capability", "technology"];
const AREA_DIMENSIONS: ReadonlyMap<DiagnosticArea, readonly string[]> = new Map(
  Object.entries(DIAGNOSTIC_AREA_DIMENSIONS) as [DiagnosticArea, readonly string[]][],
);

/** The T01 content facts of a seeded row (the content half of g1.diagnostic). */
export interface T01ContentFact {
  readonly dimensionCode: string;
  readonly hasCurrentState: boolean;
  readonly hasRootCause: boolean;
  readonly hasImpact: boolean;
  readonly hasConfidence: boolean;
}

/** Pure: coverage of the five areas from the seeded T01 rows (a missing row is not covered). */
export function diagnosticCoverage(rows: readonly T01ContentFact[]): DiagnosticAreaCoverage[] {
  const covered = (code: string) =>
    rows.some((r) => r.dimensionCode === code && r.hasCurrentState && r.hasRootCause && r.hasImpact && r.hasConfidence);
  return AREA_ORDER.map((area) => {
    const dimensions = [...(AREA_DIMENSIONS.get(area) ?? [])];
    const missing = dimensions.filter((d) => !covered(d));
    return { area, covered: missing.length === 0, dimensions, missing };
  });
}

export async function loadReadiness(db: DbOrTx, transformationId: string): Promise<TransformationReadiness> {
  const t = await db
    .selectFrom("transformation")
    .select(["id", "mode", "entry_phase", "current_phase"])
    .where("id", "=", transformationId)
    .executeTakeFirst();
  if (!t) throw problems.notFound();
  const instances = await db
    .selectFrom("gate_instance")
    .select(["gate_code", "status"])
    .where("transformation_id", "=", transformationId)
    .where("gate_code", "in", ["G1", "G2", "G3", "G4"])
    .execute();
  const dispensations = await loadDispensations(db, transformationId);
  const facts = await loadGateFacts(db, transformationId);
  const diagnostic = diagnosticCoverage(facts.seededDiagnosticItems);
  const gates = (["G1", "G2", "G3", "G4"] as const).map((gateCode) => ({
    gateCode,
    status: (instances.find((i) => i.gate_code === gateCode)?.status ??
      "draft") as TransformationReadiness["gates"][number]["status"],
    dispensations: dispensations.filter((d) => d.gateCode === gateCode),
  }));
  const mode = t.mode === "modular" ? "modular" : "end_to_end";
  const state = sequencingState({
    mode,
    gates: Object.fromEntries(gates.filter((g) => g.gateCode !== "G4").map((g) => [g.gateCode, g.status])),
    dispensations: dispensations.map(
      (d): DispensationFact => ({
        kind: d.kind,
        gateCode: d.gateCode as SequencingGate,
        initiativeId: d.initiativeId,
        counts: d.counts,
      }),
    ),
  });
  return {
    transformationId: t.id,
    mode,
    entryPhase: t.entry_phase,
    currentPhase: t.current_phase,
    gates,
    diagnostic,
    missingDiagnosticAreas: diagnostic.filter((a) => !a.covered).map((a) => a.area),
    sequencing: {
      canSubmitInitiatives: state.canSubmit,
      canLaunchInitiatives: state.canLaunch,
      blockers: state.blockers,
    },
  };
}

export function registerReadinessRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(PATH, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return loadReadiness(db, transformationId);
  });
  return [`GET ${PATH}`];
}
