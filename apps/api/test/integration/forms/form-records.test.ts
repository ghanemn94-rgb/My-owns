// The common form framework, part 2: drafts, export, bulk edit and the recoverable conflict (ADR-0041 §5, §6, §7, §9,
// §10; REQ-S05-001; p5-work-split §B.4; T-DG5-BE-E2) against a real PostgreSQL, on T01 (diagnostic item) and T14
// (benefit), with bulk edit on T03 (TOM gaps; a register served by the register kit):
//  - a saved draft reopens with its payload, and with baseChanged after a concurrent edit of its record;
//  - a conflicting concurrent save returns the recoverable 409 form_record.conflict with currentVersion;
//  - export returns the rows (CSV and JSON, en and ar headers; Unknown and Not computable marked, never 0);
//  - bulk edit of owners on 3 records commits all; with one stale version it commits none (409
//    form_record.bulk_conflict listing it); a refusal of a later item rolls the earlier ones back;
//  - AUD 403 on every write; another user's draft 404; one audit event per record written; commit-time
//    re-authorization (a grant revoked while the request waits -> 403 and nothing written); the database refuses a
//    change to a closed draft when the API is bypassed.
// All data is synthetic; nothing here approves anything or touches the engineering gates DG0-DG7.
import { createDb, insertAuditEvent } from "@mth/db";
import { formRecordExport, type FormRecordExport } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportCsv } from "../../../src/modules/forms/export.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { formsTransformation, seedFormsVersion, T01_FIELDS } from "../../support/forms-fixtures.ts";
import { benefitAt, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let office: Session;
let auditor: Session;
let t: string;
let t01: string;
let b: BenefitWorld;
let t14: string;
const SYSTEM = { actorType: "system" as const, actorUserId: null, source: "migration" as const };

/** Pins a transformation to a form_schema version, as an approved migration would have (owner role; test-only). */
async function pinForms(transformationId: string, organizationId: string, versionId: string, by: string) {
  const pinId = uuidv7();
  await createDb(api.owner)
    .transaction()
    .execute(async (tx) => {
      await tx
        .insertInto("transformation_config_pin")
        .values({
          id: pinId,
          organization_id: organizationId,
          transformation_id: transformationId,
          kind: "form_schema",
          methodology_version_id: versionId,
          pinned_by: by,
          created_by: by,
          updated_by: by,
        })
        .execute();
      await insertAuditEvent(tx, SYSTEM, {
        action: "test.seed",
        recordType: "transformation_config_pin",
        recordId: pinId,
        organizationId,
        newVersion: 1,
      });
    });
}

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  const v01 = await seedFormsVersion(api, T01_FIELDS);
  ({ transformationId: t, t01 } = await formsTransformation(api, w, w.office.id, v01.id));
  b = await seedBenefitWorld(api, w);
  t14 = (await benefitAt(api, b, "identify")).id;
  const v14 = await seedFormsVersion(api, [
    {
      elementType: "form_field",
      stableKey: "T14.uplift",
      attributes: { fieldType: "number", labelEn: "Uplift", labelAr: "الزيادة" },
    },
    {
      elementType: "form_field",
      stableKey: "T14.note",
      attributes: { fieldType: "text", labelEn: "Note", labelAr: "ملاحظة" },
    },
  ]);
  await pinForms(b.transformationId, b.organizationId, v14.id, w.office.id);
}, 90_000);
afterAll(() => api?.close());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: Res<Body>) => [r.status, r.body?.code];
const reqId = (r: Res) => r.headers["x-request-id"] as string;
const drafts = (tid: string) => `/api/v1/transformations/${tid}/form-drafts`;
const records = (tid: string, rt: string) => `/api/v1/transformations/${tid}/form-records/${rt}`;

