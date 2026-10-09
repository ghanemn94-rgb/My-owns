// Allocation sets and contribution shares (T-DG4-BE-M; ADR-0038 §3, §11, §12; REQ-S03-006 "an allocation link set
// totalling 110% is rejected"). Proves, against the run's disposable PostgreSQL:
//  - a capability -> KPI link of 0.6 plus a contribution share of 0.4 is accepted (`total` 1, `unallocatedShare` 0),
//    and one more 0.1 is 422 trace_link.allocation_exceeds_total with the exact text "The allocations into this record
//    would total 110%, more than 100%."; raising a member instead is refused the same way; the same rule into a benefit;
//  - a set at 0.4 shows `unallocatedShare` 0.6 (decimal strings, never floats);
//  - two concurrent writes into one target cannot both commit above 100 % (lock 730249 + the 0055 trigger), and the
//    trigger's own refusal maps to the same exact text;
//  - setOutcomeContributionAllocation: needs the KPI, refuses a removed contribution, AUD 403, If-Match 428/409, one
//    audit event, commit-time re-authorisation; the DG3 contribution routes' responses are unchanged (strict DG3 mirror).
// All data is SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { initiativeOutcomeContribution } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mapDatabaseGuardError, type PgErrorLike } from "../../../src/modules/platform/index.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { seedTraceWorld, type TraceWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
let L: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
  L = `${t.base}/trace-links`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const EXCEEDS_110 = "The allocations into this record would total 110%, more than 100%.";
const link = (body: Record<string, unknown>, session = t.s.bo) =>
  call(api.app, "POST", L, { session, body: { contributionStatement: "Synthetic contribution", ...body } });
