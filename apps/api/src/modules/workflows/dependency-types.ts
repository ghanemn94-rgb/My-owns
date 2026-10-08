// Dependency types (T08 "Type"; ADR-0023 §4; REQ-PB-052; T-DG3-BE-C):
//   GET    /dependency-types          the catalogue: Decision, Tech, Data, Vendor (B0081) and Other are system rows
//   POST   /dependency-types          add a type (dependency_type.configure; ADM_METHOD by default)
//   PATCH  /dependency-types/{code}   relabel or reorder (dependency_type.configure; If-Match)
//   DELETE /dependency-types/{code}   retire a CUSTOM type (soft; kept on existing rows). A system type is 422
//                                     dependency_type.system_undeletable. No row is ever deleted.
//
// The catalogue is global configuration (one deployment = one organization in P3): dependency_type.configure is
// required in the caller's organization, re-checked inside the write transaction on reloaded grants (BE18A).
// Technical admins and auditors do not hold it. The database guard dependency_type_system_guard is the backstop.
import { sql, type DbOrTx, type DependencyTypeTable, type Tx } from "@mth/db";
import {
  dependencyType,
  dependencyTypeCode,
  dependencyTypeList,
  freeText,
  type DependencyType,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  HttpProblem,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
} from "../platform/index.ts";

const JSON_BODY = ["application/json"] as const;
/**
 * Advisory-lock class serialising the creation of one type code (a friendly 409 instead of a unique violation). Its own
 * class `dependencyType` (T-DG3-ARCH-03: it used to share the prioritization class); registry ADVISORY_LOCK_CLASSES,
 * ADR-0016.
 */
export const DEPENDENCY_TYPE_LOCK_CLASS = ADVISORY_LOCK_CLASSES.dependencyType;

const typeCode = dependencyTypeCode;
const label = freeText(1, 100);
const ordinal = z.number().int().min(1).max(999);

// The DependencyType(+List) response mirrors live in `@mth/shared/schemas` (roadmap.ts, T-DG3-ARCH-04), re-exported here.
export { dependencyType, dependencyTypeList, type DependencyType };
export const dependencyTypeCreate = z.strictObject({
  code: typeCode,
  labelEn: label,
  labelAr: label,
  ordinal: ordinal.optional(),
});
export const dependencyTypeUpdate = z
  .strictObject({ labelEn: label.optional(), labelAr: label.optional(), ordinal: ordinal.optional() })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

type TypeRow = Selectable<DependencyTypeTable>;

export const toDependencyType = (r: TypeRow): DependencyType => ({
  id: r.id,
  code: r.code,
  labelEn: r.label_en,
  labelAr: r.label_ar,
  isSystem: r.is_system,
  sourceRef: r.source_ref,
  ordinal: r.ordinal,
  status: r.status as DependencyType["status"],
  version: r.version,
});

const rule = (code: string, detail: string, pointer: string) =>
  new HttpProblem({
    status: 422,
    type: "urn:mth:problem:validation",
    code,
    title: "Business rule violated",
    detail,
    errors: [{ pointer, code, message: detail }],
  });

/**
 * dependency_type.configure in the caller's organization, decided on grants reloaded inside `tx` (commit-time
 * authorisation, BE18A). Denied -> 403 with the denial attached for the failed-mutation audit.
 */
async function requireConfigure(tx: Tx, request: FastifyRequest): Promise<{ userId: string; organizationId: string }> {
  const principal = await refreshPrincipal(tx, request);
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  const allowed =
    org !== null &&
    principal.grants.some((g) => g.permissions.has("dependency_type.configure") && g.organizationId === org);
  if (!allowed || org === null || principal.userId === null) {
    const denied = problems.forbidden();
    throw org === null
      ? denied
      : denied.withDenial(
          denialOf("dependency_type.configure", {
            level: "organization",
            organizationId: org,
            businessUnitId: null,
            transformationId: null,
            businessUnitAncestry: [],
          }),
        );
  }
  return { userId: principal.userId, organizationId: org };
}

const AUDIT_FIELDS = ["code", "label_en", "label_ar", "ordinal", "status"] as const;
function diff(before: Partial<TypeRow>, after: TypeRow) {
  const b = new Map(Object.entries(before));
  const a = new Map(Object.entries(after));
  const changes = new Map<string, { from: unknown; to: unknown }>();
  for (const f of AUDIT_FIELDS) {
    const from = b.get(f) ?? null;
    const to = a.get(f) ?? null;
    if (from !== to) changes.set(f, { from, to });
  }
  return changes.size > 0 ? Object.fromEntries(changes) : null;
}

