// Blocker-red escalation, the API side (ADR-0032 §8; REQ-PB-082 "without duplicating an existing open ask"; B0131;
// M0233; T-DG4-BE-G).
//
// The rule itself (a blocker observed red in the forum's latest N cycles gets ONE open T16 ask with a named decision,
// owner and deadline) is evaluated by the worker: the consumer `governance.blocker_escalation` of the
// `blocker_status.recorded` event and the daily `governance.blocker_escalation_scan`
// (apps/worker/src/handlers/escalations.ts `evaluateBlocker`). It lives there, not here as p4-work-split §D.2 lists it,
// because the worker imports no API code (ADR-0002 rule 5; D-102 item 2) and no API operation evaluates the rule: the
// API only records the observation and its outbox event (escalations.ts `recordBlockerStatus`). The pure parts both
// sides need are in @mth/shared/schemas (`redForCycles`, `ESCALATION_RULE_DEFAULTS`).
//
// What the API needs, and the worker mirrors with the same SQL:
//  - the advisory lock class `executiveAskBlocker` (ADR-0016 §6) on '<transformationId>:<blockerRecordType>:<blockerRecordId>', taken by
//    createExecutiveDecision when a person links an ask to a blocker, so a person-raised ask and the job never both
//    create one (the partial unique index decision_one_open_blocker_ask is the second line);
//  - the existence check of the blocker record in the transformation;
//  - the open (or deferred) ask of a blocker, whatever its origin.
// Nothing here decides anything or touches DG0-DG7.
import type { DbOrTx, Tx } from "@mth/db";
import { sql } from "@mth/db";
import type { BlockerRecordType } from "@mth/shared/schemas";
import { ADVISORY_LOCK_CLASSES } from "../platform/index.ts";

/** The lock key of one blocker's executive ask (ADR-0032 §10). */
export const blockerLockKey = (transformationId: string, type: BlockerRecordType, id: string): string =>
  `${transformationId}:${type}:${id}`;

/** pg_advisory_xact_lock(executiveAskBlocker, hashtext('<transformationId>:<type>:<id>')) in `tx`. */
export async function lockBlockerAsk(tx: Tx, transformationId: string, type: BlockerRecordType, id: string) {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.executiveAskBlocker}::integer, hashtext(${blockerLockKey(transformationId, type, id)}::text))`.execute(
    tx,
  );
}

/** The table each blocker record type lives in (the CHECK of blocker_status / decision.blocker_record_type). */
function blockerTable(type: BlockerRecordType) {
  switch (type) {
    case "raid_entry":
      return "raid_entry" as const;
    case "dependency":
      return "dependency" as const;
    case "corrective_case":
      return "corrective_case" as const;
    case "initiative":
      return "initiative" as const;
    case "milestone":
      return "milestone" as const;
  }
}

/** True when the blocker record exists in the transformation. */
export async function blockerExists(
  db: DbOrTx,
  transformationId: string,
  type: BlockerRecordType,
  id: string,
): Promise<boolean> {
  const row = await db
    .selectFrom(blockerTable(type))
    .select("id")
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  return row !== undefined;
}

/** The blocker's open or deferred executive ask, whatever its origin, or null. */
export async function blockerAskOpen(
  db: DbOrTx,
  transformationId: string,
  type: BlockerRecordType,
  id: string,
): Promise<{ id: string; code: string } | null> {
  const row = await db
    .selectFrom("decision")
    .select(["id", "code"])
    .where("transformation_id", "=", transformationId)
    .where("blocker_record_type", "=", type)
    .where("blocker_record_id", "=", id)
    .where("status", "in", ["open", "deferred"])
    .executeTakeFirst();
  return row ?? null;
}
