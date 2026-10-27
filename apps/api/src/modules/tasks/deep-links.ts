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
//   A missing (deleted) record is not readable.
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
  resolveTarget,
  SENSITIVE_RECORD_TYPE_LIST,
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
  for (const ref of refs) {
    if (ref.kind === "organization") {
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
        .select(["link_path", "transformation_id", "target_record_type", "target_record_id"])
        .where("link_token", "=", token)
        .executeTakeFirst();
      if (!row) throw problems.notFound();
      const [readable] = await readableTargets(db, principal, [row]);
      if (!readable) throw deepLinkForbidden();
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