interface Form {
  readonly name: string;
  readonly tid: () => string;
  readonly rt: string;
  readonly id: () => string;
  readonly writer: () => Session;
  readonly reader: () => Session;
  readonly url: () => string;
  readonly edit: Record<string, unknown>;
}
const FORMS: readonly Form[] = [
  {
    name: "T01",
    tid: () => t,
    rt: "T01",
    id: () => t01,
    writer: () => office,
    reader: () => auditor,
    url: () => `/api/v1/transformations/${t}/diagnostic-items/${t01}`,
    edit: { confidence: "H" },
  },
  {
    name: "T14",
    tid: () => b.transformationId,
    rt: "T14",
    id: () => t14,
    writer: () => b.s.bo,
    reader: () => b.s.auditor,
    url: () => `${b.base}/benefits/${t14}`,
    edit: { title: "Synthetic churn reduction (edited elsewhere)" },
  },
];

async function editRecord(f: Form): Promise<number> {
  const cur = await call<Body>(api.app, "GET", f.url(), { session: f.writer() });
  const r = await call<Body>(api.app, "PATCH", f.url(), {
    session: f.writer(),
    headers: ifm(cur.body.version),
    body: f.edit,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.version as number;
}

describe("draft saving (REQ-S05-001)", () => {
  for (const f of FORMS) {
    it(`${f.name}: a saved draft reopens with its payload, and with baseChanged after a concurrent edit`, async () => {
      const cur = await call<Body>(api.app, "GET", f.url(), { session: f.writer() });
      const payload = { note: "Synthetic work in progress", nested: { amount: "1500000.10" } };
      const created = await call<Body>(api.app, "POST", drafts(f.tid()), {
        session: f.writer(),
        body: { recordType: f.rt, recordId: f.id(), baseRecordVersion: cur.body.version, payload },
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.headers.etag).toBe('"1"');
      expect(created.headers.location).toBe(`${drafts(f.tid())}/${created.body.id}`);
      expect((await auditOfRequest(api.db, reqId(created))).map((a) => [a.action, a.record_id])).toEqual([
        ["form_draft.create", created.body.id],
      ]);
      const G = `${drafts(f.tid())}/${created.body.id}`;
      const reopened = await call<Body>(api.app, "GET", G, { session: f.writer() });
      expect([reopened.status, reopened.body.payload, reopened.body.baseChanged]).toEqual([200, payload, false]);
      // Decimals in the payload stay strings (no float on any path).
      expect(reopened.body.payload.nested.amount).toBe("1500000.10");

      await editRecord(f);
      const after = await call<Body>(api.app, "GET", G, { session: f.writer() });
      expect([after.body.payload, after.body.baseChanged, after.body.version]).toEqual([payload, true, 1]);
      const listed = await call<Body>(api.app, "GET", `${drafts(f.tid())}?recordType=${f.rt}&status=open`, {
        session: f.writer(),
      });
      expect(listed.body.items.find((d: Body) => d.id === created.body.id)?.baseChanged).toBe(true);

      // Only the owner reads it; one open draft per user and record.
      expect((await call(api.app, "GET", G, { session: f.reader() })).status).toBe(404);
      expect(
        codeOf(
          await call<Body>(api.app, "POST", drafts(f.tid()), {
            session: f.writer(),
            body: { recordType: f.rt, recordId: f.id(), baseRecordVersion: 1, payload: {} },
          }),
        ),
      ).toEqual([409, "form_draft.open_exists"]);
      const closed = await call<Body>(api.app, "POST", `${G}/close`, {
        session: f.writer(),
        headers: ifm(1),
        body: { reason: "discarded" },
      });
      expect([closed.status, closed.body.status, closed.body.closedReason]).toEqual([200, "closed", "discarded"]);
      expect((await auditOfRequest(api.db, reqId(closed))).map((a) => a.action)).toEqual(["form_draft.close"]);
    });

    it(`${f.name}: a conflicting concurrent save returns the recoverable 409 with currentVersion; nothing written`, async () => {
      const created = await call<Body>(api.app, "POST", drafts(f.tid()), {
        session: f.writer(),
        body: { recordType: f.rt, payload: { note: "Tab one and tab two" } },
      });
      expect(created.status).toBe(201);
      const G = `${drafts(f.tid())}/${created.body.id}`;
      const first = await call<Body>(api.app, "PUT", G, {
        session: f.writer(),
        headers: ifm(1),
        body: { payload: { note: "Saved from tab one" } },
      });
      expect([first.status, first.body.version, first.headers.etag]).toEqual([200, 2, '"2"']);
      expect((await auditOfRequest(api.db, reqId(first))).map((a) => a.action)).toEqual(["form_draft.update"]);
      const second = await call<Body>(api.app, "PUT", G, {
        session: f.writer(),
        headers: ifm(1),
        body: { payload: { note: "Saved from tab two" } },
      });
      expect([second.status, second.body.code, second.body.currentVersion]).toEqual([409, "form_record.conflict", 2]);
      expect(second.body.detail).toBe(
        "This record changed since you opened it. Review the current version, then apply your changes again.",
      );
      expect(await auditOfRequest(api.db, reqId(second))).toEqual([]);
      const now = await call<Body>(api.app, "GET", G, { session: f.writer() });
      expect([now.body.version, now.body.payload]).toEqual([2, { note: "Saved from tab one" }]);
      // The user re-applies on the current version.
      const retry = await call<Body>(api.app, "PUT", G, {
        session: f.writer(),
        headers: ifm(2),
        body: { payload: { note: "Saved from tab two" } },
      });
      expect([retry.status, retry.body.version]).toEqual([200, 3]);
      expect((await call(api.app, "PUT", G, { session: f.writer(), body: { payload: {} } })).status).toBe(428);
    });
  }

  it("AUD gets 403 on every draft write; another writer's draft is 404 to them", async () => {
    const mine = await call<Body>(api.app, "POST", drafts(t), {
      session: office,
      body: { recordType: "T01", payload: {} },
    });
    const G = `${drafts(t)}/${mine.body.id}`;
    expect(
      (await call(api.app, "POST", drafts(t), { session: auditor, body: { recordType: "T01", payload: {} } })).status,
    ).toBe(403);
    expect((await call(api.app, "PUT", G, { session: auditor, headers: ifm(1), body: { payload: {} } })).status).toBe(
      403,
    );
    expect(
      (await call(api.app, "POST", `${G}/close`, { session: auditor, headers: ifm(1), body: { reason: "discarded" } }))
        .status,
    ).toBe(403);
    const other = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, other.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, other.subject);
    expect((await call(api.app, "GET", G, { session: s })).status).toBe(404);
    expect((await call(api.app, "PUT", G, { session: s, headers: ifm(1), body: { payload: {} } })).status).toBe(404);
    expect((await call<Body>(api.app, "GET", drafts(t), { session: s })).body.items).toEqual([]);
  });

  it("validation: payload must be an object of storable text within 256 KiB; recordId and baseRecordVersion together", async () => {
    const bad = [
      { recordType: "T01", payload: [] },
      { recordType: "T01", payload: { note: "bad \u0000 char" } },
      { recordType: "T01", payload: { note: "x".repeat(262_200) } },
      { recordType: "T01", recordId: t01, payload: {} },
      { recordType: "T01", payload: {}, extra: true },
    ];
    for (const body of bad) {
      const r = await call<Body>(api.app, "POST", drafts(t), { session: office, body });
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    const unknown = await call<Body>(api.app, "POST", drafts(t), {
      session: office,
      body: { recordType: "T01", recordId: uuidv7(), baseRecordVersion: 1, payload: {} },
    });
    expect(unknown.status).toBe(404);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", drafts(t), {
          session: office,
          body: { recordType: "health_assessment", payload: {} },
        }),
      ),
    ).toEqual([422, "form_record.type_planned"]);
  });

  it("commit-time re-authorization: a grant revoked while the request waits -> 403 and nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", drafts(t), { session: s, body: { recordType: "T01", payload: { note: "late" } } }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("form_draft").select("id").where("owner_user_id", "=", u.id).execute()).toEqual([]);
  });

  it("the database refuses a change to a closed draft when the API is bypassed", async () => {
    const d = await call<Body>(api.app, "POST", drafts(t), {
      session: office,
      body: { recordType: "T01", payload: {} },
    });
    await call(api.app, "POST", `${drafts(t)}/${d.body.id}/close`, {
      session: office,
      headers: ifm(1),
      body: { reason: "saved" },
    });
    await expect(
      api.db.transaction().execute((tx) =>
        tx
          .updateTable("form_draft")
          .set({ payload: JSON.stringify({ forced: true }), version: 3 })
          .where("id", "=", d.body.id)
          .execute(),
      ),
    ).rejects.toMatchObject({ constraint: "form_draft_status_transition" });
  });
});

