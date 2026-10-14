// P5 contract exercises of BE-A (p5-work-split §A.1 and §2 rule 14; T-DG5-BE-A): the eight slice A operations it
// routes (Studio versions and drafts, resolved elements, configuration pins), each with a success and every declared
// refusal it can reach, through the validating client. Every value is synthetic.
import {
  configElementPage,
  configPinHistoryPage,
  configPinList,
  configVersion,
  configVersionPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, uniq, type P5ExerciseContext } from "../../support/harness.ts";
import { methodologyAdmin, seedStudioBase } from "../../support/studio-fixtures.ts";

export const P5_MIRRORS_BE_A: Readonly<Record<string, z.ZodType>> = {
  listConfigVersions: configVersionPage,
  createConfigDraft: configVersion,
  getConfigVersion: configVersion,
  updateConfigDraft: configVersion,
  listConfigElements: configElementPage,
  discardConfigDraft: configVersion,
  listTransformationConfigPins: configPinList,
  listConfigPinHistory: configPinHistoryPage,
};

const PLAYBOOK_V1 = "01920002-0000-7000-8000-000000000001";

export async function exerciseP5BeAOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, (await methodologyAdmin(api.db, w)).subject);
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const base = await seedStudioBase(api, "methodology");
  const V = "/api/v1/admin/methodology-versions";

  // listConfigVersions: 200 (filters); 403 for a user without any grant (no methodology.read).
  const list = await mirrored("GET", `${V}?kind=methodology&status=published&limit=2`, { session: auditor });
  expect(list.status).toBe(200);
  const nobody = await signIn(api.app, w.nobody.subject);
  expect((await mirrored("GET", V, { session: nobody })).status).toBe(403);

  // createConfigDraft: 201; 409 draft_exists; 403 (AUD); 404 unknown base; 422 base not published; 400.
  const created = await mirrored("POST", V, {
    session: admin,
    body: { basedOnVersionId: base.id, changeSummary: "Synthetic contract draft" },
  });
  expect(created.status).toBe(201);
  const draftId = (created.body as { id: string }).id;
  const dup = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect([dup.status, (dup.body as { code: string }).code]).toEqual([409, "config_version.draft_exists"]);
  expect((await mirrored("POST", V, { session: auditor, body: { basedOnVersionId: base.id } })).status).toBe(403);
  expect((await mirrored("POST", V, { session: admin, body: { basedOnVersionId: crypto.randomUUID() } })).status).toBe(
    404,
  );
  const notPublished = await mirrored("POST", V, { session: admin, body: { basedOnVersionId: draftId } });
  expect([notPublished.status, (notPublished.body as { code: string }).code]).toEqual([
    422,
    "config_version.unknown_element",
  ]);
  expect((await mirrored("POST", V, { session: admin, body: { basedOnVersionId: "x" } })).status).toBe(400);

  // getConfigVersion: 200, 404, 403.
  expect((await mirrored("GET", `${V}/${draftId}`, { session: office })).status).toBe(200);
  expect((await mirrored("GET", `${V}/${crypto.randomUUID()}`, { session: office })).status).toBe(404);
  expect((await mirrored("GET", `${V}/${draftId}`, { session: nobody })).status).toBe(403);

  // updateConfigDraft: 200; 428; 409 stale; 403; 404; 400.
  const updated = await mirrored("PATCH", `${V}/${draftId}`, {
    session: admin,
    headers: { "if-match": '"1"' },
    body: { titleEn: "Synthetic draft title", definition: { schema: "mth.test/1", note: "edited" } },
  });
  expect(updated.status).toBe(200);
  expect((await mirrored("PATCH", `${V}/${draftId}`, { session: admin, body: { titleEn: "x" } })).status).toBe(428);
  expect(
    (
      await mirrored("PATCH", `${V}/${draftId}`, {
        session: admin,
        headers: { "if-match": '"1"' },
        body: { titleEn: "y" },
      })
    ).status,
  ).toBe(409);
  expect(
    (
      await mirrored("PATCH", `${V}/${draftId}`, {
        session: auditor,
        headers: { "if-match": '"2"' },
        body: { titleEn: "z" },
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await mirrored("PATCH", `${V}/${crypto.randomUUID()}`, {
        session: admin,
        headers: { "if-match": '"1"' },
        body: { titleEn: "z" },
      })
    ).status,
  ).toBe(404);
  expect(
    (await mirrored("PATCH", `${V}/${draftId}`, { session: admin, headers: { "if-match": '"2"' }, body: {} })).status,
  ).toBe(400);

  // listConfigElements: 200 on the seeded playbook v1 (catalogue only) and on the draft; 404; 403.
  const gates = await mirrored("GET", `${V}/${PLAYBOOK_V1}/elements?elementType=gate`, { session: auditor });
  expect(gates.status).toBe(200);
  expect((gates.body as { items: unknown[] }).items).toHaveLength(6);
  expect((await mirrored("GET", `${V}/${draftId}/elements?limit=5`, { session: admin })).status).toBe(200);
  expect((await mirrored("GET", `${V}/${crypto.randomUUID()}/elements`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", `${V}/${draftId}/elements`, { session: nobody })).status).toBe(403);

  // discardConfigDraft: 428; 409 stale; 403; 200; 409 not_editable afterwards (also for updateConfigDraft); 404.
  expect((await mirrored("POST", `${V}/${draftId}/discard`, { session: admin })).status).toBe(428);
  expect(
    (await mirrored("POST", `${V}/${draftId}/discard`, { session: admin, headers: { "if-match": '"1"' } })).status,
  ).toBe(409);
  expect(
    (await mirrored("POST", `${V}/${draftId}/discard`, { session: auditor, headers: { "if-match": '"2"' } })).status,
  ).toBe(403);
  expect(
    (await mirrored("POST", `${V}/${draftId}/discard`, { session: admin, headers: { "if-match": '"2"' } })).status,
  ).toBe(200);
  const again = await mirrored("POST", `${V}/${draftId}/discard`, { session: admin, headers: { "if-match": '"3"' } });
  expect([again.status, (again.body as { code: string }).code]).toEqual([409, "config_version.not_editable"]);
  const frozen = await mirrored("PATCH", `${V}/${draftId}`, {
    session: admin,
    headers: { "if-match": '"3"' },
    body: { titleEn: "after discard" },
  });
  expect([frozen.status, (frozen.body as { code: string }).code]).toEqual([409, "config_version.not_editable"]);
  expect(
    (await mirrored("POST", `${V}/${crypto.randomUUID()}/discard`, { session: admin, headers: { "if-match": '"1"' } }))
      .status,
  ).toBe(404);

  // listTransformationConfigPins and listConfigPinHistory: 200 for a reader of the transformation; 404 outside scope.
  const t = await mirrored("POST", "/api/v1/transformations", {
    session: office,
    headers: { "idempotency-key": uniq("p5-be-a-") },
    body: { businessUnitId: w.a1, name: "Synthetic pins", mode: "modular", entryPhase: "define" },
  });
  const tid = (t.body as { id: string }).id;
  const pins = await mirrored("GET", `/api/v1/transformations/${tid}/config-pins`, { session: office });
  expect(pins.status).toBe(200);
  expect((await mirrored("GET", `/api/v1/transformations/${tid}/config-pins`, { session: officeB })).status).toBe(404);
  expect(
    (await mirrored("GET", `/api/v1/transformations/${tid}/config-pins/history?limit=5`, { session: auditor })).status,
  ).toBe(200);
  expect(
    (await mirrored("GET", `/api/v1/transformations/${tid}/config-pins/history`, { session: officeB })).status,
  ).toBe(404);
}
