// Portfolios and workstreams (P4 slice K; ADR-0038 §9-§12; T-DG4-BE-M3; REQ-S03-001):
//   GET   /organizations/{o}/portfolios[?cursor&limit&includeArchived]          (organization.read)
//   POST  /organizations/{o}/portfolios                                         (portfolio.manage; TO). 409 code_taken
//   GET   /portfolios/{p}                                                       (organization.read)
//   PATCH /portfolios/{p}                                                       (portfolio.manage; If-Match; archive)
//   GET   /portfolios/{p}/transformations[?cursor&limit&includeRemoved]         (organization.read; readable rows only)
//   POST  /portfolios/{p}/transformations                                       (portfolio.manage; readable target)
//   POST  /portfolios/{p}/transformations/{m}/remove                            (portfolio.manage; If-Match; reason)
//   GET   /transformations/{t}/workstreams[?cursor&limit&includeArchived]       (transformation.read)
//   POST  /transformations/{t}/workstreams                                      (workstream.manage; TL, TO). WS-nn
//   GET   /transformations/{t}/workstreams/{w}                                  (transformation.read)
//   PATCH /transformations/{t}/workstreams/{w}                                  (workstream.manage; If-Match; archive)
//   GET   /transformations/{t}/workstreams/{w}/initiatives[?…&includeRemoved]   (transformation.read)
//   POST  /transformations/{t}/workstreams/{w}/initiatives                      (workstream.manage)
//   POST  /transformations/{t}/workstreams/{w}/initiatives/{m}/remove           (workstream.manage; If-Match; reason)
//
// - A portfolio is organization-level; its membership list shows only the transformations the caller may read (the
//   DG1 scoped policy, `scopeFilter` on transformation.read, the function DG1 listTransformations uses), and a
//   membership of an unreadable transformation is 404 on removal. Placing a transformation needs it to be readable.
// - A transformation sits in at most one portfolio, an initiative in at most one workstream (422; the 0055 partial
//   unique indexes are the backstop, mapped in platform/db-errors.ts). Memberships are never deleted: removal keeps the
//   row with a reason (`active → removed`, terminal; a new row re-adds).
// - Portfolio and workstream `active → archived` (terminal, with a reason); an archived one is read-only (422
//   `portfolio.archived` / `workstream.archived` on every later write, its memberships included).
// - Workstream codes WS-01, WS-02, … come from record_code_counter (prefix WS) inside the creating transaction.
// - Every write re-authorises at commit on grants reloaded inside its transaction, validates (shared free-text and
//   UTF-8 rules, S-1/S-2), requires If-Match on changes (428/409; creates are version 1), writes one audit event in its
//   transaction (the 0055 audit guards check it at COMMIT) and does no remote I/O inside it (S-4).
// - Neither a portfolio nor a workstream grants access (scoped_assignment stays the only source, ADR-0006), and nothing
//   here is a business approval or touches the engineering delivery gates DG0-DG7.
import {
  diffFields,
  sql,
  type DbOrTx,
  type PortfolioRow,
  type PortfolioTransformationRow,
  type Tx,
  type WorkstreamInitiativeRow,
  type WorkstreamRow,
} from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  portfolioCreate,
  portfolioTransformationCreate,
  portfolioUpdate,
  reasonRequest,
  workstreamCreate,
  workstreamInitiativeCreate,
  workstreamUpdate,
  type Portfolio,
  type PortfolioTransformation,
  type Workstream,
  type WorkstreamInitiative,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  commitTimeDenial,
  organizationsWith,
  principalOf,
  refreshPrincipal,
  requireAction,
  requireTransformationRead,
  scopeFilter,
  targetFor,
  type Principal,
} from "../access/index.ts";
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
  type ModuleDeps,
} from "../platform/index.ts";
import {
  assertActiveUsers,
  bumpStamps,
  maybeIdempotent,
  openWrite,
  sendCreated,
  writableTransformation,
  type WriteContext,
} from "../transformations/index.ts";

