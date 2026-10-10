// Read-only work-item facts for the slice J reads (T-DG4-KBE-G2; ADR-0037 §1 item 2, §7, §9; p4-work-split §J+K JK.5):
// the OPEN work items assigned to one user (My Work and the workspace header's next actions). Only the assignee's own
// items are ever returned: the query is keyed by `assignee_user_id`. An item follows its source's due date and owner
// through the services of service.ts (T-DG4-BE-R1), so the stored row is read as it is and nothing is re-derived here.
// Nothing is written.
import type { DbOrTx } from "@mth/db";

export interface OpenWorkItemFact {
  readonly id: string;
  readonly organizationId: string;
  readonly transformationId: string | null;
  readonly kind: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly linkPath: string;
  readonly messageKey: string;
  readonly messageParams: Record<string, unknown>;
  readonly dueDate: string | null;
  readonly periodLabel: string | null;
}

/** The open work items of `userId` (optionally of one transformation), by due date (none last), then id. */
export async function loadOpenWorkItems(
  db: DbOrTx,
  userId: string,
  transformationId: string | null = null,
): Promise<OpenWorkItemFact[]> {
  let q = db
    .selectFrom("work_item")
    .select([
      "id",
      "organization_id",
      "transformation_id",
      "kind",
      "subject_type",
      "subject_id",
      "link_path",
      "message_key",
      "message_params",
      "due_date",
      "period_label",
    ])
    .where("assignee_user_id", "=", userId)
    .where("status", "=", "open");
  if (transformationId !== null) q = q.where("transformation_id", "=", transformationId);
  const rows = await q.execute();
  return rows
    .map((r) => ({
      id: r.id,
      organizationId: r.organization_id,
      transformationId: r.transformation_id,
      kind: r.kind,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      linkPath: r.link_path,
      messageKey: r.message_key,
      messageParams: (r.message_params !== null && typeof r.message_params === "object"
        ? r.message_params
        : {}) as Record<string, unknown>,
      dueDate: r.due_date,
      periodLabel: r.period_label,
    }))
    .sort(
      (a, b) =>
        (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
