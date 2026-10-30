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
import { createTransformationRow, signIn, uniq, type P6ExerciseContext } from "../../support/harness.ts";

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
  ...p6MirrorsBeQ2(), // T-DG6-BE-Q2's four operations (its block below)
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

  await exerciseP6BeQ2Operations(ctx); // T-DG6-BE-Q2's block, after BE-Q's (p6-work-split §H/G.12)
}

// ------------------------------------------------------------------------------------------------ T-DG6-BE-Q2
// T-DG6-BE-Q2 (p6-work-split §H/G.4) routes listMyFormDrafts, compareFormRecordVersions, listHelpTopics and getHelpTopic
// and exercises each here through `ctx.mirrored`: success and every declared refusal it can reach on the shared run
// database. Not reached here, on purpose: 403 on the four reads (each needs only a signed-in user, or
// transformation.read where a caller without it gets the ADR-0006 404; only a service principal is refused 403, and no
// session can be one) and the 429 (the contract's live rate-limit sweep). No shared zod mirror of these bodies exists in
// packages/shared/src/schemas; the mirrors restate the contract schemas (MyFormDraftPage, FormRecordComparison,
// HelpTopicPage, HelpTopic). The mirrors are built in a hoisted function so BE-Q's map above can include them.
// All records are SYNTHETIC; nothing here grants a business approval or touches DG0-DG7.

function p6MirrorsBeQ2(): Record<string, z.ZodType> {
  const ts = z.iso.datetime({ offset: true });
  const recordType = z.string().regex(/^(T[0-9]{2}|[a-z][a-z_]*)$/);
  const myFormDraft = z.strictObject({
    id: z.uuid(),
    transformationId: z.uuid(),
    transformationCode: z.string(),
    transformationName: z.string(),
    recordType,
    recordId: z.uuid().nullable(),
    baseRecordVersion: z.number().int().min(1).nullable(),
    baseChanged: z.boolean(),
    version: z.number().int().min(1),
    createdAt: ts,
    updatedAt: ts,
  });
  const value = z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.unknown()),
    z.record(z.string(), z.unknown()),
    z.null(),
  ]);
  const comparison = z.strictObject({
    transformationId: z.uuid(),
    recordType,
    recordId: z.uuid(),
    fromVersion: z.number().int().min(1),
    toVersion: z.number().int().min(2),
    currentVersion: z.number().int().min(1),
    valuesWithheld: z.boolean(),
    fields: z.array(
      z.strictObject({
        fieldKey: z.string(),
        labelEn: z.string(),
        labelAr: z.string(),
        recorded: z.boolean(),
        from: value.optional(),
        to: value.optional(),
      }),
    ),
  });
  const helpTopic = z.strictObject({
    topicKey: z.string(),
    screenKey: z.string(),
    ordinal: z.number().int().min(1),
    titleEn: z.string(),
    titleAr: z.string(),
    bodyEn: z.string(),
    bodyAr: z.string(),
    arabicProvisional: z.boolean(),
    sourceRefs: z.array(z.string().regex(/^(M0[0-9]{3}|B0[0-9]{3}|REQ-S[0-9]{2}-[0-9]{3})$/)).min(1),
  });
  return {
    listMyFormDrafts: z.strictObject({ items: z.array(myFormDraft), nextCursor: z.string().nullable() }),
    compareFormRecordVersions: comparison,
    listHelpTopics: z.strictObject({ items: z.array(helpTopic), nextCursor: z.string().nullable() }),
    getHelpTopic: helpTopic,
  };
}

