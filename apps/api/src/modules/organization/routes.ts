// Organizations and business units (OpenAPI tags "organizations"). Every mutation: policy check, zod validation,
// If-Match optimistic concurrency (updates), one audit event, all in one transaction.
import { diffFields, sql } from "@mth/db";
import {
  businessUnitCreate,
  businessUnitUpdate,
  organizationCreate,
  organizationUpdate,
  uuid,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import {
  auditContextOf,
  grantCreatorAdminRoles,
  holdsAnywhere,
  organizationsWith,
  principalOf,
  requireAction,
  requireRead,
  scopeFilter,
  targetFor,
} from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
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
  findBusinessUnit,
  findOrganization,
  isDescendant,
  subtreeHeight,
  toBusinessUnit,
  toOrganization,
} from "./repository.ts";

const orgParams = z.strictObject({ organizationId: uuid });
const buParams = z.strictObject({ businessUnitId: uuid });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const buListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["active", "inactive"]).optional(),
});

/** Maximum BU depth below the organization (0 = top-level BU); the closure view covers depth < 10 (data dictionary). */
export const MAX_BU_DEPTH = 9;

const ORG_AUDIT_FIELDS = [
  "name_en",
  "name_ar",
  "default_timezone",
  "default_currency",
  "default_locale",
  "status",
] as const;
const BU_AUDIT_FIELDS = ["name_en", "name_ar", "parent_business_unit_id", "status"] as const;

function uniqueCode(e: unknown, what: string): never {
  const err = e as { code?: string };
  if (err.code === "23505") throw problems.duplicate("duplicate.code", `A ${what} with this code already exists.`);
  throw e;
}

