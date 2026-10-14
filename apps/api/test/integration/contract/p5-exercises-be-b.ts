// P5 contract exercises of BE-B (p5-work-split §A.2 and §2 rule 14; T-DG5-BE-B): the seven slice A operations it
// routes (element edits, diff, affected records, check runs, compatibility, preview), each with a success and every
// declared refusal it can reach, through the validating client. Every value is synthetic.
import {
  configAffectedRecords,
  configCheckRun,
  configCheckRunPage,
  configVersion,
  configVersionDiff,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_B: Readonly<Record<string, z.ZodType>> = {
  putConfigElement: configVersion,
  removeConfigElement: configVersion,
  getConfigVersionDiff: configVersionDiff,
  getConfigAffectedRecords: configAffectedRecords,
  listConfigCheckRuns: configCheckRunPage,
  runConfigCompatibilityCheck: configCheckRun,
  runConfigPreview: configCheckRun,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeBOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const base = await seedStudioBase(api, "methodology");
  const V = "/api/v1/admin/methodology-versions";
  const created = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(created.status).toBe(201);
  const id = (created.body as { id: string }).id;
  const missing = crypto.randomUUID();
  const G3 = `${V}/${id}/elements/gate/G3`;

  // putConfigElement: 200; 428; 409 stale; 403 (AUD); 404; 400 (attributes shape); 422 per §13 code.
  const put = await mirrored("PUT", G3, {
    session: admin,
    headers: ifm(1),
    body: { attributes: { labelEn: "Target state (synthetic)" } },
  });
  expect(put.status).toBe(200);
  expect((await mirrored("PUT", G3, { session: admin, body: { attributes: {} } })).status).toBe(428);
  expect((await mirrored("PUT", G3, { session: admin, headers: ifm(1), body: { attributes: {} } })).status).toBe(409);
  expect((await mirrored("PUT", G3, { session: auditor, headers: ifm(2), body: { attributes: {} } })).status).toBe(403);
  expect(
    (
      await mirrored("PUT", `${V}/${missing}/elements/gate/G3`, {
        session: admin,
        headers: ifm(1),
        body: { attributes: {} },
      })
    ).status,
  ).toBe(404);
  expect(
    (await mirrored("PUT", G3, { session: admin, headers: ifm(2), body: { attributes: { labelEn: 7 } } })).status,
  ).toBe(400);
  expect(
    codeOf(await mirrored("PUT", G3, { session: admin, headers: ifm(2), body: { attributes: { stableKey: "G9" } } })),
  ).toEqual([422, "config_version.stable_id_change"]);
  expect(
    codeOf(
      await mirrored("PUT", `${V}/${id}/elements/gate/G7`, {
        session: admin,
        headers: ifm(2),
        body: { attributes: {} },
      }),
    ),
  ).toEqual([422, "config_version.source_element_protected"]);
  expect(
    codeOf(
      await mirrored("PUT", G3, {
        session: admin,
        headers: ifm(2),
        body: { attributes: { defaultApproverRoleCode: "ADM_METHOD" } },
      }),
    ),
  ).toEqual([422, "config_version.admin_approver_forbidden"]);
  expect(
    codeOf(
      await mirrored("PUT", G3, {
        session: admin,
        headers: ifm(2),
        body: { attributes: { defaultApproverRoleCode: "TO" } },
      }),
    ),
  ).toEqual([422, "config_version.approver_not_allowed"]);
  expect(
    codeOf(
      await mirrored("PUT", `${V}/${id}/elements/scoring_weight/feasibility`, {
        session: admin,
        headers: ifm(2),
        body: { attributes: { weightPercent: "10" } },
      }),
    ),
  ).toEqual([422, "config_version.unknown_element"]);

  // removeConfigElement: 200 (T13 recorded); 422 protected; 428; 409; 403; 404; 400 (unknown element type).
  const T13 = `${V}/${id}/elements/template/T13/remove`;
  expect((await mirrored("POST", T13, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", T13, { session: admin, headers: ifm(1) })).status).toBe(409);
  expect((await mirrored("POST", T13, { session: auditor, headers: ifm(2) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${missing}/elements/template/T13/remove`, { session: admin, headers: ifm(1) }))
      .status,
  ).toBe(404);
  expect(
    (await mirrored("POST", `${V}/${id}/elements/nope/T13/remove`, { session: admin, headers: ifm(2) })).status,
  ).toBe(400);
  expect(
    codeOf(
      await mirrored("POST", `${V}/${id}/elements/tom_dimension/technology/remove`, {
        session: admin,
        headers: ifm(2),
      }),
    ),
  ).toEqual([422, "config_version.source_element_protected"]);
  const removed = await mirrored("POST", T13, { session: admin, headers: ifm(2) });
  expect(removed.status).toBe(200);

  // getConfigVersionDiff: 200; 400; 403; 404.
  const diff = await mirrored("GET", `${V}/${id}/diff`, { session: auditor });
  expect(diff.status).toBe(200);
  expect((await mirrored("GET", `${V}/${id}/diff?against=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${V}/${id}/diff`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${V}/${missing}/diff`, { session: admin })).status).toBe(404);

  // getConfigAffectedRecords: 200; 400; 403; 404.
  expect((await mirrored("GET", `${V}/${id}/affected-records`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${V}/x/affected-records`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${V}/${id}/affected-records`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${V}/${missing}/affected-records`, { session: admin })).status).toBe(404);

  // runConfigCompatibilityCheck: 201; 428; 409; 403; 404.
  const C = `${V}/${id}/compatibility-checks`;
  expect((await mirrored("POST", C, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", C, { session: admin, headers: ifm(1) })).status).toBe(409);
  expect((await mirrored("POST", C, { session: auditor, headers: ifm(3) })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${missing}/compatibility-checks`, { session: admin, headers: ifm(1) })).status,
  ).toBe(404);
  expect((await mirrored("POST", C, { session: admin, headers: ifm(3) })).status).toBe(201);

  // runConfigPreview: 201; 428; 409; 403; 404; 400.
  const P = `${V}/${id}/preview`;
  const samples = { samples: [{ kind: "submission", input: { routeKey: "gate.G3" } }] };
  expect((await mirrored("POST", P, { session: admin, body: samples })).status).toBe(428);
  expect((await mirrored("POST", P, { session: admin, headers: ifm(1), body: samples })).status).toBe(409);
  expect((await mirrored("POST", P, { session: auditor, headers: ifm(3), body: samples })).status).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${missing}/preview`, { session: admin, headers: ifm(1), body: samples })).status,
  ).toBe(404);
  expect((await mirrored("POST", P, { session: admin, headers: ifm(3), body: { samples: "x" } })).status).toBe(400);
  expect((await mirrored("POST", P, { session: admin, headers: ifm(3), body: samples })).status).toBe(201);

  // listConfigCheckRuns: 200; 400; 403; 404.
  const runs = await mirrored("GET", `${V}/${id}/check-runs?checkKind=compatibility`, { session: auditor });
  expect(runs.status).toBe(200);
  expect((runs.body as { items: unknown[] }).items).toHaveLength(1);
  expect((await mirrored("GET", `${V}/${id}/check-runs?checkKind=nope`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${V}/${id}/check-runs`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${V}/${missing}/check-runs`, { session: admin })).status).toBe(404);
}
