// P5 slice C instance fixtures (T-DG5-BE-F2; p5-work-split §C.2). A procedure launch reads the transformation's
// `procedure` pin, else the newest published `procedures` version; suites never publish `procedures` itself (one open
// draft per key), so each one publishes its OWN synthetic procedures key through the Studio pipeline (draft, put,
// preview, compatibility, TO review, publish) and pins its transformations to it, as a methodology migration would.
// Every value is synthetic; a configuration review or publish approves nothing in the business, and nothing here
// touches the engineering gates DG0-DG7.
import { createDb, insertAuditEvent, sql } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { expect } from "vitest";
import { call, type Session, type TestApi } from "./harness.ts";
import { seedProceduresVersion, syntheticDefinitionBody } from "./procedures-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

/** Pins a transformation's `procedure` kind to `versionId` (as a migration owner would; synthetic and audited). */
export async function pinProcedures(
  api: TestApi,
  organizationId: string,
  transformationId: string,
  versionId: string,
  byUserId: string,
): Promise<void> {
  // The owner pool is the harness's (api.close() ends it): never destroyed here.
  const owner = createDb(api.owner);
  {
    await owner.transaction().execute(async (tx) => {
      const id = uuidv7();
      await tx
        .insertInto("transformation_config_pin")
        .values({
          id,
          organization_id: organizationId,
          transformation_id: transformationId,
          kind: "procedure",
          methodology_version_id: versionId,
          pinned_by: byUserId,
          pinned_at: sql<Date>`now()`,
          created_by: byUserId,
          updated_by: byUserId,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.pin",
        recordType: "transformation_config_pin",
        recordId: id,
        organizationId,
        transformationId,
        newVersion: 1,
      });
    });
  }
}

/** The synthetic vendor_onboarding body (procedures-fixtures.ts) with its first step `collect` made skippable. */
export function skippableCollectBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const body = syntheticDefinitionBody(overrides) as { steps: { stepKey: string }[] } & Record<string, unknown>;
  const steps = body.steps.map((s) => (s.stepKey === "collect" ? { ...s, skippable: true } : s));
  return { ...body, steps };
}

/**
 * Publishes a synthetic procedures version through the Studio pipeline: based on a fresh copy of the ten seeded
 * procedures (`basedOnVersionId`, else a new seeded key), with `vendor_onboarding` put as `body`. Returns its id.
 */
export async function publishProcedures(
  api: TestApi,
  admin: Session,
  reviewer: Session,
  body: Record<string, unknown> = syntheticDefinitionBody(),
  basedOnVersionId?: string,
): Promise<string> {
  const based = basedOnVersionId ?? (await seedProceduresVersion(api)).id;
  const d = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: based } });
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  const id = d.body.id as string;
  const versionOf = async () => (await call<Body>(api.app, "GET", `${V}/${id}`, { session: admin })).body.version;
  const put = await call<Body>(api.app, "PUT", `/api/v1/admin/procedure-definitions/${id}/vendor_onboarding`, {
    session: admin,
    headers: ifm(await versionOf()),
    body,
  });
  expect(put.status, JSON.stringify(put.body)).toBe(200);
  const pv = await call<Body>(api.app, "POST", `${V}/${id}/preview`, {
    session: admin,
    headers: ifm(await versionOf()),
    body: { samples: [] },
  });
  expect(pv.status, JSON.stringify(pv.body)).toBe(201);
  const compat = await call<Body>(api.app, "POST", `${V}/${id}/compatibility-checks`, {
    session: admin,
    headers: ifm(await versionOf()),
  });
  expect(compat.status, JSON.stringify(compat.body)).toBe(201);
  const sub = await call<Body>(api.app, "POST", `${V}/${id}/submit-review`, {
    session: admin,
    headers: ifm(await versionOf()),
    body: {},
  });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const dec = await call<Body>(api.app, "POST", `${V}/${id}/reviews/${sub.body.id}/decision`, {
    session: reviewer,
    headers: ifm(1),
    body: { outcome: "approve" },
  });
  expect(dec.status, JSON.stringify(dec.body)).toBe(200);
  const pub = await call<Body>(api.app, "POST", `${V}/${id}/publish`, {
    session: admin,
    headers: ifm(await versionOf()),
  });
  expect([pub.status, pub.body.status], JSON.stringify(pub.body)).toEqual([200, "published"]);
  return id;
}
