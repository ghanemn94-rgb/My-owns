// Configuration transfer adapter of the notification policy (P7 slice D; ADR-0065 §1, §6; T-DG7-BE-F).
//
// One item per organization, itemCode `notification_policy`. Content { nonUrgentWorkingDaysOnly,
// defaultQuietHoursStart, defaultQuietHoursEnd, defaultDigestMode } (the putNotificationPolicy body). No draft stage:
// applied on commit like putNotificationPolicy (notification_policy.configure in the caller's organization, the
// quiet-hours rule, create or version + 1, audit notification_policy.create / .update). An organization with no row
// exports the defaults it is using only when a row exists; nothing is exported for a defaulted organization.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { hhmm, notificationPolicyPut, quietHoursValid } from "@mth/shared/schemas";
import { canonicalBundleJson } from "@mth/shared/transfer";
import type { ConfigBundleKindAdapterPort, PlannedBundleItem, WrittenBundleRecord } from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { auditContextOf, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import { problems } from "../platform/index.ts";
import { notificationRefusals } from "./notification-policy.ts";

// The ConfigBundleKindAdapter port with the API's types (@mth/shared/transfer; this module never imports transfer).
type ConfigBundleKindAdapter = ConfigBundleKindAdapterPort<DbOrTx, Tx, FastifyRequest, Principal>;
type PlannedItem = PlannedBundleItem;
type WrittenRecord = WrittenBundleRecord;

export const NOTIFICATION_POLICY_ITEM = "notification_policy";
const toDbTime = (t: string | null): string | null => (t === null ? null : `${t}:00`);

async function contentOf(db: DbOrTx, organizationId: string) {
  const r = await db
    .selectFrom("notification_policy")
    .selectAll()
    .where("organization_id", "=", organizationId)
    .executeTakeFirst();
  if (r === undefined) return undefined;
  return {
    row: r,
    content: {
      nonUrgentWorkingDaysOnly: r.non_urgent_working_days_only,
      defaultQuietHoursStart: r.default_quiet_hours_start === null ? null : hhmm(r.default_quiet_hours_start),
      defaultQuietHoursEnd: r.default_quiet_hours_end === null ? null : hhmm(r.default_quiet_hours_end),
      defaultDigestMode: r.default_digest_mode,
    },
  };
}

const content = notificationPolicyPut.refine((c) => quietHoursValid(c.defaultQuietHoursStart, c.defaultQuietHoursEnd));

export const notificationPolicyBundleAdapter: ConfigBundleKindAdapter = {
  kind: "notification_policy",
  contentSchema: content,
  permitted: async (_db, principal, organizationId) =>
    principal.organizationId === organizationId &&
    principal.userId !== null &&
    principal.grants.some(
      (g) => g.permissions.has("notification_policy.configure") && g.organizationId === organizationId,
    ),
  async exportPublished(db, organizationId) {
    const c = await contentOf(db, organizationId);
    return c === undefined
      ? []
      : [{ itemCode: NOTIFICATION_POLICY_ITEM, sourceVersionNo: c.row.version, content: c.content }];
  },
  async plan(db, organizationId, item): Promise<PlannedItem> {
    if (item.itemCode !== NOTIFICATION_POLICY_ITEM)
      return { action: "refused", problemCode: "config_bundle.kind_unavailable" };
    const c = await contentOf(db, organizationId);
    if (c === undefined) return { action: "create_draft" };
    return { action: canonicalBundleJson(c.content) === canonicalBundleJson(item.content) ? "identical" : "new_draft" };
  },
  async write(ctx, item): Promise<WrittenRecord> {
    const { tx, request, userId, principal, organizationId } = ctx;
    if (
      principal.organizationId !== organizationId ||
      !principal.grants.some(
        (g) => g.permissions.has("notification_policy.configure") && g.organizationId === organizationId,
      )
    )
      throw problems.forbidden();
    const body = notificationPolicyPut.parse(item.content);
    if (!quietHoursValid(body.defaultQuietHoursStart, body.defaultQuietHoursEnd))
      throw notificationRefusals.quietHoursInvalid();
    const current = await tx
      .selectFrom("notification_policy")
      .selectAll()
      .where("organization_id", "=", organizationId)
      .forUpdate()
      .executeTakeFirst();
    const prior = (await contentOf(tx, organizationId))?.content;
    const values = {
      non_urgent_working_days_only: body.nonUrgentWorkingDaysOnly,
      default_quiet_hours_start: toDbTime(body.defaultQuietHoursStart),
      default_quiet_hours_end: toDbTime(body.defaultQuietHoursEnd),
      default_digest_mode: body.defaultDigestMode,
    };
    const row = current
      ? await tx
          .updateTable("notification_policy")
          .set({ ...values, version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: userId })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto("notification_policy")
          .values({ id: uuidv7(), organization_id: organizationId, ...values, created_by: userId, updated_by: userId })
          .returningAll()
          .executeTakeFirstOrThrow();
    const after = (await contentOf(tx, organizationId))!.content;
    const changes = new Map<string, { from: unknown; to: unknown }>();
    for (const [k, to] of Object.entries(after)) {
      const from = prior === undefined ? null : new Map(Object.entries(prior)).get(k);
      if (from !== to) changes.set(k, { from, to });
    }
    await record(tx, auditContextOf(request), {
      action: current ? "notification_policy.update" : "notification_policy.create",
      recordType: "notification_policy",
      recordId: row.id,
      organizationId,
      priorVersion: current?.version ?? null,
      newVersion: row.version,
      reason: `Configuration bundle import ${ctx.importId}`,
      changes: changes.size > 0 ? Object.fromEntries(changes) : null,
    });
    return { targetRecordType: "notification_policy", targetRecordId: row.id };
  },
};
