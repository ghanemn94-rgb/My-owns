// P5 slice B test fixtures (T-DG5-BE-D; p5-work-split §B.2). The `forms` key is platform-wide (one open draft per key,
// and new transformations are pinned to its newest published version), so suites never publish or draft `forms`
// itself: each test seeds its OWN synthetic published form_schema version under a unique key, as the migration owner
// would (origin 'seed', with the audit events the deferred guards require), and pins its own fixture transformation to
// it, as an approved migration would. Every value here is synthetic test data; nothing here is a business approval.
import { randomBytes } from "node:crypto";
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { createTransformationRow, uniq, type TestApi, type World } from "./harness.ts";

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ownerDb = (api: TestApi): Db => createDb(api.owner);

export interface FormElementSeed {
  readonly elementType: "form" | "form_field";
  readonly stableKey: string;
  readonly origin?: "source" | "admin";
  readonly attributes: Record<string, unknown>;
}

/** A synthetic published form_schema version under a fresh key, with the given element rows. */
export async function seedFormsVersion(
  api: TestApi,
  elements: readonly FormElementSeed[] = [],
): Promise<{ id: string; key: string }> {
  const id = uuidv7();
  const key = `test-forms-${uniq("k").toLowerCase()}`;
  await ownerDb(api)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_version")
        .values({
          id,
          key,
          version_no: 1,
          status: "published",
          title_en: "Synthetic form schema",
          title_ar: "نموذج تجريبي",
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify({ schema: "mth.test/1", fixture: true }),
          content_sha256: randomBytes(32).toString("hex"),
          published_at: new Date(),
          config_kind: "form_schema",
          origin: "seed",
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "methodology_version",
        recordId: id,
        organizationId: null,
        newVersion: 1,
      });
      for (const e of elements) {
        const elementId = uuidv7();
        await tx
          .insertInto("methodology_element")
          .values({
            id: elementId,
            methodology_version_id: id,
            element_type: e.elementType,
            stable_key: e.stableKey,
            origin: e.origin ?? "admin",
            removed: false,
            ordinal: null,
            attributes: JSON.stringify(e.attributes),
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "methodology_element",
          recordId: elementId,
          organizationId: null,
          newVersion: 1,
        });
      }
    });
  return { id, key };
}

/**
 * A fixture transformation in org A / BU a1 with the DG2-DG4 starter structure (six seeded T01 rows among others),
 * optionally pinned to a form_schema version (as an approved migration would have left it). Returns its id and the id
 * of one seeded T01 diagnostic item.
 */
export async function formsTransformation(
  api: TestApi,
  w: World,
  createdBy: string,
  formsVersionId?: string,
): Promise<{ transformationId: string; t01: string }> {
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, createdBy);
  await api.owner.query(`SELECT p4_instantiate_transformation($1::uuid, $2::uuid, 'fixture', 'api')`, [
    transformationId,
    createdBy,
  ]);
  if (formsVersionId !== undefined) {
    const pinId = uuidv7();
    await ownerDb(api)
      .transaction()
      .execute(async (tx) => {
        await tx
          .insertInto("transformation_config_pin")
          .values({
            id: pinId,
            organization_id: w.orgA.id,
            transformation_id: transformationId,
            kind: "form_schema",
            methodology_version_id: formsVersionId,
            pinned_by: createdBy,
            created_by: createdBy,
            updated_by: createdBy,
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "transformation_config_pin",
          recordId: pinId,
          organizationId: w.orgA.id,
          newVersion: 1,
        });
      });
  }
  const item = await api.db
    .selectFrom("diagnostic_item")
    .select("id")
    .where("transformation_id", "=", transformationId)
    .orderBy("id")
    .executeTakeFirstOrThrow();
  return { transformationId, t01: item.id };
}

/** The extension fields of T01 used across the slice B suites (synthetic). */
export const T01_FIELDS: readonly FormElementSeed[] = [
  {
    elementType: "form_field",
    stableKey: "T01.risk_score",
    attributes: { fieldType: "number", labelEn: "Risk score", scale: 2 },
  },
  {
    elementType: "form_field",
    stableKey: "T01.adoption",
    attributes: { fieldType: "percentage", labelEn: "Adoption" },
  },
  { elementType: "form_field", stableKey: "T01.budget", attributes: { fieldType: "currency", labelEn: "Budget" } },
  {
    elementType: "form_field",
    stableKey: "T01.channels",
    attributes: {
      fieldType: "choice",
      labelEn: "Channels",
      multiple: true,
      options: [
        { value: "retail", labelEn: "Retail", labelAr: "التجزئة" },
        { value: "online", labelEn: "Online", labelAr: "عبر الإنترنت" },
      ],
    },
  },
  {
    elementType: "form_field",
    stableKey: "T01.tier",
    attributes: {
      fieldType: "choice",
      labelEn: "Tier",
      options: [
        { value: "gold", labelEn: "Gold", labelAr: "ذهبي" },
        { value: "silver", labelEn: "Silver", labelAr: "فضي" },
      ],
    },
  },
  {
    elementType: "form_field",
    stableKey: "T01.weighted_risk",
    attributes: {
      fieldType: "calculated",
      labelEn: "Weighted risk",
      expression: "risk_score * adoption",
      resultUnitKind: "score",
    },
  },
  {
    elementType: "form_field",
    stableKey: "T01.note",
    attributes: { fieldType: "text", labelEn: "Note", required: true },
  },
];
