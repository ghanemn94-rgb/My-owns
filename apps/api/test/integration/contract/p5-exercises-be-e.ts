// P5 contract exercises of BE-E (p5-work-split §B.3 and §2 rule 14; T-DG5-BE-E): the six form-framework operations it
// routes (version history, comments, attachments), each with a success and every declared refusal it can reach,
// through the validating client. The record is a seeded T01 diagnostic item (attachments in the DG2 evidence_link);
// the form_record_attachment store (T14) is covered by test/integration/forms/form-framework.test.ts. Every value is
// synthetic; nothing here is a business approval.
import {
  formRecordAttachment,
  formRecordAttachmentPage,
  formRecordComment,
  formRecordCommentPage,
  formRecordVersionPage,
} from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { formsTransformation } from "../../support/forms-fixtures.ts";
import { call, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_E: Readonly<Record<string, z.ZodType>> = {
  listFormRecordVersions: formRecordVersionPage,
  listFormRecordComments: formRecordCommentPage,
  createFormRecordComment: formRecordComment,
  listFormRecordAttachments: formRecordAttachmentPage,
  attachFormRecordEvidence: formRecordAttachment,
  removeFormRecordAttachment: formRecordAttachment,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeEOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const missing = crypto.randomUUID();
  const { transformationId: t, t01 } = await formsTransformation(api, w, w.office.id);
  const R = (rt = "T01", id = t01, tid = t) => `/api/v1/transformations/${tid}/form-records/${rt}/${id}`;

  // listFormRecordVersions: 200; 400; 404 (outside scope, unknown record, planned type).
  const versions = await mirrored("GET", `${R()}/versions`, { session: auditor });
  expect(versions.status).toBe(200);
  expect(versions.body.items.length).toBeGreaterThan(0);
  expect((await mirrored("GET", `${R()}/versions?limit=0`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${R("T01", "x")}/versions`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${R()}/versions`, { session: nobody })).status).toBe(404);
  expect((await mirrored("GET", `${R()}/versions`, { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", `${R("T01", missing)}/versions`, { session: auditor })).status).toBe(404);
  expect((await mirrored("GET", `${R("launch_plan")}/versions`, { session: auditor })).status).toBe(404);

  // createFormRecordComment: 201 (comment, reply); 400; 403 (AUD); 404; 422 (reply to a reply, planned type).
  const C = `${R()}/comments`;
  const top = await mirrored("POST", C, { session: office, body: { body: "Synthetic comment" } });
  expect(top.status).toBe(201);
  const reply = await mirrored("POST", C, {
    session: office,
    body: { body: "Synthetic reply", parentCommentId: top.body.id },
  });
  expect(reply.status).toBe(201);
  expect(
    codeOf(await mirrored("POST", C, { session: office, body: { body: "x", parentCommentId: reply.body.id } })),
  ).toEqual([422, "form_comment.parent_invalid"]);
  expect(
    codeOf(await mirrored("POST", `${R("launch_plan")}/comments`, { session: office, body: { body: "x" } })),
  ).toEqual([422, "form_record.type_planned"]);
  expect((await mirrored("POST", C, { session: office, body: { body: " ​ " } })).status).toBe(400);
  expect((await mirrored("POST", C, { session: office, body: { body: "x", extra: 1 } })).status).toBe(400);
  expect((await mirrored("POST", C, { session: auditor, body: { body: "x" } })).status).toBe(403);
  expect((await mirrored("POST", C, { session: officeB, body: { body: "x" } })).status).toBe(404);
  expect(
    (await mirrored("POST", `${R("T01", missing)}/comments`, { session: office, body: { body: "x" } })).status,
  ).toBe(404);

  // listFormRecordComments: 200; 400; 404.
  const comments = await mirrored("GET", `${C}?limit=1`, { session: auditor });
  expect([comments.status, comments.body.items.length]).toEqual([200, 1]);
  const next = await mirrored("GET", `${C}?limit=1&cursor=${comments.body.nextCursor}`, { session: auditor });
  expect(next.body.items[0].parentCommentId).toBe(top.body.id);
  expect((await mirrored("GET", `${C}?cursor=bad`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", C, { session: officeB })).status).toBe(404);

  // attachFormRecordEvidence: 201; 400; 403; 404; 409 (already attached); 422 (evidence of another transformation).
  const ev = await call<{ id: string }>(api.app, "POST", `/api/v1/transformations/${t}/evidence`, {
    session: office,
    body: { kind: "note", title: "Synthetic evidence", noteBody: "Synthetic", ownerUserId: w.office.id },
  });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const A = `${R()}/attachments`;
  const attached = await mirrored("POST", A, { session: office, body: { evidenceId: ev.body.id } });
  expect([attached.status, attached.body.store]).toEqual([201, "evidence_link"]);
  expect((await mirrored("POST", A, { session: office, body: { evidenceId: ev.body.id } })).status).toBe(409);
  expect(codeOf(await mirrored("POST", A, { session: office, body: { evidenceId: missing } }))).toEqual([
    422,
    "form_attachment.evidence_unknown",
  ]);
  expect((await mirrored("POST", A, { session: office, body: { evidenceId: "x" } })).status).toBe(400);
  expect((await mirrored("POST", A, { session: auditor, body: { evidenceId: ev.body.id } })).status).toBe(403);
  expect((await mirrored("POST", A, { session: officeB, body: { evidenceId: ev.body.id } })).status).toBe(404);

  // listFormRecordAttachments: 200; 400; 404.
  const list = await mirrored("GET", A, { session: auditor });
  expect([list.status, list.body.items.length]).toEqual([200, 1]);
  expect((await mirrored("GET", `${A}?includeRemoved=maybe`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", A, { session: officeB })).status).toBe(404);

  // removeFormRecordAttachment: 200; 428; 409; 400; 403; 404; 422 (already removed).
  const X = `${A}/${attached.body.id}/remove`;
  const why = { reason: "Synthetic: attached to the wrong record" };
  expect((await mirrored("POST", X, { session: office, body: why })).status).toBe(428);
  expect(codeOf(await mirrored("POST", X, { session: office, headers: ifm(9), body: why }))).toEqual([
    409,
    "form_record.conflict",
  ]);
  expect((await mirrored("POST", X, { session: office, headers: ifm(1), body: { reason: "x" } })).status).toBe(400);
  expect((await mirrored("POST", X, { session: auditor, headers: ifm(1), body: why })).status).toBe(403);
  expect(
    (await mirrored("POST", `${A}/${missing}/remove`, { session: office, headers: ifm(1), body: why })).status,
  ).toBe(404);
  const removed = await mirrored("POST", X, { session: office, headers: ifm(1), body: why });
  expect([removed.status, removed.body.status, removed.body.version]).toEqual([200, "removed", 2]);
  expect(codeOf(await mirrored("POST", X, { session: office, headers: ifm(2), body: why }))).toEqual([
    422,
    "form_attachment.already_removed",
  ]);
  expect((await mirrored("GET", `${A}?includeRemoved=true`, { session: auditor })).body.items.length).toBe(1);
}
