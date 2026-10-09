// Contribution allocations (T-DG4-KBE-D; ADR-0029 §5, §11; REQ-S08-013, REQ-PB-058). Proves, against the run's
// disposable PostgreSQL: "allocations 60% + 50% are rejected; 60% + 30% saves and shows 10% unallocated"; shares are
// exact decimal fractions (0.1 + 0.2 = 0.300000, never 0.30000000000000004); duplicate initiatives and out-of-range
// shares are refused; a replace steps the set number and the benefit version with one audit event (old and new sets);
// concurrent replaces never total above 100 %; AUD and ADM-only get 403; If-Match 428/409; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody, insertInitiative, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let B: string;
let i1: string;
let i2: string;
let i3: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  B = `${b.base}/benefits`;
  [i1, i2, i3] = [
    await insertInitiative(api.db, b),
    await insertInitiative(api.db, b),
    await insertInitiative(api.db, b),
  ];
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const newBenefit = async () => {
  const r = await call(api.app, "POST", B, { session: b.s.bo, body: financialBody(b, { plannedValue: "10000000" }) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
};
const put = (id: string, version: number, allocations: unknown[], session = b.s.tl) =>
  call(api.app, "PUT", `${B}/${id}/allocations`, { session, headers: ifm(version), body: { allocations } });

describe("replaceBenefitAllocations (REQ-S08-013)", () => {
  it("60 % + 50 % is rejected; 60 % + 30 % saves and shows 10 % unallocated", async () => {
    const id = await newBenefit();
    const empty = await call(api.app, "GET", `${B}/${id}/allocations`, { session: b.s.auditor });
    expect([empty.status, empty.headers.etag, empty.body]).toEqual([
      200,
      '"1"',
      { benefitId: id, setNo: 0, allocations: [], allocatedShare: "0.000000", unallocatedShare: "1.000000" },
    ]);
    const over = await put(id, 1, [
      { initiativeId: i1, share: "0.6" },
      { initiativeId: i2, share: "0.5" },
    ]);
    expect([over.status, over.body.code, over.body.detail]).toEqual([
      422,
      "benefit_allocation.over_100",
      "The allocations total 110 %, above 100 %. Reduce them so they total 100 % or less.",
    ]);
    const ok = await put(id, 1, [
      { initiativeId: i1, share: "0.6", basis: "Synthetic attribution basis" },
      { initiativeId: i2, share: "0.3" },
    ]);
    expect([ok.status, ok.headers.etag]).toEqual([200, '"2"']);
    expect(ok.body).toEqual({
      benefitId: id,
      setNo: 1,
      allocations: [
        { initiativeId: i1, share: "0.600000", basis: "Synthetic attribution basis" },
        { initiativeId: i2, share: "0.300000", basis: null },
      ],
      allocatedShare: "0.900000",
      unallocatedShare: "0.100000",
    });
    const read = await call(api.app, "GET", `${B}/${id}/allocations`, { session: b.s.auditor });
    expect([read.body.unallocatedShare, read.headers.etag]).toEqual(["0.100000", '"2"']);
    const audit = await auditOf(api.db, id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["benefit.create", null, 1],
      ["benefit.allocations_replaced", 1, 2],
    ]);
    expect((audit[1]!.changes as { allocations: unknown }).allocations).toEqual({
      from: [],
      to: [
        { initiativeId: i1, share: "0.600000" },
        { initiativeId: i2, share: "0.300000" },
      ],
    });
  });

  it("exact decimals: 0.1 + 0.2 = 0.300000 and exactly 100 % saves with 0 unallocated; an empty set clears", async () => {
    const id = await newBenefit();
    const r = await put(id, 1, [
      { initiativeId: i1, share: "0.1" },
      { initiativeId: i2, share: "0.2" },
    ]);
    expect([r.body.allocatedShare, r.body.unallocatedShare]).toEqual(["0.300000", "0.700000"]);
    const full = await put(id, 2, [
      { initiativeId: i1, share: "0.333333" },
      { initiativeId: i2, share: "0.333333" },
      { initiativeId: i3, share: "0.333334" },
    ]);
    expect([full.status, full.body.allocatedShare, full.body.unallocatedShare, full.body.setNo]).toEqual([
      200,
      "1.000000",
      "0.000000",
      2,
    ]);
    const tiny = await put(id, 3, [
      { initiativeId: i1, share: "0.5" },
      { initiativeId: i2, share: "0.500001" },
    ]);
    expect([tiny.status, tiny.body.detail]).toEqual([
      422,
      "The allocations total 100.0001 %, above 100 %. Reduce them so they total 100 % or less.",
    ]);
    const cleared = await put(id, 3, []);
    expect([cleared.status, cleared.body.setNo, cleared.body.allocations, cleared.body.unallocatedShare]).toEqual([
      200,
      3,
      [],
      "1.000000",
    ]);
  });

  it("share range, duplicates, scale and references are refused; nothing written", async () => {
    const id = await newBenefit();
    for (const share of ["0", "-0.1", "1.000001"]) {
      const r = await put(id, 1, [{ initiativeId: i1, share }]);
      expect([r.status, r.body.code, r.body.errors?.[0]?.pointer], share).toEqual([
        422,
        "benefit_allocation.share_invalid",
        "/allocations/0/share",
      ]);
    }
    const dup = await put(id, 1, [
      { initiativeId: i1, share: "0.2" },
      { initiativeId: i1, share: "0.2" },
    ]);
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      422,
      "benefit_allocation.duplicate_initiative",
      "Each initiative appears once in a benefit's allocations.",
    ]);
    expect((await put(id, 1, [{ initiativeId: i1, share: "0.1234567" }])).status).toBe(400);
    expect((await put(id, 1, [{ initiativeId: i1, share: 0.5 }])).status).toBe(400);
    const ref = await put(id, 1, [{ initiativeId: crypto.randomUUID(), share: "0.5" }]);
    expect([ref.status, ref.body.code]).toEqual([422, "validation.reference"]);
    const row = await api.db
      .selectFrom("benefit")
      .select(["version", "allocation_set_no"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ version: 1, allocation_set_no: 0 });
  });

  it("AUD, ADM-only and a role without benefit.allocate get 403; If-Match 428/409; archived 422", async () => {
    const id = await newBenefit();
    for (const session of [b.s.auditor, b.s.admin, b.s.fin])
      expect((await put(id, 1, [{ initiativeId: i1, share: "0.5" }], session)).status).toBe(403);
    const none = await call(api.app, "PUT", `${B}/${id}/allocations`, { session: b.s.bo, body: { allocations: [] } });
    expect(none.status).toBe(428);
    expect((await put(id, 4, [])).status).toBe(409);
    await call(api.app, "POST", `${B}/${id}/archive`, { session: b.s.bo, headers: ifm(1), body: { reason: "Gone" } });
    const archived = await put(id, 2, []);
    expect([archived.status, archived.body.code]).toEqual([422, "benefit.archived"]);
  });

  it("concurrent replaces serialise under lock 730232: one wins, the other is 409; never above 100 %", async () => {
    const id = await newBenefit();
    const [a, c] = await Promise.all([
      put(id, 1, [{ initiativeId: i1, share: "0.7" }]),
      put(id, 1, [{ initiativeId: i2, share: "0.7" }]),
    ]);
    expect([a.status, c.status].sort()).toEqual([200, 409]);
    const sets = await api.db
      .selectFrom("benefit_allocation")
      .select(["set_no", "share"])
      .where("benefit_id", "=", id)
      .execute();
    expect(sets).toEqual([{ set_no: 1, share: "0.700000" }]);
  });

  it("commit-time: a grant revoked while the replace waited is 403; nothing written", async () => {
    const id = await newBenefit();
    const u = await extraUser(api, w, b, "TL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PUT", `${B}/${id}/allocations`, {
          session: u.session,
          headers: ifm(1),
          body: { allocations: [{ initiativeId: i1, share: "0.5" }] },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("benefit_allocation").select("id").where("benefit_id", "=", id).execute()).toEqual(
      [],
    );
  });
});
