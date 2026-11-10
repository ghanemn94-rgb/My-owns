// P6 contract exercises of BE-D (p6-plan §5.1, p6-work-split §2 rule 16; T-DG6-BE-D; ADR-0052 §1, §2) through the
// contract-validating client `mirrored`:
//  - previewEvidenceContent: 200 (image/png), 400 (a malformed id), 401 (no session), 403 evidence.parent_forbidden (an
//    in-scope reader not admitted to a sensitive item), 404 (an unknown item), 422 evidence.preview_unavailable (SVG);
//  - getUploadPolicy: 200 (the default, ETag "0"), 400 (a malformed organization id), 401, 403 (TO), 404 (unknown org);
//  - putUploadPolicy: 200 ("0" creates), 400 (a type outside the set), 401, 403 (AUD), 404, 409 (stale), 428 (no
//    If-Match), then restores the default allow-list.
// 429 is the platform's rate limit (ADR-0007 §5b; tested in admin/security.test.ts). The success JSON bodies are also
// checked against their zod mirrors below. Every value is SYNTHETIC; nothing here approves anything or touches DG0-DG7.
import { uploadPolicy } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { call, signIn, type P6ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";
import { FIXTURES, SVG_WITH_SCRIPT } from "../../support/upload-fixtures.ts";

export const P6_MIRRORS_BE_D: Readonly<Record<string, z.ZodType>> = {
  getUploadPolicy: uploadPolicy,
  putUploadPolicy: uploadPolicy,
};

export async function exerciseP6BeDOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  const p = await setupP2World(api, w);
  const T = `/api/v1/transformations/${p.transformationId}`;
  const send = (method: string, url: string, opts?: Parameters<typeof call>[3]) => call(api.app, method, url, opts);
  const fileItem = async (fileName: string, bytes: Buffer) => {
    const c = await send("POST", `${T}/evidence`, {
      session: p.lead.session,
      body: { kind: "file", title: "Synthetic contract evidence", ownerUserId: p.lead.id },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const up = await send("POST", `${T}/evidence/${c.body.id}/content`, {
      session: p.lead.session,
      headers: { ...ifm(c.body.version), "content-type": "application/octet-stream", "x-file-name": fileName },
      body: bytes,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    return c.body.id as string;
  };

  // previewEvidenceContent
  const png = await fileItem("chart.png", FIXTURES.png);
  const PREVIEW = (id: string) => `${T}/evidence/${id}/preview`;
  const ok = await m("GET", PREVIEW(png), { session: p.lead.session });
  expect([ok.status, ok.headers["content-type"]]).toEqual([200, "image/png"]);
  expect(ok.raw.rawPayload.equals(FIXTURES.png)).toBe(true);
  expect((await m("GET", `${T}/evidence/not-a-uuid/preview`, { session: p.lead.session })).status).toBe(400);
  expect((await m("GET", PREVIEW(png))).status).toBe(401);
  expect((await m("GET", PREVIEW(crypto.randomUUID()), { session: p.lead.session })).status).toBe(404);
  const svg = await fileItem("diagram.svg", SVG_WITH_SCRIPT);
  const unavailable = await m("GET", PREVIEW(svg), { session: p.lead.session });
  expect([unavailable.status, unavailable.body.code]).toEqual([422, "evidence.preview_unavailable"]);
  const marked = await send("PUT", `${T}/records/evidence/${png}/sensitivity`, {
    session: p.office.session,
    headers: { "if-match": '"0"' },
    body: { isSensitive: true, reason: "Synthetic contract sensitivity" },
  });
  expect(marked.status, JSON.stringify(marked.body)).toBe(200);
  const forbidden = await m("GET", PREVIEW(png), { session: p.contributor.session });
  expect([forbidden.status, forbidden.body.code]).toEqual([403, "evidence.parent_forbidden"]);

  // getUploadPolicy
  const admin = await signIn(api.app, w.admin.subject);
  const POLICY = (org: string) => `/api/v1/admin/upload-policy?organizationId=${org}`;
  const read = await m("GET", POLICY(w.orgA.id), { session: admin });
  expect(read.status, JSON.stringify(read.body)).toBe(200);
  const etag = String(read.headers["etag"]);
  expect((await m("GET", "/api/v1/admin/upload-policy?organizationId=x", { session: admin })).status).toBe(400);
  expect((await m("GET", POLICY(w.orgA.id))).status).toBe(401);
  expect((await m("GET", POLICY(w.orgA.id), { session: p.office.session })).status).toBe(403);
  expect((await m("GET", POLICY(crypto.randomUUID()), { session: admin })).status).toBe(404);

  // putUploadPolicy
  const body = { allowedTypes: ["pdf", "png"], maxBytes: 1048576, reason: "Synthetic contract narrowing" };
  expect((await m("PUT", POLICY(w.orgA.id), { session: admin, body })).status).toBe(428);
  expect(
    (await m("PUT", POLICY(w.orgA.id), { session: admin, headers: ifm(0), body: { ...body, allowedTypes: ["exe"] } }))
      .status,
  ).toBe(400);
  expect((await m("PUT", POLICY(w.orgA.id), { headers: ifm(0), body })).status).toBe(401);
  expect((await m("PUT", POLICY(w.orgA.id), { session: p.auditor.session, headers: ifm(0), body })).status).toBe(403);
  expect((await m("PUT", POLICY(crypto.randomUUID()), { session: admin, headers: ifm(0), body })).status).toBe(404);
  const created = await m("PUT", POLICY(w.orgA.id), { session: admin, headers: { "if-match": etag }, body });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  expect((await m("PUT", POLICY(w.orgA.id), { session: admin, headers: { "if-match": etag }, body })).status).toBe(409);
  const restored = await m("PUT", POLICY(w.orgA.id), {
    session: admin,
    headers: { "if-match": String(created.headers["etag"]) },
    body: {
      allowedTypes: ["pdf", "docx", "xlsx", "pptx", "csv", "txt", "png", "jpeg", "gif", "svg"],
      maxBytes: 26214400,
      reason: "Synthetic contract restore",
    },
  });
  expect(restored.status, JSON.stringify(restored.body)).toBe(200);
}
