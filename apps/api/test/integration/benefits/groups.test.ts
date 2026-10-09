// Shared-benefit groups (T-DG4-KBE-D; ADR-0029 §6, §11; REQ-PB-058). Proves, against the run's disposable
// PostgreSQL: a group counts NO member until a counted member is named, then exactly that member
// (benefit_counting); the counted member must be a member (422) and cannot leave while counted (422); codes BG-01…;
// AUD and ADM-only get 403; If-Match 428/409; one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a business or Finance approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let G: string;
let B: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  G = `${b.base}/benefit-groups`;
  B = `${b.base}/benefits`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const newGroup = async (title = "Synthetic shared pool") => {
  const r = await call(api.app, "POST", G, { session: b.s.tl, body: { title } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number };
};
const newBenefit = async (extra: Record<string, unknown> = {}) => {
  const r = await call(api.app, "POST", B, { session: b.s.bo, body: financialBody(b, extra) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; code: string };
};
const counting = async (id: string) =>
  (await call(api.app, "GET", `${B}/${id}`, { session: b.s.auditor })).body.counting;

describe("shared-benefit groups (REQ-PB-058)", () => {
  it("no member is counted until one is named; then exactly the named member is counted", async () => {
    const g = await newGroup();
    expect(g.code).toMatch(/^BG-[0-9]{2,6}$/);
    const one = await newBenefit({ benefitGroupId: g.id, plannedValue: "10000000" });
    const two = await newBenefit({ benefitGroupId: g.id, plannedValue: "10000000" });
    for (const id of [one.id, two.id])
      expect(await counting(id)).toEqual({
        counted: false,
        exclusionReason: "group_counted_member_not_named",
        overlapOpen: false,
      });
    const named = await call(api.app, "PATCH", `${G}/${g.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { countedBenefitId: one.id },
    });
    expect([named.status, named.body.countedBenefitId, [...named.body.memberBenefitIds].sort()]).toEqual([
      200,
      one.id,
      [one.id, two.id].sort(),
    ]);
    expect((await counting(one.id)).counted).toBe(true);
    expect(await counting(two.id)).toEqual({
      counted: false,
      exclusionReason: "group_member_not_counted",
      overlapOpen: false,
    });
    const view = await api.db
      .selectFrom("benefit_counting")
      .select(["benefit_id"])
      .where("benefit_id", "in", [one.id, two.id])
      .where("counted", "=", true)
      .execute();
    expect(view).toEqual([{ benefit_id: one.id }]);
    expect((await auditOf(api.db, g.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["benefit_group.create", 1],
      ["benefit_group.update", 2],
    ]);
  });

  it("the counted benefit must be a member; the counted member cannot leave while counted", async () => {
    const g = await newGroup();
    const outside = await newBenefit();
    const bad = await call(api.app, "PATCH", `${G}/${g.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { countedBenefitId: outside.id },
    });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "benefit_group.counted_not_member",
      "The counted benefit must be a member of the group.",
    ]);
    const member = await newBenefit({ benefitGroupId: g.id });
    await call(api.app, "PATCH", `${G}/${g.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { countedBenefitId: member.id },
    });
    const leave = await call(api.app, "PATCH", `${B}/${member.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { benefitGroupId: null },
    });
    expect([leave.status, leave.body.code, leave.body.detail]).toEqual([
      422,
      "benefit_group.counted_member_leaving",
      `Benefit ${member.code} is the counted member of its shared-benefit group. Name another counted member first.`,
    ]);
    // Un-name it first, then it may leave.
    await call(api.app, "PATCH", `${G}/${g.id}`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { countedBenefitId: null },
    });
    const left = await call(api.app, "PATCH", `${B}/${member.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { benefitGroupId: null },
    });
    expect([left.status, left.body.benefitGroupId, left.body.counting.counted]).toEqual([200, null, true]);
  });

  it("list and get; rename; AUD and ADM-only get 403; If-Match 428/409; 400 on an empty body", async () => {
    const g = await newGroup("Synthetic pool to rename");
    const list = await call(api.app, "GET", `${G}?limit=100`, { session: b.s.auditor });
    expect((list.body.items as { id: string }[]).map((x) => x.id)).toContain(g.id);
    const one = await call(api.app, "GET", `${G}/${g.id}`, { session: b.s.auditor });
    expect([one.status, one.headers.etag, one.body.memberBenefitIds]).toEqual([200, '"1"', []]);
    expect((await call(api.app, "GET", `${G}/${g.id}`, { session: b.s.outsider })).status).toBe(404);
    for (const session of [b.s.auditor, b.s.admin, b.s.fin]) {
      expect((await call(api.app, "POST", G, { session, body: { title: "x" } })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${G}/${g.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(403);
    }
    expect((await call(api.app, "PATCH", `${G}/${g.id}`, { session: b.s.tl, body: { title: "x" } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", `${G}/${g.id}`, { session: b.s.tl, headers: ifm(4), body: { title: "x" } })).status,
    ).toBe(409);
    expect((await call(api.app, "PATCH", `${G}/${g.id}`, { session: b.s.tl, headers: ifm(1), body: {} })).status).toBe(
      400,
    );
    const renamed = await call(api.app, "PATCH", `${G}/${g.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { title: "Synthetic renamed pool", description: "Synthetic" },
    });
    expect([renamed.status, renamed.body.title, renamed.body.version]).toEqual([200, "Synthetic renamed pool", 2]);
  });

  it("commit-time: a grant revoked while the group update waited is 403; nothing written", async () => {
    const g = await newGroup();
    const u = await extraUser(api, w, b, "TL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${G}/${g.id}`, {
          session: u.session,
          headers: ifm(1),
          body: { title: "Late rename" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("benefit_group")
      .select(["title", "version"])
      .where("id", "=", g.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ title: "Synthetic shared pool", version: 1 });
  });
});
