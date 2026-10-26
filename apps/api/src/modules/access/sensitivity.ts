// Record sensitivity flags and explicit sensitive-record grants (slice E; ADR-0051 §2, §6, §7; REQ-S10-002; T-DG6-BE-B):
//   GET  /transformations/{t}/records/{recordType}/{recordId}/sensitivity   getRecordSensitivity
//   PUT  /transformations/{t}/records/{recordType}/{recordId}/sensitivity   putRecordSensitivity   (IfMatchOrZero)
//   GET  /admin/sensitive-grants                                             listSensitiveGrants
//   POST /admin/sensitive-grants                                             createSensitiveGrant
//   GET  /admin/sensitive-grants/{grantId}                                   getSensitiveGrant
//   POST /admin/sensitive-grants/{grantId}/revoke                            revokeSensitiveGrant   (IfMatch)
// and the §2 clause for record views: `sensitiveAdmits`, `requireSensitiveRead` (404 like any unreadable record).
//
// Authorization (ADR-0051 §7; seeded by 0100): mark/unmark, grant and revoke need `sensitive_record.grant` (TO,
// ADM_ACCESS) on the record's transformation; listing and reading grants need `sensitive_record.read` (TO, AUD,
// ADM_ACCESS). Both codes are STRUCTURAL (rules.ts), so an ADM_ACCESS organization-level assignment covers the
// organization's transformations for these two codes only: an access administrator manages grants by record id and
// sees a record title only where the §2 rule lets it read the record (`recordTitleRedacted`). Refusal: 404 when the
// caller cannot see the record (or grant) at all, 403 when it can read it but lacks the permission (ADR-0006).
// Every mutation: validation, If-Match (428/409; IfMatchOrZero "0" creates the flag row), the sensitiveRecordGrant lock
// ("<recordType>:<recordId>", the one the 0098 triggers take), authorization re-checked inside the transaction on
// reloaded grants (commit time; a right revoked meanwhile is 403 and nothing is written), and one audit event with
// prior and new version. No remote I/O. The history `record_sensitivity_change` is written by its trigger only.
// A grant is an access decision, never a business approval (G1-G6); nothing here touches DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import {
  reason as reasonRule,
  sensitiveRecordType,
  uuid,
  type RecordSensitivity,
  type SensitiveGrant,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { authorize, denialOf, resolveTarget, type Principal } from "./policy.ts";
import {
  activeGrantKeys,
  readScopeFor,
  recordKey,
  SENSITIVE_GRANT_PERMISSION,
  SENSITIVE_READ_PERMISSION,
  sensitivityClauseAdmits,
  type SensitiveRecordType,
} from "./read-scope.ts";
import { auditContextOf, commitTimeDenial, principalOf, refreshPrincipal } from "./request.ts";
import type { ResolvedTarget } from "./rules.ts";

const JSON_BODY = ["application/json"] as const;
const READ: Permission = "transformation.read";

// ------------------------------------------------------------------------------------------------ refusals (ADR-0051 §2)

/** The exact refusals of ADR-0051 §2 (codes are i18n keys under `problems.`). */
export const sensitivityRefusals = {
  notSelf: () => problems.businessRule("sensitive_grant.not_self", "You cannot grant access to yourself."),
  granteeNotInOrganization: () =>
    problems.businessRule(
      "sensitive_grant.grantee_not_in_organization",
      "The person you grant access to must be a user of the record's organization.",
    ),
  duplicate: () =>
    problems.duplicate("sensitive_grant.duplicate", "This person already has an active grant for this record."),
  notActive: () => problems.invalidTransition("Only an active grant can be revoked."),
  reasonRequired: () =>
    new HttpProblem({
      status: 422,
      type: "urn:mth:problem:validation",
      code: "sensitivity.reason_required",
      title: "Business rule violated",
      detail: "Give a reason of 3 to 1000 characters.",
      errors: [
        { pointer: "/reason", code: "sensitivity.reason_required", message: "Give a reason of 3 to 1000 characters." },
      ],
    }),
} as const;

/**
 * The reason of a mutation: a JSON string is required by the contract (otherwise 400); a string that fails the shared
 * reason rule (trimmed 3-1000 characters, not blank, no invalid character) is 422 `sensitivity.reason_required`.
 */
