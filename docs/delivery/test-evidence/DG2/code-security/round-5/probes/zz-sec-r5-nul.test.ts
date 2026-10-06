// code-security-reviewer DG2 round-5 NUL probe (T-DG2-REV-SEC-R5, supports F-DG2-231). NOT part of the candidate: copied
// into a disposable clone (96a3c293) at apps/api/test/integration/ and run against a disposable PostgreSQL 16.
// All data SYNTHETIC. U+0000 inside otherwise visible free text passes every schema (freeText, name, reason all
// see visible content) and reaches PostgreSQL, whose text type cannot hold NUL (SQLSTATE 22021). The SECURE
// expectation (a 4xx validation problem) is asserted LAST, after logging the observed status, writes and audit.
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, startApi, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());
const counts = async () => {
  const r = await sql<{ t: string; c: string; a: string }>`select (select count(*) from transformation) t, (select count(*) from charter) c, (select count(*) from audit_event) a`.execute(api.db);
  return r.rows[0];
};

describe("U+0000 in visible free text", () => {
  it("root cause: PostgreSQL rejects NUL in text with SQLSTATE 22021", async () => {
    const err = await sql`select ${"a\u0000b"}::text as v`.execute(api.db).then(() => null, (e: { code?: string; message?: string }) => ({ code: e.code, message: e.message }));
    log("pg.nul", err);
    expect(err?.code).toBe("22021");
  });

  it.each([
    ["charter outOfScope (freeText, P2)", "charter"],
    ["transformation name (shared name, P1)", "name"],
    ["TOM gap archive reason (shared reason, P2)", "reason"],
  ])("%s", async (label, kind) => {
    let res;
    let target = "";
    if (kind === "charter") {
      const q = await setupP2World(api, w);
      target = `/api/v1/transformations/${q.transformationId}/charter`;
      const before = await counts();
      res = await call(api.app, "POST", target, { session: q.lead.session, contract: false, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope: "Synthetic\u0000exclusion" } });
      const after = await counts();
      const get = await call(api.app, "GET", target, { session: q.lead.session });
      log(`nul.${kind}`, { status: res.status, body: res.body, before, after, getAfter: get.status, audit: (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).length });
      expect(after).toEqual(before);
    } else if (kind === "name") {
      const before = await counts();
      res = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, contract: false, body: { businessUnitId: w.a1, name: "Synthetic\u0000name", mode: "end_to_end" } });
      const after = await counts();
      log(`nul.${kind}`, { status: res.status, body: res.body, before, after });
      expect(after).toEqual(before);
    } else {
      const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
      const before = await counts();
      res = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, contract: false, headers: ifm(gap.body.version), body: { reason: "Synthetic\u0000reason" } });
      const after = await counts();
      const still = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
      log(`nul.${kind}`, { status: res.status, body: res.body, before, after, record: [still.body.status, still.body.version] });
      expect([still.body.status, still.body.version]).toEqual(["open", gap.body.version]);
    }
    // secure expectation, asserted last
    expect(res.status, label).toBeGreaterThanOrEqual(400);
    expect(res.status, label).toBeLessThan(500);
  });
});
