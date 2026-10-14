// Form schemas, the forms kind provider, custom-field values and the forms pin (ADR-0041 §1-§4, §7, §9, §10; D-145;
// p5-work-split §B.2; T-DG5-BE-D) against a real PostgreSQL:
//  - REQ-S05-002: an extension field added to T03 in a Studio draft passes preview and compatibility and publishes
//    (the slice A pipeline; the final publish step is written as the owner because publishConfigVersion is BE-B3's,
//    not merged yet); deleting T03 `gap` -> 422 form_schema.source_column_protected; changing a source column's type
//    -> 422 form_schema.source_column_type_fixed; and the other §10 definition-time refusals;
//  - REQ-S06-005: 12% stores "0.12"; 1500000.10 SAR stores and reads back exactly; a calculated field naming an unknown
//    field -> 422 form_schema.calculated_formula_invalid; calculated values Not computable with the missing field named;
//  - REQ-S16-010: a value violating its schema -> 400/422 before persistence, and the database refuses it when the API
//    check is bypassed; migration 0071's multiple-choice shapes, accepted and refused;
//  - REQ-S05-006: the registry lists the twelve extension record types with the badge;
//  - pins: a transformation created through the API is pinned to the newest published forms version; a DG4-style
//    transformation (no pin) reads forms v1;
//  - every write: If-Match "0" creates, stale -> 409 form_record.conflict with currentVersion, 428 missing, AUD 403,
//    outside scope 404, one audit event per write, commit-time re-authorization (403, nothing written).
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { createDb, insertAuditEvent } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configKindProvider } from "../../../src/modules/methodology/index.ts";
import {
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { formsTransformation, seedFormsVersion, T01_FIELDS } from "../../support/forms-fixtures.ts";
import { methodologyAdmin } from "../../support/studio-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let admin: Session;
let adminId: string;
let office: Session;
let auditor: Session;
let nobody: Session;
let officeB: Session;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const a = await methodologyAdmin(api.db, w);
  adminId = a.id;
  admin = await signIn(api.app, a.subject);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
}, 60_000);
afterAll(() => api.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const V = "/api/v1/admin/methodology-versions";
const FORMS_V1 = "01920005-0200-7000-8000-000000000001";
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: { status: number; body: Body }) => [r.status, r.body?.code];
const cf = (t: string, rt: string, id: string) => `/api/v1/transformations/${t}/form-records/${rt}/${id}/custom-fields`;
const valuesRow = (id: string) =>
  api.db.selectFrom("form_custom_value").selectAll().where("record_id", "=", id).executeTakeFirst();

/** A fresh Studio draft of a fresh synthetic form_schema base (never the shared `forms` key). */
async function formsDraft(elements = [] as Parameters<typeof seedFormsVersion>[1]) {
  const base = await seedFormsVersion(api, elements);
  const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
  expect(res.status).toBe(201);
  return { id: res.body.id as string, baseId: base.id };
}
const putEl = (id: string, type: string, key: string, version: number, attributes: Record<string, unknown>) =>
  call<Body>(api.app, "PUT", `${V}/${id}/elements/${type}/${key}`, {
    session: admin,
    headers: ifm(version),
    body: { attributes },
  });
const removeEl = (id: string, type: string, key: string, version: number) =>
  call<Body>(api.app, "POST", `${V}/${id}/elements/${type}/${key}/remove`, { session: admin, headers: ifm(version) });

