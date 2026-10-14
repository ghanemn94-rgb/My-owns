// Fixtures of the methodology-migration suites (T-DG5-BE-C; ADR-0040; p5-work-split §A.5). Studio keys are platform-wide
// and new transformations are pinned to the newest published `playbook` and `forms` versions, so these suites never
// publish those keys: each test seeds its OWN synthetic published versions of one fresh key (v1, v2, ...), as the
// migration owner would (origin 'seed', with the audit events the deferred guards require), and points its own fixture
// transformation's pin of that kind at v1, as if it had been created on it. Every value here is synthetic test data;
// nothing here is a business approval and nothing touches the engineering gates DG0-DG7.
import { randomBytes } from "node:crypto";
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { uniq, type TestApi } from "../../support/harness.ts";
import type { SeededElement } from "../../support/studio-fixtures.ts";

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ownerDb = (api: TestApi): Db => createDb(api.owner);

export type SeedKind = "methodology" | "scoring_defaults" | "form_schema" | "automation_rule_set";

/** A fresh synthetic key of a kind. */
export const freshKey = (kind: SeedKind) => `test-mig-${kind.replace(/_/g, "-")}-${uniq("k").toLowerCase()}`;

/** A synthetic PUBLISHED version `versionNo` of `kind`/`key`, with its element rows. */
export async function seedPublishedVersion(
  api: TestApi,
  kind: SeedKind,
  key: string,
  versionNo: number,
  elements: readonly SeededElement[] = [],
): Promise<string> {
  const id = uuidv7();
  await ownerDb(api)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_version")
        .values({
          id,
          key,
          version_no: versionNo,
          status: "published",
          title_en: `Synthetic migration fixture v${versionNo}`,
          title_ar: `إصدار تجريبي ${versionNo}`,
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify({ schema: "mth.test/1", fixture: true, versionNo }),
          content_sha256: randomBytes(32).toString("hex"),
          published_at: new Date(),
          config_kind: kind,
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
            origin: e.origin ?? "source",
            removed: e.removed ?? false,
            ordinal: e.ordinal ?? null,
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
  return id;
}

/**
 * Points the transformation's pin of `kind` at `versionId` (as if the transformation had been created on it): the
 * existing pin row, never moved, is replaced by a fresh one (test-only, owner role; a moved pin with history is never
 * touched). Returns the pin id.
 */
export async function pinFixture(
  api: TestApi,
  input: { organizationId: string; transformationId: string; kind: SeedKind; versionId: string; by: string },
): Promise<string> {
  const pinId = uuidv7();
  await ownerDb(api)
    .transaction()
    .execute(async (tx) => {
      await tx
        .deleteFrom("transformation_config_pin")
        .where("transformation_id", "=", input.transformationId)
        .where("kind", "=", input.kind)
        .where("last_migration_id", "is", null)
        .execute();
      await tx
        .insertInto("transformation_config_pin")
        .values({
          id: pinId,
          organization_id: input.organizationId,
          transformation_id: input.transformationId,
          kind: input.kind,
          methodology_version_id: input.versionId,
          pinned_by: input.by,
          created_by: input.by,
          updated_by: input.by,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "transformation_config_pin",
        recordId: pinId,
        organizationId: input.organizationId,
        newVersion: 1,
      });
    });
  return pinId;
}

/** Every business row of a transformation that a migration must never rewrite, as JSON (byte-for-byte comparison). */
export async function historySnapshot(db: Db, transformationId: string): Promise<string> {
  const tables = [
    "gate_instance",
    "gate_submission",
    "gate_submission_criterion",
    "gate_decision",
    "gate_decision_agreement",
    "decision",
    "charter",
    "baseline",
    "value_pool",
    "diagnostic_item",
    "diagnostic_finding",
    "evidence",
    "evidence_link",
    "scoring_weight_set",
    "form_custom_value",
  ] as const;
  const out: Record<string, unknown[]> = {};
  for (const t of tables) {
    const rows = await db
      .selectFrom(t as never)
      .selectAll()
      .where("transformation_id" as never, "=", transformationId as never)
      .orderBy("id" as never)
      .execute();
    out[t] = rows as unknown[];
  }
  return JSON.stringify(out);
}
