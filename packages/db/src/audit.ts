// The single insert path into audit_event (ADR-0004 §5). It takes a transaction handle, so it cannot be called
// outside one: the audit row commits or rolls back together with the mutation it describes.
// The API `audit` module, the worker and the CLI all call this; nothing else inserts into audit_event.
import { v7 as uuidv7 } from "uuid";
import type { Tx } from "./pool.ts";

export type ActorType = "user" | "service" | "system";
export type AuditSource = "api" | "worker" | "cli" | "migration";

export interface AuditActor {
  readonly actorType: ActorType;
  readonly actorUserId: string | null;
  readonly onBehalfOfUserId?: string | null;
  readonly requestId?: string | null;
  readonly source: AuditSource;
}

export type FieldChanges = Readonly<Record<string, { readonly from: unknown; readonly to: unknown }>>;

export interface AuditEventInput {
  readonly action: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly organizationId: string | null;
  readonly transformationId?: string | null;
  readonly priorVersion?: number | null;
  readonly newVersion?: number | null;
  readonly reason?: string | null;
  readonly changes?: FieldChanges | null;
}

/** Field names that must never appear in an audit diff (secrets and session material). */
const FORBIDDEN_FIELDS = /token|secret|password|verifier|nonce|cookie|hash/i;

export async function insertAuditEvent(tx: Tx, actor: AuditActor, event: AuditEventInput): Promise<string> {
  if (actor.actorType === "user" && !actor.actorUserId) throw new Error("audit: user actor needs actorUserId");
  if (event.changes) {
    for (const field of Object.keys(event.changes)) {
      if (FORBIDDEN_FIELDS.test(field)) throw new Error(`audit: field ${field} may not be recorded in an audit diff`);
    }
  }
  const id = uuidv7();
  await tx
    .insertInto("audit_event")
    .values({
      id,
      organization_id: event.organizationId,
      transformation_id: event.transformationId ?? null,
      actor_type: actor.actorType,
      actor_user_id: actor.actorUserId,
      on_behalf_of_user_id: actor.onBehalfOfUserId ?? null,
      action: event.action,
      record_type: event.recordType,
      record_id: event.recordId,
      prior_version: event.priorVersion ?? null,
      new_version: event.newVersion ?? null,
      reason: event.reason ?? null,
      request_id: actor.requestId ?? null,
      source: actor.source,
      changes: event.changes ? JSON.stringify(event.changes) : null,
    })
    .execute();
  return id;
}

/** Field-level diff over an allow-list of fields; only changed fields are included. Null when nothing changed. */
export function diffFields<T extends object>(
  before: T,
  after: T,
  fields: readonly (keyof T & string)[],
): FieldChanges | null {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    const from = normalise(before[f]);
    const to = normalise(after[f]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[f] = { from, to };
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

function normalise(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  return v === undefined ? null : v;
}