describe("REQ-S05-002: protected source columns and extension fields through the Studio pipeline", () => {
  it("an extension field added to T03 passes preview and compatibility and publishes; the admin schema shows it", async () => {
    const d = await formsDraft();
    const put = await putEl(d.id, "form_field", "T03.risk_owner_note", 1, {
      fieldType: "text",
      labelEn: "Risk owner note (synthetic)",
      labelAr: "ملاحظة مالك المخاطر",
      helpEn: "Who owns the residual risk of this gap.",
      maxLength: 500,
    });
    expect(put.status).toBe(200);
    // Relabelling a source column and adding help is allowed (REQ-S05-002 "relabel help").
    const relabel = await putEl(d.id, "form_field", "T03.gap", 2, { labelEn: "Gap (synthetic label)", helpEn: "Help" });
    expect(relabel.status).toBe(200);

    const preview = await call<Body>(api.app, "POST", `${V}/${d.id}/preview`, {
      session: admin,
      headers: ifm(3),
      body: { samples: [{ kind: "record", recordType: "T03", input: { values: { risk_owner_note: "Synthetic" } } }] },
    });
    expect(preview.status).toBe(201);
    expect(preview.body.result).toBe("pass");
    const compat = await call<Body>(api.app, "POST", `${V}/${d.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(4),
    });
    expect(compat.status).toBe(201);
    expect(["pass", "warn"]).toContain(compat.body.result);

    // The diff lists the added field and the changed source column (REQ-S06-007 slice B rows).
    const diff = await call<Body>(api.app, "GET", `${V}/${d.id}/diff`, { session: admin });
    expect(diff.status).toBe(200);
    const rows = diff.body.entries.map((e: Body) => `${e.change}:${e.elementType}:${e.stableKey}`);
    expect(rows).toContain("added:form_field:T03.risk_owner_note");
    expect(rows).toContain("changed:form_field:T03.gap");

    // Publish (the configured TO review is synthetic; publishConfigVersion is BE-B3's): the database accepts it.
    const reviewer = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, reviewer.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await createDb(api.owner)
      .transaction()
      .execute(async (tx) => {
        const v = await tx
          .selectFrom("methodology_version")
          .select(["content_sha256", "version", "draft_stage"])
          .where("id", "=", d.id)
          .executeTakeFirstOrThrow();
        expect(v.draft_stage).toBe("preview");
        const reviewId = uuidv7();
        await tx
          .insertInto("config_review_request")
          .values({
            id: reviewId,
            methodology_version_id: d.id,
            content_sha256: v.content_sha256,
            reviewer_role_code: "TO",
            requested_by: adminId,
            created_by: adminId,
            updated_by: adminId,
          })
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "config_review_request",
          recordId: reviewId,
          organizationId: null,
          newVersion: 1,
        });
        await tx
          .updateTable("config_review_request")
          .set({
            status: "approved",
            decided_by: reviewer.id,
            decided_at: new Date(),
            updated_by: reviewer.id,
            version: 2,
          })
          .where("id", "=", reviewId)
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "config_review_request",
          recordId: reviewId,
          organizationId: null,
          priorVersion: 1,
          newVersion: 2,
        });
        await tx
          .updateTable("methodology_version")
          .set({ draft_stage: "approved", version: v.version + 1 })
          .where("id", "=", d.id)
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "methodology_version",
          recordId: d.id,
          organizationId: null,
          priorVersion: v.version,
          newVersion: v.version + 1,
        });
        await tx
          .updateTable("methodology_version")
          .set({
            status: "published",
            draft_stage: null,
            published_by: adminId,
            published_at: new Date(),
            version: v.version + 2,
          })
          .where("id", "=", d.id)
          .execute();
        await insertAuditEvent(tx, SYSTEM, {
          action: "test.seed",
          recordType: "methodology_version",
          recordId: d.id,
          organizationId: null,
          priorVersion: v.version + 1,
          newVersion: v.version + 2,
        });
      });
    const schema = await call<Body>(api.app, "GET", `/api/v1/admin/form-schemas/T03?versionId=${d.id}`, {
      session: auditor,
    });
    expect(schema.status).toBe(200);
    const ext = schema.body.fields.find((f: Body) => f.key === "risk_owner_note");
    expect(ext).toMatchObject({ origin: "admin", extension: true, protected: false, fieldType: "text" });
    expect(ext.settings).toEqual({ maxLength: 500 });
    const gap = schema.body.fields.find((f: Body) => f.key === "gap");
    expect(gap).toMatchObject({ origin: "source", protected: true, labelEn: "Gap (synthetic label)", helpEn: "Help" });
    // Editing the published version is refused (slice A rule).
    expect(codeOf(await putEl(d.id, "form_field", "T03.other", 6, { fieldType: "text" }))).toEqual([
      409,
      "config_version.not_editable",
    ]);
  });

  it("deleting T03 'gap' -> 422 source_column_protected; changing its type -> 422 source_column_type_fixed; nothing written", async () => {
    const d = await formsDraft();
    expect(codeOf(await removeEl(d.id, "form_field", "T03.gap", 1))).toEqual([
      422,
      "form_schema.source_column_protected",
    ]);
    expect(codeOf(await putEl(d.id, "form_field", "T03.gap", 1, { fieldType: "number" }))).toEqual([
      422,
      "form_schema.source_column_type_fixed",
    ]);
    expect(codeOf(await putEl(d.id, "form_field", "T03.gap", 1, { maxLength: 10 }))).toEqual([
      422,
      "form_schema.source_column_type_fixed",
    ]);
    const rows = await api.db
      .selectFrom("methodology_element")
      .select("id")
      .where("methodology_version_id", "=", d.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it("the other definition-time refusals of ADR-0041 §10, each with its exact code and text", async () => {
    const d = await formsDraft();
    const cases: [string, string, Record<string, unknown>, string, string][] = [
      [
        "form_field",
        "procedure_definition.extra",
        { fieldType: "text" },
        "form_schema.extensions_not_allowed",
        "This form does not take extension fields.",
      ],
      [
        "form_field",
        "T03.Bad_Key",
        { fieldType: "text" },
        "form_schema.extension_key_invalid",
        "An extension field needs a new key of lowercase letters, digits and underscores that is not a source column.",
      ],
      [
        "form_field",
        "T03.extra",
        { fieldType: "slider" },
        "form_schema.field_type_unknown",
        "Choose one of the eleven field types.",
      ],
      ["form_field", "T03.extra", {}, "form_schema.field_type_unknown", "Choose one of the eleven field types."],
      [
        "form_field",
        "T03.extra",
        { fieldType: "choice" },
        "form_schema.field_settings_invalid",
        "This field type is missing a required setting.",
      ],
      [
        "form_field",
        "T03.extra",
        { fieldType: "reference", targetRecordType: "launch_plan" },
        "form_schema.field_settings_invalid",
        "This field type is missing a required setting.",
      ],
      ["form", "new_form", {}, "form_schema.form_fixed", "Native forms cannot be added or removed."],
    ];
    for (const [type, key, attributes, code, detail] of cases) {
      const r = await putEl(d.id, type, key, 1, attributes);
      expect([r.status, r.body.code, r.body.detail], `${key} ${JSON.stringify(attributes)}`).toEqual([
        422,
        code,
        detail,
      ]);
    }
    expect(codeOf(await removeEl(d.id, "form", "T03", 1))).toEqual([422, "form_schema.form_fixed"]);
    // A form's own labels and help are editable.
    expect((await putEl(d.id, "form", "T03", 1, { helpEn: "Synthetic form help" })).status).toBe(200);
    // An extension field may be removed in a draft (recorded).
    expect((await putEl(d.id, "form_field", "T03.extra", 2, { fieldType: "text" })).status).toBe(200);
    expect((await removeEl(d.id, "form_field", "T03.extra", 3)).status).toBe(200);
  });

  it("REQ-S06-005: a calculated field naming an unknown field -> 422 calculated_formula_invalid; a valid one is saved", async () => {
    const d = await formsDraft();
    expect((await putEl(d.id, "form_field", "T01.score", 1, { fieldType: "number" })).status).toBe(200);
    const bad = await putEl(d.id, "form_field", "T01.calc", 2, {
      fieldType: "calculated",
      expression: "score * unknown_field",
      resultUnitKind: "score",
    });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "form_schema.calculated_formula_invalid",
      "The calculated field's formula is invalid or refers to an unknown field.",
    ]);
    const good = await putEl(d.id, "form_field", "T01.calc", 2, {
      fieldType: "calculated",
      expression: "score * 2",
      resultUnitKind: "score",
    });
    expect(good.status).toBe(200);
    // Removing the input field makes the stored formula invalid: compatibility fails (never a silent pass).
    expect((await removeEl(d.id, "form_field", "T01.score", 3)).status).toBe(200);
    const compat = await call<Body>(api.app, "POST", `${V}/${d.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(4),
    });
    expect(compat.status).toBe(201);
    expect(compat.body.result).toBe("fail");
    // A new required field is a compatibility warning (pinned transformations stay pinned).
    const d2 = await formsDraft();
    expect((await putEl(d2.id, "form_field", "T01.must", 1, { fieldType: "text", required: true })).status).toBe(200);
    const compat2 = await call<Body>(api.app, "POST", `${V}/${d2.id}/compatibility-checks`, {
      session: admin,
      headers: ifm(2),
    });
    expect(compat2.body.result).toBe("warn");
    expect(JSON.stringify(compat2.body.report)).toContain("compatibility.required_field_added");
  });

  it("AUD and TO cannot edit form elements (403)", async () => {
    const d = await formsDraft();
    for (const s of [auditor, office]) {
      const r = await call<Body>(api.app, "PUT", `${V}/${d.id}/elements/form_field/T03.extra`, {
        session: s,
        headers: ifm(1),
        body: { attributes: { fieldType: "text" } },
      });
      expect(r.status).toBe(403);
    }
  });
});

