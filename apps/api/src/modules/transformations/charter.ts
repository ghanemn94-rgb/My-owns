// Transformation Charter and North Star (ADR-0017; REQ-PB-029/030/031/033/035/037).
//   Charter: one row per transformation plus an immutable charter_version snapshot per saved change. A save is always
//   three rows in one transaction - version + 1, the snapshot (with the linked North Star, top outcomes and guardrails
//   read in the same transaction) and the audit event; the database refuses a commit missing any of them.
//   North Star: exactly one current row; refining supersedes the current row and inserts a new one (both audited).
//   The charter view always shows the CURRENT North Star; a charter saved with a since-superseded North Star carries the
//   warning `charter.north_star_superseded`, and its next save re-links the current one (F-DG2-204, REQ-PB-033).
//   Thesis (B0037, REQ-PB-030): an empty part is flagged `charter.thesis_incomplete` (F-DG2-203); the sentence is
//   composed by `composeThesis` (@mth/shared) in the source structure.
import {
  diffFields,
  sql,
  type CharterRow,
  type CharterVersionTable,
  type Db,
  type DbOrTx,
  type NorthStarTable,
  type Tx,
} from "@mth/db";
import {
  charterUpdate,
  charterWrite,
  composeThesis,
  northStarWrite,
  type Charter,
  type CharterVersion,
  type CharterViewBody,
  type NorthStar,
  type Warning,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
} from "../platform/index.ts";
import { assertActiveUsers, assertSameTransformation, maybeIdempotent, openWrite } from "./register-kit.ts";
import { pick, presentOutcomes, ruleProblem, toStrategicGuardrail } from "./registers.ts";

const T = "/api/v1/transformations/:transformationId";
const tParams = z.strictObject({ transformationId: z.uuid() });
const versionParams = z.strictObject({ transformationId: z.uuid(), versionNo: z.coerce.number().int().min(1) });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

const notFound = (code: "charter_not_found" | "north_star_not_found", what: string) =>
  new HttpProblem({ status: 404, type: "urn:mth:problem:not-found", code, title: "Not found", detail: what });

/** Charter body field -> column (the 27 editable fields). */
export const CHARTER_COLS = [
  ["transformationName", "transformation_name"],
  ["executiveSponsorUserId", "executive_sponsor_user_id"],
  ["transformationLeadUserId", "transformation_lead_user_id"],
  ["caseForChange", "case_for_change"],
  ["northStarId", "north_star_id"],
  ["inScope", "in_scope"],
  ["outOfScope", "out_of_scope"],
  ["baselineDate", "baseline_date"],
  ["targetHorizonValue", "target_horizon_value"],
  ["targetHorizonUnit", "target_horizon_unit"],
  ["governanceForum", "governance_forum"],
  ["decisionRights", "decision_rights"],
  ["successDefinition", "success_definition"],
  ["thesisChange", "thesis_change"],
  ["thesisOutcomes", "thesis_outcomes"],
  ["thesisBenefits", "thesis_benefits"],
  ["thesisBecause", "thesis_because"],
  ["scOutcomeLinkage", "sc_outcome_linkage"],
  ["scOutcomeLinkageEvidence", "sc_outcome_linkage_evidence"],
  ["scProblemTraceability", "sc_problem_traceability"],
  ["scProblemTraceabilityEvidence", "sc_problem_traceability_evidence"],
  ["scExclusionsDocumented", "sc_exclusions_documented"],
  ["scExclusionsDocumentedEvidence", "sc_exclusions_documented_evidence"],
  ["scBaselineMeasurable", "sc_baseline_measurable"],
  ["scBaselineMeasurableEvidence", "sc_baseline_measurable_evidence"],
  ["scExecutiveDecisionsVisible", "sc_executive_decisions_visible"],
  ["scExecutiveDecisionsVisibleEvidence", "sc_executive_decisions_visible_evidence"],
] as const;
const CHARTER_AUDIT_FIELDS = CHARTER_COLS.map(([, c]) => c);

