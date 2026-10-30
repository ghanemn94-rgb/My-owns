// P6 contract exercises of BE-O (p6-plan §5.1, p6-work-split §2 rule 16, §B/A.8; ADR-0055 §6, §9). T-DG6-BE-O routes
// the three deliverable external-change operations and exercises each here through `ctx.mirrored` (success and every
// declared refusal it can reach), with the zod mirrors of the JSON success bodies below (no shared zod mirror exists
// for them in packages/shared; they restate the contract schema DeliverableConfirmation).
//
// Not reachable, by design: getDeliverableConfirmation 403 (the read is the deliverable's transformation read, which
// answers 404, never 403); putDeliverableExternalChange 422 (its only business rule, `other` needs a description, is a
// 400 validation error; the confirmation refusals are 409s). Every value is SYNTHETIC; confirming an external change
// approves nothing (G1-G6) and never touches DG0-DG7.
import { expect } from "vitest";
import { z } from "zod";
import { createTransformationRow, createUser, grant, signIn, type P6ExerciseContext } from "../../support/harness.ts";
import { insertDeliverable, insertInitiative, type BenefitWorld } from "../benefits/fixtures.ts";

const ts = z.string().datetime({ offset: true });
const changeType = z.enum(["customer_system", "network_upgrade", "procurement_transaction", "other"]);
const status = z.enum(["unconfirmed", "confirmed"]);
const externalChange = z.strictObject({
  id: z.uuid(),
  isExternalChange: z.boolean(),
  changeType,
  description: z.string().max(2000).nullable(),
  confirmationStatus: status,
  confirmationSource: z.enum(["reviewed_evidence", "connector_result"]).nullable(),
  evidenceId: z.uuid().nullable(),
  outboundWriteId: z.uuid().nullable(),
  connectorId: z.uuid().nullable(),
  sourceSystemId: z.string().nullable(),
  sourceReference: z.string().nullable(),
  sourceConfirmedAt: ts.nullable(),
  serviceIdentityId: z.uuid().nullable(),
  confirmedAt: ts.nullable(),
  confirmedBy: z.uuid().nullable(),
  confirmationNote: z.string().nullable(),
  version: z.number().int().min(1),
  events: z.array(
    z.strictObject({
      recordVersion: z.number().int().min(1),
      isExternalChange: z.boolean(),
      changeType,
      confirmationStatus: status,
      confirmationSource: z.string().nullable(),
      actorUserId: z.uuid().nullable(),
      occurredAt: ts,
    }),
  ),
});
const deliverableConfirmation = z.strictObject({
  deliverableId: z.uuid(),
  transformationId: z.uuid(),
  externalChange: externalChange.nullable(),
});

export const P6_MIRRORS_BE_O: Readonly<Record<string, z.ZodType>> = {
  getDeliverableConfirmation: deliverableConfirmation,
  putDeliverableExternalChange: deliverableConfirmation,
  confirmDeliverableExternalChange: deliverableConfirmation,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });

