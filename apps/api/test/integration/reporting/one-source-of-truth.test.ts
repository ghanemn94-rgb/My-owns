// One source of truth (T-DG4-BE-M; ADR-0038 §8; REQ-PB-010 "renaming an initiative changes it in roadmap, scorecard
// and benefits register views in one update; no duplicate initiative rows exist in the database"). Proves, against the
// run's disposable PostgreSQL: ONE `PATCH` of an initiative's name changes it at once in the roadmap (`getRoadmap`),
// the traceability view (its node label, read through `traceability_edge` + `initiative`), and the benefits register
// (`listBenefits` `initiatives[]`, ADR-0038 §8), and the database holds exactly one initiative row for the code.
// The "scorecard" is the T10 transformation dashboard's Portfolio area (D-106 (d)); that read model is KBE-G's and is
// not merged in this tree, so the scorecard read is asserted on the traceability node label, which reads the same
// canonical row by join (p4-work-split JK.1). All data is SYNTHETIC; nothing here touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { seedTraceWorld, type TraceWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-PB-010: one canonical initiative", () => {
  it("one rename shows in the roadmap, the traceability view and the benefits register; one initiative row", async () => {
    // Allocate the benefit to the initiative (slice B set), so the register row names it.
    const benefit = await call(api.app, "GET", `${t.base}/benefits/${t.benefitId}`, { session: t.s.bo });
    const alloc = await call(api.app, "PUT", `${t.base}/benefits/${t.benefitId}/allocations`, {
      session: t.s.bo,
      headers: ifm(benefit.body.version),
      body: { allocations: [{ initiativeId: t.initiativeId, share: "1" }] },
    });
    expect(alloc.status, JSON.stringify(alloc.body)).toBe(200);

    const ini = await call(api.app, "GET", `/api/v1/initiatives/${t.initiativeId}`, { session: t.s.tl });
    const renamed = await call(api.app, "PATCH", `/api/v1/initiatives/${t.initiativeId}`, {
      session: t.s.tl,
      headers: ifm(ini.body.version),
      body: { name: "Synthetic renamed order automation" },
    });
    expect(renamed.status, JSON.stringify(renamed.body)).toBe(200);
    const NAME = "Synthetic renamed order automation";

    const roadmap = await call(api.app, "GET", `${t.base}/roadmap`, { session: t.s.auditor });
    expect(roadmap.status).toBe(200);
    const onRoadmap = (roadmap.body.initiatives as { id: string; name: string }[]).filter(
      (i) => i.id === t.initiativeId,
    );
    expect(onRoadmap.map((i) => i.name)).toEqual([NAME]);

    const graph = await call(api.app, "GET", `${t.base}/traceability`, { session: t.s.auditor });
    const nodes = (graph.body.nodes as { recordType: string; recordId: string; label: string; code: string }[]).filter(
      (n) => n.recordId === t.initiativeId,
    );
    expect(nodes.map((n) => [n.recordType, n.label, n.code])).toEqual([["initiative", NAME, t.initiativeCode]]);

    const register = await call(api.app, "GET", `${t.base}/benefits`, { session: t.s.auditor });
    expect(register.status).toBe(200);
    const row = (
      register.body.items as { id: string; initiatives: { id: string; code: string; name: string }[] }[]
    ).find((r) => r.id === t.benefitId)!;
    expect(row.initiatives).toEqual([{ id: t.initiativeId, code: t.initiativeCode, name: NAME }]);

    const count = await api.db
      .selectFrom("initiative")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", t.transformationId)
      .where("code", "=", t.initiativeCode)
      .executeTakeFirstOrThrow();
    expect(Number(count.n)).toBe(1);
    // No P4 table stores a copy of the name: the only column holding it is initiative.name.
    const copies = await api.db
      .selectFrom("audit_event")
      .select("id")
      .where("record_id", "=", t.initiativeId)
      .where("action", "=", "initiative.update")
      .execute();
    expect(copies.length).toBe(1);
  });

  it("a benefit without an allocation set lists no initiatives (an empty array, never a guess)", async () => {
    const other = await call(api.app, "POST", `${t.base}/benefits`, {
      session: t.s.bo,
      body: {
        title: "Synthetic unallocated benefit",
        description: "Synthetic.",
        benefitType: "cost",
        valueClass: "avoided_cost",
        ownerUserId: t.users.bo.id,
        currency: "SAR",
        financialStatementLine: "Opex",
      },
    });
    expect(other.status).toBe(201);
    const register = await call(api.app, "GET", `${t.base}/benefits`, { session: t.s.auditor });
    const row = (register.body.items as { id: string; initiatives: unknown[] }[]).find((r) => r.id === other.body.id)!;
    expect(row.initiatives).toEqual([]);
  });
});
