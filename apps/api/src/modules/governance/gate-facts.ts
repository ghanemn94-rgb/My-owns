// G5 "Decision log" facts (T-DG4-BE-K; ADR-0035 §2; REQ-PB-015): the rows of the T16 executive decision log (the
// executive_decision_log view, ADR-0032) with their status and decision date, and today's business date in the
// organization's timezone (its default active business calendar, else the organization default). Read-only; wired into
// workflows' GateFactsProvider by server.ts. A NULL decision date is Unknown ("date missing"): never overdue, never on
// time.
import { sql, type DbOrTx } from "@mth/db";

export interface T16DecisionGateFact {
  readonly id: string;
  readonly t16Id: string | null;
  readonly status: string;
  readonly decisionDate: string | null;
}

export async function loadGovernanceGateFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<{ transformationId: string; decisions: T16DecisionGateFact[]; businessDate: string }> {
  const rows = await db
    .selectFrom("executive_decision_log")
    .select(["id", "t16_id", "status", sql<string | null>`decision_date::text`.as("decision_date")])
    .where("transformation_id", "=", transformationId)
    .orderBy("t16_id")
    .orderBy("id")
    .execute();
  const today = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = t.organization_id AND c.is_default AND c.status = 'active' LIMIT 1),
      o.default_timezone))::text AS d
      FROM transformation t JOIN organization o ON o.id = t.organization_id
     WHERE t.id = ${transformationId}::uuid`.execute(db);
  return {
    transformationId,
    decisions: rows.map((r) => ({
      id: r.id!,
      t16Id: r.t16_id,
      status: r.status ?? "unknown",
      decisionDate: r.decision_date,
    })),
    businessDate: today.rows[0]!.d,
  };
}
