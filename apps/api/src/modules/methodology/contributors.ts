// The authors of a Studio configuration draft (D-170; F-DG5-100; ADR-0039 §5; migration 0097).
//
// A person who wrote any part of a draft's content is one of its authors: its creator, and every recorded contributor.
// The database records contributors append-only, in the writer's own transaction, by triggers on every content table
// of a draft (methodology_version content columns, methodology_element, procedure_definition,
// procedure_step_definition), so no write path can skip the record (0097 header). The review decision refuses an
// author (403 config_review.self_review, here and in the 0097 trigger config_review_request_reviewer_not_contributor),
// and the review routing creates no task for one. Read-only.
import type { DbOrTx } from "@mth/db";
import type { MethodologyVersionRow } from "./drafts.ts";

/** The recorded contributors of a draft, sorted (may be empty for a seeded version). */
export async function configContributors(db: DbOrTx, versionId: string): Promise<string[]> {
  const rows = await db
    .selectFrom("methodology_version_contributor")
    .select("user_id")
    .where("methodology_version_id", "=", versionId)
    .orderBy("user_id")
    .execute();
  return rows.map((r) => r.user_id);
}

/** The draft's authors: its creator and every recorded contributor (deduplicated, creator first). */
export async function configAuthors(
  db: DbOrTx,
  version: Pick<MethodologyVersionRow, "id" | "created_by">,
): Promise<string[]> {
  const out = version.created_by === null ? [] : [version.created_by];
  for (const userId of await configContributors(db, version.id)) if (!out.includes(userId)) out.push(userId);
  return out;
}
