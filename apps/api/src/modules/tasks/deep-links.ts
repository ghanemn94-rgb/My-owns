// Notification deep links with re-authorization, and the read-time inbox redaction rule (slice E; ADR-0051 §3;
// REQ-S12-024; T-DG6-BE-C):
//   GET /links/{token}   resolveDeepLink   (session; 404 unknown token; 403 deep_link.forbidden; 200 {linkPath, ...})
//
// - `deepLinkTarget(linkPath)`: a pure function over the known record route patterns of the web app; it recognizes a
//   benefit, business-case or evidence route and returns that record (else null).
// - `issueDeepLink`: the LAZY token issue for a notification that must leave the in-app inbox (a channel send of
//   ADR-0054 calls it; a GET never writes). Under the deepLinkIssue advisory lock (key "<notificationId>", the lock the 0098 trigger
//   inbox_notification_deep_link_guard also takes): one UPDATE that sets `link_token` (32 random bytes, base64url = 43
//   characters) and, when `deepLinkTarget` recognizes the link, `target_record_type`/`target_record_id`; version step and
//   one audit event `inbox_notification.link_issued` with prior and new version. A concurrent second issuer waits on the
//   lock and then reads the token already set (it writes nothing). The seven notification writers are NOT edited.
// - `readableTargets`: may the principal read each notification's target NOW? The target is `target_record_*` when
//   set, else `deepLinkTarget(link_path)` computed at read time, else the item's transformation (`transformation.read`);
//   an item with none of these is organization-level and always readable. A record target is readable iff ADR-0006
//   read on its transformation AND the ADR-0051 §2 sensitivity clause (through `ReadScope.admits`), and, for an evidence
//   item, every benefit or business case it is linked to passes the same clause (ADR-0051 §4; the same link tables as
//   evidence/access.ts - the tasks module may not import evidence, so the deep-link parity test pins the agreement).
//   A missing (deleted) record is not readable. A link to a corrective case or a transition decision (records that carry
//   a benefit's values; `restrictedLinkChildren`, T-DG6-BE-Z4) is not readable when that record is restricted for the
//   reader under the ADR-0051 §2 amendment (sensitive-reach.ts).
// - `restrictedNotifications` (T-DG6-BE-Z13, F-DG6-540; D-218, D-226): the decision every notification response and
//   the resolver use: `readableTargets`, plus any id in the link, params or target that names a sensitive record or a
//   child carrying one's values the reader is not admitted to, plus the announced work item's own restriction.
// - `restrictedNotificationView` (T-DG6-BE-Z14, D-231): the redacted view every notification serializer returns for
//   a restricted notification (inbox list, mark read, digest read).
//
// The token is an opaque identifier, NEVER a credential: holding it grants nothing, every resolution re-authorizes the
// signed-in caller, and being the recipient is neither required nor sufficient. Every forbidden token answers the same
// 403 body (no title, type, id, transformation name or messageParams), so a forwarded link discloses nothing.
// Nothing here reads or writes DG0-DG7; a deep link is navigation, never a business approval.
import { randomBytes } from "node:crypto";
import { sql, type Db, type DbOrTx, type InboxNotificationRow } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import { deepLinkToken, type DeepLinkResolution } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  loadSensitiveRecords,
  principalOf,
  readScopeFor,
  reachKey,
  resolveTarget,
  restrictedIdsAmong,
  restrictedRecordRefs,
  SENSITIVE_RECORD_TYPE_LIST,
  uuidsIn,
  type Principal,
  type ReadScope,
  type ResolvedTarget,
  type SensitiveRecordRow,
  type SensitiveRecordType,
} from "../access/index.ts";
import { record, type AuditContext } from "../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem, parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";

// ------------------------------------------------------------------------------------------------ refusal (ADR-0051 §3)

/** The one 403 of the resolver (ADR-0051 §3; i18n key `problems.deep_link.forbidden`). Never names the record. */
export const deepLinkForbidden = (): HttpProblem =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "deep_link.forbidden",
    title: "Forbidden",
    detail: "You do not have access to this item.",
  });

// ------------------------------------------------------------------------------------------------ targets

