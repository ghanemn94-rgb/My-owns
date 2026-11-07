// Custom-field values that name a restricted record (T-DG6-BE-Z10B; F-DG6-420 second half; D-218; ADR-0051 §2;
// ADR-0041 §3) against a real PostgreSQL. Everything is SYNTHETIC. Marking a record sensitive is an access decision,
// never a business approval (G1-G6), and nothing here names or touches the engineering gates DG0-DG7.
//
// A T01 diagnostic item has two extension fields pinned for its transformation: an attachment list and a reference.
// The TO (office) stores both: the attachment list holds a sensitive evidence item E and an open one O; the reference
// names E. Reader TL (scoped to the transformation, no grant) is not admitted to E.
//   - GET: TL sees the list without E and the reference as null, with includesRestrictedRecords; the TO sees both.
//   - PUT (the Day-90 re-save rule): TL saves the values it was shown (O only, reference null): E stays in the list and
//     in the reference; the PUT response does not name E to TL. TL replaces the reference only by sending another id.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
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
import { formsTransformation, seedFormsVersion } from "../../support/forms-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let office: Session;
let tl: Session;
let t = "";
let t01 = "";
let e = "";
let o = "";
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const url = () => `/api/v1/transformations/${t}/form-records/T01/${t01}/custom-fields`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  const v = await seedFormsVersion(api, [
    {
      elementType: "form_field",
      stableKey: "T01.minutes",
      attributes: { fieldType: "attachment", labelEn: "Minutes", labelAr: "المحاضر", maxCount: 5 },
    },
    {
      elementType: "form_field",
      stableKey: "T01.source",
      attributes: { fieldType: "reference", labelEn: "Source", labelAr: "المصدر", targetRecordType: "evidence" },
    },
  ]);
  ({ transformationId: t, t01 } = await formsTransformation(api, w, w.office.id, v.id));
  const uTl = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.office.id, uTl.id, "TL", { type: "transformation", id: t }, w.orgA.id);
  tl = await signIn(api.app, uTl.subject);
  const ev = async (title: string) => {
    const r = await call<Body>(api.app, "POST", `/api/v1/transformations/${t}/evidence`, {
      session: office,
      body: { ownerUserId: w.office.id, kind: "note", title, noteBody: "Synthetic" },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.id as string;
  };
  e = await ev("Synthetic CONFIDENTIAL minutes (BE-Z10B)");
  o = await ev("Synthetic open minutes (BE-Z10B)");
  const mark = await call<Body>(api.app, "PUT", `/api/v1/transformations/${t}/records/evidence/${e}/sensitivity`, {
    session: office,
    headers: ifm(0),
    body: { isSensitive: true, reason: "Synthetic sensitive evidence (BE-Z10B)" },
  });
  expect(mark.status, JSON.stringify(mark.body)).toBe(200);
}, 90_000);
afterAll(() => api?.close());

describe("custom-field values naming a restricted record (T-DG6-BE-Z10B; D-218)", () => {
  it("TL reads them without the restricted id (marked); a re-save keeps it; the TO sees it", async () => {
    const put0 = await call<Body>(api.app, "PUT", url(), {
      session: office,
      headers: ifm(0),
      body: { values: { minutes: [e, o], source: e } },
    });
    expect(put0.status, JSON.stringify(put0.body).slice(0, 400)).toBe(200);
    expect(put0.body.values).toMatchObject({ minutes: [e, o], source: e });
    expect(put0.body.includesRestrictedRecords).toBeUndefined();

    const seen = await call<Body>(api.app, "GET", url(), { session: tl });
    expect(seen.status, JSON.stringify(seen.body).slice(0, 400)).toBe(200);
    expect(seen.body.values).toMatchObject({ minutes: [o], source: null });
    expect(seen.body.includesRestrictedRecords).toBe(true);
    expect(JSON.stringify(seen.body)).not.toContain(e);

    // TL saves what it was shown: E stays stored, in the list and in the reference; the response does not name it.
    const resave = await call<Body>(api.app, "PUT", url(), {
      session: tl,
      headers: ifm(seen.body.version),
      body: { values: { minutes: [o], source: null } },
    });
    expect(resave.status, JSON.stringify(resave.body).slice(0, 400)).toBe(200);
    expect(JSON.stringify(resave.body)).not.toContain(e);
    expect(resave.body.includesRestrictedRecords).toBe(true);
    const stored = await api.db
      .selectFrom("form_custom_value")
      .select("field_values")
      .where("record_id", "=", t01)
      .executeTakeFirstOrThrow();
    expect(stored.field_values).toEqual({ minutes: [o, e], source: e });

    // An explicit other reference replaces it.
    const replaced = await call<Body>(api.app, "PUT", url(), {
      session: tl,
      headers: ifm(resave.body.version),
      body: { values: { minutes: [o], source: o } },
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body.values.source).toBe(o);

    const adm = await call<Body>(api.app, "GET", url(), { session: office });
    expect(adm.body.values).toMatchObject({ minutes: [o, e], source: o });
    expect(adm.body.includesRestrictedRecords).toBeUndefined();
  });
});
