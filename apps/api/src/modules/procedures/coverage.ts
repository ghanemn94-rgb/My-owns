// The methodology coverage view (OpenAPI tag `procedures`; ADR-0042 §6, §9, §11; REQ-S01-003; p5-work-split §C.3;
// T-DG5-BE-G):
//   GET /admin/coverage?versionId=   getMethodologyCoverage (methodology.read)
//
// Every counted source element of slice A's inventory (`source_element`, 80 rows) with the native form(s) and
// procedure(s) that implement it (`methodology_coverage_link`, 0070, read-only) and a status computed LIVE on every read:
//   - covered:     at least one link resolves to a WORKING target: a registered form record type whose feature is
//                  working, or a procedure present and not removed in the newest published `procedures` version;
//   - planned:     no working target, but at least one link names a target whose feature is not shipped yet (e.g. the
//                  launch-plan and health-check forms until slice H ships them); shown as Planned, never green;
//   - not_covered: no link resolves (red).
// Totals are integer counts per status (never decimals, never a percentage that could round a gap away). `versionId`
// names the methodology version the view is read for (default: the newest published `playbook` version); a version of
// another configuration kind, or an unknown id, answers 404 (the D-146 rule for the coverage operations). Read-only:
// nothing here writes, and nothing here reads or writes the engineering gate records DG0-DG7.
import type { DbOrTx } from "@mth/db";
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { holdsAnywhere, principalOf } from "../access/index.ts";
import { parseQuery, problems, type ModuleDeps } from "../platform/index.ts";

export const METHODOLOGY_COVERAGE = "/api/v1/admin/coverage";

/** The configuration keys the view resolves against (ADR-0039 §3, ADR-0041 §2, ADR-0042 §1: one key per kind). */
const METHODOLOGY_KEY = "playbook";
const PROCEDURES_KEY = "procedures";
const FORMS_KEY = "forms";

const coverageQuery = z.strictObject({ versionId: uuid.optional() });

// ------------------------------------------------------------------------------------------------ zod mirror

/**
 * zod mirror of `MethodologyCoverage` (docs/api/openapi.yaml). Kept next to its route because the slice C shared schema
 * file belongs to BE-F; the handback asks the orchestrator whether to move it into @mth/shared for the web client.
 */
export const methodologyCoverageLink = z.strictObject({
  targetKind: z.enum(["form", "procedure"]),
  targetCode: z.string(),
  resolved: z.boolean(),
  featureStatus: z.enum(["working", "planned"]),
});
export const methodologyCoverageElement = z.strictObject({
  setCode: z.string(),
  stableKey: z.string(),
  sourceLabelEn: z.string(),
  labelAr: z.string(),
  sourceRef: z.string(),
  status: z.enum(["covered", "planned", "not_covered"]),
  links: z.array(methodologyCoverageLink),
});
export const methodologyCoverage = z.strictObject({
  methodologyVersionId: uuid,
  proceduresVersionId: uuid,
  formSchemaVersionId: uuid,
  totals: z.strictObject({
    covered: z.int().nonnegative(),
    planned: z.int().nonnegative(),
    notCovered: z.int().nonnegative(),
    total: z.int().nonnegative(),
  }),
  elements: z.array(methodologyCoverageElement),
});
export type MethodologyCoverage = z.infer<typeof methodologyCoverage>;
export type MethodologyCoverageElement = z.infer<typeof methodologyCoverageElement>;
export type CoverageStatus = MethodologyCoverageElement["status"];

// ------------------------------------------------------------------------------------------------ status rule

export interface CoverageLinkFact {
  readonly targetKind: "form" | "procedure";
  readonly targetCode: string;
  readonly resolved: boolean;
  readonly featureStatus: "working" | "planned";
}

/**
 * The live status of one element (ADR-0042 §6): covered when a link resolves to a working target; planned when no link
 * does but one names a planned target; else not covered. Planned and not covered are never covered (never green).
 */
export function coverageStatusOf(links: readonly CoverageLinkFact[]): CoverageStatus {
  if (links.some((l) => l.resolved && l.featureStatus === "working")) return "covered";
  if (links.some((l) => l.featureStatus === "planned")) return "planned";
  return "not_covered";
}

// ------------------------------------------------------------------------------------------------ read

async function newestPublished(db: DbOrTx, configKind: string, key: string): Promise<string> {
  const v = await db
    .selectFrom("methodology_version")
    .select("id")
    .where("config_kind", "=", configKind)
    .where("key", "=", key)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  // The seed publishes v1 of every kind (0062, 0068, 0069); a missing one is an installation defect, not a 404.
  if (v === undefined) throw new Error(`procedures: no published ${configKind} version '${key}'`);
  return v.id;
}

