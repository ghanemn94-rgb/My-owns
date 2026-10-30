// P6 slice F (T-DG6-BE-D; ADR-0052 §1; REQ-S13-011 "Allowed types; Max size"; D-195 Q4 "IT-configurable"): the
// organization's upload policy (Administration > Security > Upload policy).
//   GET /api/v1/admin/upload-policy?organizationId=   getUploadPolicy   security.read or upload_policy.configure;
//                                                                       ETag "0" and isDefault=true when no row exists
//   PUT /api/v1/admin/upload-policy?organizationId=   putUploadPolicy   upload_policy.configure (ADM_TECH); IfMatchOrZero;
//                                                                       audit upload_policy.changed
// No row = the built-in default (all ten types, 26214400 bytes); a row can only narrow it (`0099` CHECKs; a type
// outside the set or maxBytes above 26214400 is 400 validation before the database is reached). The history
// `upload_policy_change` is trigger-written (mth_app has SELECT only). The evidence upload reads the same row
// (evidence/content-policy.ts effectiveUploadPolicy; admin may not import evidence, ADR-0002, so the read is repeated
// here over the same table). Every mutation: the request-start gate, validation, If-Match (428/409), the commit-time
// re-check after the row lock, one audit event with prior and new version. Changing a policy approves nothing.
import { sql, type DbOrTx, type UploadPolicyTable } from "@mth/db";
import {
  INLINE_PREVIEW_TYPES,
  UPLOAD_POLICY_MAX_BYTES,
  UPLOAD_TYPES,
  uploadPolicyUpdate,
  uuid,
  type UploadPolicy,
  type UploadType,
} from "@mth/shared/schemas";
import { PROBLEM_TYPES } from "@mth/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record as audit } from "../audit/index.ts";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  principalOf,
  refreshPrincipal,
  requireAction,
  resolveTarget,
  type Principal,
} from "../access/index.ts";
import {
  etag,
  HttpProblem,
  iso,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  type ModuleDeps,
} from "../platform/index.ts";

const PATH = "/api/v1/admin/upload-policy";
const JSON_BODY = ["application/json"];
const orgQuery = z.strictObject({ organizationId: uuid });
type PolicyRow = Selectable<UploadPolicyTable>;

const sorted = (types: readonly string[]): UploadType[] => {
  const set = new Set(types);
  return UPLOAD_TYPES.filter((t) => set.has(t));
};

/** The contract view of a row, or of the default when there is none. */
export function toUploadPolicyView(organizationId: string, row: PolicyRow | undefined): UploadPolicy {
  const allowedTypes = row ? sorted(row.allowed_types) : [...UPLOAD_TYPES];
  return {
    organizationId,
    allowedTypes,
    maxBytes: row ? Number(row.max_bytes) : UPLOAD_POLICY_MAX_BYTES,
    isDefault: row === undefined,
    inlinePreviewTypes: INLINE_PREVIEW_TYPES.filter((t) => allowedTypes.includes(t)),
    reason: row?.reason ?? null,
    version: row?.version ?? 0,
    updatedAt: row ? iso(row.updated_at) : null,
  };
}

async function loadRow(db: DbOrTx, organizationId: string, lock = false): Promise<PolicyRow | undefined> {
  let q = db.selectFrom("upload_policy").selectAll().where("organization_id", "=", organizationId);
  if (lock) q = q.forUpdate();
  return q.executeTakeFirst();
}

/** The organization target: 404 when it does not exist (the contract declares 404). */
async function organizationTarget(db: DbOrTx, principal: Principal, organizationId: string) {
  const target = await resolveTarget(db, { type: "organization", id: organizationId });
  if (!target) {
    principal.tracker.decisions += 1;
    throw problems.notFound();
  }
  return target;
}

/** Reads: `upload_policy.configure` or `security.read` at the organization (403 otherwise). */
async function requireRead(db: DbOrTx, principal: Principal, organizationId: string): Promise<void> {
  const target = await organizationTarget(db, principal, organizationId);
  if ((await authorize(db, principal, "upload_policy.configure", target)).allowed) return;
  await requireAction(db, principal, "security.read", target);
}