/** A record a link path names (ADR-0051 §3). */
export interface DeepLinkTarget {
  readonly recordType: SensitiveRecordType;
  readonly recordId: string;
  /** The transformation the path names; the record must be in it. */
  readonly transformationId: string;
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** The web routes of the three record types (apps/web/src/app/router.tsx), a sub-path, query or fragment allowed. */
const ROUTES: readonly (readonly [SensitiveRecordType, RegExp])[] = [
  ["benefit", new RegExp(`^/transformations/(${UUID})/benefits/(${UUID})(?:[/?#]|$)`)],
  ["business_case", new RegExp(`^/transformations/(${UUID})/business-cases/(${UUID})(?:[/?#]|$)`)],
  ["evidence", new RegExp(`^/transformations/(${UUID})/evidence/(${UUID})(?:[/?#]|$)`)],
];

/** The benefit, business case or evidence item a link path names, or null (a pure function; ADR-0051 §3). */
export function deepLinkTarget(linkPath: string): DeepLinkTarget | null {
  for (const [recordType, pattern] of ROUTES) {
    const m = pattern.exec(linkPath);
    if (m) return { recordType, recordId: m[2]!.toLowerCase(), transformationId: m[1]!.toLowerCase() };
  }
  return null;
}

/**
 * The web routes of the records that carry a sensitive benefit's values and have their own page (T-DG6-BE-Z4,
 * F-DG6-220; ADR-0051 §2 amendment): a corrective case and a transition decision. A notification or work item whose
 * link names one is readable only when that record is not restricted for the reader (`restrictedRecordRefs`).
 */
const CHILD_ROUTES: readonly (readonly [string, RegExp])[] = [
  ["corrective_case", new RegExp(`^/transformations/(${UUID})/corrective-actions/(${UUID})(?:[/?#]|$)`)],
  ["transition_decision", new RegExp(`^/transformations/(${UUID})/transition-decisions/(${UUID})(?:[/?#]|$)`)],
];

/** The sensitive-value child record a link path names (a corrective case or transition decision), or null. */
export function deepLinkChild(linkPath: string): { recordType: string; recordId: string } | null {
  for (const [recordType, pattern] of CHILD_ROUTES) {
    const m = pattern.exec(linkPath);
    if (m) return { recordType, recordId: m[2]!.toLowerCase() };
  }
  return null;
}

/**
 * For each link path: true when it names a corrective case or transition decision that discloses a sensitive record
 * the principal is not admitted to (ADR-0051 §2; T-DG6-BE-Z4, F-DG6-220). One reach decision for the batch; a path
 * naming no such record is false. Used by the work-item reads and My Work to redact their text.
 */
export async function restrictedLinkChildren(
  db: DbOrTx,
  principal: Principal,
  linkPaths: readonly string[],
): Promise<boolean[]> {
  const children = linkPaths.map(deepLinkChild);
  const refs = children.filter((c): c is NonNullable<typeof c> => c !== null);
  if (refs.length === 0) return linkPaths.map(() => false);
  const restricted = await restrictedRecordRefs(db, principal, refs);
  return children.map((c) => c !== null && restricted.has(reachKey(c)));
}

/** The columns of a work item that can name a record (its subject and its stored link). */
export interface WorkItemRefs {
  readonly subjectType: string;
  readonly subjectId: string;
  readonly linkPath: string;
}

/**
 * T-DG6-BE-Z13B (D-227 (3); D-218, D-222 (1)): the corrective case each action among `ids` belongs to (`actionId ->
 * caseId`). The action register keeps an action on a restricted corrective case (correctiveCaseId null + marker), but a
 * task or a notification about that action (its subject or its `/action-register/<actionId>` link, and the case code it
 * carries as `sourceCode`) is about the case, so the reach check treats the action id as naming its case.
 */
export async function correctiveCasesOfActions(db: DbOrTx, ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].map((x) => x.toLowerCase()))].filter((x) => UUID_ONLY.test(x));
  if (unique.length === 0) return new Map();
  const rows = await sql<{ id: string; corrective_case_id: string }>`
    SELECT id::text AS id, corrective_case_id::text AS corrective_case_id FROM action_item
     WHERE id = ANY(${unique}::uuid[]) AND corrective_case_id IS NOT NULL`.execute(db);
  return new Map(rows.rows.map((r) => [r.id.toLowerCase(), r.corrective_case_id.toLowerCase()]));
}

