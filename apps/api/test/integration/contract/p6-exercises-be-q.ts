// P6 contract exercises of BE-Q (p6-plan §5.1, p6-work-split §2 rule 16). Stub created by T-DG6-BE-A and already
// called by contract.test.ts. T-DG6-BE-Q (p6-work-split §H/G.3) routes the 6 saved-view operations and exercises each
// here through `ctx.mirrored`: success and every declared refusal it can reach on the shared run database. Not reached
// here, on purpose: 403 on listSavedViews / getSavedView (a service principal; no session can be one), 409
// saved_view.default_conflict (a concurrent race; proven in test/integration/search/saved-views.test.ts) and the 429
// (the contract's live rate-limit sweep). T-DG6-BE-Q2 appends its block after this one.
// No shared zod mirror of these bodies exists in packages/shared/src/schemas (outside BE-Q's files); the mirror below
// restates the contract schema. All views are SYNTHETIC; nothing here grants a business approval or touches DG0-DG7.
import { expect } from "vitest";
import { z } from "zod";
import { ifm } from "../../support/p2-fixtures.ts";
import { signIn, uniq, type P6ExerciseContext } from "../../support/harness.ts";

const ts = z.iso.datetime({ offset: true });
const key = z.string().regex(/^[a-z][A-Za-z0-9]{0,63}$/);
const filterValue = z.string().min(1).max(200);
const savedView = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  ownerUserId: z.uuid(),
  ownerDisplayName: z.string(),
  isOwner: z.boolean(),
  listKey: z.enum([
    "transformations",
    "initiatives",
    "strategic_guardrails",
    "outcomes",
    "diagnostic_items",
    "diagnostic_findings",
    "workstream_outputs",
    "tom_gaps",
    "capability_heatmap",
    "journeys",
    "journey_pain_points",
    "search",
  ]),
  transformationId: z.uuid().nullable(),
  name: z.string().min(1).max(120),
  visibility: z.enum(["personal", "shared"]),
  columns: z.array(key).min(1).max(50),
  filters: z.record(key, z.union([filterValue, z.array(filterValue).min(1).max(20)])),
  sort: z.array(z.strictObject({ key, direction: z.enum(["asc", "desc"]) })).max(3),
  isDefault: z.boolean(),
  sharedAt: ts.nullable(),
  sharedBy: z.uuid().nullable(),
  status: z.enum(["active", "deleted"]),
  deletedAt: ts.nullable(),
  version: z.number().int().min(1),
  createdAt: ts,
  updatedAt: ts,
});
const savedViewPage = z.strictObject({ items: z.array(savedView), nextCursor: z.string().nullable() });

export const P6_MIRRORS_BE_Q: Readonly<Record<string, z.ZodType>> = {
  listSavedViews: savedViewPage,
  createSavedView: savedView,
  getSavedView: savedView,
  putSavedView: savedView,
  deleteSavedView: savedView,
  shareSavedView: savedView,
};

