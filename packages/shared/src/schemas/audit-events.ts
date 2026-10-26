// P6 slice F (T-DG6-BE-E; ADR-0052 §8; REQ-S16-032): zod mirrors of the global audit API (docs/api/openapi.yaml
// 1.5.0-p6: GlobalAuditEvent, GlobalAuditEventPage) and its list query. Audit data is read-only: no request body
// exists. The free-text filters are patterned identifiers (recordType, action), never free text.
import { z } from "zod";
import { cursorQuery, page, timestamp, uuid } from "./common.ts";

export const AUDIT_EVENT_SOURCES = ["api", "worker", "cli", "migration"] as const;

const auditChanges = z.record(z.string(), z.strictObject({ from: z.unknown(), to: z.unknown() })).nullable();

export const globalAuditEvent = z.strictObject({
  id: uuid,
  seq: z.string().regex(/^[0-9]+$/),
  occurredAt: timestamp,
  organizationId: uuid.nullable(),
  action: z.string().regex(/^[a-z_]+\.[a-z_.]+$/),
  recordType: z.string(),
  recordId: uuid,
  transformationId: uuid.nullable(),
  actor: z.strictObject({
    type: z.enum(["user", "service", "system"]),
    userId: uuid.nullable(),
    displayName: z.string().nullable(),
  }),
  onBehalfOfUserId: uuid.nullable(),
  priorVersion: z.number().int().min(1).nullable(),
  newVersion: z.number().int().min(1).nullable(),
  /** null when redacted (ADR-0051 §2). */
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  source: z.enum(AUDIT_EVENT_SOURCES),
  /** null when redacted (ADR-0051 §2) or for a summary without a diff. */
  changes: auditChanges,
  redacted: z.boolean(),
});
export type GlobalAuditEvent = z.infer<typeof globalAuditEvent>;

export const globalAuditEventPage = page(globalAuditEvent);
export type GlobalAuditEventPage = z.infer<typeof globalAuditEventPage>;

/** The listAuditEvents query (organizationId required; every other filter optional; newest first). */
export const auditEventListQuery = z.strictObject({
  organizationId: uuid,
  transformationId: uuid.optional(),
  recordType: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,63}$/)
    .optional(),
  recordId: uuid.optional(),
  actorUserId: uuid.optional(),
  action: z
    .string()
    .max(128)
    .regex(/^[a-z_]+\.[a-z_.]+$/)
    .optional(),
  from: timestamp.optional(),
  to: timestamp.optional(),
  ...cursorQuery.shape,
});
export type AuditEventListQuery = z.infer<typeof auditEventListQuery>;
