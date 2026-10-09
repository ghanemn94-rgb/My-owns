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
// P4 (REQ-PB-008, B0013 "Operating model before execution"; ADR-0026 §9; T-DG4-BE-C): Transform readiness, a NEW path.
// The DG3 readiness operation above stays byte-stable (D-090).
import { hasText, SEEDED_DECISION_RIGHT_KEYS, type TransformReadiness } from "@mth/shared/schemas";
import { resolveParty } from "../access/index.ts";

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
  return [`GET ${PATH}`, ...registerTransformReadinessRoute(app, db)];
}

// ------------------------------------------------------------------------------------------------ Transform readiness
// GET /transformations/{id}/readiness/transform (getTransformReadiness; transformation.read; read only). REQ-PB-008:
// "readiness for Transform shows 'not ready' when T11 or charter decision rights are empty and 'ready' once they are
// completed". Four checks (ADR-0026 §9), each listing what is missing; `ready` only when all pass. Readiness checks
// content, not approval: an approved governance matrix is not required (ADR-0026 §7).

const TRANSFORM_PATH = "/api/v1/transformations/:transformationId/readiness/transform";

/** The facts Transform readiness reads (loaded by `loadTransformReadiness`). */
export interface TransformReadinessFacts {
  /** The current charter's decision_rights text (null when there is no charter or the field is empty). */
  readonly charterDecisionRights: string | null;
  /** The transformation's T11 rows (seeded and added). */
  readonly decisionRights: readonly { templateKey: string | null; status: string; approvePartyCode: string | null }[];
  /** The parties that currently have an active role mapping in the transformation. */
  readonly mappedParties: ReadonlySet<string>;
  /** The T12 deliverables with their cell values. */
  readonly raciDeliverables: readonly {
    key: string;
    status: string;
    accountabilityException: string | null;
    values: readonly (string | null)[];
  }[];
}

/** Pure: the four Transform readiness checks of ADR-0026 §9, in order. */
export function transformReadinessChecks(f: TransformReadinessFacts): TransformReadiness["checks"] {
  const activeSeeded = (key: string) =>
    f.decisionRights.find((r) => r.templateKey === key && r.status === "active" && r.approvePartyCode !== null);
  const seeded = SEEDED_DECISION_RIGHT_KEYS.map(activeSeeded);
  const missingKeys = SEEDED_DECISION_RIGHT_KEYS.filter((key) => activeSeeded(key) === undefined);
  const unmapped = [
    ...new Set(
      seeded.flatMap((r) =>
        r && r.approvePartyCode !== null && !f.mappedParties.has(r.approvePartyCode) ? [r.approvePartyCode] : [],
      ),
    ),
  ];
  const unaccountable = f.raciDeliverables
    .filter(
      (d) =>
        d.status === "active" &&
        d.accountabilityException === null &&
        d.values.filter((v) => v === "A" || v === "A/R").length !== 1,
    )
    .map((d) => d.key);
  return [
    {
      code: "charter_decision_rights",
      passed: hasText(f.charterDecisionRights),
      missing: hasText(f.charterDecisionRights) ? [] : ["charter.decision_rights"],
    },
    { code: "t11_seeded_decisions", passed: missingKeys.length === 0, missing: [...missingKeys] },
    { code: "t11_approvers_mapped", passed: unmapped.length === 0, missing: unmapped },
    { code: "t12_accountable", passed: unaccountable.length === 0, missing: unaccountable },
  ];
}

export async function loadTransformReadiness(db: DbOrTx, transformationId: string): Promise<TransformReadiness> {
  const t = await db.selectFrom("transformation").select("id").where("id", "=", transformationId).executeTakeFirst();
  if (!t) throw problems.notFound();
  const charter = await db
    .selectFrom("charter")
    .select("decision_rights")
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  const rights = await db
    .selectFrom("transformation_decision_right")
    .select(["template_key", "status", "approve_party_code"])
    .where("transformation_id", "=", transformationId)
    .execute();
  const mappedParties = new Set<string>();
  for (const party of new Set(rights.map((r) => r.approve_party_code)))
    if ((await resolveParty(db, transformationId, party)).status === "mapped") mappedParties.add(party);
  const deliverables = await db
    .selectFrom("transformation_raci_deliverable")
    .select(["id", "template_key", "status", "accountability_exception"])
    .where("transformation_id", "=", transformationId)
    .orderBy("ordinal")
    .orderBy("id")
    .execute();
  const cells = await db
    .selectFrom("transformation_raci_assignment")
    .select(["deliverable_id", "value"])
    .where("transformation_id", "=", transformationId)
    .execute();
  const checks = transformReadinessChecks({
    charterDecisionRights: charter?.decision_rights ?? null,
    decisionRights: rights.map((r) => ({
      templateKey: r.template_key,
      status: r.status,
      approvePartyCode: r.approve_party_code,
    })),
    mappedParties,
    raciDeliverables: deliverables.map((d) => ({
      key: d.template_key ?? d.id,
      status: d.status,
      accountabilityException: d.accountability_exception,
      values: cells.filter((c) => c.deliverable_id === d.id).map((c) => c.value),
    })),
  });
  return {
    transformationId,
    phase: "transform",
    status: checks.every((c) => c.passed) ? "ready" : "not_ready",
    checks,
  };
}

/** Registered by registerReadinessRoutes (the portfolio module's existing wiring line). */
function registerTransformReadinessRoute(app: FastifyInstance, db: DbOrTx): readonly string[] {
  app.get(TRANSFORM_PATH, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    return loadTransformReadiness(db, transformationId);
  });
  return [`GET ${TRANSFORM_PATH}`];
}