export async function exerciseP6BeQ2Operations(ctx: P6ExerciseContext): Promise<void> {
  const { world: w, mirrored } = ctx;
  const app = ctx.api.app;
  const office = await signIn(app, w.office.subject); // TO @ A: initiative.edit and audit.read
  const auditor = await signIn(app, w.auditor.subject); // AUD @ A: reads, audit.read, writes nothing
  const officeB = await signIn(app, w.officeB.subject); // another organization
  const t = await createTransformationRow(ctx.api.db, w.orgA.id, w.a1, w.office.id);

  // A synthetic initiative at version 2 (created, then one PATCH) for the comparison.
  const ini = await mirrored("POST", "/api/v1/initiatives", {
    session: office,
    body: { transformationId: t, name: uniq("Synthetic BE-Q2 contract initiative "), objective: "Synthetic v1" },
  });
  expect(ini.status).toBe(201);
  const patched = await mirrored("PATCH", `/api/v1/initiatives/${ini.body.id}`, {
    session: office,
    body: { objective: "Synthetic v2" },
    headers: ifm(1),
  });
  expect(patched.status).toBe(200);

  // compareFormRecordVersions: 200 (values for audit.read); 400 (schema bound); 401; 404 (another organization);
  // 422 form_record.compare_versions_invalid.
  const C = `/api/v1/transformations/${t}/form-records/T05/${ini.body.id}/compare`;
  const cmp = await mirrored("GET", `${C}?fromVersion=1&toVersion=2`, { session: auditor });
  expect([cmp.status, cmp.body.valuesWithheld, cmp.body.currentVersion]).toEqual([200, false, 2]);
  expect(cmp.body.fields).toEqual([
    expect.objectContaining({ fieldKey: "objective", from: "Synthetic v1", to: "Synthetic v2" }),
  ]);
  expect((await mirrored("GET", `${C}?fromVersion=1&toVersion=1`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${C}?fromVersion=1&toVersion=2`)).status).toBe(401);
  expect((await mirrored("GET", `${C}?fromVersion=1&toVersion=2`, { session: officeB })).status).toBe(404);
  const invalid = await mirrored("GET", `${C}?fromVersion=1&toVersion=3`, { session: office });
  expect([invalid.status, invalid.body.code]).toEqual([422, "form_record.compare_versions_invalid"]);

  // listMyFormDrafts: 200 (the caller's open draft, newest first); 400 (unknown parameter; foreign cursor); 401.
  const draft = await mirrored("POST", `/api/v1/transformations/${t}/form-drafts`, {
    session: office,
    body: { recordType: "T05", payload: { name: "Synthetic contract draft" } },
  });
  expect(draft.status).toBe(201);
  const mine = await mirrored("GET", "/api/v1/me/form-drafts?limit=100", { session: office });
  expect(mine.status).toBe(200);
  expect(mine.body.items[0]).toMatchObject({ id: draft.body.id, transformationId: t, recordType: "T05" });
  expect((await mirrored("GET", "/api/v1/me/form-drafts?status=open", { session: office })).status).toBe(400);
  expect((await mirrored("GET", "/api/v1/me/form-drafts?cursor=bm90LWEtY3Vyc29y", { session: office })).status).toBe(
    400,
  );
  expect((await mirrored("GET", "/api/v1/me/form-drafts")).status).toBe(401);
  const audList = await mirrored("GET", "/api/v1/me/form-drafts", { session: auditor });
  expect([audList.status, audList.body.items]).toEqual([200, []]);

  // listHelpTopics: 200 (all; one screen); 400; 401. getHelpTopic: 200; 400; 401; 404.
  const H = "/api/v1/help-topics";
  const all = await mirrored("GET", `${H}?limit=100`, { session: auditor });
  expect([all.status, all.body.items.length]).toEqual([200, 11]);
  const screen = await mirrored("GET", `${H}?screenKey=search`, { session: officeB });
  expect(screen.status).toBe(200);
  expect(screen.body.items.every((x: { screenKey: string }) => x.screenKey === "search")).toBe(true);
  expect((await mirrored("GET", `${H}?screenKey=Bad-Key`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", H)).status).toBe(401);
  const topic = await mirrored("GET", `${H}/search.global`, { session: office });
  expect([topic.status, topic.body.topicKey, topic.body.arabicProvisional]).toEqual([200, "search.global", true]);
  expect((await mirrored("GET", `${H}/Bad-Key`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", `${H}/search.global`)).status).toBe(401);
  expect((await mirrored("GET", `${H}/no.such.topic`, { session: office })).status).toBe(404);
}
