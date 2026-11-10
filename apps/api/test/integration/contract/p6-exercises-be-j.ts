// P6 contract exercises of BE-J (p6-work-split §J/C.1 and §2 rule 16; T-DG6-BE-J): the three service-identity
// operations (ADR-0053 §1), each with a success and every declared refusal it can reach, through the validating
// client. The PUT narrows and then restores the grant of one seeded job identity (reports.owner_update_tasks), so the
// world is left as the seed wrote it. No shared zod mirror exists for ServiceIdentity in packages/shared (outside
// BE-J's files); the mirror below restates the contract schema for the success bodies. Every value is synthetic.
import { expect } from "vitest";
import { z } from "zod";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

const serviceIdentity = z.strictObject({
  id: z.uuid(),
  code: z.string().regex(/^(job|connector):/),
  subjectKind: z.enum(["job", "connector"]),
  queueName: z.string().nullable(),
  connectorId: z.uuid().nullable(),
  scopeLevel: z.enum(["platform", "organization"]),
  organizationId: z.uuid().nullable(),
  declaredPermissionCodes: z.array(z.string()),
  grantedPermissionCodes: z.array(z.string()),
  sensitiveAccess: z.enum(["none", "aggregate_only"]),
  labelEn: z.string(),
  labelAr: z.string(),
  reason: z.string(),
  version: z.number().int().min(1),
  updatedAt: z.string(),
});
const serviceIdentityPage = z.strictObject({ items: z.array(serviceIdentity), nextCursor: z.string().nullable() });

export const P6_MIRRORS_BE_J: Readonly<Record<string, z.ZodType>> = {
  listServiceIdentities: serviceIdentityPage,
  getServiceIdentity: serviceIdentity,
  putServiceIdentity: serviceIdentity,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });

export async function exerciseP6BeJOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject); // ADM_TECH @ A: operations.read + service_identity.configure
  const auditor = await signIn(api.app, w.auditor.subject); // AUD @ A: operations.read only
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();

  // listServiceIdentities: 200 (ADM_TECH, AUD; a page); 400; 401; 403; 404.
  const L = "/api/v1/admin/service-identities";
  const page = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&subjectKind=job&limit=2`, { session: admin });
  expect(page.status).toBe(200);
  expect(page.body.items).toHaveLength(2);
  expect(typeof page.body.nextCursor).toBe("string");
  const next = await mirrored(
    "GET",
    `${L}?organizationId=${w.orgA.id}&subjectKind=job&limit=2&cursor=${encodeURIComponent(page.body.nextCursor)}`,
    { session: auditor },
  );
  expect(next.status).toBe(200);
  expect(next.body.items[0].code > page.body.items[1].code).toBe(true);
  expect((await mirrored("GET", `${L}?organizationId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: admin })).status).toBe(404);

  // The identity the PUT works on, found through the list (all job identities fit one page of 100).
  const all = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&subjectKind=job&limit=100`, { session: admin });
  const target = (all.body.items as { id: string; code: string }[]).find(
    (i) => i.code === "job:reports.owner_update_tasks",
  )!;
  expect(target).toBeDefined();

  // getServiceIdentity: 200 (AUD); 400; 401; 404 (missing; and a caller without operations.read).
  const one = `${L}/${target.id}`;
  const got = await mirrored("GET", one, { session: auditor });
  expect(got.status).toBe(200);
  expect(got.headers["etag"]).toBe(`"${got.body.version}"`);
  expect((await mirrored("GET", `${L}/x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}`, { session: admin })).status).toBe(404);
  expect((await mirrored("GET", one, { session: nobody })).status).toBe(404);

  // putServiceIdentity: 200 narrow, 200 restore; 400; 401; 403 (AUD); 404; 409; 422 (x2); 428.
  const v = got.body.version as number;
  const declared = got.body.declaredPermissionCodes as string[];
  const reason = "Synthetic contract exercise: narrow the grant.";
  const narrowed = await mirrored("PUT", one, {
    session: admin,
    body: { grantedPermissionCodes: [], reason },
    headers: ifm(v),
  });
  expect(narrowed.status).toBe(200);
  expect(narrowed.body.grantedPermissionCodes).toEqual([]);
  const restored = await mirrored("PUT", one, {
    session: admin,
    body: { grantedPermissionCodes: declared, reason: "Synthetic contract exercise: restore the grant." },
    headers: ifm(v + 1),
  });
  expect(restored.status).toBe(200);
  expect(restored.body.grantedPermissionCodes).toEqual(declared);
  const cur = v + 2;
  const put = (opts: Parameters<typeof mirrored>[2]) => mirrored("PUT", one, opts);
  expect((await put({ session: admin, body: { grantedPermissionCodes: "x", reason }, headers: ifm(cur) })).status).toBe(
    400,
  );
  expect((await put({ body: { grantedPermissionCodes: [], reason }, headers: ifm(cur) })).status).toBe(401);
  expect(
    (await put({ session: auditor, body: { grantedPermissionCodes: [], reason }, headers: ifm(cur) })).status,
  ).toBe(403);
  expect(
    (
      await mirrored("PUT", `${L}/${missing}`, {
        session: admin,
        body: { grantedPermissionCodes: [], reason },
        headers: ifm(1),
      })
    ).status,
  ).toBe(404);
  const stale = await put({ session: admin, body: { grantedPermissionCodes: [], reason }, headers: ifm(v) });
  expect(stale.status).toBe(409);
  const wider = await put({
    session: admin,
    body: { grantedPermissionCodes: [...declared, "audit.read"], reason },
    headers: ifm(cur),
  });
  expect(wider.status).toBe(422);
  expect(wider.body.code).toBe("service_identity.grant_exceeds_declaration");
  const blank = await put({
    session: admin,
    body: { grantedPermissionCodes: [], reason: "   " },
    headers: ifm(cur),
  });
  expect(blank.status).toBe(422);
  expect(blank.body.code).toBe("service_identity.reason_required");
  expect((await put({ session: admin, body: { grantedPermissionCodes: [], reason } })).status).toBe(428);
}