type ScopeAnswer = "yes" | "partly" | "no" | null;
type CharterFieldsOf = Omit<
  Charter,
  "id" | "organizationId" | "transformationId" | "version" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy"
>;
function charterFieldsOf(
  r: Omit<
    CharterRow,
    | "id"
    | "version"
    | "created_at"
    | "created_by"
    | "updated_at"
    | "updated_by"
    | "organization_id"
    | "transformation_id"
  >,
): CharterFieldsOf {
  return {
    transformationName: r.transformation_name,
    executiveSponsorUserId: r.executive_sponsor_user_id,
    transformationLeadUserId: r.transformation_lead_user_id,
    caseForChange: r.case_for_change,
    northStarId: r.north_star_id,
    inScope: r.in_scope,
    outOfScope: r.out_of_scope,
    baselineDate: r.baseline_date,
    targetHorizonValue: r.target_horizon_value,
    targetHorizonUnit: r.target_horizon_unit as Charter["targetHorizonUnit"],
    governanceForum: r.governance_forum,
    decisionRights: r.decision_rights,
    successDefinition: r.success_definition,
    thesisChange: r.thesis_change,
    thesisOutcomes: r.thesis_outcomes,
    thesisBenefits: r.thesis_benefits,
    thesisBecause: r.thesis_because,
    scOutcomeLinkage: r.sc_outcome_linkage as ScopeAnswer,
    scOutcomeLinkageEvidence: r.sc_outcome_linkage_evidence,
    scProblemTraceability: r.sc_problem_traceability as ScopeAnswer,
    scProblemTraceabilityEvidence: r.sc_problem_traceability_evidence,
    scExclusionsDocumented: r.sc_exclusions_documented as ScopeAnswer,
    scExclusionsDocumentedEvidence: r.sc_exclusions_documented_evidence,
    scBaselineMeasurable: r.sc_baseline_measurable as ScopeAnswer,
    scBaselineMeasurableEvidence: r.sc_baseline_measurable_evidence,
    scExecutiveDecisionsVisible: r.sc_executive_decisions_visible as ScopeAnswer,
    scExecutiveDecisionsVisibleEvidence: r.sc_executive_decisions_visible_evidence,
  };
}