/**
 * T-DG6-BE-Z12B (F-DG6-480; D-218, D-222; ADR-0051 §2): for each work item, true when its subject, or the record its
 * stored link names (a benefit, business case or evidence route, or a corrective case or transition decision route),
 * discloses a sensitive record the principal is not admitted to, assignee included (D-222 supersedes BE-Z4's kept
 * ids). Such an item is shown as `restrictedWorkItemView` describes. One reach decision for the batch.
 */
export async function restrictedWorkItems(
  db: DbOrTx,
  principal: Principal,
  items: readonly WorkItemRefs[],
): Promise<boolean[]> {
  const refsOf = (w: WorkItemRefs): { recordType: string; recordId: string }[] => {
    const out: { recordType: string; recordId: string }[] = [];
    if (UUID_ONLY.test(w.subjectId)) out.push({ recordType: w.subjectType, recordId: w.subjectId.toLowerCase() });
    const child = deepLinkChild(w.linkPath);
    if (child !== null) out.push(child);
    const target = deepLinkTarget(w.linkPath);
    if (target !== null) out.push({ recordType: target.recordType, recordId: target.recordId });
    return out;
  };
  // T-DG6-BE-Z13B (D-227 (3)): an action (the item's subject, or an id in its link) on a corrective case names the case.
  const cases = await correctiveCasesOfActions(
    db,
    items.flatMap((w) => [w.subjectId, ...uuidsIn(w.linkPath)]),
  );
  const perItem = items.map((w) => {
    const refs = refsOf(w);
    for (const id of new Set([w.subjectId.toLowerCase(), ...uuidsIn(w.linkPath)])) {
      const caseId = cases.get(id);
      if (caseId !== undefined) refs.push({ recordType: "corrective_case", recordId: caseId });
    }
    return refs;
  });
  const all = perItem.flat();
  // T-DG6-BE-Z13 (F-DG6-540): any id in the link that names a sensitive record or a child carrying one's values (a
  // Finance validation, an overlap, ...), whatever route it uses, restricts the item too.
  const linkIds = items.map((w) => uuidsIn(w.linkPath));
  const hidden = await restrictedIdsAmong(
    db,
    principal,
    linkIds.flatMap((ids) => [...ids]),
  );
  const restricted = all.length === 0 ? new Set<string>() : await restrictedRecordRefs(db, principal, all);
  if (restricted.size === 0 && hidden.size === 0) return items.map(() => false);
  return perItem.map(
    (refs, i) => refs.some((r) => restricted.has(reachKey(r))) || [...linkIds.at(i)!].some((id) => hidden.has(id)),
  );
}

const UUID_ONLY = new RegExp(`^${UUID}$`);

/** The web path a restricted work item links to instead of its record: the transformation home (else My Work). */
export const restrictedWorkItemLink = (transformationId: string | null): string =>
  transformationId === null ? "/my-work" : `/transformations/${transformationId}`;

/**
 * T-DG6-BE-Z14 (D-226, D-231; code-security observation 600; ADR-0051 §3): the one redaction every response that
 * serializes a notification applies (`listMyInbox`, `markInboxNotificationRead`, `getMyNotificationDigest`; the
 * serializer sweep test `notification-serializers.test.ts` fails when a new serializer skips it). For a notification
 * `restrictedNotifications` marks: the text is `inbox.restricted` with params {}, the link is the transformation home
 * (else My Work) and the item carries `includesRestrictedRecords: true`. Every other field is kept; the stored row is
 * never modified (access restored = text and link restored).
 */
export function restrictedNotificationView<T extends { messageKey: string; messageParams: object; linkPath: string }>(
  view: T,
  transformationId: string | null,
  restricted: boolean,
): T {
  if (!restricted) return view;
  return {
    ...view,
    messageKey: "inbox.restricted",
    messageParams: {},
    linkPath: restrictedWorkItemLink(transformationId),
    includesRestrictedRecords: true,
  };
}

/** The columns of a notification that can name a record (T-DG6-BE-Z13). */
export type NotificationRefColumns = Pick<
  InboxNotificationRow,
  "link_path" | "transformation_id" | "target_record_type" | "target_record_id" | "work_item_id" | "message_params"
>;

