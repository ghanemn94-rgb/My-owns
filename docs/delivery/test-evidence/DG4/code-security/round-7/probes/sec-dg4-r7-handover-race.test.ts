// code-security-reviewer DG4 round-7 probe H (T-DG4-REV-SEC-R7B). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/ (it imports the implementers' slice G fixtures read-only).
// All data is SYNTHETIC. A BAU-handover acceptance here is a synthetic product record (a business approval INSIDE the
// product), never a real approval, and unrelated to the engineering gates DG0-DG7.
// Concurrency of the receiving-owner decision (REQ-S11-005, REQ-PB-083; ADR-0034 §5/§9, lock class bauHandover):
//   H1 four concurrent acceptances by the receiving owner at the same If-Match: exactly one 200, the others are
//      refused (409 stale or 422 accepted_final); one accept audit event; one review; the area moved once.
//   H2 an acceptance and a return at the same time (same If-Match): exactly one wins; the end state is consistent
//      (accepted with no return stamps and one review, or returned with no acceptance and no review).
//   H3 two concurrent returns: exactly one 200, one return audit event.
//   H4 two concurrent creates for the same area and cycle: exactly one 201 (bau_handover_open_key backstop), the
//      other a 409 problem (never a 500).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  createArea,
  createNoteEvidence,
  fullContent,
  insertControl,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let s: SustainmentWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

async function submitted() {
  const area = await createArea(send, s);
  await insertControl(api.db, s.b, area.id, null);
  const created = await send("POST", s.handovers, {
    session: s.wl.session,
    body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(s.b.users.bo.id) },
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
  const H = `${s.handovers}/${created.body.id}`;
  const ev = await send("POST", `${H}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
  expect(ev.status, JSON.stringify(ev.body)).toBe(201);
  const sub = await send("POST", `${H}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
  expect(sub.status, JSON.stringify(sub.body)).toBe(200);
  return { area, id: created.body.id as string, H, version: sub.body.version as number };
}
const row = (id: string) => api.db.selectFrom("bau_handover").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const reviewsOf = (areaId: string) =>
  api.db.selectFrom("sustainment_review").selectAll().where("performance_area_id", "=", areaId).execute();
const areaRow = (id: string) =>
  api.db.selectFrom("performance_area").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const actions = async (id: string) => (await auditOf(api.db, id)).map((a) => a.action);

describe("SEC-DG4-R7 probe H: BAU handover decision races", () => {
  it("H1 four concurrent acceptances: exactly one 200; one accept event; one review; area moved once", async () => {
    const d = await submitted();
    const areaBefore = await areaRow(d.area.id);
    const res = await Promise.all(
      [1, 2, 3, 4].map((i) =>
        send("POST", `${d.H}/accept`, { session: s.b.s.bo, headers: ifm(d.version), body: { note: `Synthetic ${i}` } }),
      ),
    );
    const summary = res.map((r) => `${r.status} ${r.body.code ?? r.body.status}`);
    console.log(`[probe-H] H1 ${JSON.stringify(summary)}`);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of res.filter((x) => x.status !== 200)) {
      expect([409, 422]).toContain(r.status);
      expect(r.status).not.toBe(500);
    }
    const acts = await actions(d.id);
    console.log(`[probe-H] H1 audit ${JSON.stringify(acts)}`);
    expect(acts.filter((a) => a === "bau_handover.accept")).toHaveLength(1);
    expect((await row(d.id)).status).toBe("accepted");
    expect(await reviewsOf(d.area.id)).toHaveLength(1);
    const areaAfter = await areaRow(d.area.id);
    console.log(`[probe-H] H1 area version ${areaBefore.version} -> ${areaAfter.version}, status ${areaAfter.status}`);
    expect(Number(areaAfter.version)).toBe(Number(areaBefore.version) + 1);
  });

  it("H2 an acceptance and a return at the same time: exactly one wins; the end state is consistent", async () => {
    for (let round = 0; round < 3; round++) {
      const d = await submitted();
      const [acc, ret] = await Promise.all([
        send("POST", `${d.H}/accept`, { session: s.b.s.bo, headers: ifm(d.version), body: {} }),
        send("POST", `${d.H}/return`, {
          session: s.b.s.bo,
          headers: ifm(d.version),
          body: { reason: "Synthetic: race return reason" },
        }),
      ]);
      const r = await row(d.id);
      const reviews = await reviewsOf(d.area.id);
      const acts = await actions(d.id);
      console.log(
        `[probe-H] H2.${round} accept=${acc.status} ${acc.body.code ?? acc.body.status} return=${ret.status} ${ret.body.code ?? ret.body.status} -> ${r.status}, reviews=${reviews.length}, audit=${JSON.stringify(acts)}`,
      );
      expect([acc.status, ret.status].filter((x) => x === 200)).toHaveLength(1);
      expect([acc.status, ret.status]).not.toContain(500);
      if (acc.status === 200) {
        expect(r.status).toBe("accepted");
        expect(r.returned_at ?? null).toBeNull();
        expect(reviews).toHaveLength(1);
        expect(acts.filter((a) => a === "bau_handover.return")).toHaveLength(0);
      } else {
        expect(r.status).toBe("returned");
        expect(r.accepted_at).toBeNull();
        expect(reviews).toHaveLength(0);
        expect(acts.filter((a) => a === "bau_handover.accept")).toHaveLength(0);
      }
    }
  });

  it("H3 two concurrent returns: exactly one 200 and one return event", async () => {
    const d = await submitted();
    const res = await Promise.all(
      [1, 2].map(() =>
        send("POST", `${d.H}/return`, { session: s.b.s.bo, headers: ifm(d.version), body: { reason: "Synthetic: race" } }),
      ),
    );
    console.log(`[probe-H] H3 ${JSON.stringify(res.map((r) => `${r.status} ${r.body.code ?? r.body.status}`))}`);
    expect(res.filter((r) => r.status === 200)).toHaveLength(1);
    expect(res.map((r) => r.status)).not.toContain(500);
    expect((await actions(d.id)).filter((a) => a === "bau_handover.return")).toHaveLength(1);
  });

  it("H4 two concurrent creates for the same area and cycle: exactly one 201, the other 409 (never 500)", async () => {
    const area = await createArea(send, s);
    const res = await Promise.all(
      [1, 2].map(() =>
        send("POST", s.handovers, {
          session: s.wl.session,
          body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id },
        }),
      ),
    );
    console.log(`[probe-H] H4 ${JSON.stringify(res.map((r) => `${r.status} ${r.body.code ?? r.body.status}`))}`);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = res.find((r) => r.status === 409)!;
    expect(loser.body.code).toBe("bau_handover.exists");
    const rows = await api.db.selectFrom("bau_handover").select("id").where("performance_area_id", "=", area.id).execute();
    expect(rows).toHaveLength(1);
  });
});
