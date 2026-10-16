// P5 contract exercises of BE-E2 (p5-work-split §B.4 and §2 rule 14; T-DG5-BE-E2): the seven form-framework
// operations it routes (export, bulk edit, drafts), each with a success and every declared refusal it can reach,
// through the validating client. The records are seeded T01 diagnostic items of a fixture transformation; the
// literal T01/T14 acceptance runs are in test/integration/forms/form-records.test.ts. 422 form_export.too_large needs
// more than 5000 records and is exercised there. Every value is synthetic; nothing here is a business approval.
import { formBulkUpdateResult, formDraft, formDraftPage, formRecordExport } from "@mth/shared/schemas";
import { expect } from "vitest";
import { z } from "zod";
import { formsTransformation } from "../../support/forms-fixtures.ts";
import { call, signIn, type P5ExerciseContext } from "../../support/harness.ts";

export const P5_MIRRORS_BE_E2: Readonly<Record<string, z.ZodType>> = {
  // text/csv (the default) is a string body; application/json is the FormRecordExport mirror.
  exportFormRecords: z.union([formRecordExport, z.string().startsWith("﻿")]),
  bulkUpdateFormRecords: formBulkUpdateResult,
  listFormDrafts: formDraftPage,
  createFormDraft: formDraft,
  getFormDraft: formDraft,
  updateFormDraft: formDraft,
  closeFormDraft: formDraft,
};

const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: unknown }) => [r.status, (r.body as { code?: string }).code];

