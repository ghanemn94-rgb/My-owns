// P5 contract exercises of BE-F (p5-work-split §C.1 and §2 rule 14; T-DG5-BE-F): the five slice C definition
// operations it routes (list, validate, get, put, remove), each with a success and every declared refusal it can
// reach, through the validating client. Every value is synthetic; nothing here is a business approval.
import {
  configVersion,
  procedureDefinition,
  procedureDefinitionPage,
  procedureValidationReport,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { seedProceduresVersion, syntheticDefinitionBody } from "../../support/procedures-fixtures.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_F: Readonly<Record<string, z.ZodType>> = {
  listProcedureDefinitions: procedureDefinitionPage,
  validateProcedureDefinition: procedureValidationReport,
  getProcedureDefinition: procedureDefinition,
  putProcedureDefinition: procedureDefinition,
  removeProcedureDefinition: configVersion,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeFOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  const base = await seedProceduresVersion(api);
  const V = "/api/v1/admin/methodology-versions";
  const created = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  const draft = (created.body as { id: string }).id;
  const D = "/api/v1/procedure-definitions";
  const A = (code: string, v = draft) => `/api/v1/admin/procedure-definitions/${v}/${code}`;
  const body = syntheticDefinitionBody();

  // listProcedureDefinitions: 200 (default, versionId, includeRemoved); 400; 403; 404.
  expect((await mirrored("GET", D, { session: auditor })).status).toBe(200);
  expect(
    (await mirrored("GET", `${D}?versionId=${draft}&includeRemoved=true&limit=3`, { session: auditor })).status,
  ).toBe(200);
  expect((await mirrored("GET", `${D}?versionId=x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", D, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${D}?versionId=${missing}`, { session: auditor })).status).toBe(404);

  // validateProcedureDefinition: 200 (valid and invalid report); 400; 403.
  expect((await mirrored("POST", `${D}/validate`, { session: admin, body })).status).toBe(200);
  const { trigger: _t, ...noTrigger } = body;
  const report = await mirrored("POST", `${D}/validate`, { session: admin, body: noTrigger });
  expect([report.status, (report.body as { valid: boolean }).valid]).toEqual([200, false]);
  expect((await mirrored("POST", `${D}/validate`, { session: admin, body: { nameEn: 1 } })).status).toBe(400);
  expect((await mirrored("POST", `${D}/validate`, { session: auditor, body })).status).toBe(403);

  // putProcedureDefinition: 200; 428; 409 stale; 403 (AUD); 404; 400; 422 (trigger_required, code_invalid).
  expect((await mirrored("PUT", A("vendor_onboarding"), { session: admin, body })).status).toBe(428);
  expect((await mirrored("PUT", A("vendor_onboarding"), { session: admin, headers: ifm(9), body })).status).toBe(409);
  expect((await mirrored("PUT", A("vendor_onboarding"), { session: auditor, headers: ifm(1), body })).status).toBe(403);
  expect(
    (await mirrored("PUT", A("vendor_onboarding", missing), { session: admin, headers: ifm(1), body })).status,
  ).toBe(404);
  expect(
    (await mirrored("PUT", A("vendor_onboarding"), { session: admin, headers: ifm(1), body: { nameEn: "" } })).status,
  ).toBe(400);
  expect(
    codeOf(await mirrored("PUT", A("vendor_onboarding"), { session: admin, headers: ifm(1), body: noTrigger })),
  ).toEqual([422, "procedure_definition.trigger_required"]);
  expect(codeOf(await mirrored("PUT", A("Bad-Code"), { session: admin, headers: ifm(1), body }))).toEqual([
    422,
    "procedure_definition.code_invalid",
  ]);
  const saved = await mirrored("PUT", A("vendor_onboarding"), { session: admin, headers: ifm(1), body });
  expect(saved.status).toBe(200);

  // getProcedureDefinition: 200 (default, versionId); 400; 403; 404.
  expect((await mirrored("GET", `${D}/baseline_validation`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${D}/vendor_onboarding?versionId=${draft}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${D}/baseline_validation?versionId=x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${D}/baseline_validation`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${D}/no_such_procedure`, { session: auditor })).status).toBe(404);

  // removeProcedureDefinition: 200; 428; 409 stale; 403; 404; 400; 422 source_protected; 409 not editable.
  const R = (code: string, v = draft) => `${A(code, v)}/remove`;
  expect((await mirrored("POST", R("vendor_onboarding"), { session: admin })).status).toBe(428);
  expect((await mirrored("POST", R("vendor_onboarding"), { session: admin, headers: ifm(1) })).status).toBe(409);
  expect((await mirrored("POST", R("vendor_onboarding"), { session: auditor, headers: ifm(2) })).status).toBe(403);
  expect((await mirrored("POST", R("vendor_onboarding", missing), { session: admin, headers: ifm(2) })).status).toBe(
    404,
  );
  expect((await mirrored("POST", R("vendor_onboarding", "x"), { session: admin, headers: ifm(2) })).status).toBe(400);
  expect(codeOf(await mirrored("POST", R("baseline_validation"), { session: admin, headers: ifm(2) }))).toEqual([
    422,
    "procedure_definition.source_protected",
  ]);
  expect((await mirrored("POST", R("vendor_onboarding"), { session: admin, headers: ifm(2) })).status).toBe(200);
  // A published version is not editable.
  expect(codeOf(await mirrored("POST", R("vendor_onboarding", base.id), { session: admin, headers: ifm(1) }))).toEqual([
    409,
    "config_version.not_editable",
  ]);
  expect(
    codeOf(await mirrored("PUT", A("vendor_onboarding", base.id), { session: admin, headers: ifm(1), body })),
  ).toEqual([409, "config_version.not_editable"]);
  await mirrored("POST", `${V}/${draft}/discard`, { session: admin, headers: ifm(3) });
}
