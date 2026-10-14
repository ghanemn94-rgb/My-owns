// The source-completeness gate (OpenAPI tag "studio"; ADR-0039 §1, §6, §9, §11-§13; REQ-S02-001, M0083;
// p5-work-split §A.3; T-DG5-BE-B2):
//   GET  /admin/source-coverage?versionId=   getSourceCoverage       (methodology.read; default: the newest published
//                                                                     version of the methodology kind's default key)
//   POST /admin/source-coverage/runs         runSourceCoverageCheck  (source_coverage.run; ADM_METHOD)
//
// The report counts, per source element set, the elements of the source inventory (`source_element`, seeded in 0064;
// read-only for the application) that are present in the resolved version, against the counts M0083 fixes: 2 modes,
// 6 phases, 6 gates, 16 templates, 10 TOM dimensions, 5 forums, 6 lifecycle steps, 3 launch windows, 1 roaming example,
// 25 questions. An inventory element is absent from a version when the version removes it, either through its typed
// element (`template` T13; `phase`/`gate`/`tom_dimension` are refused by the API and the 0062 CHECK) or through its
// `source_element` row `<set>.<key>`; both are honoured, so no removal path can hide from the count. Admin-added
// elements are not source elements and never count. The expected counts are the M0083 constants, not the inventory's
// row count, so a missing inventory row also fails. Result per set and overall: `fail` when a present count differs
// from its expected count; else `warn` when an element's feature is `planned`; else `pass` (ADR-0039 §6). Counts are
// integers (§12).
//
// The run is a write: commit-time re-authorization inside the transaction, Zod validation, lock class `configDraft` on
// "<kind>:<key>" (the content cannot change while the report is computed), one append-only `config_check_run` for
// exactly the content hash read under that lock, with its audit event in the same transaction, no remote I/O. The
// contract declares no If-Match for this operation (the body names the version, and the run binds to the hash it read,
// so a stale run can never satisfy publish: ADR-0039 §1, MV16); an If-Match the client does send is honoured (409 when
// stale). A run only tests configuration: it publishes nothing and approves nothing.
import type { DbOrTx, Tx } from "@mth/db";
import {
  sourceCoverageQuery,
  sourceCoverageRunRequest,
  type SourceCoverageReport,
  type SourceCoverageSet,
  type SourceSetCode,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { parseBody, parseQuery, problems, requireIfMatch, type ModuleDeps } from "../platform/index.ts";
import { toCheckRun } from "./checks.ts";
import {
  loadVersion,
  lockConfigDraft,
  requireStudioPermission,
  requireStudioWrite,
  studioRefusals,
  VERSIONS,
  type MethodologyVersionRow,
} from "./drafts.ts";
import { configKindProvider } from "./kinds.ts";

const JSON_BODY = ["application/json"] as const;
export const SOURCE_COVERAGE = "/api/v1/admin/source-coverage";
const RUNS = `${SOURCE_COVERAGE}/runs`;

/** M0083 / REQ-S02-001: every source element set with its expected count, in the order of the report. */
export const EXPECTED_SOURCE_COUNTS: readonly (readonly [SourceSetCode, number])[] = Object.freeze([
  ["mode", 2],
  ["phase", 6],
  ["gate", 6],
  ["template", 16],
  ["tom_dimension", 10],
  ["forum", 5],
  ["benefit_lifecycle_step", 6],
  ["launch_window", 3],
  ["roaming_example", 1],
  ["health_question", 25],
] as const);

/** Element types whose stable key is the inventory key of the set of the same name (ADR-0039 §2). */
const TYPED_SETS: ReadonlySet<string> = new Set(["phase", "gate", "tom_dimension", "template"]);

type Result = SourceCoverageSet["result"];

const worst = (results: readonly Result[]): Result =>
  results.includes("fail") ? "fail" : results.includes("warn") ? "warn" : "pass";

/** The source-completeness report of one methodology version (ADR-0039 §6). Read-only. */
export async function sourceCoverage(db: DbOrTx, version: MethodologyVersionRow): Promise<SourceCoverageReport> {
  const [inventory, removedRows] = await Promise.all([
    db
      .selectFrom("source_element")
      .select(["set_code", "stable_key", "ordinal", "feature_status"])
      .orderBy("set_code")
      .orderBy("ordinal")
      .execute(),
    db
      .selectFrom("methodology_element")
      .select(["element_type", "stable_key"])
      .where("methodology_version_id", "=", version.id)
      .where("element_type", "in", ["phase", "gate", "tom_dimension", "template", "source_element"])
      .where("removed", "=", true)
      .execute(),
  ]);
  // Every removal as "<set>.<key>": a typed element names its set by its type, a source_element row by its key.
  const removed = new Set(
    removedRows.map((r) => (TYPED_SETS.has(r.element_type) ? `${r.element_type}.${r.stable_key}` : r.stable_key)),
  );
  const sets: SourceCoverageSet[] = EXPECTED_SOURCE_COUNTS.map(([setCode, expected]) => {
    const members = inventory.filter((e) => e.set_code === setCode);
    const gone = members.filter((e) => removed.has(`${setCode}.${e.stable_key}`));
    const kept = members.filter((e) => !removed.has(`${setCode}.${e.stable_key}`));
    const planned = kept.filter((e) => e.feature_status !== "working");
    const result: Result = kept.length !== expected ? "fail" : planned.length > 0 ? "warn" : "pass";
    return {
      setCode,
      expected,
      present: kept.length,
      removed: gone.map((e) => e.stable_key),
      plannedFeatures: planned.map((e) => e.stable_key),
      result,
    };
  });
  return {
    versionId: version.id,
    contentSha256: version.content_sha256,
    result: worst(sets.map((s) => s.result)),
    sets,
  };
}

/** A methodology-kind version, or 404: source coverage is a property of the methodology (ADR-0039 §6). */
async function methodologyVersion(db: DbOrTx, versionId: string, forUpdate = false): Promise<MethodologyVersionRow> {
  const v = await loadVersion(db, versionId, forUpdate);
  if (v.config_kind !== "methodology") throw problems.notFound();
  return v;
}

/** The newest published version of the methodology kind's default key ('playbook'), or 404. */
async function newestPublished(db: DbOrTx): Promise<MethodologyVersionRow> {
  const key = configKindProvider("methodology").defaultKey;
  if (key === null) throw problems.notFound();
  const row = await db
    .selectFrom("methodology_version")
    .selectAll()
    .where("config_kind", "=", "methodology")
    .where("key", "=", key)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  return row;
}

/** Records one source-coverage run for the draft's current hash, with its audit event (ADR-0039 §6, §11). */
async function coverageRun(tx: Tx, request: FastifyRequest, versionId: string, expected: number | null) {
  const actor = await requireStudioWrite(tx, request, "source_coverage.run");
  const probe = await methodologyVersion(tx, versionId);
  await lockConfigDraft(tx, probe.config_kind, probe.key);
  const current = await methodologyVersion(tx, versionId, true);
  if (expected !== null && current.version !== expected) throw problems.versionConflict(current.version);
  // Checks belong to an open draft; a published or discarded version is no longer being edited.
  if (current.status !== "draft" || current.draft_stage === "discarded") throw studioRefusals.notEditable();
  const report = await sourceCoverage(tx, current);
  const id = uuidv7();
  const row = await tx
    .insertInto("config_check_run")
    .values({
      id,
      methodology_version_id: current.id,
      check_kind: "source_coverage",
      content_sha256: current.content_sha256,
      result: report.result,
      report: JSON.stringify(report),
      run_by: actor.userId,
      created_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "config_check_run.source_coverage",
    recordType: "config_check_run",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: 1,
    changes: {
      methodology_version_id: { from: null, to: current.id },
      content_sha256: { from: null, to: current.content_sha256 },
      result: { from: null, to: report.result },
    },
  });
  return row;
}

export function registerSourceCoverageRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(SOURCE_COVERAGE, { config: { access: { permission: "methodology.read" } } }, async (request) => {
    const query = parseQuery(sourceCoverageQuery, request.query);
    requireStudioPermission(principalOf(request), "methodology.read");
    const version =
      query.versionId === undefined ? await newestPublished(db) : await methodologyVersion(db, query.versionId);
    return sourceCoverage(db, version);
  });

  app.post(
    RUNS,
    { config: { access: { permission: "source_coverage.run" }, consumes: JSON_BODY } },
    async (request, reply) => {
      // Request-time checks; authorization is re-checked at commit time inside the write transaction.
      requireStudioPermission(principalOf(request), "source_coverage.run");
      const body = parseBody(sourceCoverageRunRequest, request.body);
      const expected = request.headers["if-match"] === undefined ? null : requireIfMatch(request);
      const run = await db.transaction().execute((tx) => coverageRun(tx, request, body.versionId, expected));
      reply.header("Location", `${VERSIONS}/${body.versionId}/check-runs`);
      return reply.code(201).send(toCheckRun(run));
    },
  );

  return [`GET ${SOURCE_COVERAGE}`, `POST ${RUNS}`];
}