/**
 * T-DG6-BE-Z13 (F-DG6-540; D-218, D-222 (1), D-226; ADR-0051 §2, §3): for each notification, true when the recipient
 * may not see what it is about, so every response that serializes it (`listMyInbox`, `markInboxNotificationRead`)
 * shows `restrictedNotificationView`. Restricted when ANY of these holds (one reach decision per kind for the batch):
 *   - its target is not readable now (`readableTargets`: the stored or recognized benefit, business case or evidence,
 *     a restricted corrective case or transition decision route, or the transformation);
 *   - its link, its message parameters or its stored target name the id of a sensitive record or of ANY child that
 *     carries one's values (every SENSITIVE_CHILD_SOURCES type: a Finance validation, a benefit overlap, a measurement,
 *     ...) the recipient is not admitted to (`restrictedIdsAmong`), whatever route the link uses;
 *   - the work item it announces is restricted for the recipient (`restrictedWorkItems`: its subject or its link), so
 *     the inbox and My Work agree on the same event.
 */
export async function restrictedNotifications(
  db: DbOrTx,
  principal: Principal,
  rows: readonly NotificationRefColumns[],
): Promise<boolean[]> {
  if (rows.length === 0) return [];
  const readable = await readableTargets(db, principal, rows);
  const idsOf = rows.map((r) => uuidsIn([r.link_path, r.message_params, r.target_record_id]));
  // T-DG6-BE-Z13B (D-227 (3)): an action on a corrective case named by the notification names the case too.
  const cases = await correctiveCasesOfActions(
    db,
    idsOf.flatMap((ids) => [...ids]),
  );
  for (const ids of idsOf)
    for (const id of [...ids]) {
      const caseId = cases.get(id);
      if (caseId !== undefined) ids.add(caseId);
    }
  const hidden = await restrictedIdsAmong(
    db,
    principal,
    idsOf.flatMap((ids) => [...ids]),
  );
  const itemIds = [...new Set(rows.flatMap((r) => (r.work_item_id === null ? [] : [r.work_item_id])))];
  const items =
    itemIds.length === 0
      ? []
      : await db
          .selectFrom("work_item")
          .select(["id", "subject_type", "subject_id", "link_path"])
          .where("id", "in", itemIds)
          .execute();
  const itemRestricted = await restrictedWorkItems(
    db,
    principal,
    items.map((w) => ({ subjectType: w.subject_type, subjectId: w.subject_id, linkPath: w.link_path })),
  );
  const restrictedItems = new Set(items.filter((_, i) => itemRestricted.at(i) === true).map((w) => w.id));
  return rows.map(
    (r, i) =>
      readable.at(i) !== true ||
      [...idsOf.at(i)!].some((id) => hidden.has(id)) ||
      (r.work_item_id !== null && restrictedItems.has(r.work_item_id)),
  );
}

/** What a notification points to, for the read check. */
type TargetRef =
  | {
      readonly kind: "record";
      readonly recordType: SensitiveRecordType;
      readonly recordId: string;
      readonly transformationId: string | null;
    }
  | { readonly kind: "transformation"; readonly transformationId: string }
  | { readonly kind: "organization" };

const SENSITIVE_TYPES: ReadonlySet<string> = new Set(SENSITIVE_RECORD_TYPE_LIST);

type TargetColumns = Pick<
  InboxNotificationRow,
  "link_path" | "transformation_id" | "target_record_type" | "target_record_id"
>;

/** The target of a notification (ADR-0051 §3): stored target, else the recognized path, else its transformation. */
export function targetRefOf(row: TargetColumns): TargetRef {
  if (row.target_record_type !== null && row.target_record_id !== null && SENSITIVE_TYPES.has(row.target_record_type))
    return {
      kind: "record",
      recordType: row.target_record_type as SensitiveRecordType,
      recordId: row.target_record_id,
      transformationId: row.transformation_id,
    };
  const fromPath = deepLinkTarget(row.link_path);
  if (fromPath) return { kind: "record", ...fromPath };
  if (row.transformation_id !== null) return { kind: "transformation", transformationId: row.transformation_id };
  return { kind: "organization" };
}

