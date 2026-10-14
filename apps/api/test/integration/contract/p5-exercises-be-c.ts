// P5 contract exercises of BE-C (p5-work-split §A.5 and §2 rule 14; T-DG5-BE-C): the nine slice A operations it routes
// (list, create, get, preview, submit, decide, execute and withdraw methodology migrations; list gate re-approvals),
// each with a success and every declared refusal it can reach, through the validating client. Every value is
// synthetic; approving a migration is a demo business decision in a test world that approves nothing real, and nothing
// touches the engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite).
import { gateReapprovalPage, methodologyMigration, methodologyMigrationPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { setupApprovalWorld } from "../approvals/approval-world.ts";
import { approveGate, type ChangeWorld } from "../workflows/change-fixtures.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "../methodology/migration-fixtures.ts";

export const P5_MIRRORS_BE_C: Readonly<Record<string, z.ZodType>> = {
  listMethodologyMigrations: methodologyMigrationPage,
  createMethodologyMigration: methodologyMigration,
  getMethodologyMigration: methodologyMigration,
  previewMethodologyMigration: methodologyMigration,
  submitMethodologyMigration: methodologyMigration,
  decideMethodologyMigration: methodologyMigration,
  executeMethodologyMigration: methodologyMigration,
  withdrawMethodologyMigration: methodologyMigration,
  listGateReapprovals: gateReapprovalPage,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const RATIONALE = "Synthetic demo decision; approves nothing real.";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5BeCOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const p = await setupApprovalWorld(api, w);
  const t = p.transformationId;
  const admin = p.methodologyAdmin.session;
  const sponsor = p.sponsor.session;
  const auditor = p.auditor.session;
  const contributor = p.contributor.session;
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  // The transformation's methodology pin names v1 of a fresh synthetic key; v2 adds a mandatory G2 checklist item.
  const key = freshKey("methodology");
  const v1 = await seedPublishedVersion(api, "methodology", key, 1);
  await pinFixture(api, {
    organizationId: w.orgA.id,
    transformationId: t,
    kind: "methodology",
    versionId: v1,
    by: p.lead.id,
  });
  const v2 = await seedPublishedVersion(api, "methodology", key, 2, [
    {
      elementType: "checklist_item",
      stableKey: "test.g2-check",
      origin: "admin",
      attributes: { labelEn: "Synthetic G2 check", gateCode: "G2", mandatory: true },
    },
  ]);
  const cw = { ...p, organizationId: w.orgA.id, base: `/api/v1/transformations/${t}` } as unknown as ChangeWorld;
  // G2 approved (a fixture decision; G1's own approval is not needed for the plan to name G2's re-approval).
  await approveGate(api.db, cw, "G2");
  const MIG = `/api/v1/transformations/${t}/methodology-migrations`;
  const body = { configKind: "methodology", toVersionId: v2, reason: "Synthetic contract migration" };

  // createMethodologyMigration: 201; 400; 403 (AUD); 404 (outside scope); 422 target_invalid; 409 open_exists.
  expect((await mirrored("POST", MIG, { session: admin, body: { ...body, reason: "x" } })).status).toBe(400);
  expect((await mirrored("POST", MIG, { session: auditor, body })).status).toBe(403);
  expect((await mirrored("POST", MIG, { session: nobody, body })).status).toBe(404);
  expect(code(await mirrored("POST", MIG, { session: admin, body: { ...body, toVersionId: v1 } }))).toEqual([
    422,
    "methodology_migration.target_invalid",
  ]);
  const created = await mirrored("POST", MIG, { session: admin, body });
  expect(created.status).toBe(201);
  const id = (created.body as Body).id as string;
  expect(code(await mirrored("POST", MIG, { session: admin, body }))).toEqual([
    409,
    "methodology_migration.open_exists",
  ]);
  const ONE = `${MIG}/${id}`;

  // listMethodologyMigrations: 200; 400; 403 (WL: sees the transformation, lacks methodology.read); 404.
  const list = await mirrored("GET", MIG, { session: auditor });
  expect(list.status).toBe(200);
  expect((list.body as Body).items.map((m: Body) => m.id)).toEqual([id]);
  expect((await mirrored("GET", `${MIG}?limit=0`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", MIG, { session: contributor })).status).toBe(403);
  expect((await mirrored("GET", MIG, { session: nobody })).status).toBe(404);

  // getMethodologyMigration: 200; 400; 403; 404.
  const got = await mirrored("GET", ONE, { session: admin });
  expect(got.status).toBe(200);
  expect((got.body as Body).items.map((i: Body) => i.itemKind)).toEqual(["reapproval", "unchanged_history"]);
  expect((await mirrored("GET", `${MIG}/not-a-uuid`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", ONE, { session: contributor })).status).toBe(403);
  expect((await mirrored("GET", `${MIG}/${missing}`, { session: admin })).status).toBe(404);

  // previewMethodologyMigration: 200 (revision 2); 400; 403; 404; 409; 428.
  const PREVIEW = `${ONE}/preview`;
  expect((await mirrored("POST", PREVIEW, { session: admin, body: { inputs: [] } })).status).toBe(428);
  expect((await mirrored("POST", PREVIEW, { session: admin, headers: ifm(1), body: {} })).status).toBe(400);
  expect((await mirrored("POST", PREVIEW, { session: auditor, headers: ifm(1), body: { inputs: [] } })).status).toBe(
    403,
  );
  expect(
    (await mirrored("POST", `${MIG}/${missing}/preview`, { session: admin, headers: ifm(1), body: { inputs: [] } }))
      .status,
  ).toBe(404);
  expect((await mirrored("POST", PREVIEW, { session: admin, headers: ifm(9), body: { inputs: [] } })).status).toBe(409);
  const previewed = await mirrored("POST", PREVIEW, { session: admin, headers: ifm(1), body: { inputs: [] } });
  expect(previewed.status).toBe(200);
  expect((previewed.body as Body).planRevision).toBe(2);

  // submitMethodologyMigration: 200; 400; 403; 404; 409; 428.
  const SUBMIT = `${ONE}/submit`;
  expect((await mirrored("POST", SUBMIT, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", `${MIG}/not-a-uuid/submit`, { session: admin, headers: ifm(2) })).status).toBe(400);
  expect((await mirrored("POST", SUBMIT, { session: auditor, headers: ifm(2) })).status).toBe(403);
  expect((await mirrored("POST", `${MIG}/${missing}/submit`, { session: admin, headers: ifm(2) })).status).toBe(404);
  expect((await mirrored("POST", SUBMIT, { session: admin, headers: ifm(1) })).status).toBe(409);
  const submitted = await mirrored("POST", SUBMIT, { session: admin, headers: ifm(2) });
  expect(submitted.status).toBe(200);
  // 422 not_open: submitted already.
  expect(code(await mirrored("POST", SUBMIT, { session: admin, headers: ifm(3) }))).toEqual([
    422,
    "methodology_migration.not_open",
  ]);
  expect(code(await mirrored("POST", PREVIEW, { session: admin, headers: ifm(3), body: { inputs: [] } }))).toEqual([
    422,
    "methodology_migration.not_open",
  ]);

  // executeMethodologyMigration before approval: 422 not_approved.
  const EXECUTE = `${ONE}/execute`;
  expect(code(await mirrored("POST", EXECUTE, { session: admin, headers: ifm(3) }))).toEqual([
    422,
    "methodology_migration.not_approved",
  ]);

  // decideMethodologyMigration: 400; 403 (ADM_METHOD); 404; 409; 428; 200 approve; 422 not_open afterwards.
  const DECIDE = `${ONE}/decision`;
  const approve = { outcome: "approve", rationale: RATIONALE };
  expect((await mirrored("POST", DECIDE, { session: sponsor, body: approve })).status).toBe(428);
  expect(
    (await mirrored("POST", DECIDE, { session: sponsor, headers: ifm(3), body: { outcome: "approve" } })).status,
  ).toBe(400);
  expect((await mirrored("POST", DECIDE, { session: admin, headers: ifm(3), body: approve })).status).toBe(403);
  expect(
    (await mirrored("POST", `${MIG}/${missing}/decision`, { session: sponsor, headers: ifm(3), body: approve })).status,
  ).toBe(404);
  expect((await mirrored("POST", DECIDE, { session: sponsor, headers: ifm(2), body: approve })).status).toBe(409);
  const decided = await mirrored("POST", DECIDE, { session: sponsor, headers: ifm(3), body: approve });
  expect(decided.status).toBe(200);
  expect((decided.body as Body).status).toBe("approved");
  expect(code(await mirrored("POST", DECIDE, { session: sponsor, headers: ifm(4), body: approve }))).toEqual([
    422,
    "methodology_migration.not_open",
  ]);

  // executeMethodologyMigration: 400; 403 (SP); 404; 409; 428; 200.
  expect((await mirrored("POST", EXECUTE, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", `${MIG}/not-a-uuid/execute`, { session: admin, headers: ifm(4) })).status).toBe(400);
  expect((await mirrored("POST", EXECUTE, { session: sponsor, headers: ifm(4) })).status).toBe(403);
  expect((await mirrored("POST", `${MIG}/${missing}/execute`, { session: admin, headers: ifm(4) })).status).toBe(404);
  expect((await mirrored("POST", EXECUTE, { session: admin, headers: ifm(3) })).status).toBe(409);
  const executed = await mirrored("POST", EXECUTE, { session: admin, headers: ifm(4) });
  expect(executed.status).toBe(200);
  expect((executed.body as Body).status).toBe("executed");

  // listGateReapprovals: 200 (the required G2 re-approval); 400; 404.
  const REAPPROVALS = `/api/v1/transformations/${t}/gate-reapprovals`;
  const reapprovals = await mirrored("GET", REAPPROVALS, { session: contributor });
  expect(reapprovals.status).toBe(200);
  expect((reapprovals.body as Body).items.map((r: Body) => [r.gateCode, r.status])).toEqual([["G2", "required"]]);
  expect((await mirrored("GET", `${REAPPROVALS}?limit=0`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", REAPPROVALS, { session: nobody })).status).toBe(404);

  // withdrawMethodologyMigration on a second migration (v2 -> v3): 400; 403; 404; 409; 428; 200; 422 not_open.
  const v3 = await seedPublishedVersion(api, "methodology", key, 3);
  const second = await mirrored("POST", MIG, { session: admin, body: { ...body, toVersionId: v3 } });
  expect(second.status).toBe(201);
  const WITHDRAW = `${MIG}/${(second.body as Body).id}/withdraw`;
  expect((await mirrored("POST", WITHDRAW, { session: admin })).status).toBe(428);
  expect((await mirrored("POST", `${MIG}/not-a-uuid/withdraw`, { session: admin, headers: ifm(1) })).status).toBe(400);
  expect((await mirrored("POST", WITHDRAW, { session: auditor, headers: ifm(1) })).status).toBe(403);
  expect((await mirrored("POST", `${MIG}/${missing}/withdraw`, { session: admin, headers: ifm(1) })).status).toBe(404);
  expect((await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(2) })).status).toBe(409);
  const withdrawn = await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(1) });
  expect(withdrawn.status).toBe(200);
  expect((withdrawn.body as Body).status).toBe("withdrawn");
  expect(code(await mirrored("POST", WITHDRAW, { session: admin, headers: ifm(2) }))).toEqual([
    422,
    "methodology_migration.not_open",
  ]);
  // The executed migration is no longer open either.
  expect(code(await mirrored("POST", `${ONE}/withdraw`, { session: admin, headers: ifm(5) }))).toEqual([
    422,
    "methodology_migration.not_open",
  ]);
}