async function requireConfigure(db: DbOrTx, principal: Principal, organizationId: string): Promise<void> {
  const target = await organizationTarget(db, principal, organizationId);
  await requireAction(db, principal, "upload_policy.configure", target);
}

/** If-Match of a defaulted record: `"0"` names "no policy row yet" (IfMatchOrZero). */
function ifMatchOrZero(request: FastifyRequest): number {
  return request.headers["if-match"] === '"0"' ? 0 : requireIfMatch(request);
}

function versionConflict(current: PolicyRow | undefined): HttpProblem {
  if (current) return problems.versionConflict(current.version);
  return new HttpProblem({
    status: 409,
    type: PROBLEM_TYPES.versionConflict,
    code: "version_conflict",
    title: "Version conflict",
    detail: "The record was changed by someone else. Review the current version and re-apply your change.",
  });
}

function sendPolicy(reply: FastifyReply, view: UploadPolicy) {
  reply.header("ETag", view.version >= 1 ? etag(view.version) : '"0"');
  return reply.code(200).send(view);
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerUploadPolicyRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  // getUploadPolicy: the effective policy; ETag "0" when no row exists.
  app.get(PATH, { config: { access: { permission: "security.read" } } }, async (request, reply) => {
    const { organizationId } = parseQuery(orgQuery, request.query);
    await requireRead(db, principalOf(request), organizationId);
    return sendPolicy(reply, toUploadPolicyView(organizationId, await loadRow(db, organizationId)));
  });

  // putUploadPolicy: narrow the allow-list and the size limit, with a reason (IfMatchOrZero).
  app.put(
    PATH,
    { config: { access: { permission: "upload_policy.configure" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { organizationId } = parseQuery(orgQuery, request.query);
      // Request-start gate (404/403), then validation and If-Match, then the commit-time re-check.
      await requireConfigure(db, principalOf(request), organizationId);
      const body = parseBody(uploadPolicyUpdate, request.body);
      const expected = ifMatchOrZero(request);
      const allowedTypes = sorted(body.allowedTypes);
      const view = await db.transaction().execute(async (tx) => {
        const current = await loadRow(tx, organizationId, true);
        const fresh = await refreshPrincipal(tx, request);
        try {
          await requireConfigure(tx, fresh, organizationId);
        } catch (err) {
          throw commitTimeDenial(err);
        }
        if ((current?.version ?? 0) !== expected) throw versionConflict(current);
        const me = fresh.userId!;
        const values = { allowed_types: allowedTypes, max_bytes: body.maxBytes, reason: body.reason };
        // A concurrent If-Match "0" create loses on upload_policy_organization_key: 409 version_conflict (db-errors).
        const row = current
          ? await tx
              .updateTable("upload_policy")
              .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: me })
              .where("id", "=", current.id)
              .where("version", "=", current.version)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await tx
              .insertInto("upload_policy")
              .values({ id: uuidv7(), organization_id: organizationId, ...values, created_by: me, updated_by: me })
              .returningAll()
              .executeTakeFirstOrThrow();
        const prior = toUploadPolicyView(organizationId, current);
        const next = toUploadPolicyView(organizationId, row);
        await audit(tx, auditContextOf(request), {
          action: "upload_policy.changed",
          recordType: "upload_policy",
          recordId: row.id,
          organizationId,
          priorVersion: current?.version ?? null,
          newVersion: row.version,
          reason: body.reason,
          changes: {
            allowed_types: { from: current ? prior.allowedTypes : null, to: next.allowedTypes },
            max_bytes: { from: current ? prior.maxBytes : null, to: next.maxBytes },
          },
        });
        return next;
      });
      reply.header("ETag", etag(view.version));
      return reply.code(200).send(view);
    },
  );
  return [`GET ${PATH}`, `PUT ${PATH}`];
}