describe("form schema reads (ADR-0041 §1, §2, §5)", () => {
  it("listFormRecordTypes: 33 native forms, the badge exactly on the twelve M0149 types; kind filter; AUD reads; nobody 403", async () => {
    const all = await call<Body>(api.app, "GET", "/api/v1/admin/form-schemas", { session: auditor });
    expect(all.status).toBe(200);
    expect(all.body.items).toHaveLength(33);
    const badged = all.body.items.filter((i: Body) => i.extensionBadge).map((i: Body) => i.code);
    expect(badged).toEqual([
      "evidence",
      "baseline",
      "value_pool",
      "resource_plan",
      "funding_approval",
      "procedure_definition",
      "change_request",
      "meeting_record",
      "corrective_plan",
      "lesson",
      "bau_handover",
      "control",
    ]);
    const ext = await call<Body>(api.app, "GET", "/api/v1/admin/form-schemas?kind=extension", { session: admin });
    expect(ext.body.items.map((i: Body) => i.code)).toEqual(badged);
    expect((await call(api.app, "GET", "/api/v1/admin/form-schemas?kind=nope", { session: admin })).status).toBe(400);
    expect((await call(api.app, "GET", "/api/v1/admin/form-schemas", { session: nobody })).status).toBe(403);
  });

  it("getFormSchemaAdmin defaults to the newest published forms version; T03 lists its six protected source columns", async () => {
    const r = await call<Body>(api.app, "GET", "/api/v1/admin/form-schemas/T03", { session: admin });
    expect(r.status).toBe(200);
    const newest = await api.db
      .selectFrom("methodology_version")
      .select(["id", "version_no"])
      .where("key", "=", "forms")
      .where("status", "=", "published")
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    expect(r.body.formSchemaVersionId).toBe(newest.id);
    const source = r.body.fields.filter((f: Body) => f.origin === "source").map((f: Body) => f.key);
    expect(source).toEqual(["tom_dimension", "current_state", "target_state", "gap", "design_decision", "owner"]);
    expect(r.body.fields.every((f: Body) => f.origin !== "source" || f.protected)).toBe(true);
    expect((await call(api.app, "GET", "/api/v1/admin/form-schemas/T99", { session: admin })).status).toBe(400);
    expect((await call(api.app, "GET", "/api/v1/admin/form-schemas/nope_type", { session: admin })).status).toBe(404);
    expect(
      (await call(api.app, "GET", `/api/v1/admin/form-schemas/T03?versionId=${uuidv7()}`, { session: admin })).status,
    ).toBe(404);
  });

  it("a DG4-style transformation (no pin) reads forms v1; a pinned one reads its version; planned types -> 422", async () => {
    const plain = await formsTransformation(api, w, w.office.id);
    const r = await call<Body>(api.app, "GET", `/api/v1/transformations/${plain.transformationId}/form-schemas/T14`, {
      session: auditor,
    });
    expect(r.status).toBe(200);
    expect([r.body.formSchemaVersionId, r.body.versionNo]).toEqual([FORMS_V1, 1]);
    expect(r.body.fields.every((f: Body) => f.origin === "source")).toBe(true);
    const badge = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${plain.transformationId}/form-schemas/baseline`,
      { session: auditor },
    );
    expect(badge.body.recordType.extensionBadge).toBe(true);
    const planned = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${plain.transformationId}/form-schemas/launch_plan`,
      { session: auditor },
    );
    expect([planned.status, planned.body.code, planned.body.detail]).toEqual([
      422,
      "form_record.type_planned",
      "This form is not available in this release.",
    ]);
    expect(
      (
        await call(api.app, "GET", `/api/v1/transformations/${plain.transformationId}/form-schemas/T14`, {
          session: officeB,
        })
      ).status,
    ).toBe(404);

    const version = await seedFormsVersion(api, T01_FIELDS);
    const pinned = await formsTransformation(api, w, w.office.id, version.id);
    const p = await call<Body>(api.app, "GET", `/api/v1/transformations/${pinned.transformationId}/form-schemas/T01`, {
      session: office,
    });
    expect(p.body.formSchemaVersionId).toBe(version.id);
    const budget = p.body.fields.find((f: Body) => f.key === "budget");
    expect(budget).toMatchObject({
      extension: true,
      fieldType: "currency",
      settings: { currencyCode: "SAR", scale: 2 },
    });
  });

  it("a transformation created through the API is pinned to the newest published forms version, with its audit event", async () => {
    const res = await call<Body>(api.app, "POST", "/api/v1/transformations", {
      session: office,
      body: { name: "Synthetic forms pin", businessUnitId: w.a1, mode: "end_to_end" },
    });
    expect(res.status).toBe(201);
    const newest = await api.db
      .selectFrom("methodology_version")
      .select("id")
      .where("key", "=", "forms")
      .where("status", "=", "published")
      .orderBy("version_no", "desc")
      .executeTakeFirstOrThrow();
    const pin = await api.db
      .selectFrom("transformation_config_pin")
      .selectAll()
      .where("transformation_id", "=", res.body.id)
      .where("kind", "=", "form_schema")
      .executeTakeFirstOrThrow();
    expect(pin.methodology_version_id).toBe(newest.id);
    const audits = await auditOfRequest(api.db, res.headers["x-request-id"] as string);
    expect(audits.filter((a) => a.record_id === pin.id).map((a) => a.action)).toEqual([
      "transformation_config_pin.create",
    ]);
  });
});

