// The A14 API proof of the DG5 bulk response for P6 (ADR-0057 §8; REQ-S15-010 "a bulk update touching a stale record
// reports a conflict for that record only"; D-199 ARCH-04 §5 item 1: bulk stays all-or-nothing; p6-work-split §H/G.4,
// T-DG6-BE-Q2) against a real PostgreSQL, on three initiatives (T05):
//  - two users edit: the second user's PATCH makes one of the three records stale for the first user; the first user's
//    bulk update of all three answers 409 form_record.bulk_conflict with exactly ONE error, at that item's
//    `/items/<i>/version`, naming that record and its current version; the two current items are not named;
//  - all three versions and owners are unchanged and the request wrote no audit event (nothing saved); the second
//    user's change is intact;
//  - after reloading the stale record's version, the same bulk commits all three (one version step and one audit
//    event each), keeping the second user's change to the field the bulk does not send.
// `forms/bulk.ts` is unchanged (D-199). All data is SYNTHETIC; a bulk edit approves nothing (no G1-G6 business
// approval) and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, startApi, type Res, type TestApi } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- response bodies are asserted structurally
type Body = any;

let api: TestApi;
let p: P2World;
const ids: string[] = [];
const reqId = (r: Res) => r.headers["x-request-id"] as string;

async function rows() {
  return api.db
    .selectFrom("initiative")
    .select(["id", "version", "executive_owner_user_id", "objective"])
    .where("id", "in", ids)
    .execute()
    .then((r) => ids.map((id) => r.find((x) => x.id === id)!));
}

beforeAll(async () => {
  api = await startApi();
  const w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  for (const n of [1, 2, 3]) {
    const r = await call<Body>(api.app, "POST", "/api/v1/initiatives", {
      session: p.lead.session,
      body: { transformationId: p.transformationId, name: `Synthetic bulk initiative ${n}` },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    ids.push(r.body.id);
  }
}, 120_000);
afterAll(() => api.close());

describe("A14: a bulk update touching a stale record reports a conflict for that record only", () => {
  const B = () => `/api/v1/transformations/${p.transformationId}/form-records/T05/bulk`;

  it("three items, one stale -> 409 naming only the stale item; all three unchanged; nothing saved", async () => {
    // The first user (lead) loaded all three at version 1. The second user (WL) saves the second one: version 2.
    const theirs = await call<Body>(api.app, "PATCH", `/api/v1/initiatives/${ids[1]}`, {
      session: p.contributor.session,
      body: { objective: "Synthetic objective saved by the second user" },
      headers: ifm(1),
    });
    expect(theirs.status, JSON.stringify(theirs.body)).toBe(200);
    const before = await rows();
    expect(before.map((r) => r.version)).toEqual([1, 2, 1]);

    const r = await call<Body>(api.app, "POST", B(), {
      session: p.lead.session,
      body: {
        items: ids.map((id) => ({ recordId: id, version: 1, sourceFields: { executive_owner: p.sponsor.id } })),
      },
    });
    expect([r.status, r.body.code]).toEqual([409, "form_record.bulk_conflict"]);
    expect(r.body.errors).toEqual([
      {
        pointer: "/items/1/version",
        code: "form_record.bulk_conflict",
        message: `Record ${ids[1]} is at version 2.`,
      },
    ]);
    const text = JSON.stringify(r.body);
    expect(text).not.toContain(ids[0]!);
    expect(text).not.toContain(ids[2]!);
    expect(await rows()).toEqual(before);
    expect(await auditOfRequest(api.db, reqId(r))).toEqual([]);
  });

  it("after reloading the stale record, the bulk commits all three and the second user's change stays", async () => {
    const r = await call<Body>(api.app, "POST", B(), {
      session: p.lead.session,
      body: {
        items: ids.map((id, i) => ({
          recordId: id,
          version: i === 1 ? 2 : 1,
          sourceFields: { executive_owner: p.sponsor.id },
        })),
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items).toEqual(ids.map((id, i) => ({ recordId: id, version: i === 1 ? 3 : 2 })));
    const after = await rows();
    expect(after.every((x) => x.executive_owner_user_id === p.sponsor.id)).toBe(true);
    expect(after[1]!.objective).toBe("Synthetic objective saved by the second user");
    const audits = await auditOfRequest(api.db, reqId(r));
    expect(audits.map((a) => a.record_id).sort()).toEqual([...ids].sort());
  });
});