describe("export (REQ-S05-001)", () => {
  it("T01: JSON and CSV rows in en and ar; decimals as strings; Unknown and Not computable marked, never 0", async () => {
    const put = await call<Body>(api.app, "PUT", `${records(t, "T01")}/${t01}/custom-fields`, {
      session: office,
      headers: ifm(0),
      body: {
        values: {
          risk_score: "12.50",
          adoption: "0.12",
          budget: { amount: "1500000.10", currencyCode: "SAR" },
          tier: "gold",
          note: "=SUM(A1)",
        },
      },
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const n = (await api.db.selectFrom("diagnostic_item").select("id").where("transformation_id", "=", t).execute())
      .length;

    const json = await call<Body>(api.app, "GET", `${records(t, "T01")}/export?format=json&lang=en`, {
      session: auditor,
    });
    expect(json.status).toBe(200);
    expect(formRecordExport.safeParse(json.body).success).toBe(true);
    expect(json.body.rows.length).toBe(n);
    const keys = json.body.columns.map((c: Body) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["confidence", "risk_score", "adoption", "budget", "tier"]));
    const mine = json.body.rows.find((r: Body) => r.recordId === t01);
    expect(mine.values).toMatchObject({
      risk_score: "12.50",
      adoption: "0.12",
      budget: "SAR 1500000.10",
      tier: "Gold",
    });
    // The calculated field over the stored inputs (12.50 * 0.12), a decimal string.
    expect(mine.statuses.weighted_risk).toBeUndefined();
    expect(mine.values.weighted_risk).toMatch(/^1\.5(0*)$/);
    const other = json.body.rows.find((r: Body) => r.recordId !== t01);
    expect([other.values.risk_score, other.statuses.risk_score]).toEqual([null, "unknown"]);
    expect([other.values.weighted_risk, other.statuses.weighted_risk]).toEqual([null, "not_computable"]);
    // Never 0 for a missing value.
    for (const r of json.body.rows)
      for (const [k, v] of Object.entries(r.values)) if (v === null) expect(r.statuses[k]).toBeDefined();

    const ar = await call<Body>(api.app, "GET", `${records(t, "T01")}/export?format=json&lang=ar`, {
      session: auditor,
    });
    expect(ar.body.rows.find((r: Body) => r.recordId === t01).values.tier).toBe("ذهبي");

    const csvEn = await call<string>(api.app, "GET", `${records(t, "T01")}/export?lang=en`, { session: auditor });
    expect([csvEn.status, csvEn.headers["content-type"]]).toEqual([200, "text/csv; charset=utf-8"]);
    const lines = csvEn.body.split("\r\n");
    expect(lines[0]!.startsWith("﻿Record ID,Version,")).toBe(true);
    expect(lines[0]).toContain("Risk score,Risk score (status)");
    expect(lines.length).toBe(n + 2); // header, rows, final CRLF
    expect(lines.find((l) => l.startsWith(t01))).toContain("12.50,");
    // Formula-like user text is neutralized in the CSV (ADR-0046 §4) and stays as entered in JSON.
    expect(lines.find((l) => l.startsWith(t01))).toContain(",'=SUM(A1),");
    expect(mine.values.note).toBe("=SUM(A1)");
    expect(lines.find((l) => !l.startsWith(t01) && l !== "" && !l.startsWith("﻿"))).toContain(",Unknown");
    const csvAr = await call<string>(api.app, "GET", `${records(t, "T01")}/export?lang=ar`, { session: auditor });
    expect(csvAr.body.split("\r\n")[0]!.startsWith("﻿معرّف السجل,الإصدار,")).toBe(true);
    expect(csvAr.body).toContain("غير معروف");
    const viaAccept = await call<Body>(api.app, "GET", `${records(t, "T01")}/export`, {
      session: auditor,
      headers: { accept: "application/json" },
    });
    // Without lang, the caller's preferred language.
    const pref = await api.db
      .selectFrom("app_user")
      .select("preferred_locale")
      .where("id", "=", w.auditor.id)
      .executeTakeFirstOrThrow();
    expect(viaAccept.body.language).toBe(pref.preferred_locale.startsWith("ar") ? "ar" : "en");
  });

  it("T14: export returns the benefit rows with the extension fields of the pinned version", async () => {
    const json = await call<Body>(api.app, "GET", `${records(b.transformationId, "T14")}/export?format=json&lang=ar`, {
      session: b.s.auditor,
    });
    expect(json.status).toBe(200);
    expect(json.body.rows.map((r: Body) => r.recordId)).toContain(t14);
    expect(
      json.body.columns
        .filter((c: Body) => c.extension)
        .map((c: Body) => c.label)
        .sort(),
    ).toEqual(["الزيادة", "ملاحظة"].sort());
    const csv = await call<string>(api.app, "GET", `${records(b.transformationId, "T14")}/export`, {
      session: b.s.auditor,
    });
    expect(csv.body.split("\r\n").some((l) => l.startsWith(t14))).toBe(true);
    expect(
      (await call(api.app, "GET", `${records(b.transformationId, "T14")}/export`, { session: office })).status,
    ).toBe(200);
    expect(
      (await call(api.app, "GET", `${records(b.transformationId, "T14")}/export`, { session: b.s.outsider })).status,
    ).toBe(404);
  });

  it("at most 5000 rows: 5000 export, 5001 is 422 form_export.too_large", async () => {
    const big = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
    // Bulk synthetic rows for the cap only (owner role, one statement), each with its audit event as the guard requires.
    const insert = async (n: number) => {
      await api.owner.query(
        `with rows as (
           insert into diagnostic_item (id, organization_id, transformation_id, dimension_code, created_by, updated_by)
           select gen_random_uuid(), $1, $2, (select code from diagnostic_dimension order by code limit 1), $3, $3
           from generate_series(1, $4)
           returning id)
         insert into audit_event (id, organization_id, transformation_id, actor_type, action, record_type, record_id,
                                  new_version, source)
         select gen_random_uuid(), $1, $2, 'system', 'test.seed', 'diagnostic_item', id, 1, 'migration' from rows`,
        [w.orgA.id, big, w.office.id, n],
      );
    };
    await insert(5000);
    const ok = await call<Body>(api.app, "GET", `${records(big, "T01")}/export?format=json`, { session: auditor });
    expect([ok.status, ok.body.rows?.length]).toEqual([200, 5000]);
    await insert(1);
    const tooLarge = await call<Body>(api.app, "GET", `${records(big, "T01")}/export`, { session: auditor });
    expect([tooLarge.status, tooLarge.body.code, tooLarge.body.detail]).toEqual([
      422,
      "form_export.too_large",
      "This export has more than 5000 rows. Narrow the filter or use a report export.",
    ]);
  }, 60_000);

  it("CSV cells: RFC 4180 quoting, formula-like text neutralized, decimals unprefixed, BOM and CRLF", () => {
    const body: FormRecordExport = {
      recordType: "T01",
      formSchemaVersionId: uuidv7(),
      language: "en",
      illustrativeLabel: null,
      columns: [
        { key: "issue", label: "issue, quoted", fieldType: "text", extension: false },
        { key: "n", label: "N", fieldType: "number", extension: true },
      ],
      rows: [
        {
          recordId: "01920000-0000-7000-8000-000000000001",
          version: 2,
          values: { issue: '=HYPERLINK("x")', n: "-5.25" },
          statuses: {},
        },
        {
          recordId: "01920000-0000-7000-8000-000000000002",
          version: 1,
          values: { issue: "a\nb", n: null },
          statuses: { n: "unknown" },
        },
      ],
    };
    const rows =
      '﻿Record ID,Version,"issue, quoted","issue, quoted (status)",N,N (status)\r\n' +
      `01920000-0000-7000-8000-000000000001,2,"'=HYPERLINK(""x"")",,-5.25,\r\n` +
      '01920000-0000-7000-8000-000000000002,1,"a\nb",,,Unknown\r\n';
    expect(exportCsv(body)).toBe(rows);
    // F-DG5-124 (D-178): a demo export's label is the first row, after the BOM and before the header.
    expect(exportCsv({ ...body, illustrativeLabel: "Illustrative example — synthetic" })).toBe(
      `﻿Illustrative example — synthetic\r\n${rows.slice(1)}`,
    );
  });
});

describe("bulk editing (REQ-S05-001)", () => {
  let gaps: { id: string; version: number }[] = [];
  let lead: Session; // a TL of the transformation: holds tom.edit, raid.edit and charter.edit
  beforeAll(async () => {
    const tl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, tl.id, "TL", { type: "transformation", id: t }, w.orgA.id);
    lead = await signIn(api.app, tl.subject);
    gaps = [];
    for (let i = 0; i < 3; i++) {
      const g = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/tom-gaps`, {
        session: lead,
        body: { dimensionCode: "technology", gap: `Synthetic gap ${i}` },
      });
      expect(g.status, JSON.stringify(g.body)).toBe(201);
      gaps.push({ id: g.body.id, version: g.body.version });
    }
  });
  const B = () => `${records(t, "T03")}/bulk`;
  const owners = async () =>
    await api.db
      .selectFrom("tom_gap")
      .select(["id", "owner_user_id", "version"])
      .where(
        "id",
        "in",
        gaps.map((g) => g.id),
      )
      .orderBy("id")
      .execute();

  it("owners of 3 T03 records: all committed through the register's own update, one audit event per record", async () => {
    const r = await call<Body>(api.app, "POST", B(), {
      session: lead,
      body: { items: gaps.map((g) => ({ recordId: g.id, version: g.version, sourceFields: { owner: w.leadA1.id } })) },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toEqual(gaps.map((g) => ({ recordId: g.id, version: g.version + 1 })));
    const after = await owners();
    expect(after.every((g) => g.owner_user_id === w.leadA1.id)).toBe(true);
    const audits = await auditOfRequest(api.db, reqId(r));
    expect(audits.map((a) => [a.action, a.record_id]).sort()).toEqual(gaps.map((g) => ["tom_gap.update", g.id]).sort());
    expect(audits.every((a) => a.prior_version !== null && a.new_version === (a.prior_version as number) + 1)).toBe(
      true,
    );
    gaps = after.map((g) => ({ id: g.id, version: g.version }));
  });

  it("one stale version: 409 form_record.bulk_conflict listing it, and nothing is saved", async () => {
    const before = await owners();
    const items = gaps.map((g, i) => ({
      recordId: g.id,
      version: i === 1 ? g.version - 1 : g.version,
      sourceFields: { owner: w.office.id },
    }));
    const r = await call<Body>(api.app, "POST", B(), { session: lead, body: { items } });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      409,
      "form_record.bulk_conflict",
      "One of the selected records changed. Nothing was saved; reload and try again.",
    ]);
    expect(r.body.errors).toEqual([
      {
        pointer: "/items/1/version",
        code: "form_record.bulk_conflict",
        message: `Record ${gaps[1]!.id} is at version ${gaps[1]!.version}.`,
      },
    ]);
    expect(await owners()).toEqual(before);
    expect(await auditOfRequest(api.db, reqId(r))).toEqual([]);
  });

  it("a refusal of a later item rolls back the earlier ones (all-or-nothing)", async () => {
    const before = await owners();
    const items = gaps.map((g, i) => ({
      recordId: g.id,
      version: g.version,
      sourceFields: { owner: i === 2 ? w.disabled.id : w.office.id },
    }));
    const r = await call<Body>(api.app, "POST", B(), { session: lead, body: { items } });
    expect(r.status).toBe(422);
    expect(await owners()).toEqual(before);
    expect(await auditOfRequest(api.db, reqId(r))).toEqual([]);
  });

  it("refusals: not bulk-editable field, too many, not allowed; AUD 403", async () => {
    const g = gaps[0]!;
    expect(
      codeOf(
        await call<Body>(api.app, "POST", B(), {
          session: lead,
          body: { items: [{ recordId: g.id, version: g.version, sourceFields: { gap: "x" } }] },
        }),
      ),
    ).toEqual([422, "form_record.bulk_field_not_editable"]);
    const many = Array.from({ length: 101 }, () => ({ recordId: uuidv7(), version: 1, sourceFields: {} }));
    expect(codeOf(await call<Body>(api.app, "POST", B(), { session: lead, body: { items: many } }))).toEqual([
      422,
      "form_record.bulk_too_many",
    ]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", `${records(t, "charter")}/bulk`, {
          session: lead,
          body: { items: [{ recordId: g.id, version: 1, sourceFields: {} }] },
        }),
      ),
    ).toEqual([422, "form_record.bulk_not_allowed"]);
    expect(
      (
        await call(api.app, "POST", B(), {
          session: auditor,
          body: { items: [{ recordId: g.id, version: g.version, sourceFields: { owner: w.office.id } }] },
        })
      ).status,
    ).toBe(403);
    expect((await auditOf(api.db, g.id)).length).toBe(2); // the create and the one committed bulk edit
  });

  it("T14 extension values: a stale version is the bulk conflict; the current one saves and reads back", async () => {
    const cur = await call<Body>(api.app, "GET", `${b.base}/benefits/${t14}`, { session: b.s.bo });
    const B14 = `${records(b.transformationId, "T14")}/bulk`;
    const stale = await call<Body>(api.app, "POST", B14, {
      session: b.s.bo,
      body: { items: [{ recordId: t14, version: cur.body.version + 7, customFieldValues: { uplift: "0.10" } }] },
    });
    expect(codeOf(stale)).toEqual([409, "form_record.bulk_conflict"]);
    const ok = await call<Body>(api.app, "POST", B14, {
      session: b.s.bo,
      body: {
        items: [
          { recordId: t14, version: cur.body.version, customFieldValues: { uplift: "1500000.10", note: "Synthetic" } },
        ],
      },
    });
    expect([ok.status, ok.body.items]).toEqual([200, [{ recordId: t14, version: cur.body.version }]]);
    expect((await auditOfRequest(api.db, reqId(ok))).map((a) => a.action)).toEqual(["form_custom_value.create"]);
    const values = await call<Body>(api.app, "GET", `${records(b.transformationId, "T14")}/${t14}/custom-fields`, {
      session: b.s.auditor,
    });
    expect(values.body.values).toEqual({ uplift: "1500000.10", note: "Synthetic" });
    const invalid = await call<Body>(api.app, "POST", B14, {
      session: b.s.bo,
      body: { items: [{ recordId: t14, version: cur.body.version, customFieldValues: { uplift: 12.5 } }] },
    });
    expect([invalid.status, invalid.body.errors?.[0]?.pointer]).toEqual([400, "/items/0/customFieldValues/uplift"]);
    expect(
      codeOf(
        await call<Body>(api.app, "POST", B14, {
          session: b.s.bo,
          body: { items: [{ recordId: t14, version: cur.body.version, customFieldValues: { nope: "x" } }] },
        }),
      ),
    ).toEqual([422, "form_record.custom_field_unknown"]);
  });

  it("commit-time re-authorization: a grant revoked while the bulk edit waits -> 403 and nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const before = await owners();
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", B(), {
          session: s,
          body: { items: gaps.map((g) => ({ recordId: g.id, version: g.version, sourceFields: { owner: u.id } })) },
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await owners()).toEqual(before);
  });
});