export function registerOrganizationRoutes(app: FastifyInstance, { db, config }: ModuleDeps): void {
  // ---------------------------------------------------------------- organizations
  app.get("/api/v1/organizations", { config: { access: { permission: "organization.read" } } }, async (request) => {
    const principal = principalOf(request);
    const query = parseQuery(pageQuery, request.query);
    const ids = organizationsWith(principal, "organization.read");
    const hash = filterHash({});
    const after = decodeCursor(query.cursor, hash, 2);
    if (ids.length === 0) return { items: [], nextCursor: null };
    let q = db.selectFrom("organization").selectAll().where("id", "in", ids);
    if (after) q = q.where(sql<boolean>`(code, id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("code")
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.code, r.id], hash);
    return { items: page.items.map(toOrganization), nextCursor: page.nextCursor };
  });

  app.post(
    "/api/v1/organizations",
    { config: { access: { permission: "organization.manage" } } },
    async (request, reply) => {
      const principal = principalOf(request);
      const body = parseBody(organizationCreate, request.body);
      if (!holdsAnywhere(principal, "organization.manage")) throw problems.forbidden();
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const id = uuidv7();
        const created = await tx
          .insertInto("organization")
          .values({
            id,
            code: body.code,
            name_en: body.nameEn,
            name_ar: body.nameAr,
            default_timezone: body.defaultTimezone ?? config.defaultTimezone,
            default_currency: body.defaultCurrency ?? config.defaultCurrency,
            default_locale: body.defaultLocale ?? "ar",
            created_by: principal.userId,
            updated_by: principal.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: unknown) => uniqueCode(e, "organization"));
        await record(tx, audit, {
          action: "organization.create",
          recordType: "organization",
          recordId: id,
          organizationId: id,
          newVersion: 1,
          changes: diffFields({} as Record<string, unknown>, created as unknown as Record<string, unknown>, [
            "code",
            ...ORG_AUDIT_FIELDS,
          ]),
        });
        await grantCreatorAdminRoles(tx, principal, audit, id, body.code);
        return created;
      });
      return sendVersioned(reply, 201, toOrganization(row), `/api/v1/organizations/${row.id}`);
    },
  );

  app.get(
    "/api/v1/organizations/:organizationId",
    { config: { access: { permission: "organization.read" } } },
    async (request, reply) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const principal = principalOf(request);
      await requireRead(db, principal, "organization.read", { type: "organization", id: organizationId });
      const row = await findOrganization(db, organizationId);
      if (!row) throw problems.notFound();
      return sendVersioned(reply, 200, toOrganization(row));
    },
  );

  app.patch(
    "/api/v1/organizations/:organizationId",
    { config: { access: { permission: "organization.manage" } } },
    async (request, reply) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const body = parseBody(organizationUpdate, request.body);
      const principal = principalOf(request);
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const target = await requireRead(tx, principal, "organization.read", {
          type: "organization",
          id: organizationId,
        });
        await requireAction(tx, principal, "organization.manage", target);
        const expected = requireIfMatch(request);
        const current = await findOrganization(tx, organizationId, true);
        if (!current) throw problems.notFound();
        if (current.version !== expected) throw problems.versionConflict(current.version);
        const updated = await tx
          .updateTable("organization")
          .set({
            ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
            ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
            ...(body.defaultTimezone !== undefined ? { default_timezone: body.defaultTimezone } : {}),
            ...(body.defaultCurrency !== undefined ? { default_currency: body.defaultCurrency } : {}),
            ...(body.defaultLocale !== undefined ? { default_locale: body.defaultLocale } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: principal.userId,
          })
          .where("id", "=", organizationId)
          .where("version", "=", expected)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "organization.update",
          recordType: "organization",
          recordId: organizationId,
          organizationId,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: diffFields(current, updated, [...ORG_AUDIT_FIELDS]),
        });
        return updated;
      });
      return sendVersioned(reply, 200, toOrganization(row));
    },
  );

  // ---------------------------------------------------------------- business units
  app.get(
    "/api/v1/organizations/:organizationId/business-units",
    { config: { access: { permission: "business_unit.read" } } },
    async (request) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const query = parseQuery(buListQuery, request.query);
      const principal = principalOf(request);
      const org = await findOrganization(db, organizationId);
      // Unknown organization, or one in which the caller holds nothing: 404 (existence not disclosed).
      if (!org || !organizationsWith(principal, "business_unit.read").includes(organizationId))
        throw problems.notFound();
      const hash = filterHash({ organizationId, status: query.status });
      const after = decodeCursor(query.cursor, hash, 2);
      let q = db
        .selectFrom("business_unit as b")
        .selectAll("b")
        .where("b.organization_id", "=", organizationId)
        .where(
          scopeFilter(principal, "business_unit.read", {
            level: "business_unit",
            organizationId: sql.ref("b.organization_id"),
            businessUnitId: sql.ref("b.id"),
          }),
        );
      if (query.status) q = q.where("b.status", "=", query.status);
      if (after) q = q.where(sql<boolean>`(b.code, b.id) > (${String(after[0])}, ${String(after[1])}::uuid)`);
      const rows = await q
        .orderBy("b.code")
        .orderBy("b.id")
        .limit(query.limit + 1)
        .execute();
      const page = paginate(rows, query.limit, (r) => [r.code, r.id], hash);
      return { items: page.items.map(toBusinessUnit), nextCursor: page.nextCursor };
    },
  );

  app.post(
    "/api/v1/organizations/:organizationId/business-units",
    { config: { access: { permission: "business_unit.manage" } } },
    async (request, reply) => {
      const { organizationId } = parse(orgParams, request.params, "params");
      const body = parseBody(businessUnitCreate, request.body);
      const principal = principalOf(request);
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const target = await requireRead(tx, principal, "organization.read", {
          type: "organization",
          id: organizationId,
        });
        await requireAction(tx, principal, "business_unit.manage", target);
        if (body.parentBusinessUnitId !== undefined) {
          const parent = await findBusinessUnit(tx, body.parentBusinessUnitId);
          // createBusinessUnit declares no 422 in the contract, so these rules surface as 400 field errors.
          if (!parent || parent.organization_id !== organizationId) {
            throw problems.badRequest(
              "business_unit.parent_invalid",
              "The parent business unit must exist in the same organization.",
              "/parentBusinessUnitId",
            );
          }
          const parentTarget = await targetFor(tx, "business_unit", { organizationId, businessUnitId: parent.id });
          if (parentTarget.businessUnitAncestry.length > MAX_BU_DEPTH) {
            throw problems.badRequest(
              "business_unit.depth_exceeded",
              `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
              "/parentBusinessUnitId",
            );
          }
        }
        const id = uuidv7();
        const created = await tx
          .insertInto("business_unit")
          .values({
            id,
            organization_id: organizationId,
            parent_business_unit_id: body.parentBusinessUnitId ?? null,
            code: body.code,
            name_en: body.nameEn,
            name_ar: body.nameAr,
            created_by: principal.userId,
            updated_by: principal.userId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()
          .catch((e: unknown) => uniqueCode(e, "business unit"));
        await record(tx, audit, {
          action: "business_unit.create",
          recordType: "business_unit",
          recordId: id,
          organizationId,
          newVersion: 1,
          changes: diffFields({} as Record<string, unknown>, created as unknown as Record<string, unknown>, [
            "code",
            ...BU_AUDIT_FIELDS,
          ]),
        });
        return created;
      });
      return sendVersioned(reply, 201, toBusinessUnit(row), `/api/v1/business-units/${row.id}`);
    },
  );

  app.get(
    "/api/v1/business-units/:businessUnitId",
    { config: { access: { permission: "business_unit.read" } } },
    async (request, reply) => {
      const { businessUnitId } = parse(buParams, request.params, "params");
      const principal = principalOf(request);
      await requireRead(db, principal, "business_unit.read", { type: "business_unit", id: businessUnitId });
      const row = await findBusinessUnit(db, businessUnitId);
      if (!row) throw problems.notFound();
      return sendVersioned(reply, 200, toBusinessUnit(row));
    },
  );

  app.patch(
    "/api/v1/business-units/:businessUnitId",
    { config: { access: { permission: "business_unit.manage" } } },
    async (request, reply) => {
      const { businessUnitId } = parse(buParams, request.params, "params");
      const body = parseBody(businessUnitUpdate, request.body);
      const principal = principalOf(request);
      const audit = auditContextOf(request);
      const row = await db.transaction().execute(async (tx) => {
        const target = await requireRead(tx, principal, "business_unit.read", {
          type: "business_unit",
          id: businessUnitId,
        });
        await requireAction(tx, principal, "business_unit.manage", target);
        const expected = requireIfMatch(request);
        const current = await findBusinessUnit(tx, businessUnitId, true);
        if (!current) throw problems.notFound();
        if (current.version !== expected) throw problems.versionConflict(current.version);
        if (body.parentBusinessUnitId !== undefined && body.parentBusinessUnitId !== current.parent_business_unit_id) {
          const parentId = body.parentBusinessUnitId;
          if (parentId !== null) {
            const parent = await findBusinessUnit(tx, parentId);
            if (!parent || parent.organization_id !== current.organization_id) {
              throw problems.businessRule(
                "business_unit.parent_invalid",
                "The parent business unit must exist in the same organization.",
              );
            }
            if (parentId === businessUnitId || (await isDescendant(tx, businessUnitId, parentId))) {
              throw problems.businessRule(
                "business_unit.cycle",
                "A business unit cannot be moved under itself or one of its descendants.",
              );
            }
            const parentDepth = (
              await targetFor(tx, "business_unit", {
                organizationId: current.organization_id,
                businessUnitId: parentId,
              })
            ).businessUnitAncestry.length;
            if (parentDepth + (await subtreeHeight(tx, businessUnitId)) > MAX_BU_DEPTH) {
              throw problems.businessRule(
                "business_unit.depth_exceeded",
                `Business units can be nested at most ${MAX_BU_DEPTH + 1} levels deep.`,
              );
            }
          }
        }
        const updated = await tx
          .updateTable("business_unit")
          .set({
            ...(body.nameEn !== undefined ? { name_en: body.nameEn } : {}),
            ...(body.nameAr !== undefined ? { name_ar: body.nameAr } : {}),
            ...(body.parentBusinessUnitId !== undefined ? { parent_business_unit_id: body.parentBusinessUnitId } : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: principal.userId,
          })
          .where("id", "=", businessUnitId)
          .where("version", "=", expected)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, audit, {
          action: "business_unit.update",
          recordType: "business_unit",
          recordId: businessUnitId,
          organizationId: current.organization_id,
          priorVersion: current.version,
          newVersion: updated.version,
          changes: diffFields(current, updated, [...BU_AUDIT_FIELDS]),
        });
        return updated;
      });
      return sendVersioned(reply, 200, toBusinessUnit(row));
    },
  );
}
