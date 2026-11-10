// P6 contract exercises of BE-E (p6-work-split §E/F.7 and §2 rule 16; T-DG6-BE-E): the three slice F operations it
// routes (the rate-limit matrix and the global audit API), each with a success and every declared refusal it can reach,
// through the validating client. Every value is synthetic.
import { insertAuditEvent } from "@mth/db";
import { globalAuditEvent, globalAuditEventPage, rateLimitMatrix } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P6_MIRRORS_BE_E: Readonly<Record<string, z.ZodType>> = {
  getSecurityRateLimits: rateLimitMatrix,
  listAuditEvents: globalAuditEventPage,
  getAuditEvent: globalAuditEvent,
};

export async function exerciseP6BeEOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const admin = await signIn(api.app, w.admin.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const missing = crypto.randomUUID();
  // One synthetic organization-level event of org A, so the reads below never depend on earlier exercises.
  await api.db
    .transaction()
    .execute((tx) =>
      insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: w.office.id, requestId: "p6-be-e-contract", source: "api" },
        { action: "test_fixture.contract", recordType: "organization", recordId: w.orgA.id, organizationId: w.orgA.id },
      ),
    );

  // getSecurityRateLimits: 200 (ADM_TECH, AUD); 400; 401; 403.
  const R = "/api/v1/admin/security/rate-limits";
  const matrix = await mirrored("GET", `${R}?organizationId=${w.orgA.id}`, { session: admin });
  expect(matrix.status).toBe(200);
  expect(matrix.body.classes.map((c: { name: string }) => c.name)).toEqual([
    "global",
    "auth",
    "upload",
    "search",
    "assistant",
    "webhook",
    "export",
  ]);
  expect((await mirrored("GET", `${R}?organizationId=${w.orgA.id}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${R}?organizationId=x`, { session: admin })).status).toBe(400);
  expect((await mirrored("GET", `${R}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${R}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);

  // listAuditEvents: 200 (AUD, newest first, with a page); 400; 401; 403; 404.
  const L = "/api/v1/audit-events";
  const page = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&limit=1`, { session: auditor });
  expect(page.status).toBe(200);
  expect(page.body.items).toHaveLength(1);
  const next = await mirrored("GET", `${L}?organizationId=${w.orgA.id}&action=test_fixture.contract`, {
    session: admin,
  });
  expect(next.status).toBe(200);
  expect(next.body.items.length).toBeGreaterThan(0);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}&limit=0`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}?organizationId=${w.orgA.id}`, { session: nobody })).status).toBe(403);
  expect((await mirrored("GET", `${L}?organizationId=${missing}`, { session: auditor })).status).toBe(404);

  // getAuditEvent: 200; 400; 401; 404 (missing, and outside the caller's scope).
  const first = page.body.items[0] as { id: string };
  expect((await mirrored("GET", `${L}/${first.id}`, { session: auditor })).status).toBe(200);
  expect((await mirrored("GET", `${L}/x`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${L}/${first.id}`)).status).toBe(401);
  expect((await mirrored("GET", `${L}/${missing}`, { session: auditor })).status).toBe(404);
  expect((await mirrored("GET", `${L}/${first.id}`, { session: nobody })).status).toBe(404);
}