export function toCharter(r: CharterRow): Charter {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    ...charterFieldsOf(r),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

type NorthStarRow = Selectable<NorthStarTable>;
export function toNorthStar(r: NorthStarRow): NorthStar {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    statement: r.statement,
    status: r.status as NorthStar["status"],
    supersededAt: isoOrNull(r.superseded_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

export function findCharter(db: DbOrTx, transformationId: string, forUpdate = false) {
  let q = db.selectFrom("charter").selectAll().where("transformation_id", "=", transformationId);
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

export function findCurrentNorthStar(db: DbOrTx, transformationId: string, forUpdate = false) {
  let q = db
    .selectFrom("north_star")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "current");
  if (forUpdate) q = q.forUpdate();
  return q.executeTakeFirst();
}

async function topOutcomesOf(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("outcome")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("is_top_outcome", "=", true)
    .where("status", "<>", "archived")
    .orderBy(sql`top_rank NULLS LAST`)
    .orderBy("id")
    .execute();
}
async function activeGuardrailsOf(db: DbOrTx, transformationId: string) {
  return db
    .selectFrom("strategic_guardrail")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "=", "active")
    .orderBy("id")
    .execute();
}

/** The scope-check pre-checks (ADR-0017 §2): support, never replace, the human answer; missing data is `unknown`. */
async function scopeCheckPrechecks(db: DbOrTx, c: CharterRow): Promise<CharterViewBody["scopeCheckPrechecks"]> {
  const defs = await db
    .selectFrom("charter_scope_check_definition")
    .select(["code", "system_precheck"])
    .orderBy("ordinal")
    .execute();
  const count = async (q: Promise<{ n: string } | undefined>) => Number((await q)?.n ?? 0);
  const confirmedFindings = await count(
    db
      .selectFrom("diagnostic_finding")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", c.transformation_id)
      .where("status", "=", "confirmed")
      .executeTakeFirst(),
  );
  const baselines = await db
    .selectFrom("baseline")
    .select(["value", "source", "baseline_date"])
    .where("transformation_id", "=", c.transformation_id)
    .where("status", "=", "active")
    .execute();
  const openDecisions = await db
    .selectFrom("decision")
    .select(["owner_user_id"])
    .where("transformation_id", "=", c.transformation_id)
    .where("status", "=", "open")
    .execute();
  return defs.map((d) => {
    const code = d.code as CharterViewBody["scopeCheckPrechecks"][number]["code"];
    switch (d.system_precheck) {
      case "scope_items_traced":
        if (c.in_scope === null)
          return { code, result: "unknown" as const, detail: "In-scope items are not recorded yet." };
        return confirmedFindings > 0
          ? { code, result: "pass" as const, detail: `${confirmedFindings} confirmed diagnostic finding(s) exist.` }
          : { code, result: "attention" as const, detail: "No confirmed diagnostic finding traces the scope yet." };
      case "exclusions_present":
        return c.out_of_scope === null
          ? { code, result: "unknown" as const, detail: "No exclusions (out of scope) are recorded yet." }
          : { code, result: "pass" as const, detail: "Explicit exclusions are documented." };
      case "baseline_measurable": {
        if (baselines.length === 0) return { code, result: "unknown" as const, detail: "No baseline is recorded yet." };
        const measurable = baselines.filter((b) => b.value !== null && b.source !== null && b.baseline_date !== null);
        return measurable.length > 0
          ? { code, result: "pass" as const, detail: `${measurable.length} baseline(s) have a value, source and date.` }
          : { code, result: "attention" as const, detail: "No baseline has a value, a source and a date." };
      }
      case "executive_decisions_visible": {
        if (openDecisions.length === 0)
          return { code, result: "unknown" as const, detail: "No open decision is recorded yet." };
        const owned = openDecisions.filter((o) => o.owner_user_id !== null).length;
        return owned > 0
          ? { code, result: "pass" as const, detail: `${owned} open decision(s) have an owner.` }
          : { code, result: "attention" as const, detail: "Open decisions have no owner." };
      }
      default:
        return { code, result: "not_applicable" as const, detail: "Answered by people; no system pre-check." };
    }
  });
}

const THESIS_PART_LABEL: ReadonlyMap<string, string> = new Map([
  ["thesisChange", "what we change (capabilities / journeys / operating model)"],
  ["thesisOutcomes", "the customer/operational outcomes that will improve"],
  ["thesisBenefits", "the financial/strategic benefits it will create"],
  ["thesisBecause", "the evidence / causal logic (because ...)"],
]);

/** One `charter.thesis_incomplete` warning per empty thesis part (B0037; never silently passing). */
export function thesisWarnings(
  c: Pick<Charter, "thesisChange" | "thesisOutcomes" | "thesisBenefits" | "thesisBecause">,
) {
  return composeThesis(c).missing.map(
    (part): Warning => ({
      code: "charter.thesis_incomplete",
      message: `The transformation thesis is incomplete: ${THESIS_PART_LABEL.get(part) ?? part} is empty. It must read "If we change ..., then ... will improve, which will create ..., because ..." (B0037).`,
      pointer: `/charter/${part}`,
    }),
  );
}

export async function charterView(db: DbOrTx, c: CharterRow): Promise<CharterViewBody & { version: number }> {
  // Always the CURRENT North Star (REQ-PB-033): a refinement supersedes the row the charter was saved with.
  const northStarRow = await findCurrentNorthStar(db, c.transformation_id);
  const topOutcomes = await topOutcomesOf(db, c.transformation_id);
  const guardrails = await activeGuardrailsOf(db, c.transformation_id);
  const warnings: Warning[] = [];
  if (topOutcomes.length < 3 || topOutcomes.length > 5)
    warnings.push({
      code: "charter.top_outcomes_count",
      message: `The charter should hold 3-5 top outcomes; it holds ${topOutcomes.length}.`,
      pointer: "/topOutcomes",
    });
  if (c.north_star_id !== null && northStarRow?.id !== c.north_star_id)
    warnings.push({
      code: "charter.north_star_superseded",
      message:
        "The North Star this charter version was saved with has since been refined (superseded). The current North Star is shown; save the charter to record it in a new charter version.",
      pointer: "/northStar",
    });
  const charterBody = toCharter(c);
  warnings.push(...thesisWarnings(charterBody));
  return {
    charter: charterBody,
    northStar: northStarRow ? toNorthStar(northStarRow) : null,
    topOutcomes: await presentOutcomes(db, topOutcomes),
    guardrails: guardrails.map(toStrategicGuardrail),
    warnings,
    scopeCheckPrechecks: await scopeCheckPrechecks(db, c),
    // ETag source only; stripped before sending.
    version: c.version,
  };
}

/** Appends the immutable snapshot of `c` (charter_version, version_no = c.version) in the same transaction. */
async function snapshot(tx: Tx, c: CharterRow, savedBy: string, changeSummary: string | null): Promise<void> {
  const ns = c.north_star_id
    ? await tx.selectFrom("north_star").select("statement").where("id", "=", c.north_star_id).executeTakeFirst()
    : undefined;
  const tops = await topOutcomesOf(tx, c.transformation_id);
  const guardrails = await activeGuardrailsOf(tx, c.transformation_id);
  const { id: _id, version: _v, created_at: _ca, created_by: _cb, updated_at: _ua, updated_by: _ub, ...fields } = c;
  await tx
    .insertInto("charter_version")
    .values({
      ...fields,
      id: uuidv7(),
      charter_id: c.id,
      version_no: c.version,
      north_star_statement: ns?.statement ?? null,
      top_outcomes_snapshot: JSON.stringify(
        tops.map((o) => ({ id: o.id, statement: o.statement, rank: o.top_rank, version: o.version })),
      ),
      guardrails_snapshot: JSON.stringify(
        guardrails.map((g) => ({ id: g.id, title: g.title, category: g.category, version: g.version })),
      ),
      change_summary: changeSummary,
      saved_by: savedBy,
    })
    .execute();
}

function toCharterVersion(r: Selectable<CharterVersionTable>): CharterVersion {
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    charterId: r.charter_id,
    versionNo: r.version_no,
    ...charterFieldsOf(r),
    northStarStatement: r.north_star_statement,
    topOutcomesSnapshot: r.top_outcomes_snapshot as Record<string, unknown>[],
    guardrailsSnapshot: r.guardrails_snapshot as Record<string, unknown>[],
    changeSummary: r.change_summary,
    savedBy: r.saved_by,
    savedAt: iso(r.saved_at),
  };
}

async function checkCharter(tx: Tx, organizationId: string, transformationId: string, m: Partial<CharterRow>) {
  if (((m.target_horizon_value ?? null) === null) !== ((m.target_horizon_unit ?? null) === null))
    throw ruleProblem(
      "charter.target_horizon_pair",
      "The target horizon needs both a value and a unit.",
      "/targetHorizonUnit",
    );
  await assertActiveUsers(tx, organizationId, [
    { id: m.executive_sponsor_user_id ?? null, pointer: "/executiveSponsorUserId" },
    { id: m.transformation_lead_user_id ?? null, pointer: "/transformationLeadUserId" },
  ]);
  await assertSameTransformation(tx, "north_star", transformationId, m.north_star_id ?? null, "/northStarId");
}

/** An explicitly linked North Star must be the CURRENT one (a superseded sentence is never linked as current). */
async function assertNorthStarCurrent(tx: Tx, transformationId: string, changes: Partial<CharterRow>): Promise<void> {
  const id = changes.north_star_id ?? null;
  if (id === null) return;
  const ns = await tx
    .selectFrom("north_star")
    .select("status")
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (ns && ns.status !== "current")
    throw ruleProblem(
      "charter.north_star_not_current",
      "Link the current North Star; this one was superseded by a refinement.",
      "/northStarId",
    );
}

const sendView = (
  reply: FastifyReply,
  status: number,
  view: CharterViewBody & { version: number },
  location?: string,
) => {
  const { version, ...body } = view;
  reply.header("ETag", `"${version}"`);
  if (location) reply.header("Location", location);
  return reply.code(status).send(body);
};

export function registerCharterRoutes(app: FastifyInstance, db: Db): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const charterEdit = { access: { permission: "charter.edit" as const } };
  const northStarEdit = { access: { permission: "north_star.edit" as const } };
  const tid = (request: FastifyRequest) => parse(tParams, request.params, "params").transformationId;

  app.get(`${T}/charter`, { config: read }, async (request, reply) => {
    const transformationId = tid(request);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const c = await findCharter(db, transformationId);
    if (!c) throw notFound("charter_not_found", "No charter has been created for this transformation yet.");
    return sendView(reply, 200, await charterView(db, c));
  });

  app.post(`${T}/charter`, { config: charterEdit }, async (request, reply) => {
    const transformationId = tid(request);
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "charter.edit" }], null);
      const body = parseBody(charterWrite, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => {
        if (await findCharter(tx, transformationId))
          throw problems.duplicate(
            "duplicate.charter",
            "This transformation already has a charter; save a change instead.",
          );
        const values = pick(body, CHARTER_COLS) as Partial<CharterRow>;
        await checkCharter(tx, ctx.organizationId, transformationId, values);
        await assertNorthStarCurrent(tx, transformationId, values);
        const id = uuidv7();
        const row = await tx
          .insertInto("charter")
          .values({
            ...values,
            id,
            organization_id: ctx.organizationId,
            transformation_id: transformationId,
            created_by: ctx.userId,
            updated_by: ctx.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: { code?: string; constraint?: string }) => {
            if (e.code === "23505" && e.constraint === "charter_transformation_id_key")
              throw problems.duplicate("duplicate.charter", "This transformation already has a charter.");
            throw e;
          });
        await snapshot(tx, row, ctx.userId, null);
        await record(tx, ctx.audit, {
          action: "charter.create",
          recordType: "charter",
          recordId: id,
          organizationId: ctx.organizationId,
          transformationId,
          newVersion: 1,
          changes: diffFields(
            {} as Record<string, unknown>,
            row as unknown as Record<string, unknown>,
            CHARTER_AUDIT_FIELDS,
          ),
        });
        const { version: _v, ...view } = await charterView(tx, row);
        return { status: 201, body: { ...view, id, version: row.version } };
      });
    });
    const { id: _id, version, ...view } = result.body;
    if (result.replayed) {
      request.authz.decisions += 1;
      reply.header("Idempotent-Replayed", "true");
    }
    return sendView(reply, result.status, { ...view, version }, `/api/v1/transformations/${transformationId}/charter`);
  });

  app.patch(`${T}/charter`, { config: charterEdit }, async (request, reply) => {
    const transformationId = tid(request);
    const view = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "charter.edit" }], null);
      const body = parseBody(charterUpdate, request.body);
      const expected = requireIfMatch(request);
      const current = await findCharter(tx, transformationId, true);
      if (!current) throw notFound("charter_not_found", "No charter has been created for this transformation yet.");
      if (current.version !== expected) throw problems.versionConflict(current.version);
      const changes = pick(body, CHARTER_COLS) as Partial<CharterRow>;
      await checkCharter(tx, ctx.organizationId, transformationId, { ...current, ...changes });
      await assertNorthStarCurrent(tx, transformationId, changes);
      // A save re-links a superseded North Star to the current one (recorded in the diff and the new snapshot).
      if (!("north_star_id" in changes) && current.north_star_id !== null) {
        const ns = await findCurrentNorthStar(tx, transformationId);
        if (ns && ns.id !== current.north_star_id) changes.north_star_id = ns.id;
      }
      const updated = await tx
        .updateTable("charter")
        .set({ ...changes, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
        .where("id", "=", current.id)
        .where("version", "=", current.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await snapshot(tx, updated, ctx.userId, body.changeSummary ?? null);
      await record(tx, ctx.audit, {
        action: "charter.update",
        recordType: "charter",
        recordId: current.id,
        organizationId: ctx.organizationId,
        transformationId,
        priorVersion: current.version,
        newVersion: updated.version,
        reason: body.changeSummary ?? null,
        changes: diffFields(current, updated, CHARTER_AUDIT_FIELDS),
      });
      return charterView(tx, updated);
    });
    return sendView(reply, 200, view);
  });

  app.get(`${T}/charter/versions`, { config: read }, async (request) => {
    const transformationId = tid(request);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("charter_version").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("version_no", "<", Number(after[0]));
    const rows = await q
      .orderBy("version_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.version_no], hash);
    return { items: page.items.map(toCharterVersion), nextCursor: page.nextCursor };
  });

  app.get(`${T}/charter/versions/:versionNo`, { config: read }, async (request) => {
    const { transformationId, versionNo } = parse(versionParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("charter_version")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("version_no", "=", versionNo)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return toCharterVersion(row);
  });

  // ---------------------------------------------------------------- North Star
  app.get(`${T}/north-star`, { config: read }, async (request, reply) => {
    const transformationId = tid(request);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const ns = await findCurrentNorthStar(db, transformationId);
    if (!ns) throw notFound("north_star_not_found", "No North Star has been set for this transformation yet.");
    return sendVersioned(reply, 200, toNorthStar(ns));
  });

  app.put(`${T}/north-star`, { config: northStarEdit }, async (request, reply) => {
    const transformationId = tid(request);
    const row = await db.transaction().execute(async (tx) => {
      const ctx = await openWrite(tx, request, transformationId, [{ permission: "north_star.edit" }], null);
      const { statement } = parseBody(northStarWrite, request.body);
      // Serialize refinements of one transformation (the partial unique index backs this up).
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`northstar:${transformationId}`}, 0))`.execute(tx);
      const current = await findCurrentNorthStar(tx, transformationId, true);
      const hasIfMatch = request.headers["if-match"] !== undefined;
      if (current) {
        const expected = requireIfMatch(request);
        if (current.version !== expected) throw problems.versionConflict(current.version);
        const superseded = await tx
          .updateTable("north_star")
          .set({
            status: "superseded",
            superseded_at: sql<Date>`now()`,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: ctx.userId,
          })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: "north_star.supersede",
          recordType: "north_star",
          recordId: current.id,
          organizationId: ctx.organizationId,
          transformationId,
          priorVersion: current.version,
          newVersion: superseded.version,
          changes: { status: { from: "current", to: "superseded" } },
        });
      } else if (hasIfMatch) {
        throw new HttpProblem({
          status: 409,
          type: "urn:mth:problem:version-conflict",
          code: "version_conflict",
          title: "Version conflict",
          detail: "There is no current North Star to refine; send the first one without If-Match.",
        });
      }
      const id = uuidv7();
      const created = await tx
        .insertInto("north_star")
        .values({
          id,
          organization_id: ctx.organizationId,
          transformation_id: transformationId,
          statement,
          created_by: ctx.userId,
          updated_by: ctx.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await record(tx, ctx.audit, {
        action: "north_star.create",
        recordType: "north_star",
        recordId: id,
        organizationId: ctx.organizationId,
        transformationId,
        newVersion: 1,
        changes: { statement: { from: current?.statement ?? null, to: statement } },
      });
      return created;
    });
    return sendVersioned(reply, 200, toNorthStar(row));
  });

  app.get(`${T}/north-star/history`, { config: read }, async (request) => {
    const transformationId = tid(request);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ transformationId, northStar: true });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("north_star").selectAll().where("transformation_id", "=", transformationId);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toNorthStar), nextCursor: page.nextCursor };
  });

  return [
    `GET ${T}/charter`,
    `POST ${T}/charter`,
    `PATCH ${T}/charter`,
    `GET ${T}/charter/versions`,
    `GET ${T}/charter/versions/:versionNo`,
    `GET ${T}/north-star`,
    `PUT ${T}/north-star`,
    `GET ${T}/north-star/history`,
  ];
}