function checkedReason(value: string): string {
  const r = reasonRule.safeParse(value);
  if (!r.success) throw sensitivityRefusals.reasonRequired();
  return r.data;
}

// ------------------------------------------------------------------------------------------------ the records

/** A record of a sensitive type with what the §2 clause and the grant response need. */
export interface SensitiveRecordRow {
  readonly recordType: SensitiveRecordType;
  readonly id: string;
  readonly organizationId: string;
  readonly transformationId: string;
  readonly title: string;
  /** The named parties of ADR-0051 §2 for this type. */
  readonly partyUserIds: readonly (string | null)[];
}

/** The named-party columns of each sensitive type (ADR-0051 §2, exactly). */
export const SENSITIVE_RECORD_PARTY_COLUMNS: Readonly<Record<SensitiveRecordType, readonly string[]>> = {
  benefit: ["owner_user_id", "finance_validator_user_id", "created_by"],
  business_case: ["benefit_owner_user_id", "initiative_owner_user_id", "finance_validator_user_id", "created_by"],
  evidence: ["owner_user_id", "created_by"],
};

/** Loads records of one sensitive type by id (any transformation); missing ids are absent from the map. */
export async function loadSensitiveRecords(
  db: DbOrTx,
  recordType: SensitiveRecordType,
  ids: readonly string[],
): Promise<Map<string, SensitiveRecordRow>> {
  const out = new Map<string, SensitiveRecordRow>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  if (recordType === "benefit") {
    const rows = await db
      .selectFrom("benefit")
      .select(["id", "organization_id", "transformation_id", "title", "owner_user_id", "finance_validator_user_id"])
      .select("created_by")
      .where("id", "in", unique)
      .execute();
    for (const r of rows)
      out.set(r.id, {
        recordType,
        id: r.id,
        organizationId: r.organization_id,
        transformationId: r.transformation_id,
        title: r.title,
        partyUserIds: [r.owner_user_id, r.finance_validator_user_id, r.created_by],
      });
  } else if (recordType === "business_case") {
    const rows = await db
      .selectFrom("business_case")
      .select([
        "id",
        "organization_id",
        "transformation_id",
        "title",
        "benefit_owner_user_id",
        "initiative_owner_user_id",
        "finance_validator_user_id",
        "created_by",
      ])
      .where("id", "in", unique)
      .execute();
    for (const r of rows)
      out.set(r.id, {
        recordType,
        id: r.id,
        organizationId: r.organization_id,
        transformationId: r.transformation_id,
        title: r.title,
        partyUserIds: [r.benefit_owner_user_id, r.initiative_owner_user_id, r.finance_validator_user_id, r.created_by],
      });
  } else {
    const rows = await db
      .selectFrom("evidence")
      .select(["id", "organization_id", "transformation_id", "title", "owner_user_id", "created_by"])
      .where("id", "in", unique)
      .execute();
    for (const r of rows)
      out.set(r.id, {
        recordType,
        id: r.id,
        organizationId: r.organization_id,
        transformationId: r.transformation_id,
        title: r.title,
        partyUserIds: [r.owner_user_id, r.created_by],
      });
  }
  return out;
}

/** One record of a sensitive type in the named transformation, or null. */
export async function loadSensitiveRecord(
  db: DbOrTx,
  recordType: SensitiveRecordType,
  recordId: string,
  transformationId: string,
): Promise<SensitiveRecordRow | null> {
  const row = (await loadSensitiveRecords(db, recordType, [recordId])).get(recordId);
  return row && row.transformationId === transformationId ? row : null;
}

/** True when the record is currently marked sensitive (`record_sensitivity.is_sensitive`). */
export async function isMarkedSensitive(
  db: DbOrTx,
  recordType: SensitiveRecordType,
  recordId: string,
): Promise<boolean> {
  const row = await db
    .selectFrom("record_sensitivity")
    .select("is_sensitive")
    .where("record_type", "=", recordType)
    .where("record_id", "=", recordId)
    .executeTakeFirst();
  return row?.is_sensitive === true;
}

/**
 * The §2 sensitivity clause for ONE record (ADR-0051 §2): true when the record is not sensitive, or the principal holds
 * an active grant for it, is one of its named parties, or holds `sensitive_record.grant` at its scope. It does NOT
 * include the ADR-0006 read check: callers run `requireRead`/`requireTransformationRead` first.
 */