export async function exerciseP6BeOOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const missing = crypto.randomUUID();
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const tl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, tl.id, "TL", scope, w.orgA.id);
  const bo = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "BO", scope, w.orgA.id);
  const [lead, owner, office, auditor, outsider] = await Promise.all([
    signIn(api.app, tl.subject), // TL: external_change.flag (not confirm)
    signIn(api.app, bo.subject), // BO: external_change.flag + external_change.confirm
    signIn(api.app, w.office.subject), // TO @ A: reviews the evidence
    signIn(api.app, w.auditor.subject), // AUD @ A: reads only
    signIn(api.app, w.officeB.subject), // TO @ B: out of scope
  ]);
  const fixture = { organizationId: w.orgA.id, transformationId, users: { tl } } as unknown as BenefitWorld;
  const deliverableId = await insertDeliverable(api.db, fixture, await insertInitiative(api.db, fixture));
  const C = `/api/v1/deliverables/${deliverableId}/confirmation`;
  const X = `/api/v1/deliverables/${deliverableId}/external-change`;
  const E = `/api/v1/transformations/${transformationId}/evidence`;
  const evidence = async (kind: "note" | "file_reference", verify: boolean): Promise<string> => {
    const created = await mirrored("POST", E, {
      session: lead,
      body:
        kind === "note"
          ? { kind, title: "Synthetic go-live record", noteBody: "Synthetic: live.", ownerUserId: tl.id }
          : { kind, title: "Synthetic filename link", fileName: "signoff.pdf", ownerUserId: tl.id },
    });
    expect(created.status).toBe(201);
    if (verify) {
      const reviewed = await mirrored("POST", `${E}/${created.body.id}/review`, {
        session: office,
        headers: ifm(1),
        body: { result: "verified", accessibilityStatus: "accessible", note: "Synthetic: checked" },
      });
      expect(reviewed.status).toBe(200);
    }
    return created.body.id as string;
  };

  // getDeliverableConfirmation: 200 (never flagged: null, ETag "0"); 400; 401; 404 (outsider; unknown).
  const none = await mirrored("GET", C, { session: auditor });
  expect([none.status, none.headers["etag"], (none.body as { externalChange: unknown }).externalChange]).toEqual([
    200,
    '"0"',
    null,
  ]);
  expect((await mirrored("GET", "/api/v1/deliverables/not-a-uuid/confirmation", { session: auditor })).status).toBe(
    400,
  );
  expect((await mirrored("GET", C)).status).toBe(401);
  expect((await mirrored("GET", C, { session: outsider })).status).toBe(404);
  expect((await mirrored("GET", `/api/v1/deliverables/${missing}/confirmation`, { session: auditor })).status).toBe(
    404,
  );

  // putDeliverableExternalChange: 200 (If-Match "0" creates; a change); 400; 401; 403 (AUD); 404; 409 (stale;
  // not_flagged); 428.
  const flagBody = { isExternalChange: true, changeType: "customer_system", description: "Synthetic: billing change." };
  expect((await mirrored("PUT", X, { session: lead, headers: ifm(0), body: { ...flagBody, extra: 1 } })).status).toBe(
    400,
  );
  expect((await mirrored("PUT", X, { headers: ifm(0), body: flagBody })).status).toBe(401);
  expect((await mirrored("PUT", X, { session: auditor, headers: ifm(0), body: flagBody })).status).toBe(403);
  expect(
    (
      await mirrored("PUT", `/api/v1/deliverables/${missing}/external-change`, {
        session: lead,
        headers: ifm(0),
        body: flagBody,
      })
    ).status,
  ).toBe(404);
  expect((await mirrored("PUT", X, { session: lead, body: flagBody })).status).toBe(428);
  const notFlagged = await mirrored("PUT", X, {
    session: lead,
    headers: ifm(0),
    body: { ...flagBody, isExternalChange: false },
  });
  expect([notFlagged.status, (notFlagged.body as { code: string }).code]).toEqual([409, "external_change.not_flagged"]);
  const flagged = await mirrored("PUT", X, { session: lead, headers: ifm(0), body: flagBody });
  expect([flagged.status, flagged.headers["etag"]]).toEqual([200, '"1"']);
  expect((await mirrored("PUT", X, { session: lead, headers: ifm(0), body: flagBody })).status).toBe(409);
  const changed = await mirrored("PUT", X, {
    session: owner,
    headers: ifm(1),
    body: { ...flagBody, changeType: "network_upgrade" },
  });
  expect([changed.status, changed.headers["etag"]]).toEqual([200, '"2"']);

  // confirmDeliverableExternalChange: 200; 400; 401; 403 (AUD; TL); 404 (evidence elsewhere: unknown id); 409 (stale;
  // already confirmed); 422 (a filename-only link); 428.
  const verified = await evidence("note", true);
  const filename = await evidence("file_reference", false);
  const body = { evidenceId: verified, note: "Synthetic: reviewed go-live record." };
  expect((await mirrored("POST", C, { session: owner, headers: ifm(2), body: { evidenceId: verified } })).status).toBe(
    400,
  );
  expect((await mirrored("POST", C, { headers: ifm(2), body })).status).toBe(401);
  expect((await mirrored("POST", C, { session: auditor, headers: ifm(2), body })).status).toBe(403);
  expect((await mirrored("POST", C, { session: lead, headers: ifm(2), body })).status).toBe(403);
  expect(
    (await mirrored("POST", C, { session: owner, headers: ifm(2), body: { evidenceId: missing, note: null } })).status,
  ).toBe(404);
  expect((await mirrored("POST", C, { session: owner, body })).status).toBe(428);
  expect((await mirrored("POST", C, { session: owner, headers: ifm(1), body })).status).toBe(409);
  const refused = await mirrored("POST", C, {
    session: owner,
    headers: ifm(2),
    body: { evidenceId: filename, note: null },
  });
  expect([refused.status, (refused.body as { code: string }).code]).toEqual([
    422,
    "external_change.evidence_not_verified",
  ]);
  const confirmed = await mirrored("POST", C, { session: owner, headers: ifm(2), body });
  expect([confirmed.status, confirmed.headers["etag"]]).toEqual([200, '"3"']);
  const again = await mirrored("POST", C, { session: owner, headers: ifm(3), body });
  expect([again.status, (again.body as { code: string }).code]).toEqual([409, "external_change.already_confirmed"]);
  const read = await mirrored("GET", C, { session: auditor });
  expect((read.body as { externalChange: { confirmationSource: string } }).externalChange.confirmationSource).toBe(
    "reviewed_evidence",
  );
}
