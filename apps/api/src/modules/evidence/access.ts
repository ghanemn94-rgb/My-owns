// Evidence authorization through the parent record, including after an ownership transfer (slice E; ADR-0051 §4;
// REQ-S13-013; D-196 point 1; T-DG6-BE-C). ONE decision for an evidence item's metadata, its content download and its
// preview, so they can never disagree on allow or deny (M0255). A caller may read the item iff:
//   1. ADR-0006 read on the evidence's transformation (`transformation.read`); otherwise 404 `not_found` (the
//      DG2-approved non-disclosure form; D-196 point 1, Option A), and
//   2. the item itself passes the ADR-0051 §2 sensitivity clause, and
//   3. every benefit or business case the item is linked to passes the same clause (a non-sensitive parent always
//      does). "Linked" is every row of the type-specific link tables that names the item: `benefit_evidence` (0038) and
//      `form_record_attachment` (0068) whose form record type is stored in `benefit` or `business_case` (T14,
//      business_case); the polymorphic `evidence_link` (0012) cannot name either type. Every row counts, including a
//      removed attachment (fail closed). tasks/deep-links.ts repeats this enumeration (tasks may not import evidence);
//      the deep-link test pins the agreement.
// An in-scope caller refused by 2 or 3 gets 403 `evidence.parent_forbidden` on the download and the preview
// (ADR-0051 §4). The metadata GET keeps the §2 404 for a sensitive item itself (BE-B2) and answers the same 403 for a
// sensitive parent; the list omits both.
//
// Ownership transfer: no rule reads `owner_user_id`, `created_by` or the uploader except as a §2 named party of a
// SENSITIVE item, and none requires a previous owner to keep access. After a BAU handover (ADR-0034) the new owner reads
// the evidence through their own assignment on the transformation (and, for a sensitive item, a grant or a named-party
// role on the record now naming them).
import { sql, type DbOrTx, type EvidenceRow, type Expression, type SqlBool } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  activeGrantKeys,
  denialOf,
  loadSensitiveRecords,
  readScopeFor,
  requireTransformationRead,
  sensitivityClauseSql,
  type Principal,
  type ResolvedTarget,
  type SensitiveRecordType,
} from "../access/index.ts";
import { HttpProblem, problems } from "../platform/index.ts";

/** The 403 of ADR-0051 §4 (i18n key `problems.evidence.parent_forbidden`). Never names the record. */
export const evidenceParentForbidden = (): HttpProblem =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "evidence.parent_forbidden",
    title: "Forbidden",
    detail: "You do not have access to the record this evidence belongs to.",
  });

/** The benefits and business cases one evidence item is linked to (ADR-0051 §4; see the header). */
export async function evidenceParents(
  db: DbOrTx,
  evidenceId: string,
): Promise<{ recordType: SensitiveRecordType; recordId: string }[]> {
  const rows = await sql<{ record_type: SensitiveRecordType; record_id: string }>`
    SELECT 'benefit' AS record_type, be.benefit_id AS record_id
      FROM benefit_evidence be WHERE be.evidence_id = ${evidenceId}::uuid
    UNION
    SELECT frt.table_name AS record_type, fa.record_id
      FROM form_record_attachment fa JOIN form_record_type frt ON frt.code = fa.record_type
     WHERE fa.evidence_id = ${evidenceId}::uuid AND frt.table_name IN ('benefit', 'business_case')`.execute(db);
  return rows.rows.map((r) => ({ recordType: r.record_type, recordId: r.record_id }));
}

/** The outcome of the ADR-0051 §4 decision for an item the caller can see exists (rule 1 passed). */
export interface EvidenceReadDecision {
  readonly target: ResolvedTarget;
  readonly row: EvidenceRow;
  /** null: admitted; "item": refused by rule 2; "parent": refused by rule 3. */
  readonly refusal: null | "item" | "parent";
}

/**
 * Rules 1-3 for one item. Throws 404 when the caller cannot read the transformation or the item does not exist in it;
 * otherwise returns the decision (nothing is thrown for rules 2 and 3, so each route picks its status).
 */