const JSON_BODY = ["application/json"] as const;
const ORG_READ = "organization.read" as const;
const T_READ = "transformation.read" as const;
export const PORTFOLIO_MANAGE = "portfolio.manage" as const;
export const WORKSTREAM_MANAGE = "workstream.manage" as const;
const WORKSTREAM_RULES = [{ permission: WORKSTREAM_MANAGE }];

const ORG_PORTFOLIOS = "/api/v1/organizations/:organizationId/portfolios";
const PORTFOLIO = "/api/v1/portfolios/:portfolioId";
const PORTFOLIO_MEMBERS = `${PORTFOLIO}/transformations`;
const PORTFOLIO_MEMBER_REMOVE = `${PORTFOLIO_MEMBERS}/:portfolioTransformationId/remove`;
const WORKSTREAMS = "/api/v1/transformations/:transformationId/workstreams";
const WORKSTREAM = `${WORKSTREAMS}/:workstreamId`;
const WORKSTREAM_MEMBERS = `${WORKSTREAM}/initiatives`;
const WORKSTREAM_MEMBER_REMOVE = `${WORKSTREAM_MEMBERS}/:workstreamInitiativeId/remove`;

/** ADR-0038 §12 refusal texts (exact; S-11). */
export const STRUCTURE_TEXT = Object.freeze({
  codeTaken: "Another portfolio of this organization uses this code.",
  alreadyPlaced: "This transformation already sits in a portfolio.",
  portfolioArchived: "This portfolio is archived.",
  alreadyAssigned: "This initiative already belongs to a workstream.",
  workstreamArchived: "This workstream is archived.",
  membershipNotActive: "This membership has already been removed.",
});

export const structureRefusals = Object.freeze({
  codeTaken: () => problems.duplicate("portfolio.code_taken", STRUCTURE_TEXT.codeTaken),
  alreadyPlaced: () => problems.businessRule("portfolio.transformation_already_placed", STRUCTURE_TEXT.alreadyPlaced),
  portfolioArchived: () => problems.businessRule("portfolio.archived", STRUCTURE_TEXT.portfolioArchived),
  alreadyAssigned: () =>
    problems.businessRule("workstream.initiative_already_assigned", STRUCTURE_TEXT.alreadyAssigned),
  workstreamArchived: () => problems.businessRule("workstream.archived", STRUCTURE_TEXT.workstreamArchived),
  membershipNotActive: () =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.invalidTransition,
      code: "membership.not_active",
      title: "Invalid transition",
      detail: STRUCTURE_TEXT.membershipNotActive,
      errors: [{ pointer: "", code: "membership.not_active", message: STRUCTURE_TEXT.membershipNotActive }],
    }),
  /** A referenced record (the initiative of an assignment) is not one of this transformation (existing code). */
  reference: (pointer: string, what: string) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.validation,
      code: "validation.reference",
      title: "Business rule violated",
      detail: "The referenced record does not exist in this transformation.",
      errors: [{ pointer, code: "validation.reference", message: `No ${what} with this id in this transformation.` }],
    }),
});

const orgParams = z.strictObject({ organizationId: z.uuid() });
const portfolioParams = z.strictObject({ portfolioId: z.uuid() });
const portfolioMemberParams = z.strictObject({ portfolioId: z.uuid(), portfolioTransformationId: z.uuid() });
const tParams = z.strictObject({ transformationId: z.uuid() });
const workstreamParams = z.strictObject({ transformationId: z.uuid(), workstreamId: z.uuid() });
const workstreamMemberParams = z.strictObject({
  transformationId: z.uuid(),
  workstreamId: z.uuid(),
  workstreamInitiativeId: z.uuid(),
});
const archivedQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  includeArchived: z.stringbool().default(false),
});
const removedQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  includeRemoved: z.stringbool().default(false),
});

// ------------------------------------------------------------------------------------------------ presenters

