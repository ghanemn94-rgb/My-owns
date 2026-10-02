// Human-readable codes per transformation (ADR-0015 §1): D-01 (design decisions), GD-01 (gate decisions), DEC-01
// (executive decisions, P4), DEP-01 (dependencies). The counter row is incremented with an UPSERT inside the creating
// transaction, so two concurrent creates never get the same code (the row lock serializes them); the unique
// constraints decision_code_key / dependency_code_key back this up.
import { sql, type Tx } from "@mth/db";

export type CodePrefix = "D" | "GD" | "DEC" | "DEP";

export async function nextCode(tx: Tx, transformationId: string, prefix: CodePrefix): Promise<string> {
  const row = await sql<{ last_value: number }>`
    INSERT INTO record_code_counter (transformation_id, prefix, last_value) VALUES (${transformationId}::uuid, ${prefix}, 1)
    ON CONFLICT (transformation_id, prefix) DO UPDATE SET last_value = record_code_counter.last_value + 1
    RETURNING last_value`.execute(tx);
  const n = row.rows[0]!.last_value;
  return `${prefix}-${String(n).padStart(2, "0")}`;
}