export async function evidenceReadDecision(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  evidenceId: string,
): Promise<EvidenceReadDecision> {
  const target = await requireTransformationRead(db, principal, transformationId);
  const row = await db
    .selectFrom("evidence")
    .selectAll()
    .where("id", "=", evidenceId)
    .where("transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  const scope = await readScopeFor(db, principal, "transformation.read");
  if (
    !scope.admits({
      recordType: "evidence",
      recordId: row.id,
      target,
      partyUserIds: [row.owner_user_id, row.created_by],
    })
  )
    return { target, row, refusal: "item" };
  for (const parent of await evidenceParents(db, row.id)) {
    const rec = (await loadSensitiveRecords(db, parent.recordType, [parent.recordId])).get(parent.recordId);
    // A link row's FK keeps its record in the evidence's transformation, so `target` is the record's target.
    if (!rec || !scope.admits({ recordType: rec.recordType, recordId: rec.id, target, partyUserIds: rec.partyUserIds }))
      return { target, row, refusal: "parent" };
  }
  return { target, row, refusal: null };
}

/**
 * The download and preview gate (ADR-0051 §4): 404 for a caller without `transformation.read` or a missing item,
 * 403 `evidence.parent_forbidden` for an in-scope caller not admitted to a sensitive item or a sensitive parent.
 */
export async function requireEvidenceRead(
  db: DbOrTx,
  principal: Principal,
  transformationId: string,
  evidenceId: string,
): Promise<{ target: ResolvedTarget; row: EvidenceRow }> {
  const decision = await evidenceReadDecision(db, principal, transformationId, evidenceId);
  if (decision.refusal !== null)
    throw evidenceParentForbidden().withDenial({
      ...denialOf("transformation.read", decision.target),
      recordType: "evidence",
      recordId: evidenceId,
    });
  return { target: decision.target, row: decision.row };
}

/**
 * Rule 3 as SQL over an evidence row, for lists (ADR-0051 §1, §4): true when no linked benefit or business case is
 * refused to the principal by the §2 sensitivity clause. Pair it with `ReadScope.predicate` (rules 1 and 2).
 */
export async function evidenceParentsAdmittedSql(
  db: DbOrTx,
  principal: Principal,
  evidenceId: Expression<string>,
): Promise<Expression<SqlBool>> {
  const granted = await activeGrantKeys(db, principal);
  const benefitClause = sensitivityClauseSql(principal, granted, {
    recordType: "benefit",
    recordId: sql.ref("p_b.id"),
    organizationId: sql.ref("p_b.organization_id"),
    transformationId: sql.ref("p_b.transformation_id"),
    partyUserIds: [sql.ref("p_b.owner_user_id"), sql.ref("p_b.finance_validator_user_id"), sql.ref("p_b.created_by")],
  });
  const caseClause = sensitivityClauseSql(principal, granted, {
    recordType: "business_case",
    recordId: sql.ref("p_c.id"),
    organizationId: sql.ref("p_c.organization_id"),
    transformationId: sql.ref("p_c.transformation_id"),
    partyUserIds: [
      sql.ref("p_c.benefit_owner_user_id"),
      sql.ref("p_c.initiative_owner_user_id"),
      sql.ref("p_c.finance_validator_user_id"),
      sql.ref("p_c.created_by"),
    ],
  });
  return sql<SqlBool>`(NOT EXISTS (
      SELECT 1 FROM benefit p_b
       WHERE p_b.id IN (
               SELECT be.benefit_id FROM benefit_evidence be WHERE be.evidence_id = ${evidenceId}
               UNION
               SELECT fa.record_id FROM form_record_attachment fa JOIN form_record_type frt ON frt.code = fa.record_type
                WHERE fa.evidence_id = ${evidenceId} AND frt.table_name = 'benefit')
         AND NOT ${benefitClause})
    AND NOT EXISTS (
      SELECT 1 FROM business_case p_c
       WHERE p_c.id IN (
               SELECT fa.record_id FROM form_record_attachment fa JOIN form_record_type frt ON frt.code = fa.record_type
                WHERE fa.evidence_id = ${evidenceId} AND frt.table_name = 'business_case')
         AND NOT ${caseClause}))`;
}