export const toPortfolio = (r: PortfolioRow): Portfolio => ({
  id: r.id,
  organizationId: r.organization_id,
  code: r.code,
  name: r.name,
  description: r.description,
  ownerUserId: r.owner_user_id,
  status: r.status as Portfolio["status"],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

type MemberRow = PortfolioTransformationRow & { t_code: string; t_name: string };

export const toPortfolioTransformation = (r: MemberRow): PortfolioTransformation => ({
  id: r.id,
  portfolioId: r.portfolio_id,
  transformationId: r.transformation_id,
  transformationCode: r.t_code,
  transformationName: r.t_name,
  status: r.status as PortfolioTransformation["status"],
  removedAt: isoOrNull(r.removed_at),
  removedBy: r.removed_by,
  removeReason: r.remove_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

export const toWorkstream = (r: WorkstreamRow): Workstream => ({
  id: r.id,
  transformationId: r.transformation_id,
  code: r.code,
  name: r.name,
  description: r.description,
  leadUserId: r.lead_user_id,
  status: r.status as Workstream["status"],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

type AssignmentRow = WorkstreamInitiativeRow & { i_code: string; i_name: string };

export const toWorkstreamInitiative = (r: AssignmentRow): WorkstreamInitiative => ({
  id: r.id,
  workstreamId: r.workstream_id,
  initiativeId: r.initiative_id,
  initiativeCode: r.i_code,
  initiativeName: r.i_name,
  status: r.status as WorkstreamInitiative["status"],
  removedAt: isoOrNull(r.removed_at),
  removedBy: r.removed_by,
  removeReason: r.remove_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

const PORTFOLIO_AUDIT_FIELDS = ["code", "name", "description", "owner_user_id", "status", "archive_reason"] as const;
const WORKSTREAM_AUDIT_FIELDS = ["code", "name", "description", "lead_user_id", "status", "archive_reason"] as const;

// ------------------------------------------------------------------------------------------------ portfolio access

/**
 * Read gate of the portfolio reads (ADR-0038 §10 "Read portfolios: organization.read, every role"): the caller holds
 * organization.read through ANY grant in the organization (the `organizationsWith` rule of benefits/totals.ts and
 * tasks/routes.ts), so a business-unit- or transformation-scoped user reads the portfolios and sees, in each
 * membership list, only the transformations it may read (§9 "Scope"). 404 otherwise (never a disclosure).
 */
function requireOrganizationRead(principal: Principal, organizationId: string): void {
  if (!organizationsWith(principal, ORG_READ).includes(organizationId)) throw problems.notFound();
}

/** The portfolio, readable by the caller (organization.read in its organization), or 404. */
async function readablePortfolio(
  db: DbOrTx,
  principal: Principal,
  portfolioId: string,
  lock: "update" | "share" | null = null,
): Promise<PortfolioRow> {
  let q = db.selectFrom("portfolio").selectAll().where("id", "=", portfolioId);
  if (lock === "update") q = q.forUpdate();
  if (lock === "share") q = q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  requireOrganizationRead(principal, row.organization_id);
  return row;
}

/**
 * Write gate of a portfolio mutation: read the organization (else 404), then portfolio.manage ON the organization (an
 * organization-level grant: TO; a business-unit grant never applies to the organization target), decided on grants
 * reloaded inside `tx` (commit-time authorisation; 403 with the denial attached so the failed-mutation audit records
 * it). Returns the refreshed principal, which also decides any transformation read of the same write.
 */
async function requirePortfolioManage(tx: Tx, request: FastifyRequest, organizationId: string): Promise<Principal> {
  requireOrganizationRead(principalOf(request), organizationId);
  const target = await targetFor(tx, "organization", { organizationId });
  const fresh = await refreshPrincipal(tx, request);
  try {
    await requireAction(tx, fresh, PORTFOLIO_MANAGE, target);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  return fresh;
}

/** SQL predicate on `t` (transformation): readable by the principal (the DG1 scoped policy). */
const readableTransformationSql = (principal: Principal) =>
  scopeFilter(principal, T_READ, {
    level: "transformation",
    organizationId: sql.ref("t.organization_id"),
    businessUnitId: sql.ref("t.business_unit_id"),
    transformationId: sql.ref("t.id"),
  });

async function loadMember(db: DbOrTx, portfolioId: string, memberId: string): Promise<MemberRow | undefined> {
  return db
    .selectFrom("portfolio_transformation as m")
    .innerJoin("transformation as t", "t.id", "m.transformation_id")
    .selectAll("m")
    .select(["t.code as t_code", "t.name as t_name"])
    .where("m.portfolio_id", "=", portfolioId)
    .where("m.id", "=", memberId)
    .executeTakeFirst();
}

// ------------------------------------------------------------------------------------------------ portfolio writes

async function createPortfolio(tx: Tx, request: FastifyRequest, organizationId: string) {
  const principal = await requirePortfolioManage(tx, request, organizationId);
  const userId = principal.userId!;
  const body = parseBody(portfolioCreate, request.body);
  return maybeIdempotent(tx, request, userId, body, async () => {
    await assertActiveUsers(tx, organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
    const taken = await tx
      .selectFrom("portfolio")
      .select("id")
      .where("organization_id", "=", organizationId)
      .where("code", "=", body.code)
      .executeTakeFirst();
    if (taken) throw structureRefusals.codeTaken();
    const id = uuidv7();
    const row = await tx
      .insertInto("portfolio")
      .values({
        id,
        organization_id: organizationId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        owner_user_id: body.ownerUserId ?? null,
        created_by: userId,
        updated_by: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, auditContextOf(request), {
      action: "portfolio.create",
      recordType: "portfolio",
      recordId: id,
      organizationId,
      newVersion: row.version,
      changes: diffFields({} as Partial<PortfolioRow>, row as Partial<PortfolioRow>, [...PORTFOLIO_AUDIT_FIELDS]),
    });
    return { status: 201, body: toPortfolio(row) };
  });
}

async function updatePortfolio(tx: Tx, request: FastifyRequest, portfolioId: string): Promise<Portfolio> {
  const located = await readablePortfolio(tx, principalOf(request), portfolioId);
  const principal = await requirePortfolioManage(tx, request, located.organization_id);
  const userId = principal.userId!;
  const body = parseBody(portfolioUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await readablePortfolio(tx, principal, portfolioId, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "active") throw structureRefusals.portfolioArchived();
  if (body.ownerUserId !== undefined)
    await assertActiveUsers(tx, current.organization_id, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  if (body.code !== undefined && body.code !== current.code) {
    const taken = await tx
      .selectFrom("portfolio")
      .select("id")
      .where("organization_id", "=", current.organization_id)
      .where("code", "=", body.code)
      .executeTakeFirst();
    if (taken) throw structureRefusals.codeTaken();
  }
  const archiving = body.status === "archived";
  const updated = await tx
    .updateTable("portfolio")
    .set({
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(archiving
        ? {
            status: "archived",
            archived_at: sql<Date>`now()`,
            archived_by: userId,
            archive_reason: body.archiveReason!,
          }
        : {}),
      ...bumpStamps(userId),
    })
    .where("id", "=", portfolioId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: archiving ? "portfolio.archive" : "portfolio.update",
    recordType: "portfolio",
    recordId: portfolioId,
    organizationId: current.organization_id,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(archiving ? { reason: body.archiveReason! } : {}),
    changes: diffFields(current as Partial<PortfolioRow>, updated as Partial<PortfolioRow>, [
      ...PORTFOLIO_AUDIT_FIELDS,
    ]),
  });
  return toPortfolio(updated);
}

async function addPortfolioTransformation(tx: Tx, request: FastifyRequest, portfolioId: string) {
  const located = await readablePortfolio(tx, principalOf(request), portfolioId);
  const principal = await requirePortfolioManage(tx, request, located.organization_id);
  const userId = principal.userId!;
  const body = parseBody(portfolioTransformationCreate, request.body);
  return maybeIdempotent(tx, request, userId, body, async () => {
    const portfolio = await readablePortfolio(tx, principal, portfolioId, "share");
    if (portfolio.status !== "active") throw structureRefusals.portfolioArchived();
    // The transformation must be readable by the caller (404 otherwise, never a disclosure of its existence) and of
    // the portfolio's organization; an archived transformation is read-only.
    const target = await requireTransformationRead(tx, principal, body.transformationId);
    if (target.organizationId !== portfolio.organization_id) throw problems.notFound();
    const t = await writableTransformation(tx, body.transformationId);
    const placed = await tx
      .selectFrom("portfolio_transformation")
      .select("id")
      .where("transformation_id", "=", body.transformationId)
      .where("status", "=", "active")
      .executeTakeFirst();
    if (placed) throw structureRefusals.alreadyPlaced();
    const id = uuidv7();
    await tx
      .insertInto("portfolio_transformation")
      .values({
        id,
        organization_id: t.organization_id,
        transformation_id: body.transformationId,
        portfolio_id: portfolioId,
        created_by: userId,
        updated_by: userId,
      })
      .execute();
    await record(tx, auditContextOf(request), {
      action: "portfolio_transformation.create",
      recordType: "portfolio_transformation",
      recordId: id,
      organizationId: t.organization_id,
      transformationId: body.transformationId,
      newVersion: 1,
      changes: {
        portfolio_id: { from: null, to: portfolioId },
        transformation_id: { from: null, to: body.transformationId },
        status: { from: null, to: "active" },
      },
    });
    return { status: 201, body: toPortfolioTransformation((await loadMember(tx, portfolioId, id))!) };
  });
}

async function removePortfolioTransformation(
  tx: Tx,
  request: FastifyRequest,
  portfolioId: string,
  memberId: string,
): Promise<PortfolioTransformation> {
  const located = await readablePortfolio(tx, principalOf(request), portfolioId);
  const principal = await requirePortfolioManage(tx, request, located.organization_id);
  const userId = principal.userId!;
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const portfolio = await readablePortfolio(tx, principal, portfolioId, "share");
  const current = await tx
    .selectFrom("portfolio_transformation")
    .selectAll()
    .where("portfolio_id", "=", portfolioId)
    .where("id", "=", memberId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  // A membership of a transformation the caller may not read is not disclosed (404, as in the list).
  await requireTransformationRead(tx, principal, current.transformation_id);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (portfolio.status !== "active") throw structureRefusals.portfolioArchived();
  if (current.status !== "active") throw structureRefusals.membershipNotActive();
  const updated = await tx
    .updateTable("portfolio_transformation")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: userId,
      remove_reason: body.reason,
      ...bumpStamps(userId),
    })
    .where("id", "=", memberId)
    .where("version", "=", current.version)
    .returning(["id", "version"])
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "portfolio_transformation.remove",
    recordType: "portfolio_transformation",
    recordId: memberId,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "active", to: "removed" } },
  });
  return toPortfolioTransformation((await loadMember(tx, portfolioId, memberId))!);
}

// ------------------------------------------------------------------------------------------------ workstreams

/**
 * Write gate of a workstream mutation: the transformation read gate on the request-start grants first (a caller who
 * never could read the transformation gets 404, never a 403 that discloses it; the access/groups.ts order), then
 * openWrite's commit-time re-authorisation on grants reloaded inside `tx` (a right revoked meanwhile is 403, audited).
 */
async function openWorkstreamWrite(tx: Tx, request: FastifyRequest, transformationId: string): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, WORKSTREAM_RULES, null, { atCommit: true });
}

/** Next WS-nn code of the transformation from record_code_counter (prefix WS, 0055); the UPSERT serializes creates. */
async function nextWorkstreamCode(tx: Tx, transformationId: string): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, 'WS', 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  return `WS-${String(row.rows[0]!.last_value).padStart(2, "0")}`;
}

async function findWorkstream(
  db: DbOrTx,
  transformationId: string,
  workstreamId: string,
  lock: "update" | "share" | null = null,
): Promise<WorkstreamRow> {
  let q = db
    .selectFrom("workstream")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("id", "=", workstreamId);
  if (lock === "update") q = q.forUpdate();
  if (lock === "share") q = q.forShare();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

async function loadAssignment(
  db: DbOrTx,
  workstreamId: string,
  assignmentId: string,
): Promise<AssignmentRow | undefined> {
  return db
    .selectFrom("workstream_initiative as m")
    .innerJoin("initiative as i", "i.id", "m.initiative_id")
    .selectAll("m")
    .select(["i.code as i_code", "i.name as i_name"])
    .where("m.workstream_id", "=", workstreamId)
    .where("m.id", "=", assignmentId)
    .executeTakeFirst();
}

async function createWorkstream(ctx: WriteContext, body: z.infer<typeof workstreamCreate>): Promise<Workstream> {
  const { tx, transformationId, userId } = ctx;
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.leadUserId, pointer: "/leadUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("workstream")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextWorkstreamCode(tx, transformationId),
      name: body.name,
      description: body.description ?? null,
      lead_user_id: body.leadUserId ?? null,
      created_by: userId,
      updated_by: userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "workstream.create",
    recordType: "workstream",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as Partial<WorkstreamRow>, row as Partial<WorkstreamRow>, [...WORKSTREAM_AUDIT_FIELDS]),
  });
  return toWorkstream(row);
}

async function updateWorkstream(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  workstreamId: string,
): Promise<Workstream> {
  const ctx = await openWorkstreamWrite(tx, request, transformationId);
  const body = parseBody(workstreamUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await findWorkstream(tx, transformationId, workstreamId, "update");
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "active") throw structureRefusals.workstreamArchived();
  if (body.leadUserId !== undefined)
    await assertActiveUsers(tx, ctx.organizationId, [{ id: body.leadUserId, pointer: "/leadUserId" }]);
  const archiving = body.status === "archived";
  const updated = await tx
    .updateTable("workstream")
    .set({
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.leadUserId !== undefined ? { lead_user_id: body.leadUserId } : {}),
      ...(archiving
        ? {
            status: "archived",
            archived_at: sql<Date>`now()`,
            archived_by: ctx.userId,
            archive_reason: body.archiveReason!,
          }
        : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", workstreamId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: archiving ? "workstream.archive" : "workstream.update",
    recordType: "workstream",
    recordId: workstreamId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(archiving ? { reason: body.archiveReason! } : {}),
    changes: diffFields(current as Partial<WorkstreamRow>, updated as Partial<WorkstreamRow>, [
      ...WORKSTREAM_AUDIT_FIELDS,
    ]),
  });
  return toWorkstream(updated);
}

async function addWorkstreamInitiative(
  ctx: WriteContext,
  workstreamId: string,
  body: z.infer<typeof workstreamInitiativeCreate>,
): Promise<WorkstreamInitiative> {
  const { tx, transformationId, userId } = ctx;
  const ws = await findWorkstream(tx, transformationId, workstreamId, "share");
  if (ws.status !== "active") throw structureRefusals.workstreamArchived();
  const initiative = await tx
    .selectFrom("initiative")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .where("id", "=", body.initiativeId)
    .executeTakeFirst();
  if (!initiative) throw structureRefusals.reference("/initiativeId", "initiative");
  const assigned = await tx
    .selectFrom("workstream_initiative")
    .select("id")
    .where("initiative_id", "=", body.initiativeId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (assigned) throw structureRefusals.alreadyAssigned();
  const id = uuidv7();
  await tx
    .insertInto("workstream_initiative")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      workstream_id: workstreamId,
      initiative_id: body.initiativeId,
      created_by: userId,
      updated_by: userId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "workstream_initiative.create",
    recordType: "workstream_initiative",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: {
      workstream_id: { from: null, to: workstreamId },
      initiative_id: { from: null, to: body.initiativeId },
      status: { from: null, to: "active" },
    },
  });
  return toWorkstreamInitiative((await loadAssignment(tx, workstreamId, id))!);
}

async function removeWorkstreamInitiative(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  workstreamId: string,
  assignmentId: string,
): Promise<WorkstreamInitiative> {
  const ctx = await openWorkstreamWrite(tx, request, transformationId);
  const body = parseBody(reasonRequest, request.body);
  const expected = requireIfMatch(request);
  const ws = await findWorkstream(tx, transformationId, workstreamId, "share");
  const current = await tx
    .selectFrom("workstream_initiative")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("workstream_id", "=", workstreamId)
    .where("id", "=", assignmentId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (ws.status !== "active") throw structureRefusals.workstreamArchived();
  if (current.status !== "active") throw structureRefusals.membershipNotActive();
  const updated = await tx
    .updateTable("workstream_initiative")
    .set({
      status: "removed",
      removed_at: sql<Date>`now()`,
      removed_by: ctx.userId,
      remove_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", assignmentId)
    .where("version", "=", current.version)
    .returning(["id", "version"])
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "workstream_initiative.remove",
    recordType: "workstream_initiative",
    recordId: assignmentId,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "active", to: "removed" } },
  });
  return toWorkstreamInitiative((await loadAssignment(tx, workstreamId, assignmentId))!);
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerStructureRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const orgRead = { access: { permission: ORG_READ } };
  const tRead = { access: { permission: T_READ } };
  const portfolioWrite = { access: { permission: PORTFOLIO_MANAGE }, consumes: JSON_BODY };
  const workstreamWrite = { access: { permission: WORKSTREAM_MANAGE }, consumes: JSON_BODY };

  // ---- portfolios

  app.get(ORG_PORTFOLIOS, { config: orgRead }, async (request) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const query = parseQuery(archivedQuery, request.query);
    requireOrganizationRead(principalOf(request), organizationId);
    const hash = filterHash({ table: "portfolio", organizationId, includeArchived: query.includeArchived });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("portfolio").selectAll().where("organization_id", "=", organizationId);
    if (!query.includeArchived) q = q.where("status", "=", "active");
    if (after) q = q.where(sql<boolean>`(code, id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("code")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.code, r.id], hash);
    return { items: page.items.map(toPortfolio), nextCursor: page.nextCursor };
  });

  app.post(ORG_PORTFOLIOS, { config: portfolioWrite }, async (request, reply) => {
    const { organizationId } = parse(orgParams, request.params, "params");
    const result = await db.transaction().execute((tx) => createPortfolio(tx, request, organizationId));
    return sendCreated(request, reply, result, "/api/v1/portfolios");
  });

  app.get(PORTFOLIO, { config: orgRead }, async (request, reply) => {
    const { portfolioId } = parse(portfolioParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    return sendVersioned(reply, 200, toPortfolio(await readablePortfolio(db, principalOf(request), portfolioId)));
  });

  app.patch(PORTFOLIO, { config: portfolioWrite }, async (request, reply) => {
    const { portfolioId } = parse(portfolioParams, request.params, "params");
    const body = await db.transaction().execute((tx) => updatePortfolio(tx, request, portfolioId));
    return sendVersioned(reply, 200, body);
  });

  app.get(PORTFOLIO_MEMBERS, { config: orgRead }, async (request) => {
    const { portfolioId } = parse(portfolioParams, request.params, "params");
    const query = parseQuery(removedQuery, request.query);
    const principal = principalOf(request);
    await readablePortfolio(db, principal, portfolioId);
    const hash = filterHash({ table: "portfolio_transformation", portfolioId, includeRemoved: query.includeRemoved });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("portfolio_transformation as m")
      .innerJoin("transformation as t", "t.id", "m.transformation_id")
      .selectAll("m")
      .select(["t.code as t_code", "t.name as t_name"])
      .where("m.portfolio_id", "=", portfolioId)
      // Only the transformations the caller may read are listed (ADR-0038 §9 "Scope").
      .where(readableTransformationSql(principal));
    if (!query.includeRemoved) q = q.where("m.status", "=", "active");
    if (after) q = q.where("m.id", ">", String(after[0]));
    const rows = await q
      .orderBy("m.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toPortfolioTransformation), nextCursor: page.nextCursor };
  });

  app.post(PORTFOLIO_MEMBERS, { config: portfolioWrite }, async (request, reply) => {
    const { portfolioId } = parse(portfolioParams, request.params, "params");
    const result = await db.transaction().execute((tx) => addPortfolioTransformation(tx, request, portfolioId));
    return sendCreated(request, reply, result, `/api/v1/portfolios/${portfolioId}/transformations`);
  });

  app.post(PORTFOLIO_MEMBER_REMOVE, { config: portfolioWrite }, async (request, reply) => {
    const { portfolioId, portfolioTransformationId } = parse(portfolioMemberParams, request.params, "params");
    const body = await db
      .transaction()
      .execute((tx) => removePortfolioTransformation(tx, request, portfolioId, portfolioTransformationId));
    return sendVersioned(reply, 200, body);
  });

  // ---- workstreams

  app.get(WORKSTREAMS, { config: tRead }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(archivedQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ table: "workstream", transformationId, includeArchived: query.includeArchived });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("workstream").selectAll().where("transformation_id", "=", transformationId);
    if (!query.includeArchived) q = q.where("status", "=", "active");
    // Ids are UUIDv7 (creation order), so the list follows the WS-nn order without parsing codes.
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toWorkstream), nextCursor: page.nextCursor };
  });

  app.post(WORKSTREAMS, { config: workstreamWrite }, async (request, reply) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWorkstreamWrite(tx, request, transformationId);
      const body = parseBody(workstreamCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: await createWorkstream(ctx, body),
      }));
    });
    return sendCreated(request, reply, result, `/api/v1/transformations/${transformationId}/workstreams`);
  });

  app.get(WORKSTREAM, { config: tRead }, async (request, reply) => {
    const { transformationId, workstreamId } = parse(workstreamParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, toWorkstream(await findWorkstream(db, transformationId, workstreamId)));
  });

  app.patch(WORKSTREAM, { config: workstreamWrite }, async (request, reply) => {
    const { transformationId, workstreamId } = parse(workstreamParams, request.params, "params");
    const body = await db.transaction().execute((tx) => updateWorkstream(tx, request, transformationId, workstreamId));
    return sendVersioned(reply, 200, body);
  });

  app.get(WORKSTREAM_MEMBERS, { config: tRead }, async (request) => {
    const { transformationId, workstreamId } = parse(workstreamParams, request.params, "params");
    const query = parseQuery(removedQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await findWorkstream(db, transformationId, workstreamId);
    const hash = filterHash({ table: "workstream_initiative", workstreamId, includeRemoved: query.includeRemoved });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("workstream_initiative as m")
      .innerJoin("initiative as i", "i.id", "m.initiative_id")
      .selectAll("m")
      .select(["i.code as i_code", "i.name as i_name"])
      .where("m.transformation_id", "=", transformationId)
      .where("m.workstream_id", "=", workstreamId);
    if (!query.includeRemoved) q = q.where("m.status", "=", "active");
    if (after) q = q.where("m.id", ">", String(after[0]));
    const rows = await q
      .orderBy("m.id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toWorkstreamInitiative), nextCursor: page.nextCursor };
  });

  app.post(WORKSTREAM_MEMBERS, { config: workstreamWrite }, async (request, reply) => {
    const { transformationId, workstreamId } = parse(workstreamParams, request.params, "params");
    const result = await db.transaction().execute(async (tx) => {
      const ctx = await openWorkstreamWrite(tx, request, transformationId);
      const body = parseBody(workstreamInitiativeCreate, request.body);
      return maybeIdempotent(tx, request, ctx.userId, body, async () => ({
        status: 201,
        body: await addWorkstreamInitiative(ctx, workstreamId, body),
      }));
    });
    return sendCreated(
      request,
      reply,
      result,
      `/api/v1/transformations/${transformationId}/workstreams/${workstreamId}/initiatives`,
    );
  });

  app.post(WORKSTREAM_MEMBER_REMOVE, { config: workstreamWrite }, async (request, reply) => {
    const { transformationId, workstreamId, workstreamInitiativeId } = parse(
      workstreamMemberParams,
      request.params,
      "params",
    );
    const body = await db
      .transaction()
      .execute((tx) => removeWorkstreamInitiative(tx, request, transformationId, workstreamId, workstreamInitiativeId));
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${ORG_PORTFOLIOS}`,
    `POST ${ORG_PORTFOLIOS}`,
    `GET ${PORTFOLIO}`,
    `PATCH ${PORTFOLIO}`,
    `GET ${PORTFOLIO_MEMBERS}`,
    `POST ${PORTFOLIO_MEMBERS}`,
    `POST ${PORTFOLIO_MEMBER_REMOVE}`,
    `GET ${WORKSTREAMS}`,
    `POST ${WORKSTREAMS}`,
    `GET ${WORKSTREAM}`,
    `PATCH ${WORKSTREAM}`,
    `GET ${WORKSTREAM_MEMBERS}`,
    `POST ${WORKSTREAM_MEMBERS}`,
    `POST ${WORKSTREAM_MEMBER_REMOVE}`,
  ];
}