export async function sensitiveAdmits(
  db: DbOrTx,
  principal: Principal,
  recordType: SensitiveRecordType,
  recordId: string,
  target: ResolvedTarget,
  partyUserIds: readonly (string | null)[],
): Promise<boolean> {
  principal.tracker.decisions += 1;
  if (!(await isMarkedSensitive(db, recordType, recordId))) return true;
  const granted = await activeGrantKeys(db, principal);
  return sensitivityClauseAdmits(
    principal,
    { granted },
    { recordType, recordId, isSensitive: true, target, partyUserIds },
  );
}

/**
 * The record-view half of the §2 rule (ADR-0051 §1): after the ADR-0006 read check, a sensitive record the principal
 * is not admitted to answers 404 `not_found` (existence not disclosed), with the denial attached for the audit.
 */
export async function requireSensitiveRead(
  db: DbOrTx,
  principal: Principal,
  recordType: SensitiveRecordType,
  recordId: string,
  target: ResolvedTarget,
  partyUserIds: readonly (string | null)[],
): Promise<void> {
  if (await sensitiveAdmits(db, principal, recordType, recordId, target, partyUserIds)) return;
  throw problems.notFound().withDenial({ ...denialOf(READ, target), recordType, recordId });
}

/** True when the principal may read the record itself (ADR-0006 transformation read AND the §2 clause). */
async function canReadRecord(
  db: DbOrTx,
  principal: Principal,
  rec: SensitiveRecordRow,
  target: ResolvedTarget,
): Promise<boolean> {
  if (!(await authorize(db, principal, READ, target)).allowed) return false;
  return sensitiveAdmits(db, principal, rec.recordType, rec.id, target, rec.partyUserIds);
}

/**
 * The management gate (mark/unmark, grant, revoke): `sensitive_record.grant` on the record's transformation. Denied:
 * 403 when the caller can read the record (or its grants), 404 otherwise. The denial is attached for the audit.
 */
async function requireManage(
  db: DbOrTx,
  principal: Principal,
  target: ResolvedTarget,
  rec: SensitiveRecordRow | null,
): Promise<void> {
  if ((await authorize(db, principal, SENSITIVE_GRANT_PERMISSION, target)).allowed) return;
  const denial = denialOf(SENSITIVE_GRANT_PERMISSION, target);
  const visible =
    (rec !== null && (await canReadRecord(db, principal, rec, target))) ||
    (await authorize(db, principal, SENSITIVE_READ_PERMISSION, target)).allowed;
  throw (visible ? problems.forbidden() : problems.notFound()).withDenial(denial);
}

/** Commit time: re-run a gate on the reloaded principal; a right lost since the request started is 403. */
async function atCommit(check: () => Promise<void>): Promise<void> {
  try {
    await check();
  } catch (err) {
    throw commitTimeDenial(err);
  }
}

async function transformationTarget(db: DbOrTx, transformationId: string): Promise<ResolvedTarget> {
  const target = await resolveTarget(db, { type: "transformation", id: transformationId });
  if (!target) throw problems.notFound();
  return target;
}

