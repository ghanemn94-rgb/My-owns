// getAssessmentFormVersion (T-DG4-BE-R4; ADR-0033 amendment V1) against a real PostgreSQL:
//  - version 1 after an update to version 2 returns the old questions (the version a record was answered on), and
//    version 2 the new ones; the body is exactly AssessmentFormVersion; no ETag (the row is append-only);
//  - an unpublished version and the versions of a retired form are readable;
//  - version 99 → 404; a form of another transformation (through this transformation's path) → 404; an unknown form
//    → 404; outside scope (ADM-only, another transformation's reader) → 404; versionNo 0, a non-integer or a value
//    above the integer column → 400; unauthenticated 401. The read writes nothing.
// All data is SYNTHETIC. Nothing here is a business approval; nothing touches DG0-DG7.
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let other: BenefitWorld;

const V1 = {
  questions: [
    { key: "clarity", type: "scale", label_en: "Clarity", label_ar: "الوضوح", required: true, min: 1, max: 5 },
    { key: "comment", type: "text", label_en: "Comment", label_ar: "تعليق", required: false },
  ],
};
const V2 = {
  questions: [
    {
      key: "clarity",
      type: "scale",
      label_en: "Clarity of the guide",
      label_ar: "وضوح الدليل",
      required: true,
      min: 1,
      max: 5,
    },
  ],
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  other = await seedBenefitWorld(api, w);
}, 90_000);
afterAll(async () => {
  await api.close();
}, 60_000);

async function newForm(world: BenefitWorld, schema: unknown = V1) {
  const r = await call(api.app, "POST", `${world.base}/assessment-forms`, {
    session: world.s.bo,
    body: { kind: "feedback", name: "Synthetic feedback form", schema },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; currentVersion: Record<string, unknown> };
}

describe("getAssessmentFormVersion (ADR-0033 amendment V1)", () => {
  it("version 1 after an update to version 2 returns the old questions; no ETag; unpublished and retired readable", async () => {
    const f = await newForm(b);
    const F = `${b.base}/assessment-forms/${f.id}`;
    // Version 1 while the form is a draft (never published).
    const draftV1 = await call(api.app, "GET", `${F}/versions/1`, { session: b.s.auditor });
    expect([draftV1.status, draftV1.headers.etag, draftV1.body]).toEqual([200, undefined, f.currentVersion]);
    const published = await call(api.app, "POST", `${F}/publish`, { session: b.s.bo, headers: ifm(f.version) });
    expect(published.status, JSON.stringify(published.body)).toBe(200);
    const updated = await call(api.app, "PATCH", F, {
      session: b.s.bo,
      headers: ifm(published.body.version),
      body: { schema: V2 },
    });
    expect([updated.status, updated.body.currentVersion.versionNo]).toEqual([200, 2]);
    const auditBefore = (await auditOf(api.db, f.id)).length;

    const v1 = await call(api.app, "GET", `${F}/versions/1`, { session: b.s.auditor });
    expect([v1.status, v1.headers.etag]).toEqual([200, undefined]);
    expect(v1.body).toEqual({
      versionNo: 1,
      schema: V1,
      createdAt: f.currentVersion["createdAt"],
      createdBy: b.users.bo.id,
    });
    expect(Object.keys(v1.body)).toEqual(["versionNo", "schema", "createdAt", "createdBy"]);
    // Version 2 is unpublished (publishedVersionNo stays 1) and equals the current version.
    const v2 = await call(api.app, "GET", `${F}/versions/2`, { session: b.s.tl });
    expect([v2.status, v2.body]).toEqual([200, updated.body.currentVersion]);
    expect(updated.body.publishedVersionNo).toBe(1);
    expect(v2.body.schema).toEqual(V2);

    // A retired form's versions stay readable.
    const republished = await call(api.app, "POST", `${F}/publish`, {
      session: b.s.bo,
      headers: ifm(updated.body.version),
    });
    expect(republished.status, JSON.stringify(republished.body)).toBe(200);
    const retired = await call(api.app, "POST", `${F}/retire`, {
      session: b.s.bo,
      headers: ifm(republished.body.version),
    });
    expect([retired.status, retired.body.status]).toEqual([200, "retired"]);
    expect((await call(api.app, "GET", `${F}/versions/1`, { session: b.s.auditor })).body).toEqual(v1.body);
    expect((await call(api.app, "GET", `${F}/versions/2`, { session: b.s.auditor })).body).toEqual(v2.body);
    // Reads wrote nothing (publish and retire wrote their own events).
    const actions = (await auditOf(api.db, f.id)).slice(auditBefore).map((e) => e.action);
    expect(actions.every((a) => a.startsWith("assessment_form.") && !a.includes("version"))).toBe(true);
    expect(actions).toHaveLength(2);
  });

  it("404: version 99, another transformation's form, an unknown form, outside scope; 400 bad versionNo; 401", async () => {
    const f = await newForm(b);
    const F = `${b.base}/assessment-forms/${f.id}`;
    const v99 = await call(api.app, "GET", `${F}/versions/99`, { session: b.s.auditor });
    expect([v99.status, v99.body.type, v99.body.code]).toEqual([404, "urn:mth:problem:not-found", "not_found"]);
    const foreign = await newForm(other);
    // The other transformation's form through this transformation's path (the caller reads both).
    expect(
      (await call(api.app, "GET", `${other.base}/assessment-forms/${foreign.id}/versions/1`, { session: other.s.bo }))
        .status,
    ).toBe(200);
    const crossed = await call(api.app, "GET", `${b.base}/assessment-forms/${foreign.id}/versions/1`, {
      session: b.s.auditor,
    });
    expect([crossed.status, crossed.body.code]).toEqual([404, "not_found"]);
    const unknown = await call(api.app, "GET", `${b.base}/assessment-forms/${uuidv7()}/versions/1`, {
      session: b.s.auditor,
    });
    expect(unknown.status).toBe(404);
    // Outside scope: ADM-only, and another transformation's Transformation Lead.
    expect((await call(api.app, "GET", `${F}/versions/1`, { session: b.s.admin })).status).toBe(404);
    expect((await call(api.app, "GET", `${F}/versions/1`, { session: other.s.tl })).status).toBe(404);
    for (const bad of ["0", "-1", "1.5", "x", "2147483648"]) {
      const r = await call(api.app, "GET", `${F}/versions/${bad}`, { session: b.s.auditor });
      expect([r.status, r.body.code], bad).toEqual([400, "validation"]);
    }
    expect((await call(api.app, "GET", `${F}/versions/1`)).status).toBe(401);
  });
});
