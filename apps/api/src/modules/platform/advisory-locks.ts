// The registry of transaction-scoped advisory-lock CLASSES (ADR-0016 §"Advisory-lock registry"; T-DG3-ARCH-03).
//
// Every two-key lock `pg_advisory_xact_lock(class, hashtext(<resource id>))` the API or a database trigger takes uses
// one class from this table. A class names ONE kind of resource; two kinds of resource must never share a class,
// otherwise unrelated writes would serialize on each other, and a hash collision between their keys could even make
// one write wait for an unrelated one (T-DG3-ARCH-03: prioritization and dependency-type creation both used 730222).
// The owning module re-exports its constant under its historical name (HIERARCHY_LOCK_CLASS, ...), so callers and
// tests keep their imports. Where a trigger shares the lock, the migration declares the same number as a PL/pgSQL
// CONSTANT; `advisory-locks.test.ts` checks every such migration constant against this table.
//
// Out of scope of this registry (a different key space, so no collision is possible with the two-int4 form): the
// single-bigint locks `pg_advisory_xact_lock(hashtextextended(<text>, 0))` (idempotency, North Star, readable codes)
// and the fixed bigint keys of the migration runner and bootstrap (packages/db).

/** One row per advisory-lock class: the integer, the resource it serializes, and the key's second half. */
export const ADVISORY_LOCK_CLASSES = {
  /** Business-unit hierarchy of one organization (organization module + trigger 0009). Key: organization_id. */
  businessUnitHierarchy: 730219,
  /** Outcome tree of one transformation (trigger 0013 only; no API caller). Key: transformation_id. */
  outcomeTree: 730220,
  /** Initiative dependency graph of one transformation (workflows T08 + trigger 0022). Key: transformation_id. */
  dependencyGraph: 730221,
  /** Prioritization writes of one transformation (portfolio: weight sets, snapshots, results). Key: transformation_id. */
  prioritization: 730222,
  /** Creation of one dependency-type code (workflows, API only). Key: the requested code text. */
  dependencyType: 730223,
  // P4 block of T-DG4-ARCH-01 (730224-730227; p4-plan §4, ADR-0026). 730227 is RESERVED for this block: never
  // allocated to another block, and listed here only once a resource uses it.
  /** Delegation graph of one organization (access delegations + trigger 0029 loop guard). Key: organization_id. */
  delegationGraph: 730224,
  /** Accountable cells of one T12 RACI deliverable (governance RACI + deferred trigger 0030). Key: deliverable id. */
  raciDeliverable: 730225,
  /** Approval subject record (workflows approvals + triggers 0031). Key: the subject record id. */
  approvalSubject: 730226,
} as const;

export type AdvisoryLockClassName = keyof typeof ADVISORY_LOCK_CLASSES;
