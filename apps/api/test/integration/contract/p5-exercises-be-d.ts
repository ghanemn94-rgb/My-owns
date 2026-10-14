// P5 contract exercises of BE-D (p5-work-split §B.2 and §2 rule 14; T-DG5-BE-D): the five slice B operations it routes
// (the native-form registry, the admin and transformation form schemas, custom-field values), each with a success and
// every declared refusal it can reach, through the validating client. Every value is synthetic.
import { formCustomValues, formRecordTypeList, formSchema } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { formsTransformation, seedFormsVersion, T01_FIELDS } from "../../support/forms-fixtures.ts";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {
  listFormRecordTypes: formRecordTypeList,
  getFormSchemaAdmin: formSchema,
  getTransformationFormSchema: formSchema,
  getFormRecordCustomFields: formCustomValues,
  putFormRecordCustomFields: formCustomValues,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeDOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const missing = crypto.randomUUID();
  const version = await seedFormsVersion(api, T01_FIELDS);
  const { transformationId: t, t01 } = await formsTransformation(api, w, w.office.id, version.id);

  // listFormRecordTypes: 200; 400; 403.
  const A = "/api/v1/admin/form-schemas";
  expect((await mirrored("GET", A, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${A}?kind=extension`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${A}?kind=nope`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", A, { session: nobody })).status).toBe(403);

  // getFormSchemaAdmin: 200 (default and versionId); 400; 403; 404.
  expect((await mirrored("GET", `${A}/T03`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${A}/T01?versionId=${version.id}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${A}/T03?versionId=x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${A}/T03`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${A}/unknown_type`, { session: auditor })).status).toBe(404);

  // getTransformationFormSchema: 200; 400; 403; 404; 422.
  const S = (rt: string, id = t) => `/api/v1/transformations/${id}/form-schemas/${rt}`;
  expect((await mirrored("GET", S("T01"), { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", S("T01", "x"), { session: auditor })).status).toBe(400);
  // A caller without transformation.read in scope never learns the transformation exists: 404 (no 403 is reachable
  // on this read; the 403 of the contract is the platform's generic refusal).
  expect((await mirrored("GET", S("T01"), { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", S("T01"), { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", S("T01", missing), { session: auditor })).status).toBe(404);
  expect(codeOf(await mirrored("GET", S("launch_plan"), { session: auditor }))).toEqual([
    422,
    "form_record.type_planned",
  ]);

  // putFormRecordCustomFields: 200 (create with "0", update); 428; 409; 400; 422; 403; 404.
  const C = (rt = "T01", id = t01) => `/api/v1/transformations/${t}/form-records/${rt}/${id}/custom-fields`;
  const body = { values: { note: "Synthetic", adoption: "12%" } };
  expect((await mirrored("PUT", C(), { session: office, body })).status).toBe(428);
  const created = await mirrored("PUT", C(), { session: office, headers: ifm(0), body });
  expect(created.status).toBe(200);
  expect(created.body.values.adoption).toBe("0.12");
  expect(codeOf(await mirrored("PUT", C(), { session: office, headers: ifm(0), body }))).toEqual([
    409,
    "form_record.conflict",
  ]);
  expect(
    (await mirrored("PUT", C(), { session: office, headers: ifm(1), body: { values: { note: "x", risk_score: 1 } } }))
      .status,
  ).toBe(400);
  expect((await mirrored("PUT", C(), { session: office, headers: ifm(1), body: { values: "x" } })).status).toBe(400);
  expect(
    codeOf(
      await mirrored("PUT", C(), { session: office, headers: ifm(1), body: { values: { nope: "x", note: "x" } } }),
    ),
  ).toEqual([422, "form_record.custom_field_unknown"]);
  expect(
    codeOf(await mirrored("PUT", C(), { session: office, headers: ifm(1), body: { values: { risk_score: "1" } } })),
  ).toEqual([422, "form_record.custom_field_required"]);
  expect((await mirrored("PUT", C(), { session: auditor, headers: ifm(1), body })).status).toBe(403);
  expect((await mirrored("PUT", C(), { session: officeB, headers: ifm(1), body })).status).toBe(404);
  expect((await mirrored("PUT", C("T01", missing), { session: office, headers: ifm(0), body })).status).toBe(404);
  expect((await mirrored("PUT", C(), { session: office, headers: ifm(1), body })).status).toBe(200);

  // getFormRecordCustomFields: 200; 400; 403; 404.
  const got = await mirrored("GET", C(), { session: auditor });
  expect([got.status, got.body.version]).toEqual([200, 2]);
  expect((await mirrored("GET", C("T01", "x"), { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", C(), { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", C(), { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", C("T01", missing), { session: auditor })).status).toBe(404);
}