/**
 * The benefits and business cases each evidence item is linked to (ADR-0051 §4): every row of the type-specific link
 * tables that names the item - `benefit_evidence` (0038) and `form_record_attachment` (0068) whose form record type is
 * stored in `benefit` or `business_case` (T14, business_case). The polymorphic `evidence_link` (0012) cannot name either
 * type. Every row counts, including a removed attachment (fail closed). Same enumeration as evidence/access.ts.
 */
export async function evidenceParentRefs(
  db: DbOrTx,
  evidenceIds: readonly string[],
): Promise<Map<string, { recordType: SensitiveRecordType; recordId: string }[]>> {
  const out = new Map<string, { recordType: SensitiveRecordType; recordId: string }[]>();
  if (evidenceIds.length === 0) return out;
  const ids = [...new Set(evidenceIds)];
  const rows = await sql<{ evidence_id: string; record_type: SensitiveRecordType; record_id: string }>`
    SELECT be.evidence_id, 'benefit' AS record_type, be.benefit_id AS record_id
      FROM benefit_evidence be WHERE be.evidence_id = ANY(${ids}::uuid[])
    UNION
    SELECT fa.evidence_id, frt.table_name AS record_type, fa.record_id
      FROM form_record_attachment fa JOIN form_record_type frt ON frt.code = fa.record_type
     WHERE fa.evidence_id = ANY(${ids}::uuid[]) AND frt.table_name IN ('benefit', 'business_case')`.execute(db);
  for (const r of rows.rows) {
    const list = out.get(r.evidence_id) ?? [];
    list.push({ recordType: r.record_type, recordId: r.record_id });
    out.set(r.evidence_id, list);
  }
  return out;
}

/**
 * May `principal` read each row's target now (ADR-0051 §3, §4)? One ReadScope, one record load per type and one
 * transformation resolution per id for the whole batch; nothing is written.
 */
