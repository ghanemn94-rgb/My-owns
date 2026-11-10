// A14 "Concurrent editing" for P6 (T-DG6-QA-C; REQ-S20-014, REQ-S16-026, REQ-S15-010, REQ-DLV-038).
// Acceptance texts (binding, requirements.csv):
//  - REQ-S20-014 / §20 A14: "Conflicting updates show a recoverable conflict rather than silently overwriting accepted
//    changes".
//  - REQ-S16-026: "two users edit the same initiative; the second save returns 409 and the UI offers compare and
//    reapply without losing the first change" (the UI half is e2e/a14-compare-reapply.spec.ts).
//  - REQ-S15-010 (A14 part): "a bulk update touching a stale record reports a conflict for that record only".
// Derived from docs/api/openapi.yaml: updateInitiative (If-Match; 409 VersionConflict with currentVersion), getInitiative
// (ETag), bulkUpdateFormRecords ("all-or-nothing ... 409 form_record.bulk_conflict lists the stale items"),
// compareFormRecordVersions ("Values only for a caller holding audit.read in scope; every other reader, including an
// editor of the record type, gets valuesWithheld true and field names only"), and ADR-0057 §7 (reapply = a PATCH with
// If-Match = the current version, containing only "my changes"; fields only they changed are never sent).
// The real API (inject, every response validated against the contract by the harness) on the run's PostgreSQL. All
// people and data are SYNTHETIC; an edit approves nothing (no G1-G6 business approval).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupP2World, type P2World } from "../../../apps/api/test/support/p2-fixtures.ts";
import { auditOf, call, expectProblem, startApi, type Loose, type Res, type TestApi } from "../support/api.ts";
import { seedWorld } from "../support/p4.ts";

let api: TestApi;
let p: P2World;
const VERSION_CONFLICT = "urn:mth:problem:version-conflict";
const reqId = (r: Res<Loose>) => String(r.headers["x-request-id"]);
const ifm = (v: number | string) => ({ "if-match": typeof v === "number" ? `"${v}"` : v });
const I = (id: string) => `/api/v1/initiatives/${id}`;
const bulkUrl = () => `/api/v1/transformations/${p.transformationId}/form-records/T05/bulk`;
const compareUrl = (id: string, from: number, to: number) =>
  `/api/v1/transformations/${p.transformationId}/form-records/T05/${id}/compare?fromVersion=${from}&toVersion=${to}`;

async function newInitiative(name: string): Promise<string> {
  const r = await call<Loose>(api.app, "POST", "/api/v1/initiatives", {
    session: p.lead.session,
    body: { transformationId: p.transformationId, name },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.body.version).toBe(1);
  return r.body.id as string;
}
const row = (id: string) =>
  api.db
    .selectFrom("initiative")
    .select(["version", "name", "objective", "risks_summary", "scope_in", "executive_owner_user_id"])
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
const auditsOfRequest = async (r: Res<Loose>) =>
  (await api.db.selectFrom("audit_event").select(["record_id"]).where("request_id", "=", reqId(r)).execute()).map(
    (a) => a.record_id,
  );

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  p = await setupP2World(api, w);
}, 120_000);
afterAll(() => api?.close());

