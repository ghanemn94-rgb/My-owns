// Orphan report (T-DG4-BE-M; ADR-0038 §5; REQ-PB-044 "an initiative without a TOM gap appears in the orphan report").
// Proves, against the run's disposable PostgreSQL: an initiative linked only to a diagnosed finding is listed with
// `missing` upstream and `expected` naming the TOM-gap step; once linked to a gap it leaves the upstream list; drafts are
// never orphans; the filters and the cursor work; every listed href returns 200; scope 404; nothing is stored.
// All data is SYNTHETIC; nothing here grants a business approval or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { insertSubmittedInitiative, seedTraceWorld, type TraceWorld } from "../contract/p4-exercises-be-m.ts";

let api: TestApi;
let w: World;
let t: TraceWorld;
let O: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  t = await seedTraceWorld(api, w);
  O = `${t.base}/orphans`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

interface Item {
  recordType: string;
  recordId: string;
  href: string;
  missing: string;
  expected: string[];
}
const report = async (query = "") => {
  const r = await call(api.app, "GET", `${O}${query}`, { session: t.s.auditor });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { items: Item[]; nextCursor: string | null };
};

describe("REQ-PB-044: the orphan report", () => {
  it("an initiative linked only to a finding is listed with expected naming the TOM gap step", async () => {
    const gl = await call(api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/gap-links`, {
      session: t.s.tl,
      body: { targetType: "diagnostic_finding", targetId: t.findingId },
    });
    expect(gl.status, JSON.stringify(gl.body)).toBe(201);
    const items = (await report("?recordType=initiative")).items;
    const item = items.find((i) => i.recordId === t.initiativeId);
    expect(item, JSON.stringify(items)).toBeDefined();
    expect(item!.missing === "upstream" || item!.missing === "both").toBe(true);
    expect(item!.expected).toContain("tom_gap → initiative");
    // The finding itself is no orphan any more (it reaches an initiative).
    expect((await report("?recordType=diagnostic_finding")).items.some((i) => i.recordId === t.findingId)).toBe(false);
    // Linked to a TOM gap, the initiative leaves the upstream list.
    expect(
      (
        await call(api.app, "POST", `/api/v1/initiatives/${t.initiativeId}/gap-links`, {
          session: t.s.tl,
          body: { targetType: "tom_gap", targetId: t.gap1Id },
        })
      ).status,
    ).toBe(201);
    expect(
      (await report("?recordType=initiative&missing=upstream")).items.some((i) => i.recordId === t.initiativeId),
    ).toBe(false);
  });

  it("drafts are never orphans; every listed href returns 200", async () => {
    const draft = await insertSubmittedInitiative(api.db, t, "draft");
    const all = (await report("?limit=100")).items;
    expect(all.some((i) => i.recordId === draft.id)).toBe(false);
    const types = new Set(all.map((i) => i.recordType));
    expect(types.size).toBeGreaterThan(3);
    for (const type of types) {
      const item = all.find((i) => i.recordType === type)!;
      expect(item.expected.length).toBeGreaterThan(0);
      const r = await call(api.app, "GET", item.href, { session: t.s.auditor });
      expect([type, r.status]).toEqual([type, 200]);
    }
    // Every gap starts without an issue -> gap link: upstream expects the finding step.
    const gap = all.find((i) => i.recordId === t.gap2Id)!;
    expect([gap.missing, gap.expected]).toEqual(["both", ["diagnostic_finding → tom_gap", "tom_gap → initiative"]]);
  });

  it("the cursor walks the whole report; filters are bound to the cursor; scope 404", async () => {
    const all = (await report("?limit=100")).items.map((i) => i.recordId);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { items: Item[]; nextCursor: string | null } = await report(
        `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      seen.push(...page.items.map((i) => i.recordId));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(seen).toEqual(all);
    const first = await report("?limit=1");
    const reuse = await call(
      api.app,
      "GET",
      `${O}?limit=1&recordType=benefit&cursor=${encodeURIComponent(first.nextCursor!)}`,
      {
        session: t.s.auditor,
      },
    );
    expect(reuse.status).toBe(400);
    expect((await call(api.app, "GET", O, { session: t.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${O}?missing=sideways`, { session: t.s.auditor })).status).toBe(400);
  });
});
