// The forms pin of a new transformation (ADR-0041 §4; M0155; p5-work-split §B.2; T-DG5-BE-D): a TransformationInitializer
// registered at composition (server.ts) that pins a transformation created after this release to the NEWEST PUBLISHED
// version of the `forms` key, in its create transaction, with the pin's audit event. A transformation created before
// this release has no form_schema pin and resolves to forms v1 (ADR-0039 §3 "never the latest"; no back-fill). Moving
// an existing transformation to a newer forms version is a methodology migration (ADR-0040), never this initializer.
// The DG1 createTransformation request and response are unchanged. Configuration only: no business approval.
import { sql, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { record } from "../audit/index.ts";
import type { TransformationInitContext } from "../transformations/index.ts";

/** The form_schema key new transformations are pinned to (the kind's default key, ADR-0041 §2). */
export const FORMS_KEY = "forms";

/** Pins the new transformation to the newest published `forms` version (idempotent: an existing pin is kept). */
export async function pinNewTransformationToForms(tx: Tx, ctx: TransformationInitContext): Promise<void> {
  const existing = await tx
    .selectFrom("transformation_config_pin")
    .select("id")
    .where("transformation_id", "=", ctx.transformationId)
    .where("kind", "=", "form_schema")
    .executeTakeFirst();
  if (existing !== undefined) return;
  const newest = await tx
    .selectFrom("methodology_version")
    .select(["id", "version_no"])
    .where("config_kind", "=", "form_schema")
    .where("key", "=", FORMS_KEY)
    .where("status", "=", "published")
    .orderBy("version_no", "desc")
    .limit(1)
    .executeTakeFirst();
  if (newest === undefined) return; // no published forms version: the transformation resolves to the default (none)
  const id = uuidv7();
  await tx
    .insertInto("transformation_config_pin")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      kind: "form_schema",
      methodology_version_id: newest.id,
      pinned_by: ctx.actorUserId,
      pinned_at: sql<Date>`now()`,
      created_by: ctx.actorUserId,
      updated_by: ctx.actorUserId,
    })
    .execute();
  await record(tx, ctx.audit, {
    action: "transformation_config_pin.create",
    recordType: "transformation_config_pin",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: {
      kind: { from: null, to: "form_schema" },
      methodology_version_id: { from: null, to: newest.id },
      version_no: { from: null, to: newest.version_no },
    },
  });
}
