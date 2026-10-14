// P5 slice A test fixtures (T-DG5-BE-A; p5-work-split §A.1). Studio drafts are platform-wide and a configuration key
// may have at most one open draft (methodology_version_one_open_draft_key), so suites that run in parallel on the
// shared run database would collide on the seeded keys `playbook` and `scoring-defaults`. Each test therefore seeds
// its OWN synthetic published base version under a unique key, as the migration owner would (origin 'seed'; the
// fixture connection is the owner role, which the 0062 guard lets insert seeds), with the audit event the 0062
// deferred guard requires. Every value here is synthetic test data.
import { randomBytes } from "node:crypto";
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { createUser, grant, uniq, type TestApi, type World } from "./harness.ts";

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

/** The owner-role connection of the suite (api.owner), as Kysely. Never destroyed here: the harness ends the pool. */
const ownerDb = (api: TestApi): Db => createDb(api.owner);

export interface SeededElement {
  readonly elementType: string;
  readonly stableKey: string;
  readonly origin?: "source" | "admin";
  readonly ordinal?: number | null;
  readonly removed?: boolean;
  readonly attributes: Record<string, unknown>;
}

/** A synthetic published base version of `kind` under a fresh key, with optional element rows. */
export async function seedStudioBase(
  api: TestApi,
  kind: "methodology" | "scoring_defaults",
  elements: readonly SeededElement[] = [],
): Promise<{ id: string; key: string }> {
  const id = uuidv7();
  const key = `${kind === "methodology" ? "test-meth" : "test-score"}-${uniq("k").toLowerCase()}`;
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
          title_en: "Synthetic Studio base",
          title_ar: "أساس تجريبي",
          source_document: "synthetic test fixture",
          source_sha256: null,
          definition: JSON.stringify({ schema: "mth.test/1", fixture: true }),
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
  return { id, key };
}

/** A fresh ADM_METHOD user in org A (methodology.configure, methodology.publish, methodology.read). */
export async function methodologyAdmin(db: Db, w: World): Promise<{ id: string; subject: string }> {
  const u = await createUser(db, w.orgA.id);
  await grant(db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  return u;
}

/** Writes an element row into a draft as the owner (the BE-B element routes do not exist yet), audited. */
export async function putElementAsOwner(api: TestApi, versionId: string, e: SeededElement): Promise<string> {
  const elementId = uuidv7();
  await ownerDb(api)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("methodology_element")
        .values({
          id: elementId,
          methodology_version_id: versionId,
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
    });
  return elementId;
}

/** Records a passing preview run for the draft's current hash and moves it to `preview`, as the owner, audited. */
export async function moveDraftToPreview(api: TestApi, versionId: string, runBy: string): Promise<void> {
  await ownerDb(api)
    .transaction()
    .execute(async (tx) => {
      const v = await tx
        .selectFrom("methodology_version")
        .select(["content_sha256", "version"])
        .where("id", "=", versionId)
        .executeTakeFirstOrThrow();
      const runId = uuidv7();
      await tx
        .insertInto("config_check_run")
        .values({
          id: runId,
          methodology_version_id: versionId,
          check_kind: "preview",
          content_sha256: v.content_sha256,
          result: "pass",
          report: JSON.stringify({ fixture: true }),
          run_by: runBy,
          created_by: runBy,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "config_check_run",
        recordId: runId,
        organizationId: null,
      });
      await tx
        .updateTable("methodology_version")
        .set({ draft_stage: "preview", version: v.version + 1 })
        .where("id", "=", versionId)
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "methodology_version",
        recordId: versionId,
        organizationId: null,
        priorVersion: v.version,
        newVersion: v.version + 1,
      });
    });
}