export async function exerciseP6BeQOperations(ctx: P6ExerciseContext): Promise<void> {
  const { world: w, mirrored } = ctx;
  const app = ctx.api.app;
  const office = await signIn(app, w.office.subject); // TO @ A: saved_view.manage and saved_view.share
  const admin = await signIn(app, w.admin.subject); // ADM_TECH + ADM_ACCESS @ A: saved_view.manage only
  const auditor = await signIn(app, w.auditor.subject); // AUD @ A: reads and applies, writes nothing
  const officeB = await signIn(app, w.officeB.subject); // another organization
  const nobody = await signIn(app, w.nobody.subject); // no grant
  const V = "/api/v1/saved-views";
  const name = uniq("Contract view ");
  const body = { listKey: "initiatives", name, columns: ["code", "name"], filters: { q: "synthetic" } };

  // createSavedView: 201; 400; 401; 403 (AUD; no grant); 404 (another organization's transformation is unreadable:
  // none here, so a random id); 409 name taken; 422 unknown key.
  const created = await mirrored("POST", V, { session: office, body });
  expect(created.status).toBe(201);
  expect(created.headers["etag"]).toBe('"1"');
  expect(created.headers["location"]).toBe(`${V}/${created.body.id}`);
  const id = created.body.id as string;
  expect((await mirrored("POST", V, { session: office, body: { ...body, columns: [] } })).status).toBe(400);
  expect((await mirrored("POST", V, { body })).status).toBe(401);
  expect((await mirrored("POST", V, { session: auditor, body: { ...body, name: uniq("A") } })).status).toBe(403);
  expect((await mirrored("POST", V, { session: nobody, body: { ...body, name: uniq("N") } })).status).toBe(403);
  const unreadable = await mirrored("POST", V, {
    session: office,
    body: { ...body, listKey: "outcomes", columns: ["statement"], filters: {}, transformationId: crypto.randomUUID() },
  });
  expect(unreadable.status).toBe(404);
  const taken = await mirrored("POST", V, { session: office, body: { ...body, name: name.toUpperCase() } });
  expect([taken.status, taken.body.code]).toEqual([409, "saved_view.name_taken"]);
  const unknown = await mirrored("POST", V, { session: office, body: { ...body, name: uniq("U"), columns: ["nope"] } });
  expect([unknown.status, unknown.body.code, unknown.body.params]).toEqual([
    422,
    "saved_view.unknown_key",
    { key: "nope" },
  ]);

  // listSavedViews: 200 (own first); 400 (missing listKey); 401. AUD lists too (200).
  const listed = await mirrored("GET", `${V}?listKey=initiatives&limit=100`, { session: office });
  expect(listed.status).toBe(200);
  expect(listed.body.items.some((v: { id: string }) => v.id === id)).toBe(true);
  expect((await mirrored("GET", V, { session: office })).status).toBe(400);
  expect((await mirrored("GET", `${V}?listKey=initiatives`)).status).toBe(401);
  expect((await mirrored("GET", `${V}?listKey=initiatives`, { session: auditor })).status).toBe(200);

  // getSavedView: 200; 400; 401; 404 (personal view of someone else; another organization; unknown).
  const got = await mirrored("GET", `${V}/${id}`, { session: office });
  expect([got.status, got.body.isOwner, got.headers["etag"]]).toEqual([200, true, '"1"']);
  expect((await mirrored("GET", `${V}/not-a-uuid`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", `${V}/${id}`)).status).toBe(401);
  expect((await mirrored("GET", `${V}/${id}`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", `${V}/${id}`, { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", `${V}/${crypto.randomUUID()}`, { session: office })).status).toBe(404);

  // putSavedView: 200; 400; 401; 404 (AUD and admin: a personal view of someone else); 422; 428; 409 stale; the 403s
  // (saved_view.not_owner; AUD) once the view is shared, below.
  const update = { name, columns: ["code"], filters: {}, sort: [{ key: "code", direction: "asc" }], isDefault: true };
  const put = await mirrored("PUT", `${V}/${id}`, { session: office, body: update, headers: ifm(1) });
  expect([put.status, put.body.version, put.body.isDefault]).toEqual([200, 2, true]);
  expect((await mirrored("PUT", `${V}/${id}`, { session: office, body: { name }, headers: ifm(2) })).status).toBe(400);
  expect((await mirrored("PUT", `${V}/${id}`, { body: update, headers: ifm(2) })).status).toBe(401);
  expect((await mirrored("PUT", `${V}/${id}`, { session: auditor, body: update, headers: ifm(2) })).status).toBe(404);
  expect((await mirrored("PUT", `${V}/${id}`, { session: admin, body: update, headers: ifm(2) })).status).toBe(404);
  const badSort = { ...update, sort: [{ key: "budget", direction: "asc" }] };
  const unknownSort = await mirrored("PUT", `${V}/${id}`, { session: office, body: badSort, headers: ifm(2) });
  expect([unknownSort.status, unknownSort.body.code]).toEqual([422, "saved_view.unknown_key"]);
  expect((await mirrored("PUT", `${V}/${id}`, { session: office, body: update })).status).toBe(428);
  const stale = await mirrored("PUT", `${V}/${id}`, { session: office, body: update, headers: ifm(1) });
  expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);

  // shareSavedView: 200 (shared; another user of the organization then reads it; a non-owner gets 403
  // saved_view.not_owner); 400; 401; 403 (admin cannot share its own view: no saved_view.share); 404; 428; 409 stale.
  const shared = await mirrored("POST", `${V}/${id}/share`, {
    session: office,
    body: { shared: true },
    headers: ifm(2),
  });
  expect([shared.status, shared.body.visibility, shared.body.version]).toEqual([200, "shared", 3]);
  const asAdmin = await mirrored("GET", `${V}/${id}`, { session: admin });
  expect([asAdmin.status, asAdmin.body.isOwner]).toEqual([200, false]);
  const notOwner = await mirrored("PUT", `${V}/${id}`, { session: admin, body: update, headers: ifm(3) });
  expect([notOwner.status, notOwner.body.code]).toEqual([403, "saved_view.not_owner"]);
  expect((await mirrored("PUT", `${V}/${id}`, { session: auditor, body: update, headers: ifm(3) })).status).toBe(403);
  expect((await mirrored("DELETE", `${V}/${id}`, { session: auditor, headers: ifm(3) })).status).toBe(403);
  expect((await mirrored("POST", `${V}/${id}/share`, { session: office, body: {}, headers: ifm(3) })).status).toBe(400);
  expect((await mirrored("POST", `${V}/${id}/share`, { body: { shared: false }, headers: ifm(3) })).status).toBe(401);
  const adminView = await mirrored("POST", V, { session: admin, body: { ...body, name: uniq("Admin view ") } });
  expect(adminView.status).toBe(201);
  const adminShare = await mirrored("POST", `${V}/${adminView.body.id}/share`, {
    session: admin,
    body: { shared: true },
    headers: ifm(1),
  });
  expect(adminShare.status).toBe(403);
  const S404 = `${V}/${crypto.randomUUID()}/share`;
  expect((await mirrored("POST", S404, { session: office, body: { shared: true }, headers: ifm(1) })).status).toBe(404);
  expect((await mirrored("POST", `${V}/${id}/share`, { session: office, body: { shared: false } })).status).toBe(428);
  const staleShare = await mirrored("POST", `${V}/${id}/share`, {
    session: office,
    body: { shared: false },
    headers: ifm(1),
  });
  expect(staleShare.status).toBe(409);
  const unshared = await mirrored("POST", `${V}/${id}/share`, {
    session: office,
    body: { shared: false },
    headers: ifm(3),
  });
  expect([unshared.status, unshared.body.visibility, unshared.body.version]).toEqual([200, "personal", 4]);

  // deleteSavedView: 200 (the deleted view); 400; 401; 403 (AUD, above, on the shared view); 404 (AUD and another
  // organization, on the personal view); 428; 409 stale; 409 saved_view.deleted.
  expect((await mirrored("DELETE", `${V}/not-a-uuid`, { session: office, headers: ifm(4) })).status).toBe(400);
  expect((await mirrored("DELETE", `${V}/${id}`, { headers: ifm(4) })).status).toBe(401);
  expect((await mirrored("DELETE", `${V}/${id}`, { session: auditor, headers: ifm(4) })).status).toBe(404);
  expect((await mirrored("DELETE", `${V}/${id}`, { session: officeB, headers: ifm(4) })).status).toBe(404);
  expect((await mirrored("DELETE", `${V}/${id}`, { session: office })).status).toBe(428);
  expect((await mirrored("DELETE", `${V}/${id}`, { session: office, headers: ifm(3) })).status).toBe(409);
  const deleted = await mirrored("DELETE", `${V}/${id}`, { session: office, headers: ifm(4) });
  expect([deleted.status, deleted.body.status, deleted.body.isDefault, deleted.body.version]).toEqual([
    200,
    "deleted",
    false,
    5,
  ]);
  const again = await mirrored("DELETE", `${V}/${id}`, { session: office, headers: ifm(5) });
  expect([again.status, again.body.code]).toEqual([409, "saved_view.deleted"]);
  const putDeleted = await mirrored("PUT", `${V}/${id}`, { session: office, body: update, headers: ifm(5) });
  expect([putDeleted.status, putDeleted.body.code]).toEqual([409, "saved_view.deleted"]);
}
