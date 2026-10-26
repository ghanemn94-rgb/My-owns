// P6 stub (T-DG6-BE-A; p6-plan §5.1, p6-work-split §E/F.1): the ReadScope port, one read boundary derived from the
// ADR-0006 policy (slice E; ADR-0051 §1; REQ-S10-004). Owned and filled by task BE-B, with the parity test.
//
// The wiring point: these types are exported through access/index.ts now, so search (ADR-0057), assistant retrieval
// (ADR-0059), report and export selection (reporting/exports/jobs.ts), integrations, operations and the worker's job
// identities (ADR-0053) can be written against them; BE-B adds `readScopeFor` (a ReadScopeFactory) in this file, and
// access/index.ts already re-exports everything here. access imports none of its consumers (p6-plan §2).
import type { DbOrTx, Expression, SqlBool } from "@mth/db";
import type { Permission } from "@mth/shared";
import type { Principal } from "./policy.ts";
import type { ResolvedTarget } from "./rules.ts";

/** The record types that can be marked sensitive (D-195 Q3; the closed CHECK set of 0098, ADR-0051 §2). */
export type SensitiveRecordType = "benefit" | "business_case" | "evidence";

/** The columns of a queried row that the read decision needs (ADR-0051 §1). */
export interface ReadScopeColumns {
  /** null: a record type that cannot be sensitive. */
  readonly recordType: SensitiveRecordType | null;
  readonly recordId: Expression<string>;
  readonly organizationId: Expression<string>;
  readonly businessUnitId?: Expression<string | null>;
  readonly transformationId: Expression<string | null>;
  /** The row's named parties (ADR-0051 §2). */
  readonly partyUserIds?: readonly Expression<string | null>[];
}

/** One principal's read boundary for one permission, loaded once per request (ADR-0051 §1). */
export interface ReadScope {
  /** SQL predicate for list, search, export and retrieval queries. */
  predicate(cols: ReadScopeColumns): Expression<SqlBool>;
  /** The same decision for a row already in memory (search hits, retrieval chunks, job outputs). */
  admits(row: {
    recordType: SensitiveRecordType | null;
    recordId: string;
    target: ResolvedTarget;
    partyUserIds: readonly (string | null)[];
  }): boolean;
}

/** The signature of BE-B's `readScopeFor` (ADR-0051 §1). */
export type ReadScopeFactory = (db: DbOrTx, principal: Principal, permission: Permission) => Promise<ReadScope>;