describe("putFormRecordCustomFields / getFormRecordCustomFields (REQ-S16-010, REQ-S06-005)", () => {
  async function pinnedT01() {
    const version = await seedFormsVersion(api, T01_FIELDS);
    return formsTransformation(api, w, w.office.id, version.id);
  }

  it('12% stores "0.12"; 1500000.10 SAR stores exactly; multiple choice stores a list; calculated values evaluated', async () => {
    const { transformationId: t, t01 } = await pinnedT01();
    const put = await call<Body>(api.app, "PUT", cf(t, "T01", t01), {
      session: office,
      headers: ifm(0),
      body: {
        values: {
          risk_score: "3.50",
          adoption: "12%",
          budget: { amount: "1500000.10", currencyCode: "SAR" },
          channels: ["retail", "online"],
          tier: "gold",
          note: "Synthetic note",
        },
      },
    });
    expect(put.status).toBe(200);
    expect(put.headers["etag"]).toBe('"1"');
    expect(put.body.values.adoption).toBe("0.12");
    expect(put.body.values.budget).toEqual({ amount: "1500000.10", currencyCode: "SAR" });
    expect(put.body.calculated.weighted_risk).toEqual({ status: "computed", value: "0.42", missingFields: [] });
    const row = await valuesRow(t01);
    expect(row?.field_values).toEqual({
      risk_score: "3.50",
      adoption: "0.12",
      budget: { amount: "1500000.10", currencyCode: "SAR" },
      channels: ["retail", "online"],
      tier: "gold",
      note: "Synthetic note",
    });
    // Unknown is never 0: clearing an input makes the calculated field Not computable with the missing field named.
    const cleared = await call<Body>(api.app, "PUT", cf(t, "T01", t01), {
      session: office,
      headers: ifm(1),
      body: { values: { risk_score: null, note: "Synthetic note" } },
    });
    expect(cleared.status).toBe(200);
    expect(cleared.body.values.risk_score).toBeNull();
    expect(cleared.body.values.budget).toBeNull();
    expect(cleared.body.calculated.weighted_risk).toEqual({
      status: "not_computable",
      value: null,
      missingFields: ["risk_score", "adoption"],
    });
    const get = await call<Body>(api.app, "GET", cf(t, "T01", t01), { session: auditor });
    expect([get.status, get.headers["etag"], get.body.version]).toEqual([200, '"2"', 2]);
  });

  it("a value violating its schema is refused before persistence (400 field code / 422), and nothing is written", async () => {
    const { transformationId: t, t01 } = await pinnedT01();
    const send = (values: Record<string, unknown>) =>
      call<Body>(api.app, "PUT", cf(t, "T01", t01), { session: office, headers: ifm(0), body: { values } });
    const invalid: [Record<string, unknown>, string][] = [
      [{ note: "x", risk_score: 3.5 }, "validation.decimal"],
      [{ note: "x", risk_score: "١٢" }, "validation.decimal"],
      [{ note: "x", adoption: "250%" }, "validation.percentage"],
      [{ note: "x", budget: { amount: "1.005", currencyCode: "SAR" } }, "validation.currency_amount"],
      [{ note: "x", budget: { amount: "1.00", currencyCode: "usd" } }, "validation.currency_code"],
      [{ note: "x", channels: ["retail", "retail"] }, "validation.choice"],
      [{ note: "x", channels: [] }, "validation.choice"],
      [{ note: "x", tier: ["gold"] }, "validation.choice"],
    ];
    for (const [values, code] of invalid) {
      const r = await send(values);
      expect([r.status, r.body.errors?.[0]?.code], JSON.stringify(values)).toEqual([400, code]);
    }
    const unknown = await send({ note: "x", not_a_field: "1" });
    expect([unknown.status, unknown.body.code]).toEqual([422, "form_record.custom_field_unknown"]);
    const calc = await send({ note: "x", weighted_risk: "1" });
    expect([calc.status, calc.body.code]).toEqual([422, "form_record.custom_field_unknown"]);
    const required = await send({ risk_score: "1" });
    expect([required.status, required.body.code, required.body.detail]).toEqual([
      422,
      "form_record.custom_field_required",
      "Fill in the required extension fields.",
    ]);
    expect(await valuesRow(t01)).toBeUndefined();
  });

  it("the database refuses a value violating its schema when the API check is bypassed (form_custom_value_type_shape)", async () => {
    const version = await seedFormsVersion(api, T01_FIELDS);
    const { transformationId: t, t01 } = await formsTransformation(api, w, w.office.id, version.id);
    const insert = (values: Record<string, unknown>) =>
      createDb(api.owner)
        .transaction()
        .execute(async (tx) => {
          const id = uuidv7();
          await tx
            .insertInto("form_custom_value")
            .values({
              id,
              organization_id: w.orgA.id,
              transformation_id: t,
              record_type: "T01",
              record_id: t01,
              form_schema_version_id: version.id,
              field_values: JSON.stringify(values),
              created_by: w.office.id,
              updated_by: w.office.id,
            })
            .execute();
          await insertAuditEvent(tx, SYSTEM, {
            action: "test.seed",
            recordType: "form_custom_value",
            recordId: id,
            organizationId: w.orgA.id,
            newVersion: 1,
          });
          throw new Error("rollback: accepted");
        });
    const refused = async (values: Record<string, unknown>) =>
      expect(insert(values), JSON.stringify(values)).rejects.toMatchObject({
        constraint: "form_custom_value_type_shape",
      });
    const accepted = async (values: Record<string, unknown>) =>
      expect(insert(values), JSON.stringify(values)).rejects.toThrow("rollback: accepted");
    await refused({ risk_score: 3.5 }); // a JSON number is never a stored decimal
    await refused({ adoption: "12%" });
    await refused({ budget: { amount: 1500000.1, currencyCode: "SAR" } });
    // 0071 (D-145): multiple choice = a non-empty array of unique strings of 1-100 characters; single = a string.
    await accepted({ channels: ["retail", "online"] });
    await accepted({ channels: ["retail"] });
    await accepted({ tier: "gold" });
    await accepted({ adoption: "0.12", budget: { amount: "1500000.10", currencyCode: "SAR" } });
    await refused({ channels: [] });
    await refused({ channels: ["retail", "retail"] });
    await refused({ channels: ["retail", 7] });
    await refused({ channels: ["x".repeat(101)] });
    await refused({ channels: [""] });
    await refused({ channels: "retail" });
    await refused({ tier: ["gold"] });
    await refused({ tier: "" });
    await expect(insert({ not_a_field: "1" })).rejects.toMatchObject({ constraint: "form_custom_value_unknown_field" });
  });

  it('If-Match: "0" creates; stale -> 409 form_record.conflict with currentVersion; missing -> 428; one audit event per write', async () => {
    const { transformationId: t, t01 } = await pinnedT01();
    const body = { values: { note: "Synthetic" } };
    expect((await call(api.app, "PUT", cf(t, "T01", t01), { session: office, body })).status).toBe(428);
    const created = await call<Body>(api.app, "PUT", cf(t, "T01", t01), { session: office, headers: ifm(0), body });
    expect(created.status).toBe(200);
    const row = await valuesRow(t01);
    const audits = await auditOfRequest(api.db, created.headers["x-request-id"] as string);
    expect(audits.map((a) => [a.action, a.record_id, a.new_version])).toEqual([
      ["form_custom_value.create", row!.id, 1],
    ]);
    const stale = await call<Body>(api.app, "PUT", cf(t, "T01", t01), { session: office, headers: ifm(0), body });
    expect([stale.status, stale.body.code, stale.body.currentVersion, stale.body.detail]).toEqual([
      409,
      "form_record.conflict",
      1,
      "This record changed since you opened it. Review the current version, then apply your changes again.",
    ]);
    const updated = await call<Body>(api.app, "PUT", cf(t, "T01", t01), {
      session: office,
      headers: ifm(1),
      body: { values: { note: "Synthetic 2" } },
    });
    expect(updated.status).toBe(200);
    const u = await auditOfRequest(api.db, updated.headers["x-request-id"] as string);
    expect(u.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([["form_custom_value.update", 1, 2]]);
    // A stale version against no row: 409 without currentVersion (nothing to show yet).
    const other = await api.db
      .selectFrom("diagnostic_item")
      .select("id")
      .where("transformation_id", "=", t)
      .where("id", "!=", t01)
      .executeTakeFirstOrThrow();
    const none = await call<Body>(api.app, "PUT", cf(t, "T01", other.id), { session: office, headers: ifm(3), body });
    expect([none.status, none.body.code, none.body.currentVersion]).toEqual([409, "form_record.conflict", undefined]);
  });

  it("authorization: AUD 403, no write permission 403, outside scope 404, unknown record 404; nothing written", async () => {
    const { transformationId: t, t01 } = await pinnedT01();
    const body = { values: { note: "Synthetic" } };
    expect((await call(api.app, "PUT", cf(t, "T01", t01), { session: auditor, headers: ifm(0), body })).status).toBe(
      403,
    );
    // ADM_METHOD configures forms only in Studio: it neither reads transformations nor holds a register write
    // permission (ADR-0041 §9), so a business record is not even visible to it (404). AUD reads but cannot write: 403.
    expect((await call(api.app, "PUT", cf(t, "T01", t01), { session: admin, headers: ifm(0), body })).status).toBe(404);
    // Outside scope (no grant at all, or grants only in another organization): the record does not exist (404).
    expect((await call(api.app, "PUT", cf(t, "T01", t01), { session: nobody, headers: ifm(0), body })).status).toBe(
      404,
    );
    expect((await call(api.app, "PUT", cf(t, "T01", t01), { session: officeB, headers: ifm(0), body })).status).toBe(
      404,
    );
    expect(
      (await call(api.app, "PUT", cf(t, "T01", uuidv7()), { session: office, headers: ifm(0), body })).status,
    ).toBe(404);
    // A record id of another type (a T01 id addressed as T08, which TO may edit) is not that record: 404.
    expect((await call(api.app, "PUT", cf(t, "T08", t01), { session: office, headers: ifm(0), body })).status).toBe(
      404,
    );
    // A record type whose write permission the caller lacks (T14 benefit.edit; TO holds none): 403 before any lookup.
    expect((await call(api.app, "PUT", cf(t, "T14", t01), { session: office, headers: ifm(0), body })).status).toBe(
      403,
    );
    const planned = await call<Body>(api.app, "PUT", cf(t, "launch_plan", t01), {
      session: office,
      headers: ifm(0),
      body,
    });
    expect([planned.status, planned.body.code]).toEqual([422, "form_record.type_planned"]);
    const noExt = await call<Body>(api.app, "PUT", cf(t, "phase_step", t01), {
      session: office,
      headers: ifm(0),
      body,
    });
    expect([noExt.status, noExt.body.code]).toEqual([422, "form_schema.extensions_not_allowed"]);
    expect((await call(api.app, "GET", cf(t, "T01", t01), { session: officeB })).status).toBe(404);
    expect(await valuesRow(t01)).toBeUndefined();
  });

  it("commit-time re-authorization: the write permission revoked while the request waits -> 403, nothing written", async () => {
    const { transformationId: t, t01 } = await pinnedT01();
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "PUT", cf(t, "T01", t01), { session: s, headers: ifm(0), body: { values: { note: "x" } } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await valuesRow(t01)).toBeUndefined();
  });

  it("an unpinned (DG4) transformation validates against forms v1: it has no extension fields", async () => {
    const plain = await formsTransformation(api, w, w.office.id);
    const r = await call<Body>(api.app, "PUT", cf(plain.transformationId, "T01", plain.t01), {
      session: office,
      headers: ifm(0),
      body: { values: { note: "x" } },
    });
    expect([r.status, r.body.code]).toEqual([422, "form_record.custom_field_unknown"]);
    const empty = await call<Body>(api.app, "PUT", cf(plain.transformationId, "T01", plain.t01), {
      session: office,
      headers: ifm(0),
      body: { values: {} },
    });
    expect([empty.status, empty.body.formSchemaVersionId, empty.body.values]).toEqual([200, FORMS_V1, {}]);
  });
});

describe("the forms provider's affected records and migration items (ADR-0039 §5, ADR-0040 §2)", () => {
  it("affected records count the records of the changed form per pinned transformation; a new required field is a migration item", async () => {
    const base = await seedFormsVersion(api, T01_FIELDS);
    const pinned = await formsTransformation(api, w, w.office.id, base.id);
    const res = await call<Body>(api.app, "POST", V, { session: admin, body: { basedOnVersionId: base.id } });
    expect(res.status).toBe(201);
    const draft = res.body.id as string;
    expect(
      (await putEl(draft, "form_field", "T01.sponsor_note", 1, { fieldType: "text", required: true })).status,
    ).toBe(200);
    const affected = await call<Body>(api.app, "GET", `${V}/${draft}/affected-records`, { session: admin });
    expect(affected.status).toBe(200);
    const mine = affected.body.transformations.find((x: Body) => x.transformationId === pinned.transformationId);
    expect(mine.records).toEqual([{ recordType: "T01", count: 6, unknownReason: null }]);

    const items = await configKindProvider("form_schema").migrationItems!(api.db, {
      transformationId: pinned.transformationId,
      fromVersionId: base.id,
      toVersionId: draft,
    });
    expect(items).toEqual([
      {
        itemKind: "new_required_field",
        elementType: "form_field",
        stableKey: "T01.sponsor_note",
        recordType: "diagnostic_item",
        resolution: "needs_input",
        detail: {
          recordTypeCode: "T01",
          fieldKey: "sponsor_note",
          fieldType: "text",
          labelEn: "sponsor_note",
          labelAr: "sponsor_note",
          recordCount: 6,
        },
      },
    ]);
  });
});