async function lockRecord(tx: Tx, recordType: SensitiveRecordType, recordId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.sensitiveRecordGrant}::integer, hashtext(${recordKey(recordType, recordId)}::text))`.execute(
    tx,
  );
}

// ------------------------------------------------------------------------------------------------ flags

const recordParams = z.strictObject({ transformationId: uuid, recordType: sensitiveRecordType, recordId: uuid });
const noQuery = z.strictObject({});
/** The contract's body shape; the reason's length and blankness are checked after parsing (422, see checkedReason). */
const flagBody = z.strictObject({ isSensitive: z.boolean(), reason: z.string() });
const grantCreateBody = z.strictObject({
  transformationId: uuid,
  recordType: sensitiveRecordType,
  recordId: uuid,
  granteeUserId: uuid,
  reason: z.string(),
});
const revokeBody = z.strictObject({ reason: z.string() });

async function findFlag(db: DbOrTx, recordType: SensitiveRecordType, recordId: string, lock = false) {
  let q = db
    .selectFrom("record_sensitivity")
    .selectAll()
    .where("record_type", "=", recordType)
    .where("record_id", "=", recordId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}
type FlagRow = NonNullable<Awaited<ReturnType<typeof findFlag>>>;

function toSensitivity(rec: SensitiveRecordRow, flag: FlagRow | undefined, canManage: boolean): RecordSensitivity {
  return {
    transformationId: rec.transformationId,
    recordType: rec.recordType,
    recordId: rec.id,
    isSensitive: flag?.is_sensitive ?? false,
    reason: flag?.reason ?? null,
    version: flag?.version ?? 0,
    updatedAt: flag ? iso(flag.updated_at) : null,
    updatedBy: flag?.updated_by ?? null,
    canManage,
  };
}

/** If-Match of the flag row; `"0"` names "never marked" (the IfMatchOrZero rule). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

// ------------------------------------------------------------------------------------------------ grants

async function findGrant(db: DbOrTx, id: string, lock = false) {
  let q = db
    .selectFrom("sensitive_record_grant as g")
    .leftJoin("app_user as u", "u.id", "g.grantee_user_id")
    .selectAll("g")
    .select("u.display_name as grantee_display_name")
    .where("g.id", "=", id);
  if (lock) q = q.forUpdate("g");
  return q.executeTakeFirst();
}
type GrantRow = NonNullable<Awaited<ReturnType<typeof findGrant>>>;

function toGrant(r: GrantRow, title: string | null): SensitiveGrant {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    recordType: r.record_type as SensitiveRecordType,
    recordId: r.record_id,
    recordTitle: title,
    recordTitleRedacted: title === null,
    granteeUserId: r.grantee_user_id,
    granteeDisplayName: r.grantee_display_name ?? null,
    reason: r.reason,
    status: r.status as SensitiveGrant["status"],
    grantedBy: r.created_by,
    grantedAt: iso(r.created_at),
    revokedAt: isoOrNull(r.revoked_at),
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    version: r.version,
  };
}

/**
 * The record titles the caller may see for a set of grants (ADR-0051 §2 "a grant response shows the record's title
 * only when the caller can read the record"), decided through the ReadScope (ADR-0006 read AND the §2 clause).
 */
async function visibleTitles(
  db: DbOrTx,
  principal: Principal,
  rows: readonly GrantRow[],
): Promise<Map<string, string | null>> {
  const titles = new Map<string, string | null>();
  if (rows.length === 0) return titles;
  const scope = await readScopeFor(db, principal, READ);
  const targets = new Map<string, ResolvedTarget | null>();
  for (const type of ["benefit", "business_case", "evidence"] as const) {
    const ofType = rows.filter((r) => r.record_type === type);
    const records = await loadSensitiveRecords(
      db,
      type,
      ofType.map((r) => r.record_id),
    );
    for (const g of ofType) {
      const rec = records.get(g.record_id);
      if (!rec) {
        titles.set(g.id, null);
        continue;
      }
      if (!targets.has(rec.transformationId))
        targets.set(
          rec.transformationId,
          await resolveTarget(db, { type: "transformation", id: rec.transformationId }),
        );
      const target = targets.get(rec.transformationId) ?? null;
      const ok =
        target !== null && scope.admits({ recordType: type, recordId: rec.id, target, partyUserIds: rec.partyUserIds });
      titles.set(g.id, ok ? rec.title : null);
    }
  }
  return titles;
}

/** The grant, visible to a holder of `sensitive_record.read` on its transformation; 404 otherwise. */
async function visibleGrant(db: DbOrTx, principal: Principal, grantId: string, lock = false) {
  const row = await findGrant(db, grantId, lock);
  principal.tracker.decisions += 1;
  if (!row) throw problems.notFound();
  const target = await transformationTarget(db, row.transformation_id);
  const d = await authorize(db, principal, SENSITIVE_READ_PERMISSION, target);
  if (!d.allowed && !(await authorize(db, principal, SENSITIVE_GRANT_PERMISSION, target)).allowed)
    throw problems.notFound().withDenial(denialOf(SENSITIVE_READ_PERMISSION, target));
  return { row, target };
}

const listQuery = z.strictObject({
  transformationId: uuid,
  recordType: sensitiveRecordType.optional(),
  recordId: uuid.optional(),
  granteeUserId: uuid.optional(),
  status: z.enum(["active", "revoked"]).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const grantParams = z.strictObject({ grantId: uuid });

async function createGrant(tx: Tx, request: FastifyRequest, body: z.infer<typeof grantCreateBody>, reason: string) {
  // The sensitiveRecordGrant lock first, then the commit-time re-authorization on reloaded grants (rule 4, ADR-0051 §6).
  await lockRecord(tx, body.recordType, body.recordId);
  const fresh = await refreshPrincipal(tx, request);
  const me = fresh.userId!;
  const target = await transformationTarget(tx, body.transformationId);
  const rec = await loadSensitiveRecord(tx, body.recordType, body.recordId, body.transformationId);
  await atCommit(() => requireManage(tx, fresh, target, rec));
  if (!rec) throw problems.notFound();
  if (body.granteeUserId === me) throw sensitivityRefusals.notSelf();
  const grantee = await tx
    .selectFrom("app_user")
    .select("id")
    .where("id", "=", body.granteeUserId)
    .where("organization_id", "=", rec.organizationId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (!grantee) throw sensitivityRefusals.granteeNotInOrganization();
  const existing = await tx
    .selectFrom("sensitive_record_grant")
    .select("id")
    .where("record_type", "=", rec.recordType)
    .where("record_id", "=", rec.id)
    .where("grantee_user_id", "=", body.granteeUserId)
    .where("status", "=", "active")
    .executeTakeFirst();
  if (existing) throw sensitivityRefusals.duplicate();
  const id = uuidv7();
  await tx
    .insertInto("sensitive_record_grant")
    .values({
      id,
      organization_id: rec.organizationId,
      transformation_id: rec.transformationId,
      record_type: rec.recordType,
      record_id: rec.id,
      grantee_user_id: body.granteeUserId,
      reason,
      created_by: me,
      updated_by: me,
    })
    .execute();
  await audit(tx, auditContextOf(request), {
    action: "sensitive_record_grant.granted",
    recordType: "sensitive_record_grant",
    recordId: id,
    organizationId: rec.organizationId,
    transformationId: rec.transformationId,
    priorVersion: null,
    newVersion: 1,
    reason,
    changes: {
      record_type: { from: null, to: rec.recordType },
      record_id: { from: null, to: rec.id },
      grantee_user_id: { from: null, to: body.granteeUserId },
      status: { from: null, to: "active" },
    },
  });
  return (await findGrant(tx, id))!;
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerSensitivityRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const FLAG = "/api/v1/transformations/:transformationId/records/:recordType/:recordId/sensitivity";
  const GRANTS = "/api/v1/admin/sensitive-grants";
  const GRANT = `${GRANTS}/:grantId`;
  const REVOKE = `${GRANT}/revoke`;

  // getRecordSensitivity: the record must be readable (ADR-0006 read AND the §2 clause), or the caller reads flags as
  // metadata (sensitive_record.read / .grant on the transformation, ADR-0051 §7); else 404.
  app.get(FLAG, { config: { access: { permission: READ } } }, async (request, reply) => {
    const params = parse(recordParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const target = await transformationTarget(db, params.transformationId);
    const rec = await loadSensitiveRecord(db, params.recordType, params.recordId, params.transformationId);
    const canManage = (await authorize(db, principal, SENSITIVE_GRANT_PERMISSION, target)).allowed;
    const metadata = canManage || (await authorize(db, principal, SENSITIVE_READ_PERMISSION, target)).allowed;
    if (!rec) throw problems.notFound();
    if (!metadata && !(await canReadRecord(db, principal, rec, target)))
      throw problems.notFound().withDenial(denialOf(READ, target));
    const flag = await findFlag(db, rec.recordType, rec.id);
    return sendVersioned(reply, 200, toSensitivity(rec, flag, canManage));
  });

  // putRecordSensitivity: mark or unmark (IfMatchOrZero; "0" creates the flag row).
  app.put(
    FLAG,
    { config: { access: { permission: SENSITIVE_GRANT_PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const params = parse(recordParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const principal = principalOf(request);
      const body = parseBody(flagBody, request.body);
      // Request-start gate (404/403 as ADR-0006), then validation and If-Match, then the commit-time re-check.
      {
        const target = await transformationTarget(db, params.transformationId);
        const rec = await loadSensitiveRecord(db, params.recordType, params.recordId, params.transformationId);
        await requireManage(db, principal, target, rec);
        if (!rec) throw problems.notFound();
      }
      const reason = checkedReason(body.reason);
      const expected = ifMatchOrZero(request);
      const saved = await db.transaction().execute(async (tx) => {
        // Locks first (the sensitiveRecordGrant key and the flag row), then the commit-time re-authorization (rule 4, ADR-0051 §6).
        await lockRecord(tx, params.recordType, params.recordId);
        const current = await findFlag(tx, params.recordType, params.recordId, true);
        const fresh = await refreshPrincipal(tx, request);
        const me = fresh.userId!;
        const target = await transformationTarget(tx, params.transformationId);
        const rec = await loadSensitiveRecord(tx, params.recordType, params.recordId, params.transformationId);
        await atCommit(() => requireManage(tx, fresh, target, rec));
        if (!rec) throw problems.notFound();
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== expected) throw problems.versionConflict(currentVersion);
        const action = body.isSensitive ? "record_sensitivity.marked" : "record_sensitivity.unmarked";
        let row: FlagRow;
        if (!current) {
          row = await tx
            .insertInto("record_sensitivity")
            .values({
              id: uuidv7(),
              organization_id: rec.organizationId,
              transformation_id: rec.transformationId,
              record_type: rec.recordType,
              record_id: rec.id,
              is_sensitive: body.isSensitive,
              reason,
              created_by: me,
              updated_by: me,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } else {
          row = await tx
            .updateTable("record_sensitivity")
            .set({
              is_sensitive: body.isSensitive,
              reason,
              version: sql<number>`version + 1`,
              updated_at: sql<Date>`now()`,
              updated_by: me,
            })
            .where("id", "=", current.id)
            .where("version", "=", current.version)
            .returningAll()
            .executeTakeFirstOrThrow();
        }
        await audit(tx, auditContextOf(request), {
          action,
          recordType: "record_sensitivity",
          recordId: row.id,
          organizationId: rec.organizationId,
          transformationId: rec.transformationId,
          priorVersion: current ? current.version : null,
          newVersion: row.version,
          reason,
          changes: {
            record_type: { from: current ? current.record_type : null, to: rec.recordType },
            record_id: { from: current ? current.record_id : null, to: rec.id },
            is_sensitive: { from: current ? current.is_sensitive : null, to: row.is_sensitive },
            reason: { from: current ? current.reason : null, to: row.reason },
          },
        });
        return toSensitivity(rec, row, true);
      });
      return sendVersioned(reply, 200, saved);
    },
  );

  // listSensitiveGrants: sensitive_record.read on the transformation (403 when the caller reads the transformation but
  // lacks it; 404 otherwise). Newest first.
  app.get(GRANTS, { config: { access: { permission: SENSITIVE_READ_PERMISSION } } }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    const target = await transformationTarget(db, query.transformationId);
    const allowed =
      (await authorize(db, principal, SENSITIVE_READ_PERMISSION, target)).allowed ||
      (await authorize(db, principal, SENSITIVE_GRANT_PERMISSION, target)).allowed;
    if (!allowed) {
      const denial = denialOf(SENSITIVE_READ_PERMISSION, target);
      if ((await authorize(db, principal, READ, target)).allowed) throw problems.forbidden().withDenial(denial);
      throw problems.notFound().withDenial(denial);
    }
    const { cursor, limit, ...filters } = query;
    const hash = filterHash(filters);
    const after = decodeCursor(cursor, hash, 2);
    let q = db
      .selectFrom("sensitive_record_grant as g")
      .leftJoin("app_user as u", "u.id", "g.grantee_user_id")
      .selectAll("g")
      .select("u.display_name as grantee_display_name")
      .select(sql<string>`to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`.as("ck"))
      .where("g.transformation_id", "=", query.transformationId);
    if (query.recordType) q = q.where("g.record_type", "=", query.recordType);
    if (query.recordId) q = q.where("g.record_id", "=", query.recordId);
    if (query.granteeUserId) q = q.where("g.grantee_user_id", "=", query.granteeUserId);
    if (query.status) q = q.where("g.status", "=", query.status);
    if (after)
      q = q.where(
        sql<boolean>`(g.created_at, g.id) < ((${String(after[0])}::timestamp AT TIME ZONE 'UTC'), ${String(after[1])}::uuid)`,
      );
    const rows = await q
      .orderBy("g.created_at", "desc")
      .orderBy("g.id", "desc")
      .limit(limit + 1)
      .execute();
    const page = paginate(rows, limit, (r) => [r.ck, r.id], hash);
    const titles = await visibleTitles(db, principal, page.items);
    return { items: page.items.map((r) => toGrant(r, titles.get(r.id) ?? null)), nextCursor: page.nextCursor };
  });

  // createSensitiveGrant: sensitive_record.grant; 201 with ETag "1".
  app.post(
    GRANTS,
    { config: { access: { permission: SENSITIVE_GRANT_PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      parseQuery(noQuery, request.query);
      const principal = principalOf(request);
      const body = parseBody(grantCreateBody, request.body);
      {
        const target = await transformationTarget(db, body.transformationId);
        const rec = await loadSensitiveRecord(db, body.recordType, body.recordId, body.transformationId);
        await requireManage(db, principal, target, rec);
        if (!rec) throw problems.notFound();
      }
      const reason = checkedReason(body.reason);
      const row = await db.transaction().execute((tx) => createGrant(tx, request, body, reason));
      const titles = await visibleTitles(db, principalOf(request), [row]);
      return sendVersioned(reply, 201, toGrant(row, titles.get(row.id) ?? null), `${GRANTS}/${row.id}`);
    },
  );

  // getSensitiveGrant: sensitive_record.read on the grant's transformation; 404 otherwise.
  app.get(GRANT, { config: { access: { permission: SENSITIVE_READ_PERMISSION } } }, async (request, reply) => {
    const { grantId } = parse(grantParams, request.params, "params");
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const { row } = await visibleGrant(db, principal, grantId);
    const titles = await visibleTitles(db, principal, [row]);
    return sendVersioned(reply, 200, toGrant(row, titles.get(row.id) ?? null));
  });

  // revokeSensitiveGrant: active -> revoked (terminal), If-Match, with a reason.
  app.post(
    REVOKE,
    { config: { access: { permission: SENSITIVE_GRANT_PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { grantId } = parse(grantParams, request.params, "params");
      parseQuery(noQuery, request.query);
      const principal = principalOf(request);
      const body = parseBody(revokeBody, request.body);
      {
        const { target } = await visibleGrant(db, principal, grantId);
        await requireManage(db, principal, target, null);
      }
      const reason = checkedReason(body.reason);
      const expected = requireIfMatch(request);
      const row = await db.transaction().execute(async (tx) => {
        // The grant's record never changes (sensitive_record_grant_immutable), so its lock key is known before the lock.
        const current = await findGrant(tx, grantId);
        if (!current) throw problems.notFound();
        // Locks first (the sensitiveRecordGrant key and the grant row), then the commit-time re-authorization (rule 4, ADR-0051 §6).
        await lockRecord(tx, current.record_type as SensitiveRecordType, current.record_id);
        const locked = (await findGrant(tx, grantId, true))!;
        const fresh = await refreshPrincipal(tx, request);
        const me = fresh.userId!;
        const target = await transformationTarget(tx, locked.transformation_id);
        await atCommit(() => requireManage(tx, fresh, target, null));
        if (locked.version !== expected) throw problems.versionConflict(locked.version);
        if (locked.status !== "active") throw sensitivityRefusals.notActive();
        await tx
          .updateTable("sensitive_record_grant")
          .set({
            status: "revoked",
            revoked_at: sql<Date>`now()`,
            revoked_by: me,
            revoke_reason: reason,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: me,
          })
          .where("id", "=", grantId)
          .where("version", "=", locked.version)
          .executeTakeFirstOrThrow();
        await audit(tx, auditContextOf(request), {
          action: "sensitive_record_grant.revoked",
          recordType: "sensitive_record_grant",
          recordId: grantId,
          organizationId: locked.organization_id,
          transformationId: locked.transformation_id,
          priorVersion: locked.version,
          newVersion: locked.version + 1,
          reason,
          changes: { status: { from: locked.status, to: "revoked" } },
        });
        return (await findGrant(tx, grantId))!;
      });
      const titles = await visibleTitles(db, principalOf(request), [row]);
      return sendVersioned(reply, 200, toGrant(row, titles.get(row.id) ?? null));
    },
  );

  return [`GET ${FLAG}`, `PUT ${FLAG}`, `GET ${GRANTS}`, `POST ${GRANTS}`, `GET ${GRANT}`, `POST ${REVOKE}`];
}
