// P6 contract exercises of BE-B (p6-plan §5.1, p6-work-split §2 rule 16; T-DG6-BE-B): the six record-sensitivity and
// sensitive-grant operations of ADR-0051 §2, each with a success and every declared refusal it can reach, through the
// contract-validating client `mirrored` (each success body is also checked against its zod mirror below). Every value
// is SYNTHETIC. A grant is an access decision, never a business approval; nothing here touches DG0-DG7.
import { recordSensitivity, sensitiveGrant, sensitiveGrantPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createTransformationRow, createUser, grant, signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_B: Readonly<Record<string, z.ZodType>> = {
  getRecordSensitivity: recordSensitivity,
  putRecordSensitivity: recordSensitivity,
  listSensitiveGrants: sensitiveGrantPage,
  createSensitiveGrant: sensitiveGrant,
  getSensitiveGrant: sensitiveGrant,
  revokeSensitiveGrant: sensitiveGrant,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const MISSING = "01900000-0000-7000-8000-00000000beef";

export async function exerciseP6BeBOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const transformationId = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  const scope = { type: "transformation" as const, id: transformationId };
  const bo = await createUser(api.db, w.orgA.id);
  const wl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, bo.id, "BO", scope, w.orgA.id);
  await grant(api.db, w.grantor.id, wl.id, "WL", scope, w.orgA.id);
  const boS = await signIn(api.app, bo.subject);
  const wlS = await signIn(api.app, wl.subject);
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const outsider = await signIn(api.app, w.officeB.subject);
  const base = `/api/v1/transformations/${transformationId}`;
  const created = await m("POST", `${base}/benefits`, {
    session: boS,
    body: {
      title: "Synthetic contract benefit",
      description: "Synthetic.",
      benefitType: "revenue",
      valueClass: "revenue_uplift",
      ownerUserId: bo.id,
      currency: "SAR",
      financialStatementLine: "Revenue - prepaid",
    },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const benefitId = created.body.id as string;
  const FLAG = `${base}/records/benefit/${benefitId}/sensitivity`;
  const status = async (p: Promise<{ status: number; body: Body }>, expected: number, code?: string) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // getRecordSensitivity: 200 (version 0), 400, 404.
  const flag0 = await status(m("GET", FLAG, { session: wlS }), 200);
  expect(flag0.body).toMatchObject({ version: 0, isSensitive: false });
  await status(m("GET", `${base}/records/kpi/${benefitId}/sensitivity`, { session: office }), 400);
  await status(m("GET", FLAG, { session: outsider }), 404, "not_found");

  // putRecordSensitivity: 428, 400, 422, 403 (AUD), 404, 200 create, 409 stale.
  const mark = { isSensitive: true, reason: "Synthetic commercial terms" };
  await status(m("PUT", FLAG, { session: office, body: mark }), 428, "precondition_required");
  await status(m("PUT", FLAG, { session: office, body: { isSensitive: true }, headers: ifm(0) }), 400);
  await status(
    m("PUT", FLAG, { session: office, body: { isSensitive: true, reason: "x" }, headers: ifm(0) }),
    422,
    "sensitivity.reason_required",
  );
  await status(m("PUT", FLAG, { session: auditor, body: mark, headers: { "if-match": '"0"' } }), 403, "forbidden");
  await status(m("PUT", FLAG, { session: outsider, body: mark, headers: { "if-match": '"0"' } }), 404, "not_found");
  const marked = await status(m("PUT", FLAG, { session: office, body: mark, headers: { "if-match": '"0"' } }), 200);
  expect(marked.body).toMatchObject({ isSensitive: true, version: 1 });
  await status(
    m("PUT", FLAG, { session: office, body: mark, headers: { "if-match": '"0"' } }),
    409,
    "version_conflict",
  );

  // createSensitiveGrant: 201, 400, 403 (AUD), 404, 409 duplicate, 422 not_self.
  const GRANTS = "/api/v1/admin/sensitive-grants";
  const body = {
    transformationId,
    recordType: "benefit",
    recordId: benefitId,
    granteeUserId: wl.id,
    reason: "Synthetic need",
  };
  await status(m("POST", GRANTS, { session: office, body: { ...body, granteeUserId: "nope" } }), 400);
  await status(m("POST", GRANTS, { session: auditor, body }), 403, "forbidden");
  await status(m("POST", GRANTS, { session: office, body: { ...body, recordId: MISSING } }), 404, "not_found");
  await status(
    m("POST", GRANTS, { session: office, body: { ...body, granteeUserId: w.office.id } }),
    422,
    "sensitive_grant.not_self",
  );
  const g = await status(m("POST", GRANTS, { session: office, body }), 201);
  await status(m("POST", GRANTS, { session: office, body }), 409, "sensitive_grant.duplicate");
  const grantId = g.body.id as string;

  // listSensitiveGrants: 200 (AUD), 400, 403, 404.
  const list = await status(m("GET", `${GRANTS}?transformationId=${transformationId}`, { session: auditor }), 200);
  expect(list.body.items.map((x: Body) => x.id)).toEqual([grantId]);
  await status(m("GET", GRANTS, { session: office }), 400);
  await status(m("GET", `${GRANTS}?transformationId=${transformationId}`, { session: wlS }), 403, "forbidden");
  await status(m("GET", `${GRANTS}?transformationId=${transformationId}`, { session: outsider }), 404, "not_found");

  // getSensitiveGrant: 200, 400, 404.
  await status(m("GET", `${GRANTS}/${grantId}`, { session: auditor }), 200);
  await status(m("GET", `${GRANTS}/not-a-uuid`, { session: office }), 400);
  await status(m("GET", `${GRANTS}/${grantId}`, { session: wlS }), 404, "not_found");

  // revokeSensitiveGrant: 428, 400, 403 (AUD), 404, 409 stale, 200, 422 invalid_transition.
  const REVOKE = `${GRANTS}/${grantId}/revoke`;
  const reason = { reason: "Synthetic need ended" };
  await status(m("POST", REVOKE, { session: office, body: reason }), 428, "precondition_required");
  await status(m("POST", REVOKE, { session: office, body: {}, headers: ifm(1) }), 400);
  await status(m("POST", REVOKE, { session: auditor, body: reason, headers: ifm(1) }), 403, "forbidden");
  await status(
    m("POST", `${GRANTS}/${MISSING}/revoke`, { session: office, body: reason, headers: ifm(1) }),
    404,
    "not_found",
  );
  await status(m("POST", REVOKE, { session: office, body: reason, headers: ifm(4) }), 409, "version_conflict");
  const revoked = await status(m("POST", REVOKE, { session: office, body: reason, headers: ifm(1) }), 200);
  expect(revoked.body).toMatchObject({ status: "revoked", version: 2 });
  await status(m("POST", REVOKE, { session: office, body: reason, headers: ifm(2) }), 422, "invalid_transition");
}
