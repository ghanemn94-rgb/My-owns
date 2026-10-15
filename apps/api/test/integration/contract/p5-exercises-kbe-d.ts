// P5 contract exercises of KBE-D (p5-work-split §F.3 and §2 rule 14; T-DG5-KBE-D): the seven owner-update operations
// (list, create, get, update, submit, reopen, revisions), each with a success and every declared refusal it can reach,
// through the validating client. Every value is synthetic; submitting an update approves nothing, and nothing touches
// the engineering gates DG0-DG7.
//
// Declared but not reachable here: 401 (the identity hook's own suite); 429 (the rate limiter's own suite); 403 on the
// reads (every caller who can see a transformation holds transformation.read, so a caller who cannot gets 404).
import { ownerUpdate, ownerUpdatePage, ownerUpdateRevisionPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { createUser, grant, signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_KBE_D: Readonly<Record<string, z.ZodType>> = {
  listOwnerUpdates: ownerUpdatePage,
  createOwnerUpdate: ownerUpdate,
  getOwnerUpdate: ownerUpdate,
  updateOwnerUpdate: ownerUpdate,
  submitOwnerUpdate: ownerUpdate,
  reopenOwnerUpdate: ownerUpdate,
  listOwnerUpdateRevisions: ownerUpdateRevisionPage,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

export async function exerciseP5KbeDOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const code = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];
  const p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const U = `${T}/updates`;
  const lead = p.lead.session;
  const auditor = p.auditor.session;
  const wl = p.contributor.session;
  const nobody = await signIn(api.app, w.nobody.subject);
  const office = await signIn(api.app, w.office.subject);
  const other = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, other.id, "WL", { type: "transformation", id: p.transformationId }, w.orgA.id);
  const otherWl = await signIn(api.app, other.subject);
  const missing = crypto.randomUUID();

  // Fixtures (through the API): a workstream led by the WL, an open and a closed monthly period.
  const ws = await mirrored("POST", `${T}/workstreams`, {
    session: lead,
    body: { name: "Synthetic contract workstream", leadUserId: p.contributor.id },
  });
  expect(ws.status).toBe(201);
  const RP = `/api/v1/organizations/${w.orgA.id}/reporting-periods`;
  const period = async (label: string, start: string, end: string, due: string, close: boolean) => {
    const c = await mirrored("POST", RP, {
      session: office,
      body: { frequency: "monthly", periodLabel: label, periodStart: start, periodEnd: end, updateDueDate: due },
    });
    expect(c.status).toBe(201);
    expect((await mirrored("POST", `${RP}/${c.body.id}/open`, { session: office, headers: ifm(1) })).status).toBe(200);
    if (close)
      expect((await mirrored("POST", `${RP}/${c.body.id}/close`, { session: office, headers: ifm(2) })).status).toBe(
        200,
      );
    return c.body.id as string;
  };
  const open = await period("2071-07", "2071-07-01", "2071-07-31", "2071-08-10", false);
  const closed = await period("2071-06", "2071-06-01", "2071-06-30", "2071-07-10", true);
  const body = (extra: Record<string, unknown> = {}) => ({
    subjectType: "workstream",
    subjectId: ws.body.id,
    reportingPeriodId: open,
    ...extra,
  });

  // createOwnerUpdate: 400; 403 (AUD; a non-lead WL: owner_update.not_owner); 404; 422; 201; 409.
  expect((await mirrored("POST", U, { session: wl, body: body({ extra: 1 }) })).status).toBe(400);
  expect((await mirrored("POST", U, { session: auditor, body: body() })).status).toBe(403);
  expect(code(await mirrored("POST", U, { session: otherWl, body: body() }))).toEqual([403, "owner_update.not_owner"]);
  expect((await mirrored("POST", U, { session: nobody, body: body() })).status).toBe(404);
  expect(code(await mirrored("POST", U, { session: wl, body: body({ reportingPeriodId: closed }) }))).toEqual([
    422,
    "owner_update.period_not_open",
  ]);
  const created = await mirrored("POST", U, { session: wl, body: body() });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  expect(code(await mirrored("POST", U, { session: wl, body: body({ asks: "Synthetic" }) }))).toEqual([
    409,
    "owner_update.exists",
  ]);

  // listOwnerUpdates: 200; 400; 404.
  expect((await mirrored("GET", `${U}?reportingPeriodId=${open}&status=draft`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${U}?status=open`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", U, { session: nobody })).status).toBe(404);

  // getOwnerUpdate and listOwnerUpdateRevisions: 200; 400; 404.
  for (const suffix of ["", "/revisions"]) {
    expect((await mirrored("GET", `${U}/${id}${suffix}`, { session: auditor })).status).toBe(200);
    expect((await mirrored("GET", `${U}/not-a-uuid${suffix}`, { session: auditor })).status).toBe(400);
    expect((await mirrored("GET", `${U}/${missing}${suffix}`, { session: auditor })).status).toBe(404);
    expect((await mirrored("GET", `${U}/${id}${suffix}`, { session: nobody })).status).toBe(404);
  }

  // submitOwnerUpdate on an empty draft: 422 owner_update.empty.
  expect(code(await mirrored("POST", `${U}/${id}/submit`, { session: wl, headers: ifm(1) }))).toEqual([
    422,
    "owner_update.empty",
  ]);

  // updateOwnerUpdate: 400; 403; 404; 428; 409; 200.
  const P = `${U}/${id}`;
  const text = { achievements: "Synthetic contract achievement" };
  expect((await mirrored("PATCH", P, { session: wl, headers: ifm(1), body: {} })).status).toBe(400);
  expect((await mirrored("PATCH", P, { session: auditor, headers: ifm(1), body: text })).status).toBe(403);
  expect(code(await mirrored("PATCH", P, { session: otherWl, headers: ifm(1), body: text }))).toEqual([
    403,
    "owner_update.not_owner",
  ]);
  expect((await mirrored("PATCH", `${U}/${missing}`, { session: wl, headers: ifm(1), body: text })).status).toBe(404);
  expect(code(await mirrored("PATCH", P, { session: wl, body: text }))).toEqual([428, "precondition_required"]);
  expect(code(await mirrored("PATCH", P, { session: wl, headers: ifm(9), body: text }))).toEqual([
    409,
    "version_conflict",
  ]);
  expect((await mirrored("PATCH", P, { session: wl, headers: ifm(1), body: text })).status).toBe(200);

  // reopenOwnerUpdate on a draft: 422 owner_update.not_submitted.
  const R = `${P}/reopen`;
  const why = { reason: "Synthetic correction" };
  expect(code(await mirrored("POST", R, { session: wl, headers: ifm(2), body: why }))).toEqual([
    422,
    "owner_update.not_submitted",
  ]);

  // submitOwnerUpdate: 400 (a malformed If-Match); 403; 404; 428; 409; 200; 422 not_draft.
  const S = `${P}/submit`;
  expect((await mirrored("POST", `${U}/not-a-uuid/submit`, { session: wl, headers: ifm(2) })).status).toBe(400);
  expect((await mirrored("POST", S, { session: auditor, headers: ifm(2) })).status).toBe(403);
  expect((await mirrored("POST", `${U}/${missing}/submit`, { session: wl, headers: ifm(2) })).status).toBe(404);
  expect(code(await mirrored("POST", S, { session: wl }))).toEqual([428, "precondition_required"]);
  expect(code(await mirrored("POST", S, { session: wl, headers: ifm(7) }))).toEqual([409, "version_conflict"]);
  const submitted = await mirrored("POST", S, { session: wl, headers: ifm(2) });
  expect([submitted.status, submitted.body.status, submitted.body.revisionNo]).toEqual([200, "submitted", 1]);
  expect(code(await mirrored("POST", S, { session: wl, headers: ifm(3) }))).toEqual([422, "owner_update.not_draft"]);
  expect(code(await mirrored("PATCH", P, { session: wl, headers: ifm(3), body: text }))).toEqual([
    422,
    "owner_update.not_draft",
  ]);

  // reopenOwnerUpdate: 400; 403; 404; 428; 409; 200.
  expect((await mirrored("POST", R, { session: wl, headers: ifm(3), body: { reason: "x" } })).status).toBe(400);
  expect((await mirrored("POST", R, { session: auditor, headers: ifm(3), body: why })).status).toBe(403);
  expect((await mirrored("POST", `${U}/${missing}/reopen`, { session: wl, headers: ifm(3), body: why })).status).toBe(
    404,
  );
  expect(code(await mirrored("POST", R, { session: wl, body: why }))).toEqual([428, "precondition_required"]);
  expect(code(await mirrored("POST", R, { session: wl, headers: ifm(8), body: why }))).toEqual([
    409,
    "version_conflict",
  ]);
  const reopened = await mirrored("POST", R, { session: wl, headers: ifm(3), body: why });
  expect([reopened.status, reopened.body.status, reopened.body.reopenReason]).toEqual([
    200,
    "draft",
    "Synthetic correction",
  ]);

  // The revisions read after a submission: one revision, newest first.
  const revs = await mirrored("GET", `${P}/revisions?limit=10`, { session: auditor });
  expect([revs.status, (revs.body as Body).items.length]).toEqual([200, 1]);
}