export async function exerciseP5BeE2Operations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const office = await signIn(api.app, w.office.subject);
  const auditor = await signIn(api.app, w.auditor.subject);
  const nobody = await signIn(api.app, w.nobody.subject);
  const officeB = await signIn(api.app, w.officeB.subject);
  const missing = crypto.randomUUID();
  const { transformationId: t, t01 } = await formsTransformation(api, w, w.office.id);
  const items = await api.db
    .selectFrom("diagnostic_item")
    .select(["id", "version"])
    .where("transformation_id", "=", t)
    .orderBy("id")
    .limit(2)
    .execute();
  const F = (rt = "T01") => `/api/v1/transformations/${t}/form-records/${rt}`;

  // exportFormRecords: 200 (csv default, json, ar); 400 (format, Accept mismatch, unknown query); 404; 422 planned.
  const csv = await mirrored("GET", `${F()}/export`, { session: auditor });
  expect([csv.status, String(csv.headers["content-type"])]).toEqual([200, "text/csv; charset=utf-8"]);
  const json = await mirrored("GET", `${F()}/export?format=json&lang=ar`, { session: auditor });
  expect([json.status, json.body.language, json.body.rows.length > 0]).toEqual([200, "ar", true]);
  expect((await mirrored("GET", `${F()}/export?format=xml`, { session: auditor })).status).toBe(400);
  expect(
    (await mirrored("GET", `${F()}/export?format=json`, { session: auditor, headers: { accept: "text/csv" } })).status,
  ).toBe(400);
  expect((await mirrored("GET", `${F()}/export?extra=1`, { session: auditor })).status).toBe(400);
  expect((await mirrored("GET", `${F()}/export`, { session: officeB })).status).toBe(404);
  expect((await mirrored("GET", `${F()}/export`, { session: nobody })).status).toBe(404);
  expect(codeOf(await mirrored("GET", `${F("launch_plan")}/export`, { session: auditor }))).toEqual([
    422,
    "form_record.type_planned",
  ]);

  // bulkUpdateFormRecords: 200; 409 bulk_conflict; 400; 403; 404; 422 (not allowed, field, too many, planned).
  const B = `${F()}/bulk`;
  const bulk = await mirrored("POST", B, {
    session: office,
    body: { items: items.map((i) => ({ recordId: i.id, version: i.version, sourceFields: { confidence: "M" } })) },
  });
  expect([bulk.status, bulk.body.items.length], JSON.stringify(bulk.body)).toEqual([200, 2]);
  const stale = await mirrored("POST", B, {
    session: office,
    body: { items: items.map((i) => ({ recordId: i.id, version: i.version, sourceFields: { confidence: "L" } })) },
  });
  expect(codeOf(stale)).toEqual([409, "form_record.bulk_conflict"]);
  expect((await mirrored("POST", B, { session: office, body: { items: [] } })).status).toBe(400);
  expect((await mirrored("POST", B, { session: auditor, body: { items: [] } })).status).toBe(403);
  expect((await mirrored("POST", B, { session: officeB, body: { items: [] } })).status).toBe(404);
  expect(
    codeOf(
      await mirrored("POST", B, {
        session: office,
        body: { items: [{ recordId: t01, version: 1, sourceFields: { item: "x" } }] },
      }),
    ),
  ).toEqual([422, "form_record.bulk_field_not_editable"]);
  const many = Array.from({ length: 101 }, () => ({ recordId: crypto.randomUUID(), version: 1, sourceFields: {} }));
  expect(codeOf(await mirrored("POST", B, { session: office, body: { items: many } }))).toEqual([
    422,
    "form_record.bulk_too_many",
  ]);
  expect(
    codeOf(
      await mirrored("POST", `${F("evidence")}/bulk`, {
        session: office,
        body: { items: [{ recordId: missing, version: 1, sourceFields: {} }] },
      }),
    ),
  ).toEqual([422, "form_record.bulk_not_allowed"]);
  expect(codeOf(await mirrored("POST", `${F("launch_plan")}/bulk`, { session: office, body: { items: [] } }))).toEqual([
    422,
    "form_record.type_planned",
  ]);

  // createFormDraft: 201 (new record; existing record); 409 open_exists; 400; 403; 404; 422 planned.
  const D = `/api/v1/transformations/${t}/form-drafts`;
  const fresh = await mirrored("POST", D, { session: office, body: { recordType: "T01", payload: { item: "Synth" } } });
  expect([fresh.status, fresh.body.status, fresh.body.version]).toEqual([201, "open", 1]);
  const current = await api.db
    .selectFrom("diagnostic_item")
    .select("version")
    .where("id", "=", t01)
    .executeTakeFirstOrThrow();
  const existing = { recordType: "T01", recordId: t01, baseRecordVersion: current.version, payload: { issue: "x" } };
  const ofRecord = await mirrored("POST", D, { session: office, body: existing });
  expect([ofRecord.status, ofRecord.body.baseChanged]).toEqual([201, false]);
  expect(codeOf(await mirrored("POST", D, { session: office, body: existing }))).toEqual([
    409,
    "form_draft.open_exists",
  ]);
  expect((await mirrored("POST", D, { session: office, body: { recordType: "T01", payload: [] } })).status).toBe(400);
  expect(
    (await mirrored("POST", D, { session: office, body: { recordType: "T01", recordId: t01, payload: {} } })).status,
  ).toBe(400);
  expect((await mirrored("POST", D, { session: auditor, body: { recordType: "T01", payload: {} } })).status).toBe(403);
  expect((await mirrored("POST", D, { session: officeB, body: { recordType: "T01", payload: {} } })).status).toBe(404);
  expect(
    codeOf(await mirrored("POST", D, { session: office, body: { recordType: "launch_plan", payload: {} } })),
  ).toEqual([422, "form_record.type_planned"]);

  // listFormDrafts: 200 (own only, filters, cursor); 400; 404.
  const page = await mirrored("GET", `${D}?limit=1`, { session: office });
  expect([page.status, page.body.items.length, page.body.nextCursor !== null]).toEqual([200, 1, true]);
  const next = await mirrored("GET", `${D}?limit=1&cursor=${page.body.nextCursor}`, { session: office });
  expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
  expect((await mirrored("GET", `${D}?status=open&recordType=T01`, { session: office })).body.items.length).toBe(2);
  expect((await mirrored("GET", D, { session: auditor })).body.items).toEqual([]);
  expect((await mirrored("GET", `${D}?status=maybe`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", D, { session: officeB })).status).toBe(404);

  // getFormDraft: 200; 400; 404 (unknown; another user's).
  const G = `${D}/${fresh.body.id}`;
  const reopened = await mirrored("GET", G, { session: office });
  expect([reopened.status, reopened.body.payload]).toEqual([200, { item: "Synth" }]);
  expect((await mirrored("GET", `${D}/x`, { session: office })).status).toBe(400);
  expect((await mirrored("GET", `${D}/${missing}`, { session: office })).status).toBe(404);
  expect((await mirrored("GET", G, { session: auditor })).status).toBe(404);

  // updateFormDraft: 200; 428; 409 form_record.conflict; 400; 403; 404.
  const upd = { payload: { item: "Synth 2" } };
  expect((await mirrored("PUT", G, { session: office, body: upd })).status).toBe(428);
  expect(codeOf(await mirrored("PUT", G, { session: office, headers: ifm(9), body: upd }))).toEqual([
    409,
    "form_record.conflict",
  ]);
  expect((await mirrored("PUT", G, { session: office, headers: ifm(1), body: { payload: "x" } })).status).toBe(400);
  expect((await mirrored("PUT", G, { session: auditor, headers: ifm(1), body: upd })).status).toBe(403);
  expect((await mirrored("PUT", `${D}/${missing}`, { session: office, headers: ifm(1), body: upd })).status).toBe(404);
  const updated = await mirrored("PUT", G, { session: office, headers: ifm(1), body: upd });
  expect([updated.status, updated.body.version, updated.body.payload]).toEqual([200, 2, upd.payload]);

  // closeFormDraft: 200; 428; 409; 400; 403; 404; then 422 form_draft.closed on update and close.
  const X = `${G}/close`;
  const discard = { reason: "discarded" };
  expect((await mirrored("POST", X, { session: office, body: discard })).status).toBe(428);
  expect(codeOf(await mirrored("POST", X, { session: office, headers: ifm(1), body: discard }))).toEqual([
    409,
    "form_record.conflict",
  ]);
  expect((await mirrored("POST", X, { session: office, headers: ifm(2), body: { reason: "x" } })).status).toBe(400);
  expect((await mirrored("POST", X, { session: auditor, headers: ifm(2), body: discard })).status).toBe(403);
  expect(
    (await mirrored("POST", `${D}/${missing}/close`, { session: office, headers: ifm(2), body: discard })).status,
  ).toBe(404);
  const closed = await mirrored("POST", X, { session: office, headers: ifm(2), body: discard });
  expect([closed.status, closed.body.status, closed.body.closedReason]).toEqual([200, "closed", "discarded"]);
  expect(codeOf(await mirrored("POST", X, { session: office, headers: ifm(3), body: discard }))).toEqual([
    422,
    "form_draft.closed",
  ]);
  expect(codeOf(await mirrored("PUT", G, { session: office, headers: ifm(3), body: upd }))).toEqual([
    422,
    "form_draft.closed",
  ]);
  // The draft of the existing record is saved after its register write (the client's sequence).
  const saved = await call(api.app, "POST", `${D}/${ofRecord.body.id}/close`, {
    session: office,
    headers: ifm(1),
    body: { reason: "saved" },
  });
  expect(saved.status).toBe(200);
}