async function methodologyVersionOf(db: DbOrTx, versionId: string | undefined): Promise<string> {
  if (versionId === undefined) return newestPublished(db, "methodology", METHODOLOGY_KEY);
  const v = await db
    .selectFrom("methodology_version")
    .select(["id", "config_kind"])
    .where("id", "=", versionId)
    .executeTakeFirst();
  if (v === undefined || v.config_kind !== "methodology") throw problems.notFound();
  return v.id;
}

/** Builds the coverage view (live; ADR-0042 §6). Exported for the integration tests and later readers. */
export async function loadMethodologyCoverage(db: DbOrTx, versionId: string | undefined): Promise<MethodologyCoverage> {
  const methodologyVersionId = await methodologyVersionOf(db, versionId);
  const proceduresVersionId = await newestPublished(db, "procedure", PROCEDURES_KEY);
  const formSchemaVersionId = await newestPublished(db, "form_schema", FORMS_KEY);
  const [elements, links, forms, procedures] = await Promise.all([
    db
      .selectFrom("source_element")
      .select(["id", "set_code", "stable_key", "ordinal", "source_label_en", "label_ar", "source_ref"])
      .orderBy("set_code")
      .orderBy("ordinal")
      .orderBy("stable_key")
      .execute(),
    db
      .selectFrom("methodology_coverage_link")
      .select(["source_element_id", "target_kind", "target_code"])
      .orderBy("target_kind")
      .orderBy("target_code")
      .execute(),
    db.selectFrom("form_record_type").select(["code", "feature_status"]).execute(),
    db
      .selectFrom("procedure_definition")
      .select("code")
      .where("methodology_version_id", "=", proceduresVersionId)
      .where("removed", "=", false)
      .execute(),
  ]);
  const formStatus = new Map(forms.map((f) => [f.code, f.feature_status === "working" ? "working" : "planned"]));
  const liveProcedures = new Set(procedures.map((p) => p.code));
  const byElement = new Map<string, CoverageLinkFact[]>();
  for (const l of links) {
    // A form resolves when its record type is registered; its feature is working or planned per the registry (an
    // unregistered one, which the 0070 guard prevents, neither resolves nor counts as planned: not covered). A procedure
    // resolves when present and not removed in the newest published `procedures` version; procedures are working.
    const fact: CoverageLinkFact =
      l.target_kind === "form"
        ? {
            targetKind: "form",
            targetCode: l.target_code,
            resolved: formStatus.has(l.target_code),
            featureStatus: formStatus.get(l.target_code) === "planned" ? "planned" : "working",
          }
        : {
            targetKind: "procedure",
            targetCode: l.target_code,
            resolved: liveProcedures.has(l.target_code),
            featureStatus: "working",
          };
    const list = byElement.get(l.source_element_id) ?? [];
    list.push(fact);
    byElement.set(l.source_element_id, list);
  }
  const totals = { covered: 0, planned: 0, notCovered: 0, total: 0 };
  const out: MethodologyCoverageElement[] = elements.map((e) => {
    const facts = byElement.get(e.id) ?? [];
    const status = coverageStatusOf(facts);
    totals.total += 1;
    if (status === "covered") totals.covered += 1;
    else if (status === "planned") totals.planned += 1;
    else totals.notCovered += 1;
    return {
      setCode: e.set_code,
      stableKey: e.stable_key,
      sourceLabelEn: e.source_label_en,
      labelAr: e.label_ar,
      sourceRef: e.source_ref,
      status,
      links: facts.map((f) => ({ ...f })),
    };
  });
  return { methodologyVersionId, proceduresVersionId, formSchemaVersionId, totals, elements: out };
}

/** methodology.read anywhere (Studio configuration is global, as the slice A and B admin reads): 403 without it. */
function requireMethodologyRead(request: FastifyRequest): void {
  if (!holdsAnywhere(principalOf(request), "methodology.read")) throw problems.forbidden();
}

export function registerMethodologyCoverageRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(
    METHODOLOGY_COVERAGE,
    { config: { access: { permission: "methodology.read" as const } } },
    async (request) => {
      const query = parseQuery(coverageQuery, request.query);
      requireMethodologyRead(request);
      return loadMethodologyCoverage(db, query.versionId);
    },
  );
  return [`GET ${METHODOLOGY_COVERAGE}`];
}
