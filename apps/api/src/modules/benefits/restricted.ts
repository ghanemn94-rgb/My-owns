// Sensitive records on the DG4/DG5 benefit reads and rollups (slice E; ADR-0051 §1, §2; REQ-S10-002, REQ-S10-004;
// p6-work-split §E/F.3; T-DG6-BE-B2).
//
//  - Record views and lists use the access module's `requireSensitiveRead` and `readScopeFor(...).predicate`.
//  - Aggregates (D-195 Q3) are computed exactly as in DG4 for every reader. `restrictedRecordIds` answers which of the
//    records an aggregate includes are sensitive AND not admitted for this reader; when that set is not empty the
//    response carries `includesRestrictedRecords: true`. When none of the included records is sensitive the response
//    is unchanged byte for byte (no field), so every DG4/DG5 response stays identical until someone marks a record;
//    when some are sensitive and the reader is admitted to all of them the field is `false`.
//  - The individual record (id, code, title, value) of a restricted record is never shown in an aggregate.
// Nothing here changes a number: totals stay the DG4 decimal sums and Unknown stays Unknown (ADR-0051 §8).
import { sql, type DbOrTx } from "@mth/db";
import {
  activeGrantKeys,
  loadSensitiveRecords,
  resolveTarget,
  sensitivityClauseAdmits,
  type Principal,
  type ResolvedTarget,
  type SensitiveRecordType,
} from "../access/index.ts";

/** The ids among `ids` that are marked sensitive (`record_sensitivity.is_sensitive`). */
export async function markedSensitiveIds(
  db: DbOrTx,
  recordType: SensitiveRecordType,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .selectFrom("record_sensitivity")
    .select("record_id")
    .where("record_type", "=", recordType)
    .where("is_sensitive", "=", true)
    .where(sql<boolean>`record_id = ANY(${[...new Set(ids)]}::uuid[])`)
    .execute();
  return new Set(rows.map((r) => r.record_id));
}

/** The outcome of the restricted-records check of one aggregate. */
export interface Restriction {
  /** At least one included record is sensitive (the response then carries `includesRestrictedRecords`). */
  readonly anySensitive: boolean;
  /** The included sensitive records this reader is not admitted to (ADR-0051 §2 rules 1-3). */
  readonly restricted: ReadonlySet<string>;
}

export const NO_RESTRICTION: Restriction = { anySensitive: false, restricted: new Set() };

/**
 * Which of `ids` (records the reader reaches through a transformation it can read) are sensitive and not admitted.
 * One query when nothing is sensitive; otherwise the records, the reader's active grants and one target per
 * transformation, decided in memory with the same clause as `ReadScope.admits`.
 */
export async function restrictionOf(
  db: DbOrTx,
  principal: Principal,
  recordType: SensitiveRecordType,
  ids: readonly string[],
): Promise<Restriction> {
  const marked = await markedSensitiveIds(db, recordType, ids);
  if (marked.size === 0) return NO_RESTRICTION;
  const records = await loadSensitiveRecords(db, recordType, [...marked]);
  const granted = await activeGrantKeys(db, principal);
  const targets = new Map<string, ResolvedTarget | null>();
  const restricted = new Set<string>();
  for (const id of marked) {
    const rec = records.get(id);
    if (rec === undefined) {
      restricted.add(id);
      continue;
    }
    if (!targets.has(rec.transformationId))
      targets.set(rec.transformationId, await resolveTarget(db, { type: "transformation", id: rec.transformationId }));
    const target = targets.get(rec.transformationId) ?? null;
    const admitted =
      target !== null &&
      sensitivityClauseAdmits(
        principal,
        { granted },
        {
          recordType,
          recordId: id,
          isSensitive: true,
          target,
          partyUserIds: rec.partyUserIds,
        },
      );
    if (!admitted) restricted.add(id);
  }
  return { anySensitive: true, restricted };
}

/** The optional response field: absent when nothing included is sensitive (DG4/DG5 bytes unchanged). */
export function restrictedField(r: Restriction): { includesRestrictedRecords?: boolean } {
  return r.anySensitive ? { includesRestrictedRecords: r.restricted.size > 0 } : {};
}