const contribute = async (outcomeKpiId: string | null) => {
  const r = await call(api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions`, {
    session: t.s.tl,
    body: { outcomeId: t.outcomeId, ...(outcomeKpiId ? { outcomeKpiId } : {}), contributionStatement: "Synthetic" },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number };
};
const allocate = (linkId: string, version: number | null, body: unknown, session = t.s.bo) =>
  call(api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions/${linkId}/allocation`, {
    session,
    body,
    ...(version === null ? {} : { headers: ifm(version) }),
  });
const setOf = (type: "outcome_kpi" | "benefit", id: string) =>
  call(api.app, "GET", `${t.base}/allocation-sets/${type}/${id}`, { session: t.s.auditor });

describe("REQ-S03-006: the 100 % rule", () => {
  it("0.6 + 0.4 is accepted (total 1, unallocated 0); one more 0.1 is refused with the exact 110 % text", async () => {
    const cap = await link({
      linkKind: "capability_kpi",
      fromId: t.capability1Id,
      toId: t.kpi1Id,
      allocationShare: "0.6",
    });
    expect(cap.status, JSON.stringify(cap.body)).toBe(201);
    const c = await contribute(t.kpi1Id);
    const share = await allocate(c.id, c.version, { allocationShare: "0.4", allocationBasis: "Synthetic split" });
    expect([share.status, share.body.allocationShare, share.body.outcomeKpiId, share.headers["etag"]]).toEqual([
      200,
      "0.400000",
      t.kpi1Id,
      '"2"',
    ]);
    const set = await setOf("outcome_kpi", t.kpi1Id);
    expect([set.status, set.body.total, set.body.unallocatedShare]).toEqual([200, "1.000000", "0.000000"]);
    expect(
      (set.body.members as { linkTable: string; allocationShare: string }[])
        .map((m) => `${m.linkTable}:${m.allocationShare}`)
        .sort(),
    ).toEqual(["initiative_outcome_contribution:0.400000", "trace_link:0.600000"]);
    const over = await link({
      linkKind: "capability_kpi",
      fromId: t.capability2Id,
      toId: t.kpi1Id,
      allocationShare: "0.1",
    });
    expect([over.status, over.body.code, over.body.detail, over.body.errors[0].pointer]).toEqual([
      422,
      "trace_link.allocation_exceeds_total",
      EXCEEDS_110,
      "/allocationShare",
    ]);
    // Raising a member instead is refused the same way.
    const raise = await call(api.app, "PATCH", `${L}/${cap.body.id}`, {
      session: t.s.bo,
      headers: ifm(1),
      body: { allocationShare: "0.7" },
    });
    expect([raise.status, raise.body.code, raise.body.detail]).toEqual([
      422,
      "trace_link.allocation_exceeds_total",
      EXCEEDS_110,
    ]);
    // ...and through the contribution share.
    const raiseC = await allocate(c.id, 2, { allocationShare: "0.5", allocationBasis: null });
    expect([raiseC.status, raiseC.body.code, raiseC.body.detail]).toEqual([
      422,
      "trace_link.allocation_exceeds_total",
      EXCEEDS_110,
    ]);
    // The set is unchanged.
    expect((await setOf("outcome_kpi", t.kpi1Id)).body.total).toBe("1.000000");
    // A removed member leaves the set (TL10).
    const rm = await call(api.app, "POST", `${L}/${cap.body.id}/remove`, {
      session: t.s.bo,
      headers: ifm(1),
      body: { reason: "Synthetic: re-estimated" },
    });
    expect(rm.status).toBe(200);
    const after = await setOf("outcome_kpi", t.kpi1Id);
    expect([after.body.total, after.body.unallocatedShare]).toEqual(["0.400000", "0.600000"]);
  });

  it("a set at 0.4 shows unallocatedShare 0.6; an empty set is 100 % unallocated, never 0 %", async () => {
    const empty = await setOf("outcome_kpi", t.kpi2Id);
    expect([empty.status, empty.body.total, empty.body.unallocatedShare, empty.body.members]).toEqual([
      200,
      "0.000000",
      "1.000000",
      [],
    ]);
    const c = await contribute(t.kpi2Id);
    expect((await allocate(c.id, c.version, { allocationShare: "0.4", allocationBasis: null })).status).toBe(200);
    const set = await setOf("outcome_kpi", t.kpi2Id);
    expect([set.body.total, set.body.unallocatedShare]).toEqual(["0.400000", "0.600000"]);
    // The graph node carries the same totals.
    const g = await call(api.app, "GET", `${t.base}/traceability`, { session: t.s.auditor });
    const node = (g.body.nodes as { recordId: string; allocation: unknown }[]).find((n) => n.recordId === t.kpi2Id);
    expect(node?.allocation).toEqual({ total: "0.400000", unallocatedShare: "0.600000" });
  });

  it("into a benefit: 0.7 + 0.4 is refused (110 %); decimals stay exact (0.1 + 0.2 = 0.300000)", async () => {
    const a = await link({ linkKind: "kpi_benefit", fromId: t.kpi1Id, toId: t.benefitId, allocationShare: "0.7" });
    expect(a.status).toBe(201);
    const b = await link({ linkKind: "kpi_benefit", fromId: t.kpi2Id, toId: t.benefitId, allocationShare: "0.4" });
    expect([b.status, b.body.detail]).toEqual([
      422,
      "The allocations into this record would total 110%, more than 100%.",
    ]);
    expect(
      (
        await call(api.app, "PATCH", `${L}/${a.body.id}`, {
          session: t.s.bo,
          headers: ifm(1),
          body: { allocationShare: "0.1" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await link({ linkKind: "kpi_benefit", fromId: t.kpi2Id, toId: t.benefitId, allocationShare: "0.2" })).status,
    ).toBe(201);
    const set = await setOf("benefit", t.benefitId);
    expect([set.body.total, set.body.unallocatedShare]).toEqual(["0.300000", "0.700000"]);
    expect(
      (await call(api.app, "GET", `${t.base}/allocation-sets/benefit/${t.kpi1Id}`, { session: t.s.auditor })).status,
    ).toBe(404);
    expect(
      (await call(api.app, "GET", `${t.base}/allocation-sets/benefit/${t.benefitId}`, { session: t.s.outsider }))
        .status,
    ).toBe(404);
  });

  it("two concurrent writes into one target cannot both commit above 100 %", async () => {
    const other = await seedTraceWorld(api, w);
    for (let round = 0; round < 3; round += 1) {
      const benefit = await call(api.app, "POST", `${other.base}/benefits`, {
        session: other.s.bo,
        body: {
          title: `Synthetic concurrent benefit ${round}`,
          description: "Synthetic.",
          benefitType: "cost",
          valueClass: "avoided_cost",
          ownerUserId: other.users.bo.id,
          currency: "SAR",
          financialStatementLine: "Opex",
        },
      });
      expect(benefit.status).toBe(201);
      const results = await Promise.all(
        [other.kpi1Id, other.kpi2Id].map((kpi) =>
          call(api.app, "POST", `${other.base}/trace-links`, {
            session: other.s.bo,
            body: {
              linkKind: "kpi_benefit",
              fromId: kpi,
              toId: benefit.body.id,
              contributionStatement: "Concurrent",
              allocationShare: "0.6",
            },
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      const refused = results.find((r) => r.status === 422)!;
      expect([refused.body.code, refused.body.detail]).toEqual([
        "trace_link.allocation_exceeds_total",
        "The allocations into this record would total 120%, more than 100%.",
      ]);
      const sum = await api.db
        .selectFrom("trace_link")
        .select((eb) => eb.fn.sum<string>("allocation_share").as("s"))
        .where("benefit_id", "=", benefit.body.id)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      expect(sum.s).toBe("0.600000");
    }
  });

  it("the 0055 trigger refuses a direct write above 100 % and maps to the same exact text", async () => {
    const set = await setOf("benefit", t.benefitId); // 0.3 allocated
    expect(set.body.total).toBe("0.300000");
    let error: unknown = null;
    try {
      await api.db
        .insertInto("trace_link")
        .values({
          id: "01900000-0000-7000-8000-0000000000aa",
          organization_id: t.organizationId,
          transformation_id: t.transformationId,
          link_kind: "capability_kpi",
          capability_id: t.capability2Id,
          outcome_kpi_id: t.kpi1Id,
          contribution_statement: "Direct",
          allocation_share: "0.8",
          created_by: t.users.bo.id,
          updated_by: t.users.bo.id,
        })
        .execute();
    } catch (e) {
      error = e;
    }
    expect((error as PgErrorLike | null)?.constraint).toBe("trace_allocation_total");
    const problem = mapDatabaseGuardError(error as PgErrorLike);
    expect([problem?.status, problem?.code, problem?.detail]).toEqual([
      422,
      "trace_link.allocation_exceeds_total",
      "The allocations into this record would total 120%, more than 100%.",
    ]);
  });
});

describe("setOutcomeContributionAllocation (S-4)", () => {
  it("needs the contribution's KPI; a removed contribution is read-only; a basis needs a share", async () => {
    const noKpi = await contribute(null);
    const r = await allocate(noKpi.id, 1, { allocationShare: "0.1", allocationBasis: null });
    expect([r.status, r.body.code, r.body.detail, r.body.errors[0].pointer]).toEqual([
      422,
      "contribution.allocation_needs_kpi",
      "A share needs the contribution's KPI; name the KPI first.",
      "/allocationShare",
    ]);
    // Clearing (null) on a contribution without a KPI is allowed.
    expect((await allocate(noKpi.id, 1, { allocationShare: null, allocationBasis: null })).status).toBe(200);
    expect((await allocate(noKpi.id, 2, { allocationShare: null, allocationBasis: "Basis" })).status).toBe(400);
    const removedC = await contribute(t.kpi2Id);
    const rm = await call(
      api.app,
      "POST",
      `/api/v1/initiatives/${t.initiativeId}/outcome-contributions/${removedC.id}/remove`,
      { session: t.s.tl, headers: ifm(1), body: { reason: "Synthetic removal" } },
    );
    expect(rm.status).toBe(200);
    const gone = await allocate(removedC.id, 2, { allocationShare: "0.1", allocationBasis: null });
    expect([gone.status, gone.body.code, gone.body.detail]).toEqual([
      422,
      "contribution.not_active",
      "This contribution has been removed.",
    ]);
  });

  it("AUD 403; If-Match 428/409; one audit event per mutation; commit-time re-authorisation", async () => {
    const c = await contribute(t.kpi2Id);
    expect((await allocate(c.id, 1, { allocationShare: "0.1", allocationBasis: null }, t.s.auditor)).status).toBe(403);
    // ADM-only reads no transformation: 404 on an initiative path, as on every DG3 initiative-link route.
    expect((await allocate(c.id, 1, { allocationShare: "0.1", allocationBasis: null }, t.s.admin)).status).toBe(404);
    expect((await allocate(c.id, null, { allocationShare: "0.1", allocationBasis: null })).status).toBe(428);
    expect((await allocate(c.id, 7, { allocationShare: "0.1", allocationBasis: null })).status).toBe(409);
    const ok = await allocate(c.id, 1, { allocationShare: "0.1", allocationBasis: "Synthetic" });
    expect([ok.status, ok.body.version]).toEqual([200, 2]);
    const events = await auditOf(api.db, c.id);
    expect(events.map((e) => e.action)).toEqual([
      "initiative_outcome_contribution.create",
      "initiative_outcome_contribution.allocation_set",
    ]);
    expect(events[1]!.changes).toEqual({
      allocation_share: { from: null, to: "0.100000" },
      allocation_basis: { from: null, to: "Synthetic" },
    });
    const u = await extraUser(api, w, t, "TL");
    const late = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions/${c.id}/allocation`, {
          session: u.session,
          headers: ifm(2),
          body: { allocationShare: "0.2", allocationBasis: null },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(late.status).toBe(403);
    expect((await auditOf(api.db, c.id)).length).toBe(2);
    expect(
      (
        await call(api.app, "GET", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions`, {
          session: t.s.outsider,
        })
      ).status,
    ).toBe(404);
  });

  it("the DG3 contribution routes' responses are unchanged: no share fields, strict DG3 mirror, before and after a share", async () => {
    const c = await contribute(t.kpi2Id);
    const DG3_KEYS = Object.keys(initiativeOutcomeContribution.shape).sort();
    const listBefore = await call(api.app, "GET", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions`, {
      session: t.s.auditor,
    });
    const before = (listBefore.body.items as { id: string }[]).find((i) => i.id === c.id)!;
    expect(Object.keys(before).sort()).toEqual(DG3_KEYS);
    expect(initiativeOutcomeContribution.safeParse(before).success).toBe(true);
    expect((await allocate(c.id, 1, { allocationShare: "0.05", allocationBasis: null })).status).toBe(200);
    const listAfter = await call(api.app, "GET", `/api/v1/initiatives/${t.initiativeId}/outcome-contributions`, {
      session: t.s.auditor,
    });
    const after = (listAfter.body.items as { id: string; version: number; updatedAt: string }[]).find(
      (i) => i.id === c.id,
    )!;
    expect(Object.keys(after).sort()).toEqual(DG3_KEYS);
    expect(initiativeOutcomeContribution.safeParse(after).success).toBe(true);
    // Only the P2 stamps moved (version, updatedAt, updatedBy); every other DG3 field is byte-identical.
    const { version: _v1, updatedAt: _u1, updatedBy: _b1, ...restBefore } = before as Record<string, unknown>;
    const { version: _v2, updatedAt: _u2, updatedBy: _b2, ...restAfter } = after as Record<string, unknown>;
    expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
    // A DG3-style remove still commits with the bumped version.
    const rm = await call(
      api.app,
      "POST",
      `/api/v1/initiatives/${t.initiativeId}/outcome-contributions/${c.id}/remove`,
      {
        session: t.s.tl,
        headers: ifm(after.version),
        body: { reason: "Synthetic removal" },
      },
    );
    expect([rm.status, Object.keys(rm.body).sort()]).toEqual([200, DG3_KEYS]);
  });
});
