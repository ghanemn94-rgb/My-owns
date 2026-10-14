// Configuration review policies, "Review where configured" (OpenAPI tag "studio"; ADR-0039 §5, §9, §13; REQ-S06-007,
// REQ-S06-010; p5-work-split §A.4; T-DG5-BE-B3):
//   GET   /admin/config-review-policies                 listConfigReviewPolicies   (methodology.read)
//   PATCH /admin/config-review-policies/{configKind}    updateConfigReviewPolicy   (config_review_policy.configure; TO)
//
// One row per configuration kind (seeded review required, reviewer TO) plus the S12-018 `benefit_formula` routing row
// (reviewer FIN). Only the Transformation Office changes a policy (config_review_policy.configure), so a methodology
// administrator cannot switch off the review of its own changes. The reviewer role is never the auditor or an
// administrator role (422 config_review.reviewer_not_allowed; the 0062 CHECK and trigger refuse the same), and must be
// an existing role. The update: commit-time authorization, Zod validation, If-Match (428/409), one audit event, no
// remote I/O. An update that changes nothing writes nothing and answers the current policy (no version step).
// A review policy routes configuration reviews; it grants no business approval right.
import { sql, type ConfigReviewPolicyTable, type Tx } from "@mth/db";
import {
  CONFIG_REVIEW_POLICY_KINDS,
  configReviewPolicyKind,
  configReviewPolicyUpdate,
  type ConfigReviewPolicy,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { z } from "zod";
import { auditContextOf, principalOf } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { iso, parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { requireStudioPermission, requireStudioWrite, studioRefusals } from "./drafts.ts";

type PolicyRow = Selectable<ConfigReviewPolicyTable>;

const JSON_BODY = ["application/json"] as const;
export const REVIEW_POLICIES = "/api/v1/admin/config-review-policies";
const ONE = `${REVIEW_POLICIES}/:configKind`;

const ORDER = new Map<string, number>(CONFIG_REVIEW_POLICY_KINDS.map((k, i) => [k, i]));

export function toConfigReviewPolicy(r: PolicyRow): ConfigReviewPolicy {
  return {
    configKind: r.config_kind,
    reviewRequired: r.review_required,
    reviewerRoleCode: r.reviewer_role_code,
    version: r.version,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

async function updatePolicy(tx: Tx, request: FastifyRequest, configKind: string): Promise<PolicyRow> {
  const actor = await requireStudioWrite(tx, request, "config_review_policy.configure");
  const body = parseBody(configReviewPolicyUpdate, request.body);
  const expected = requireIfMatch(request);
  const current = await tx
    .selectFrom("config_review_policy")
    .selectAll()
    .where("config_kind", "=", configKind)
    .forUpdate()
    .executeTakeFirst();
  if (current === undefined) throw problems.notFound();
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (body.reviewerRoleCode !== undefined) {
    const role = await tx
      .selectFrom("role")
      .select(["code", "kind"])
      .where("code", "=", body.reviewerRoleCode)
      .executeTakeFirst();
    // The auditor reads only; an administrator role would review its own configuration (ADR-0039 §5, RP01-RP02).
    if (role === undefined || role.code === "AUD" || role.kind === "technical_admin")
      throw studioRefusals.reviewerNotAllowed();
  }
  const reviewRequired = body.reviewRequired ?? current.review_required;
  const reviewerRoleCode = body.reviewerRoleCode ?? current.reviewer_role_code;
  if (reviewRequired === current.review_required && reviewerRoleCode === current.reviewer_role_code) return current;
  const updated = await tx
    .updateTable("config_review_policy")
    .set({
      review_required: reviewRequired,
      reviewer_role_code: reviewerRoleCode,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: actor.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  const changes = new Map<string, { from: unknown; to: unknown }>();
  if (reviewRequired !== current.review_required)
    changes.set("review_required", { from: current.review_required, to: reviewRequired });
  if (reviewerRoleCode !== current.reviewer_role_code)
    changes.set("reviewer_role_code", { from: current.reviewer_role_code, to: reviewerRoleCode });
  await record(tx, auditContextOf(request), {
    action: "config_review_policy.update",
    recordType: "config_review_policy",
    recordId: current.id,
    organizationId: actor.organizationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: Object.fromEntries(changes),
  });
  return updated;
}

export function registerConfigReviewPolicyRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "methodology.read" as const } };
  const configure = { access: { permission: "config_review_policy.configure" as const } };

  app.get(REVIEW_POLICIES, { config: read }, async (request) => {
    requireStudioPermission(principalOf(request), "methodology.read");
    const rows = await db.selectFrom("config_review_policy").selectAll().execute();
    const sorted = [...rows].sort(
      (a, b) =>
        (ORDER.get(a.config_kind) ?? ORDER.size) - (ORDER.get(b.config_kind) ?? ORDER.size) ||
        a.config_kind.localeCompare(b.config_kind),
    );
    return { items: sorted.map(toConfigReviewPolicy) };
  });

  app.patch(ONE, { config: { ...configure, consumes: JSON_BODY } }, async (request, reply) => {
    const { configKind } = parse(z.strictObject({ configKind: configReviewPolicyKind }), request.params, "params");
    const row = await db.transaction().execute((tx) => updatePolicy(tx, request, configKind));
    return sendVersioned(reply, 200, toConfigReviewPolicy(row));
  });

  return [`GET ${REVIEW_POLICIES}`, `PATCH ${ONE}`];
}
