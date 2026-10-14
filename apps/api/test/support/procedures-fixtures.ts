// P5 slice C test fixtures (T-DG5-BE-F; p5-work-split §C.1). The `procedures` key is platform-wide (one open draft per
// key), so suites never draft or publish `procedures` itself: each test seeds its OWN synthetic published `procedure`
// version under a unique key, holding a copy of the ten seeded procedures of 0069 (the product defaults), as the
// migration owner would (origin 'seed', with the audit events the deferred guards require). Every value here is
// synthetic test data; nothing here is a business approval, and nothing touches the engineering gates DG0-DG7.
import { randomBytes } from "node:crypto";
import { createDb, insertAuditEvent, type Db } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { uniq, type TestApi } from "./harness.ts";

const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
/** The `procedures` v1 seed of 0069 (ten procedures, 31 steps). */
export const SEEDED_PROCEDURES_VERSION_ID = "01920005-0300-7000-8000-000000000001";

/** A synthetic published `procedure` version under a fresh key, holding a copy of the seeded v1 rows. */
export async function seedProceduresVersion(api: TestApi): Promise<{ id: string; key: string }> {
  const owner: Db = createDb(api.owner);
  const id = uuidv7();
  const key = `test-procedures-${uniq("k").toLowerCase()}`;
  await owner.transaction().execute(async (tx) => {
    await tx
      .insertInto("methodology_version")
      .values({
        id,
        key,
        version_no: 1,
        status: "published",
        title_en: "Synthetic procedures",
        title_ar: "إجراءات تجريبية",
        source_document: "synthetic test fixture",
        source_sha256: null,
        definition: JSON.stringify({ schema: "mth.test/1", fixture: true, productDefaults: true }),
        content_sha256: randomBytes(32).toString("hex"),
        published_at: new Date(),
        config_kind: "procedure",
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
    const defs = await tx
      .selectFrom("procedure_definition")
      .selectAll()
      .where("methodology_version_id", "=", SEEDED_PROCEDURES_VERSION_ID)
      .orderBy("ordinal")
      .execute();
    for (const d of defs) {
      const defId = uuidv7();
      const { id: _id, methodology_version_id: _v, version: _n, created_at: _c, updated_at: _u, ...rest } = d;
      await tx
        .insertInto("procedure_definition")
        .values({ ...rest, id: defId, methodology_version_id: id, input_schema: JSON.stringify(d.input_schema) })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "procedure_definition",
        recordId: defId,
        organizationId: null,
        newVersion: 1,
      });
      const steps = await tx
        .selectFrom("procedure_step_definition")
        .selectAll()
        .where("procedure_definition_id", "=", d.id)
        .orderBy("ordinal")
        .execute();
      for (const s of steps) {
        const stepId = uuidv7();
        const { id: _sid, procedure_definition_id: _p, version: _sn, created_at: _sc, updated_at: _su, ...srest } = s;
        await tx
          .insertInto("procedure_step_definition")
          .values({
            ...srest,
            id: stepId,
            procedure_definition_id: defId,
            condition_value: s.condition_value === null ? null : JSON.stringify(s.condition_value),
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "procedure_step_definition",
          recordId: stepId,
          organizationId: null,
          newVersion: 1,
        });
      }
    }
  });
  return { id, key };
}

/**
 * A complete admin-authored definition body (all M0152 parts) with an ordered, a PARALLEL and a CONDITIONAL step and a
 * business approval step decided by the Sponsor role through the canonical approval. Synthetic.
 */
export function syntheticDefinitionBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    nameEn: "Synthetic vendor onboarding",
    nameAr: "تأهيل مورد تجريبي",
    purposeEn: "Onboard a synthetic vendor with parallel reviews (test data).",
    purposeAr: "تأهيل مورد تجريبي مع مراجعات متوازية (بيانات اختبار).",
    trigger: { kind: "manual", descriptionEn: "A lead starts it.", descriptionAr: "يبدأه القائد." },
    scope: { level: "transformation", descriptionEn: "One transformation.", descriptionAr: "تحول واحد." },
    prerequisitesEn: null,
    prerequisitesAr: null,
    inputSchema: [
      { key: "vendorName", fieldType: "text", labelEn: "Vendor", labelAr: "المورد", required: true },
      { key: "contractValue", fieldType: "currency", labelEn: "Value", labelAr: "القيمة", required: true },
      {
        key: "legalReview",
        fieldType: "choice",
        labelEn: "Legal review",
        labelAr: "مراجعة قانونية",
        required: true,
        options: ["yes", "no"],
      },
    ],
    launchRoleCodes: ["TL", "TO"],
    responsibleRoleCodes: ["TL"],
    slaWorkingDays: 15,
    validationRulesEn: "Every step closes in order.",
    validationRulesAr: "تُغلق كل خطوة بالترتيب.",
    approval: { mode: "any", roleCodes: ["SP"] },
    escalation: { roleCode: "SP", afterWorkingDays: 5 },
    expectedOutputsEn: "An approval linked to the instance.",
    expectedOutputsAr: "موافقة مرتبطة بالإجراء.",
    completion: {
      rule: "all_steps_closed",
      descriptionEn: "Every step is closed.",
      descriptionAr: "أُغلقت كل الخطوات.",
    },
    exceptionsEn: null,
    exceptionsAr: null,
    effectiveFrom: "2026-10-14",
    steps: [
      {
        stepKey: "collect",
        ordinal: 1,
        stepKind: "task",
        nameEn: "Collect details",
        nameAr: "جمع التفاصيل",
        responsibleRoleCode: "TL",
        slaWorkingDays: 3,
        requiredInputKeys: ["vendorName"],
      },
      {
        stepKey: "finance_check",
        ordinal: 2,
        parallelGroup: "reviews",
        stepKind: "task",
        nameEn: "Finance check",
        nameAr: "تدقيق مالي",
        responsibleRoleCode: "FIN",
        slaWorkingDays: 5,
        condition: { inputKey: "contractValue", operator: "gte", value: "1000000.00" },
      },
      {
        stepKey: "legal_check",
        ordinal: 2,
        parallelGroup: "reviews",
        stepKind: "task",
        nameEn: "Legal check",
        nameAr: "تدقيق قانوني",
        responsibleRoleCode: "TO",
        slaWorkingDays: 5,
        condition: { inputKey: "legalReview", operator: "eq", value: "yes" },
      },
      {
        stepKey: "sponsor_approval",
        ordinal: 3,
        stepKind: "approval",
        nameEn: "Sponsor approval",
        nameAr: "موافقة الراعي",
        responsibleRoleCode: "TL",
        approvalRoleCode: "SP",
        slaWorkingDays: 5,
        output: { recordType: "approval", mode: "create" },
      },
    ],
    ...overrides,
  };
}