describe("REQ-S16-026: two users edit the same initiative; the second save gets 409, compare and reapply keep both", () => {
  it("first save 200 (v2); the second, on v1, 409 version-conflict with currentVersion 2; nothing of it is written", async () => {
    const id = await newInitiative("Synthetic QA A14 initiative one");
    const first = await call<Loose>(api.app, "PATCH", I(id), {
      session: p.contributor.session,
      headers: ifm(1),
      body: { objective: "Objective written by user A (first save)" },
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.version).toBe(2);
    expect(first.headers["etag"]).toBe('"2"');

    const second = await call<Loose>(api.app, "PATCH", I(id), {
      session: p.lead.session,
      headers: ifm(1),
      body: { objective: "Objective written by user B (stale)", risksSummary: "Risks written by user B" },
    });
    expectProblem(second, 409, VERSION_CONFLICT);
    expect(second.body.currentVersion, "the 409 carries the current version for recovery").toBe(2);
    const db = await row(id);
    expect(db, "the first change is intact; nothing of the stale save is written").toMatchObject({
      version: 2,
      objective: "Objective written by user A (first save)",
      risks_summary: null,
    });
    expect(await auditsOfRequest(second), "no audit event for the refused save").toEqual([]);
  });

  it("compare v1->v2 names what the other user changed; values only for audit.read, withheld for an editor", async () => {
    const id = await newInitiative("Synthetic QA A14 initiative compare");
    // User A (the TL) saves first; user B (a contributor: an editor of initiatives without audit.read) compares.
    const a = await call<Loose>(api.app, "PATCH", I(id), {
      session: p.lead.session,
      headers: ifm(1),
      body: { objective: "Objective by user A", scopeIn: "Scope by user A" },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(200);

    const asEditor = await call<Loose>(api.app, "GET", compareUrl(id, 1, 2), { session: p.contributor.session });
    expect(asEditor.status, JSON.stringify(asEditor.body)).toBe(200);
    expect(asEditor.body).toMatchObject({ recordId: id, fromVersion: 1, toVersion: 2, currentVersion: 2 });
    expect(asEditor.body.valuesWithheld).toBe(true);
    const editorKeys = (asEditor.body.fields as Loose[]).map((f) => f.fieldKey);
    expect(editorKeys.length, "the changed fields are named").toBeGreaterThanOrEqual(2);
    for (const f of asEditor.body.fields as Loose[]) {
      expect(f, "no values for an editor without audit.read").not.toHaveProperty("from");
      expect(f).not.toHaveProperty("to");
      expect(f.labelEn.length > 0 && f.labelAr.length > 0, "bilingual field labels").toBe(true);
    }

    const asAuditor = await call<Loose>(api.app, "GET", compareUrl(id, 1, 2), { session: p.auditor.session });
    expect(asAuditor.status, JSON.stringify(asAuditor.body)).toBe(200);
    expect(asAuditor.body.valuesWithheld).toBe(false);
    // The form shows objective as one field and scope in/out as one composite field (its value an object).
    const byKey = new Map((asAuditor.body.fields as Loose[]).map((f) => [f.fieldKey as string, f]));
    expect(byKey.get("objective")).toMatchObject({ recorded: true, from: null, to: "Objective by user A" });
    expect(byKey.get("scope_in_out")).toMatchObject({
      recorded: true,
      from: { scope_in: null },
      to: { scope_in: "Scope by user A" },
    });
    expect((asAuditor.body.fields as Loose[]).map((f) => f.fieldKey).sort()).toEqual([...editorKeys].sort());

    const invalid = await call<Loose>(api.app, "GET", compareUrl(id, 2, 3), { session: p.auditor.session });
    expect([invalid.status, invalid.body.code]).toEqual([422, "form_record.compare_versions_invalid"]);
  });

  it("reapply (only my changes, If-Match = current) succeeds as v3 and keeps the other user's change", async () => {
    const id = await newInitiative("Synthetic QA A14 initiative reapply");
    const theirs = await call<Loose>(api.app, "PATCH", I(id), {
      session: p.contributor.session,
      headers: ifm(1),
      body: { objective: "Their objective (accepted first)" },
    });
    expect(theirs.status).toBe(200);
    const mine = { risksSummary: "My risks summary", scopeIn: "My scope" };
    const stale = await call<Loose>(api.app, "PATCH", I(id), { session: p.lead.session, headers: ifm(1), body: mine });
    expectProblem(stale, 409, VERSION_CONFLICT);

    // Recover: fresh GET (C), then reapply only "my changes" with If-Match = C's ETag.
    const current = await call<Loose>(api.app, "GET", I(id), { session: p.lead.session });
    expect(current.status).toBe(200);
    expect(current.headers["etag"]).toBe(`"${stale.body.currentVersion}"`);
    const reapplied = await call<Loose>(api.app, "PATCH", I(id), {
      session: p.lead.session,
      headers: ifm(String(current.headers["etag"])),
      body: mine,
    });
    expect(reapplied.status, JSON.stringify(reapplied.body)).toBe(200);
    expect(reapplied.body.version).toBe(3);
    expect(await row(id), "both changes present: none lost").toMatchObject({
      version: 3,
      objective: "Their objective (accepted first)",
      risks_summary: "My risks summary",
      scope_in: "My scope",
    });
    const trail = (await auditOf(api.db, id)).filter((e) => e.prior_version !== null);
    expect(
      trail.map((e) => [e.prior_version, e.new_version]),
      "one audited step per accepted save",
    ).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("two simultaneous saves on the same version: exactly one 200, the other 409; the loser's text is not stored", async () => {
    const id = await newInitiative("Synthetic QA A14 initiative race");
    const [r1, r2] = await Promise.all([
      call<Loose>(api.app, "PATCH", I(id), {
        session: p.contributor.session,
        headers: ifm(1),
        body: { objective: "Racer one" },
      }),
      call<Loose>(api.app, "PATCH", I(id), {
        session: p.lead.session,
        headers: ifm(1),
        body: { objective: "Racer two" },
      }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = r1.status === 200 ? "Racer one" : "Racer two";
    const loser = r1.status === 200 ? r2 : r1;
    expect(loser.body.type).toBe(VERSION_CONFLICT);
    expect(await row(id)).toMatchObject({ version: 2, objective: winner });
  });
});

describe("REQ-S15-010 (A14): a bulk update touching stale records reports a conflict for those records only", () => {
  it("four items, two stale (first and last): one error per stale item at its pointer, nothing saved", async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3, 4]) ids.push(await newInitiative(`Synthetic QA A14 bulk ${n}`));
    // The other user saves items 0 and 3 (versions 2), after the bulk editor loaded all four at version 1.
    for (const i of [0, 3]) {
      const r = await call<Loose>(api.app, "PATCH", I(ids[i]!), {
        session: p.contributor.session,
        headers: ifm(1),
        body: { objective: `Other user's objective ${i}` },
      });
      expect(r.status).toBe(200);
    }
    const before = await Promise.all(ids.map(row));
    const bulk = await call<Loose>(api.app, "POST", bulkUrl(), {
      session: p.lead.session,
      body: {
        items: ids.map((recordId) => ({ recordId, version: 1, sourceFields: { executive_owner: p.sponsor.id } })),
      },
    });
    expectProblem(bulk, 409, VERSION_CONFLICT);
    expect(bulk.body.code).toBe("form_record.bulk_conflict");
    const errors = bulk.body.errors as Loose[];
    expect(errors.map((e) => e.pointer).sort(), "exactly the two stale items").toEqual([
      "/items/0/version",
      "/items/3/version",
    ]);
    for (const e of errors) expect(e.code).toBe("form_record.bulk_conflict");
    const text = JSON.stringify(errors);
    expect(text).toContain(ids[0]!);
    expect(text).toContain(ids[3]!);
    expect(text, "a current record is not reported").not.toContain(ids[1]!);
    expect(text).not.toContain(ids[2]!);
    expect(await Promise.all(ids.map(row)), "all-or-nothing: nothing changed").toEqual(before);
    expect(await auditsOfRequest(bulk)).toEqual([]);

    // Recover: resubmit with the reloaded versions; the other user's objectives survive the bulk.
    const again = await call<Loose>(api.app, "POST", bulkUrl(), {
      session: p.lead.session,
      body: {
        items: ids.map((recordId, i) => ({
          recordId,
          version: i === 0 || i === 3 ? 2 : 1,
          sourceFields: { executive_owner: p.sponsor.id },
        })),
      },
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const after = await Promise.all(ids.map(row));
    expect(after.map((r) => r.version)).toEqual([3, 2, 2, 3]);
    expect(after.every((r) => r.executive_owner_user_id === p.sponsor.id)).toBe(true);
    expect([after[0]!.objective, after[3]!.objective]).toEqual([
      "Other user's objective 0",
      "Other user's objective 3",
    ]);
    expect((await auditsOfRequest(again)).sort()).toEqual([...ids].sort());
  });

  it("a bulk racing a single edit of one of its records: either the bulk is refused for that record, or the edit is", async () => {
    const ids: string[] = [];
    for (const n of [1, 2, 3]) ids.push(await newInitiative(`Synthetic QA A14 bulk race ${n}`));
    const [bulk, single] = await Promise.all([
      call<Loose>(api.app, "POST", bulkUrl(), {
        session: p.lead.session,
        body: {
          items: ids.map((recordId) => ({ recordId, version: 1, sourceFields: { executive_owner: p.sponsor.id } })),
        },
      }),
      call<Loose>(api.app, "PATCH", I(ids[1]!), {
        session: p.contributor.session,
        headers: ifm(1),
        body: { objective: "Single edit racing the bulk" },
      }),
    ]);
    const rows = await Promise.all(ids.map(row));
    if (bulk.status === 200) {
      expectProblem(single, 409, VERSION_CONFLICT);
      expect(rows.map((r) => r.version)).toEqual([2, 2, 2]);
      expect(rows[1]!.objective).toBeNull();
    } else {
      expect(single.status).toBe(200);
      expect([bulk.status, bulk.body.code]).toEqual([409, "form_record.bulk_conflict"]);
      expect((bulk.body.errors as Loose[]).map((e) => e.pointer)).toEqual(["/items/1/version"]);
      expect(rows.map((r) => r.version)).toEqual([1, 2, 1]);
      expect(rows[1]!.objective).toBe("Single edit racing the bulk");
      expect(rows.every((r) => r.executive_owner_user_id === null)).toBe(true);
    }
  });
});
