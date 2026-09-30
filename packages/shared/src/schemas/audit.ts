import { z } from "zod";
import { timestamp, uuid } from "./common.ts";

export const auditEvent = z.strictObject({
  id: uuid,
  seq: z.string().regex(/^[0-9]+$/),
  occurredAt: timestamp,
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
  reason: z.string().nullable(),
  requestId: z.string().nullable(),
  changes: z.record(z.string(), z.strictObject({ from: z.unknown(), to: z.unknown() })).nullable(),
});
export type AuditEvent = z.infer<typeof auditEvent>;