export async function readableTargets(
  db: DbOrTx,
  principal: Principal,
  rows: readonly TargetColumns[],
): Promise<boolean[]> {
  const refs = rows.map(targetRefOf);
  if (refs.every((r) => r.kind === "organization")) return refs.map(() => true);
  // T-DG6-BE-Z4 (F-DG6-220): a link to a restricted corrective case or transition decision is not readable.
  const restrictedChild = await restrictedLinkChildren(
    db,
    principal,
    rows.map((r) => r.link_path),
  );
  const scope = await readScopeFor(db, principal, "transformation.read");
  // Records of each type, then the evidence items' parents.
  const records = new Map<SensitiveRecordType, Map<string, SensitiveRecordRow>>();
  for (const type of SENSITIVE_RECORD_TYPE_LIST) {
    const ids = refs.flatMap((r) => (r.kind === "record" && r.recordType === type ? [r.recordId] : []));
    records.set(type, await loadSensitiveRecords(db, type, ids));
  }
  const parents = await evidenceParentRefs(db, [...records.get("evidence")!.keys()]);
  for (const type of ["benefit", "business_case"] as const) {
    const missing = [...parents.values()]
      .flat()
      .filter((p) => p.recordType === type && !records.get(type)!.has(p.recordId))
      .map((p) => p.recordId);
    for (const [id, rec] of await loadSensitiveRecords(db, type, missing)) records.get(type)!.set(id, rec);
  }
  const targets = new Map<string, ResolvedTarget | null>();
  const transformationTarget = async (id: string): Promise<ResolvedTarget | null> => {
    if (!targets.has(id)) targets.set(id, await resolveTarget(db, { type: "transformation", id }));
    return targets.get(id)!;
  };
  const admitsRecord = async (scopeOf: ReadScope, rec: SensitiveRecordRow | undefined): Promise<boolean> => {
    if (!rec) return false;
    const target = await transformationTarget(rec.transformationId);
    if (!target) return false;
    return scopeOf.admits({ recordType: rec.recordType, recordId: rec.id, target, partyUserIds: rec.partyUserIds });
  };
  const out: boolean[] = [];
  for (const [i, ref] of refs.entries()) {
    if (restrictedChild.at(i) === true) {
      out.push(false);
    } else if (ref.kind === "organization") {
      out.push(true);
    } else if (ref.kind === "transformation") {
      const target = await transformationTarget(ref.transformationId);
      out.push(
        target !== null && scope.admits({ recordType: null, recordId: ref.transformationId, target, partyUserIds: [] }),
      );
    } else {
      const rec = records.get(ref.recordType)!.get(ref.recordId);
      let ok =
        rec !== undefined &&
        (ref.transformationId === null || rec.transformationId === ref.transformationId) &&
        (await admitsRecord(scope, rec));
      if (ok && ref.recordType === "evidence")
        for (const p of parents.get(ref.recordId) ?? [])
          if (!(await admitsRecord(scope, records.get(p.recordType)!.get(p.recordId)))) {
            ok = false;
            break;
          }
      out.push(ok);
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ lazy issue

/** The result of a lazy issue: the token, and whether this call set it. */
export interface IssuedDeepLink {
  readonly token: string;
  readonly issued: boolean;
}

/**
 * Issues the notification's deep-link token once (ADR-0051 §3), in its own transaction: the deepLinkIssue lock, the row lock,
 * then either the token already set (nothing written) or one UPDATE (token and recognized target; version step) and one
 * audit event `inbox_notification.link_issued` with prior and new version. No remote I/O. 404 for an unknown id.
 * Called by the channel fan-out (ADR-0054) before a link leaves the in-app inbox; never by a GET.
 */
export async function issueDeepLink(db: Db, notificationId: string, ctx: AuditContext): Promise<IssuedDeepLink> {
  return db.transaction().execute(async (tx) => {
    await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.deepLinkIssue}::integer, hashtext(${notificationId}::text))`.execute(
      tx,
    );
    const current = await tx
      .selectFrom("inbox_notification")
      .selectAll()
      .where("id", "=", notificationId)
      .forUpdate()
      .executeTakeFirst();
    if (!current) throw problems.notFound();
    if (current.link_token !== null) return { token: current.link_token, issued: false };
    const token = randomBytes(32).toString("base64url");
    const target = current.target_record_type === null ? deepLinkTarget(current.link_path) : null;
    const updated = await tx
      .updateTable("inbox_notification")
      .set({
        link_token: token,
        ...(target ? { target_record_type: target.recordType, target_record_id: target.recordId } : {}),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.actorUserId,
      })
      .where("id", "=", notificationId)
      .where("version", "=", current.version)
      .returning(["version"])
      .executeTakeFirstOrThrow();
    await record(tx, ctx, {
      action: "inbox_notification.link_issued",
      recordType: "inbox_notification",
      recordId: notificationId,
      organizationId: current.organization_id,
      transformationId: current.transformation_id,
      priorVersion: current.version,
      newVersion: updated.version,
      // The token is an identifier, not a secret, but it is not repeated in the audit trail; only the target is.
      changes: target
        ? { link_issued: { from: false, to: true }, target_record_type: { from: null, to: target.recordType } }
        : { link_issued: { from: false, to: true } },
    });
    return { token, issued: true };
  });
}

// ------------------------------------------------------------------------------------------------ the resolver route

const tokenParams = z.strictObject({ token: deepLinkToken });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerDeepLinkRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const LINK = "/api/v1/links/:token";
  app.get(
    LINK,
    { config: { access: { permission: "authenticated" } } },
    async (request): Promise<DeepLinkResolution> => {
      const principal = principalOf(request);
      if (principal.userId === null) throw problems.unauthenticated();
      const { token } = parse(tokenParams, request.params, "params");
      parseQuery(z.strictObject({}), request.query);
      const row = await db
        .selectFrom("inbox_notification")
        .select([
          "link_path",
          "transformation_id",
          "target_record_type",
          "target_record_id",
          "work_item_id",
          "message_params",
        ])
        .where("link_token", "=", token)
        .executeTakeFirst();
      if (!row) throw problems.notFound();
      // T-DG6-BE-Z13 (D-226): the same decision as the inbox, so a child route (a Finance validation, an overlap) of a
      // restricted record is refused too.
      const [restricted] = await restrictedNotifications(db, principal, [row]);
      if (restricted === true) throw deepLinkForbidden();
      const ref = targetRefOf(row);
      return {
        linkPath: row.link_path,
        recordType: ref.kind === "record" ? ref.recordType : null,
        recordId: ref.kind === "record" ? ref.recordId : null,
      };
    },
  );
  return [`GET ${LINK}`];
}
