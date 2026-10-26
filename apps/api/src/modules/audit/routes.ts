// P6 slice F (T-DG6-BE-E; ADR-0052 §8; REQ-S16-032): the global audit API, listAuditEvents and getAuditEvent, the
// read side of Administration > Audit. Audit data is read-only: no write operation exists, and mth_app holds only
// INSERT and SELECT on audit_event, whose trigger refuses UPDATE/DELETE/TRUNCATE for every role (0003; probe AU01–AU03).
//
// audit cannot import access: access depends on audit (ADR-0002 rule 5; modules.ts), so the import would close a
// cycle. The authorization this file needs is passed in by the composition root as AuditRouteAccess (the
// GateFactsProvider pattern; D-197 item 5):
//   - organizationAccess: does the organization exist, and does the caller hold audit_event.read at any scope in it;
//   - readFilter: the caller's audit_event.read boundary (ADR-0006 scopeFilter) over an event's target, so AUD
//     (inherits downward) sees its organizations, units and transformations, and ADM_TECH / ADM_ACCESS
//     (non-inheriting; audit_event.read is not structural) see organization-level events and the transformations they
//     are assigned to;
//   - restrictedRecords: which records are sensitive and not admitted to the caller (ADR-0051 §2); their events are
//     listed with changes and reason null and redacted true. Actor, action, time, record id and versions remain.
import { sql, type DbOrTx } from "@mth/db";
import { auditEventListQuery, uuid, type GlobalAuditEvent } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { parse, parseQuery, problems, type ModuleDeps } from "../platform/index.ts";
import {
  findAuditEvent,
  queryAuditEvents,
  type AuditEventRow,
  type AuditEventTargetColumns,
  type AuditScopePredicate,
} from "./index.ts";

/** "allowed": audit_event.read somewhere in the organization; "forbidden": nowhere; "not_found": no organization. */
export type AuditOrganizationAccess = "allowed" | "forbidden" | "not_found";

/** A record an audit event is about, for the sensitivity redaction. */
export interface AuditRecordRef {
  readonly recordType: string;
  readonly recordId: string;
  readonly transformationId: string | null;
}

/** The key of a record in `restrictedRecords`' answer. */
export function auditRecordKey(ref: { readonly recordType: string; readonly recordId: string }): string {
  return `${ref.recordType}:${ref.recordId}`;
}

/** The access functions the audit routes use, injected by server.ts (each counts as a policy decision). */
export interface AuditRouteAccess {
  organizationAccess(request: FastifyRequest, organizationId: string): Promise<AuditOrganizationAccess>;
  readFilter(request: FastifyRequest, cols: AuditEventTargetColumns): ReturnType<AuditScopePredicate>;
  /** The `auditRecordKey`s of the given records that are sensitive and that the caller is not admitted to. */
  restrictedRecords(request: FastifyRequest, refs: readonly AuditRecordRef[]): Promise<ReadonlySet<string>>;
}

/**
 * The fail-closed redaction used until T-DG6-BE-B's sensitivity clause (ADR-0051 §2 `sensitiveAdmits`) is wired on
 * the server.ts line: every record currently marked sensitive (record_sensitivity.is_sensitive) is treated as not
 * admitted for every caller, so its events are always redacted. It never under-redacts; it over-redacts for the
 * callers ADR-0051 §2 admits (grantees, named parties, sensitive_record.grant holders) until BE-B's clause replaces it.
 */
export function sensitiveRecordsRedactedForEveryone(db: DbOrTx): AuditRouteAccess["restrictedRecords"] {
  return async (_request, refs) => {
    const ids = [...new Set(refs.map((r) => r.recordId))];
    if (ids.length === 0) return new Set();
    const rows = await db
      .selectFrom("record_sensitivity")
      .select(["record_type", "record_id"])
      .where("is_sensitive", "=", true)
      .where("record_id", "=", sql<string>`ANY(${ids}::uuid[])`)
      .execute();
    return new Set(rows.map((r) => auditRecordKey({ recordType: r.record_type, recordId: r.record_id })));
  };
}

const eventParams = z.strictObject({ auditEventId: uuid });

/** Applies the ADR-0051 §2 redaction to rows already inside the caller's audit scope. */
async function redact(
  access: AuditRouteAccess,
  request: FastifyRequest,
  rows: readonly AuditEventRow[],
): Promise<GlobalAuditEvent[]> {
  const restricted = await access.restrictedRecords(request, rows);
  return rows.map((row) =>
    restricted.has(auditRecordKey(row))
      ? { ...row, reason: null, changes: null, redacted: true }
      : { ...row, redacted: false },
  );
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerAuditRoutes(app: FastifyInstance, { db }: ModuleDeps, access: AuditRouteAccess): string[] {
  const read = { access: { permission: "audit_event.read" } } as const;

  app.get("/api/v1/audit-events", { config: read }, async (request) => {
    const query = parseQuery(auditEventListQuery, request.query);
    const allowed = await access.organizationAccess(request, query.organizationId);
    if (allowed === "not_found") throw problems.notFound();
    if (allowed === "forbidden") throw problems.forbidden();
    const page = await queryAuditEvents(db, (cols) => access.readFilter(request, cols), query);
    return { items: await redact(access, request, page.items), nextCursor: page.nextCursor };
  });

  app.get("/api/v1/audit-events/:auditEventId", { config: read }, async (request) => {
    const { auditEventId } = parse(eventParams, request.params, "params");
    const row = await findAuditEvent(db, (cols) => access.readFilter(request, cols), auditEventId);
    // Missing and out of scope are the same 404 (ADR-0006: existence is not disclosed).
    if (row === undefined) throw problems.notFound();
    const [event] = await redact(access, request, [row]);
    return event;
  });

  return ["GET /api/v1/audit-events", "GET /api/v1/audit-events/:auditEventId"];
}
