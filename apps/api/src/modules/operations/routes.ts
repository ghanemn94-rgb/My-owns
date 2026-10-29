// Administration > Operations (P6 slice J; ADR-0053 §2, §6, §9; REQ-S12-019; T-DG6-BE-K). Route file created as a stub
// by T-DG6-BE-A with its registration line; the services are exceptions.ts and heartbeat.ts.
//   GET  /api/v1/admin/operations/exceptions                               listOperationalExceptions       (operations.read)
//   GET  /api/v1/admin/operations/exceptions/{exceptionId}                 getOperationalException         (operations.read)
//   POST /api/v1/admin/operations/exceptions/{exceptionId}/acknowledge     acknowledgeOperationalException (operations.acknowledge)
//   POST /api/v1/admin/operations/exceptions/{exceptionId}/resolve         resolveOperationalException     (operations.acknowledge)
//   GET  /api/v1/admin/operations/heartbeat                                getWorkerHeartbeat              (operations.read)
// AUD reads and gets 403 on both POSTs. Acknowledging or resolving an exception approves nothing (not a business
// approval, G1-G6) and never touches DG0-DG7 or a KPI value.
import { uuid } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authorize, organizationsWith, principalOf } from "../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
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
  acknowledgeException,
  checkedNote,
  EXCEPTION_FAILURE_CLASSES,
  EXCEPTION_SOURCE_KINDS,
  EXCEPTION_STATUSES,
  exceptionDetail,
  listOperationalExceptions,
  OPERATIONS_ACKNOWLEDGE,
  OPERATIONS_READ,
  requireExceptionChange,
  resolveException,
  toOperationalException,
  visibleException,
} from "./exceptions.ts";
import { readWorkerHeartbeat } from "./heartbeat.ts";

const LIST = "/api/v1/admin/operations/exceptions";
const ONE = "/api/v1/admin/operations/exceptions/:exceptionId";
const ACK = "/api/v1/admin/operations/exceptions/:exceptionId/acknowledge";
const RESOLVE = "/api/v1/admin/operations/exceptions/:exceptionId/resolve";
const HEARTBEAT = "/api/v1/admin/operations/heartbeat";
const JSON_BODY = ["application/json"] as const;

const statusList = z
  .union([z.enum(EXCEPTION_STATUSES), z.array(z.enum(EXCEPTION_STATUSES)).min(1).max(3)])
  .transform((v) => (Array.isArray(v) ? [...new Set(v)] : [v]));
const listQuery = z.strictObject({
  organizationId: uuid,
  status: statusList.optional(),
  sourceKind: z.enum(EXCEPTION_SOURCE_KINDS).optional(),
  failureClass: z.enum(EXCEPTION_FAILURE_CLASSES).optional(),
  cursor: cursorSchema,
  limit: limitSchema,
});
const params = z.strictObject({ exceptionId: uuid });
const noQuery = z.strictObject({});
const acknowledgeBody = z.strictObject({ note: z.string().max(1000).nullable() });
const resolveBody = z.strictObject({ note: z.string().max(1000) });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerOperationsRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: OPERATIONS_READ } };
  const write = { access: { permission: OPERATIONS_ACKNOWLEDGE }, consumes: JSON_BODY };

  // listOperationalExceptions: newest occurrence first (cursor over last_occurred_at, id).
  app.get(LIST, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const { cursor, limit, ...filters } = query;
    const hash = filterHash({ ...filters, status: filters.status ? [...filters.status].sort() : undefined });
    const after = decodeCursor(cursor, hash, 2);
    const rows = await listOperationalExceptions(db, principalOf(request), {
      organizationId: query.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.sourceKind ? { sourceKind: query.sourceKind } : {}),
      ...(query.failureClass ? { failureClass: query.failureClass } : {}),
      after: after ? [String(after[0]), String(after[1])] : null,
      limit,
    });
    const page = paginate(rows, limit, (r) => [iso(r.last_occurred_at), r.id], hash);
    return { items: page.items.map((r) => toOperationalException(r, r.linked_kpi_count)), nextCursor: page.nextCursor };
  });

  // getOperationalException: 404 when missing or outside the caller's scope.
  app.get(ONE, { config: read }, async (request, reply) => {
    const { exceptionId } = parse(params, request.params, "params");
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    const row = await visibleException(db, principal, exceptionId);
    return sendVersioned(reply, 200, await exceptionDetail(db, principal, row));
  });

  // acknowledgeOperationalException: 400 body, 404 read gate, 403 acknowledge gate, 422 note, 428, then the
  // transaction (row lock, re-authorization at commit, 409 version, 409 state, the update and its audit event).
  app.post(ACK, { config: write }, async (request, reply) => {
    const { exceptionId } = parse(params, request.params, "params");
    parseQuery(noQuery, request.query);
    const body = parseBody(acknowledgeBody, request.body);
    const principal = principalOf(request);
    await requireExceptionChange(db, principal, exceptionId);
    const note = body.note === null ? null : checkedNote(body.note);
    const expected = requireIfMatch(request);
    const row = await db.transaction().execute((tx) => acknowledgeException(tx, request, exceptionId, expected, note));
    return sendVersioned(reply, 200, await exceptionDetail(db, principalOf(request), row));
  });

  // resolveOperationalException: as acknowledge; the note is required (422 operations.note_required).
  app.post(RESOLVE, { config: write }, async (request, reply) => {
    const { exceptionId } = parse(params, request.params, "params");
    parseQuery(noQuery, request.query);
    const body = parseBody(resolveBody, request.body);
    const principal = principalOf(request);
    await requireExceptionChange(db, principal, exceptionId);
    const note = checkedNote(body.note);
    const expected = requireIfMatch(request);
    const row = await db.transaction().execute((tx) => resolveException(tx, request, exceptionId, expected, note));
    return sendVersioned(reply, 200, await exceptionDetail(db, principalOf(request), row));
  });

  // getWorkerHeartbeat: an organization-level operations.read holder in some organization (platform telemetry).
  app.get(HEARTBEAT, { config: read }, async (request) => {
    parseQuery(noQuery, request.query);
    const principal = principalOf(request);
    let allowed = false;
    for (const organizationId of organizationsWith(principal, OPERATIONS_READ))
      if ((await authorize(db, principal, OPERATIONS_READ, { type: "organization", id: organizationId })).allowed) {
        allowed = true;
        break;
      }
    if (!allowed) throw problems.forbidden();
    return readWorkerHeartbeat(db);
  });

  return [`GET ${LIST}`, `GET ${ONE}`, `POST ${ACK}`, `POST ${RESOLVE}`, `GET ${HEARTBEAT}`];
}