async function lockType(tx: Tx, code: string): Promise<TypeRow> {
  const row = await tx
    .selectFrom("dependency_type")
    .selectAll()
    .where("code", "=", code)
    .forUpdate()
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ writes

async function createType(tx: Tx, request: FastifyRequest): Promise<TypeRow> {
  principalOf(request);
  const rawCode = new Map(
    Object.entries(request.body !== null && typeof request.body === "object" ? request.body : {}),
  ).get("code");
  if (typeof rawCode === "string")
    await sql`SELECT pg_advisory_xact_lock(${DEPENDENCY_TYPE_LOCK_CLASS}::integer, hashtext(${rawCode}::text))`.execute(
      tx,
    );
  const actor = await requireConfigure(tx, request);
  const body = parseBody(dependencyTypeCreate, request.body);
  const existing = await tx
    .selectFrom("dependency_type")
    .select("status")
    .where("code", "=", body.code)
    .executeTakeFirst();
  if (existing)
    throw problems.duplicate(
      "dependency_type.duplicate_code",
      existing.status === "retired"
        ? "A retired dependency type already uses this code; codes are never reused."
        : "A dependency type with this code already exists.",
    );
  let ord = body.ordinal;
  if (ord === undefined) {
    const max = await tx
      .selectFrom("dependency_type")
      .select((eb) => eb.fn.max("ordinal").as("m"))
      .executeTakeFirst();
    ord = Math.min(999, (max?.m ?? 0) + 1);
  }
  const id = uuidv7();
  const row = await tx
    .insertInto("dependency_type")
    .values({
      id,
      code: body.code,
      label_en: body.labelEn,
      label_ar: body.labelAr,
      is_system: false,
      source_ref: null,
      ordinal: ord,
      created_by: actor.userId,
      updated_by: actor.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "dependency_type.create",
    recordType: "dependency_type",
    recordId: id,
    organizationId: actor.organizationId,
    newVersion: row.version,
    changes: diff({}, row),
  });
  return row;
}

async function updateType(tx: Tx, request: FastifyRequest, code: string): Promise<TypeRow> {
  principalOf(request);
  const current = await lockType(tx, code);
  const actor = await requireConfigure(tx, request);
  const body = parseBody(dependencyTypeUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "retired")
    throw rule("dependency_type.retired", "A retired dependency type cannot be edited.", "/labelEn");
  const updated = await tx
    .updateTable("dependency_type")
    .set({
      ...(body.labelEn !== undefined ? { label_en: body.labelEn } : {}),
      ...(body.labelAr !== undefined ? { label_ar: body.labelAr } : {}),
      ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "dependency_type.update",
    recordType: "dependency_type",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff(current, updated),
  });
  return updated;
}

async function retireType(tx: Tx, request: FastifyRequest, code: string): Promise<TypeRow> {
  principalOf(request);
  const current = await lockType(tx, code);
  const actor = await requireConfigure(tx, request);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.is_system)
    throw rule(
      "dependency_type.system_undeletable",
      `${current.label_en} is a system dependency type and cannot be deleted or retired.`,
      "/dependencyTypeCode",
    );
  if (current.status === "retired")
    throw new HttpProblem({
      status: 422,
      type: "urn:mth:problem:invalid-transition",
      code: "dependency_type.already_retired",
      title: "Invalid transition",
      detail: "This dependency type is already retired.",
    });
  const updated = await tx
    .updateTable("dependency_type")
    .set({
      status: "retired",
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "dependency_type.retire",
    recordType: "dependency_type",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { status: { from: "active", to: "retired" } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const BASE = "/api/v1/dependency-types";
const cParams = z.strictObject({ dependencyTypeCode: typeCode });

/** The catalogue by ordinal, retired types included (they stay on existing rows). */
export function loadDependencyTypes(db: DbOrTx): Promise<TypeRow[]> {
  return db.selectFrom("dependency_type").selectAll().orderBy("ordinal").orderBy("code").execute();
}

/** Registers the dependency-type routes (workflows/index.ts) and returns them as "METHOD /path". */
export function registerDependencyTypeRoutes(app: FastifyInstance, db: DbOrTx): string[] {
  app.get(BASE, { config: { access: { permission: "authenticated" } } }, async (request) => {
    principalOf(request);
    parseQuery(z.strictObject({}), request.query);
    return { items: (await loadDependencyTypes(db)).map(toDependencyType) };
  });

  app.post(
    BASE,
    { config: { access: { permission: "dependency_type.configure" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const row = await db.transaction().execute((tx) => createType(tx, request));
      return sendVersioned(reply, 201, toDependencyType(row), `${BASE}/${row.code}`);
    },
  );

  app.patch(
    `${BASE}/:dependencyTypeCode`,
    { config: { access: { permission: "dependency_type.configure" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { dependencyTypeCode } = parse(cParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateType(tx, request, dependencyTypeCode));
      return sendVersioned(reply, 200, toDependencyType(row));
    },
  );

  app.delete(
    `${BASE}/:dependencyTypeCode`,
    { config: { access: { permission: "dependency_type.configure" } } },
    async (request, reply) => {
      const { dependencyTypeCode } = parse(cParams, request.params, "params");
      const row = await db.transaction().execute((tx) => retireType(tx, request, dependencyTypeCode));
      return sendVersioned(reply, 200, toDependencyType(row));
    },
  );

  return [`GET ${BASE}`, `POST ${BASE}`, `PATCH ${BASE}/:dependencyTypeCode`, `DELETE ${BASE}/:dependencyTypeCode`];
}
