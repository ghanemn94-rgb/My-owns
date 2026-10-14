// P5 contract exercises of BE-F2 (p5-work-split §C.2 and §2 rule 14; T-DG5-BE-F2): the ten slice C instance operations it
// routes (list, launch, get, inputs, complete, skip, assign, evidence, cancel, my procedures), each with a success and
// every declared refusal it can reach, through the validating client. Every value is synthetic; nothing here is a
// business approval, and nothing touches DG0-DG7.
import { expect } from "vitest";
import type { z } from "zod";
import {
  myProcedureStepPage,
  procedureInstance,
  procedureInstancePage,
} from "../../../src/modules/procedures/instances.ts";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { pinProcedures, publishProcedures, skippableCollectBody } from "../../support/procedure-instance-fixtures.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";
import { setupApprovalWorld } from "../approvals/approval-world.ts";

export const P5_MIRRORS_BE_F2: Readonly<Record<string, z.ZodType>> = {
  listProcedureInstances: procedureInstancePage,
  launchProcedureInstance: procedureInstance,
  getProcedureInstance: procedureInstance,
  updateProcedureInstanceInputs: procedureInstance,
  completeProcedureStep: procedureInstance,
  skipProcedureStep: procedureInstance,
  assignProcedureStep: procedureInstance,
  linkProcedureStepEvidence: procedureInstance,
  cancelProcedureInstance: procedureInstance,
  listMyProcedureSteps: myProcedureStepPage,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeF2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const reviewer = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const p = await setupApprovalWorld(api, w);
  const version = await publishProcedures(api, admin, reviewer, skippableCollectBody());
  await pinProcedures(api, w.orgA.id, p.transformationId, version, p.lead.id);
  const missing = crypto.randomUUID();
  const I = "/api/v1/procedure-instances";
  const S = (id: string, key: string, action: string) => `${I}/${id}/steps/${key}/${action}`;
  const vendor = (extra: Record<string, unknown> = {}) => ({
    procedureCode: "vendor_onboarding",
    transformationId: p.transformationId,
    inputValues: {
      vendorName: "Synthetic Co",
      contractValue: { amount: "10.00", currencyCode: "SAR" },
      legalReview: "yes",
    },
    ...extra,
  });

  // launchProcedureInstance: 201 (with Idempotency-Key); 400; 403 (AUD); 404 (unknown code); 422 (scope_mismatch).
  const launched = await mirrored("POST", I, {
    session: p.lead.session,
    headers: { "idempotency-key": `contract-${crypto.randomUUID()}` },
    body: vendor(),
  });
  expect(launched.status, JSON.stringify(launched.body)).toBe(201);
  const id = (launched.body as { id: string }).id;
  expect((await mirrored("POST", I, { session: p.lead.session, body: { procedureCode: 1 } })).status).toBe(400);
  expect((await mirrored("POST", I, { session: auditor, body: vendor() })).status).toBe(403);
  expect(
    (await mirrored("POST", I, { session: p.lead.session, body: vendor({ procedureCode: "no_such_one" }) })).status,
  ).toBe(404);
  expect(
    codeOf(
      await mirrored("POST", I, {
        session: reviewer,
        body: { procedureCode: "baseline_validation", transformationId: null },
      }),
    ),
  ).toEqual([422, "procedure.scope_mismatch"]);

  // listProcedureInstances: 200 (filters); 400; 403.
  expect(
    (
      await mirrored(
        "GET",
        `${I}?transformationId=${p.transformationId}&status=active&procedureCode=vendor_onboarding`,
        {
          session: auditor,
        },
      )
    ).status,
  ).toBe(200);
  expect((await mirrored("GET", `${I}?status=open`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", I, { session: nobody })).status).toBe(403);

  // getProcedureInstance: 200; 400; 404.
  expect((await mirrored("GET", `${I}/${id}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${I}/x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${I}/${missing}`, { session: auditor })).status).toBe(404);

  // updateProcedureInstanceInputs: 200; 428; 409; 403; 404; 400; 422.
  const IN = `${I}/${id}/inputs`;
  const inputs = { inputValues: { vendorName: "Synthetic Co 2" } };
  expect((await mirrored("PATCH", IN, { session: p.lead.session, body: inputs })).status).toBe(428);
  expect((await mirrored("PATCH", IN, { session: p.lead.session, headers: ifm(9), body: inputs })).status).toBe(409);
  expect((await mirrored("PATCH", IN, { session: auditor, headers: ifm(1), body: inputs })).status).toBe(403);
  expect(
    (await mirrored("PATCH", `${I}/${missing}/inputs`, { session: p.lead.session, headers: ifm(1), body: inputs }))
      .status,
  ).toBe(404);
  expect(
    (await mirrored("PATCH", IN, { session: p.lead.session, headers: ifm(1), body: { inputValues: {} } })).status,
  ).toBe(400);
  expect(
    codeOf(
      await mirrored("PATCH", IN, { session: p.lead.session, headers: ifm(1), body: { inputValues: { nope: "x" } } }),
    ),
  ).toEqual([422, "procedure.input_invalid"]);
  expect((await mirrored("PATCH", IN, { session: p.lead.session, headers: ifm(1), body: inputs })).status).toBe(200);

  // linkProcedureStepEvidence: 428; 409; 403; 404; 400; 422 (no such evidence in scope); 200.
  const created = await mirrored("POST", `/api/v1/transformations/${p.transformationId}/evidence`, {
    session: p.lead.session,
    body: { kind: "note", title: "Synthetic vendor note", noteBody: "Synthetic", ownerUserId: p.lead.id },
  });
  const evidenceId = (created.body as { id: string }).id;
  const E = S(id, "collect", "evidence");
  expect((await mirrored("POST", E, { session: p.lead.session, body: { evidenceId } })).status).toBe(428);
  expect((await mirrored("POST", E, { session: p.lead.session, headers: ifm(9), body: { evidenceId } })).status).toBe(
    409,
  );
  expect((await mirrored("POST", E, { session: auditor, headers: ifm(2), body: { evidenceId } })).status).toBe(403);
  expect(
    (
      await mirrored("POST", S(missing, "collect", "evidence"), {
        session: p.lead.session,
        headers: ifm(2),
        body: { evidenceId },
      })
    ).status,
  ).toBe(404);
  expect(
    (await mirrored("POST", E, { session: p.lead.session, headers: ifm(2), body: { evidenceId: "x" } })).status,
  ).toBe(400);
  expect(
    codeOf(await mirrored("POST", E, { session: p.lead.session, headers: ifm(2), body: { evidenceId: missing } })),
  ).toEqual([422, "procedure_step.output_record_invalid"]);
  expect((await mirrored("POST", E, { session: p.lead.session, headers: ifm(2), body: { evidenceId } })).status).toBe(
    200,
  );

  // assignProcedureStep: 428; 409; 403 (WL: no procedure.manage); 404; 400; 422 (a closed step: not_active, below); 200.
  const A = S(id, "collect", "assign");
  const to = { assigneeUserId: p.lead.id };
  expect((await mirrored("POST", A, { session: p.lead.session, body: to })).status).toBe(428);
  expect((await mirrored("POST", A, { session: p.lead.session, headers: ifm(9), body: to })).status).toBe(409);
  expect((await mirrored("POST", A, { session: p.contributor.session, headers: ifm(3), body: to })).status).toBe(403);
  expect(
    (await mirrored("POST", S(id, "no_step", "assign"), { session: p.lead.session, headers: ifm(3), body: to })).status,
  ).toBe(404);
  expect(
    (await mirrored("POST", A, { session: p.lead.session, headers: ifm(3), body: { assigneeUserId: "x" } })).status,
  ).toBe(400);
  expect((await mirrored("POST", A, { session: p.lead.session, headers: ifm(3), body: to })).status).toBe(200);

  // completeProcedureStep: 428; 409; 403 (AUD; not_assignee); 404; 400; 422 (inputs_missing on a second instance); 200.
  const C = S(id, "collect", "complete");
  expect((await mirrored("POST", C, { session: p.lead.session, body: {} })).status).toBe(428);
  expect((await mirrored("POST", C, { session: p.lead.session, headers: ifm(9), body: {} })).status).toBe(409);
  expect((await mirrored("POST", C, { session: auditor, headers: ifm(4), body: {} })).status).toBe(403);
  expect(codeOf(await mirrored("POST", C, { session: p.bo.session, headers: ifm(4), body: {} }))).toEqual([
    403,
    "procedure_step.not_assignee",
  ]);
  expect(
    (await mirrored("POST", S(id, "no_step", "complete"), { session: p.lead.session, headers: ifm(4), body: {} }))
      .status,
  ).toBe(404);
  expect((await mirrored("POST", C, { session: p.lead.session, headers: ifm(4), body: { note: 1 } })).status).toBe(400);
  expect(
    (await mirrored("POST", C, { session: p.lead.session, headers: ifm(4), body: { note: "Synthetic." } })).status,
  ).toBe(200);
  expect(codeOf(await mirrored("POST", A, { session: p.lead.session, headers: ifm(5), body: to }))).toEqual([
    422,
    "procedure_step.not_active",
  ]);
  const second = await mirrored("POST", I, {
    session: p.lead.session,
    body: vendor({ inputValues: { contractValue: { amount: "10.00", currencyCode: "SAR" }, legalReview: "yes" } }),
  });
  const id2 = (second.body as { id: string }).id;
  expect(
    codeOf(
      await mirrored("POST", S(id2, "collect", "complete"), { session: p.lead.session, headers: ifm(1), body: {} }),
    ),
  ).toEqual([422, "procedure_step.inputs_missing"]);

  // skipProcedureStep: 428; 409; 403; 404; 400; 422 (not_skippable); 200.
  const K = S(id2, "collect", "skip");
  const why = { reason: "Synthetic: details captured elsewhere." };
  expect((await mirrored("POST", K, { session: p.lead.session, body: why })).status).toBe(428);
  expect((await mirrored("POST", K, { session: p.lead.session, headers: ifm(9), body: why })).status).toBe(409);
  expect((await mirrored("POST", K, { session: auditor, headers: ifm(1), body: why })).status).toBe(403);
  expect(
    (await mirrored("POST", S(missing, "collect", "skip"), { session: p.lead.session, headers: ifm(1), body: why }))
      .status,
  ).toBe(404);
  expect((await mirrored("POST", K, { session: p.lead.session, headers: ifm(1), body: { reason: "x" } })).status).toBe(
    400,
  );
  expect((await mirrored("POST", K, { session: p.lead.session, headers: ifm(1), body: why })).status).toBe(200);
  expect(
    codeOf(await mirrored("POST", S(id, "legal_check", "skip"), { session: reviewer, headers: ifm(5), body: why })),
  ).toEqual([422, "procedure_step.not_skippable"]);

  // listMyProcedureSteps: 200; 400; 403.
  expect((await mirrored("GET", "/api/v1/me/procedure-steps?limit=5", { session: reviewer })).status).toBe(200);
  expect((await mirrored("GET", "/api/v1/me/procedure-steps?limit=0", { session: reviewer })).status).toBe(400);
  expect((await mirrored("GET", "/api/v1/me/procedure-steps", { session: nobody })).status).toBe(403);

  // cancelProcedureInstance: 428; 409; 403; 404; 400; 200; 422 (not_active).
  const X = `${I}/${id2}/cancel`;
  const r = { reason: "Synthetic: no longer needed." };
  expect((await mirrored("POST", X, { session: p.lead.session, body: r })).status).toBe(428);
  expect((await mirrored("POST", X, { session: p.lead.session, headers: ifm(9), body: r })).status).toBe(409);
  expect((await mirrored("POST", X, { session: p.bo.session, headers: ifm(2), body: r })).status).toBe(403);
  expect(
    (await mirrored("POST", `${I}/${missing}/cancel`, { session: p.lead.session, headers: ifm(2), body: r })).status,
  ).toBe(404);
  expect((await mirrored("POST", X, { session: p.lead.session, headers: ifm(2), body: {} })).status).toBe(400);
  expect((await mirrored("POST", X, { session: p.lead.session, headers: ifm(2), body: r })).status).toBe(200);
  expect(codeOf(await mirrored("POST", X, { session: p.lead.session, headers: ifm(3), body: r }))).toEqual([
    422,
    "procedure.not_active",
  ]);
}
