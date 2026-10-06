// qa-verifier DG2 round 3 — independent regression tests (T-DG2-REV-QA-R3). Authored by qa-verifier, NOT by an
// implementer. Real Fastify app (inject) on a disposable PostgreSQL via the backend's harness.
//  1. F-DG2-150 / REQ-PB-031 / REQ-S04-003: with everything else G1-ready, clearing Out of scope makes the exclusions
//     pre-check fail (attention, never unknown/pass) AND blocks the G1 submission (422, nothing written); restoring a real
//     exclusion makes G1 submittable again.
//  2. D-063 / REQ-PB-026: whitespace-only T01 text and charter text leave the row and version unchanged.
//  3. DB guards (migration 0010) fire on P2 rows written by the API, independently of the API: version step, immutable
//     columns, the deferred audit-required constraint and append-only history.
// Copy to tests/qa/integration/ in a disposable clone and run:
//   QA_PG_PORT=<port> tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/dg2-qa-regress-r3.test.ts
// All data is SYNTHETIC; product gate G1 here is a demo business gate on synthetic data (unrelated to DG0-DG7).
import { sql } from "../../../packages/db/src/index.ts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";
import { gateVersion, ifm, makeG1Ready, setupP2World, type P2World } from "../../../apps/api/test/support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
let api: TestApi;
let w: World;
let p: P2World;
let T: string;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
  await makeG1Ready(api, p);
});
afterAll(() => api.close());

const lead = () => p.lead.session;
const excl = (body: Any) => body.scopeCheckPrechecks.find((x: Any) => x.code === "exclusions_documented");
const g1 = async () => (await call<Any>(api.app, "GET", `${T}/gates/G1`, { session: lead() })).body;
const charterCrit = (g: Any) => g.criteria.find((c: Any) => c.key === "g1.initial_charter");

describe("QA r3 F-DG2-150: exclusions pre-check and G1 with an empty Out of scope", () => {
  it("baseline: G1-ready world, exclusions pre-check passes and the charter criterion is complete", async () => {
    const c = await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() });
    expect(c.status).toBe(200);
    expect(excl(c.body).result).toBe("pass");
    expect(charterCrit(await g1()).completeness).toBe("complete");
  });

  it("clearing Out of scope: pre-check attention (never unknown), G1 charter criterion incomplete, submit refused 422", async () => {
    const c = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body;
    const cleared = await call<Any>(api.app, "PATCH", `${T}/charter`, {
      session: lead(),
      headers: ifm(c.charter.version),
      body: { outOfScope: null, changeSummary: "QA: clear exclusions" },
    });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(excl(cleared.body).result).toBe("attention");
    const g = await g1();
    expect(charterCrit(g).completeness).toBe("incomplete");
    expect(charterCrit(g).missing.map((m: Any) => m.pointer)).toContain("/charter/outOfScope");
    const before = (await call<Any>(api.app, "GET", `${T}/gates/G1/submissions`, { session: lead() })).body.items.length;
    const sub = await call<Any>(api.app, "POST", `${T}/gates/G1/submissions`, {
      session: lead(),
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "QA: should be refused" },
    });
    console.log(`QA-R3 submit G1 with empty Out of scope -> ${sub.status} ${sub.body.code}`);
    expect(sub.status).toBe(422);
    const after = (await call<Any>(api.app, "GET", `${T}/gates/G1/submissions`, { session: lead() })).body.items.length;
    expect(after).toBe(before);
  });

  it("whitespace-only Out of scope is 400 validation.blank; charter version unchanged; pre-check still attention", async () => {
    const c = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body;
    const blank = await call<Any>(api.app, "PATCH", `${T}/charter`, {
      session: lead(),
      headers: ifm(c.charter.version),
      body: { outOfScope: "  \t " },
    });
    expect(blank.status).toBe(400);
    expect(blank.body.errors).toContainEqual(expect.objectContaining({ pointer: "/outOfScope", code: "validation.blank" }));
    const again = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body;
    expect(again.charter.version).toBe(c.charter.version);
    expect(again.charter.outOfScope).toBeNull();
    expect(excl(again).result).toBe("attention");
  });

  it("restoring a real exclusion: pass, criterion complete, G1 submission accepted (201)", async () => {
    const c = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body;
    const real = await call<Any>(api.app, "PATCH", `${T}/charter`, {
      session: lead(),
      headers: ifm(c.charter.version),
      body: { outOfScope: "Enterprise contracts (synthetic)", changeSummary: "QA: restore exclusions" },
    });
    expect(real.status).toBe(200);
    expect(excl(real.body).result).toBe("pass");
    expect(charterCrit(await g1()).completeness).toBe("complete");
    const sub = await call<Any>(api.app, "POST", `${T}/gates/G1/submissions`, {
      session: lead(),
      headers: ifm(await gateVersion(api, p, "G1")),
      body: { submissionNote: "QA: G1 after restoring exclusions" },
    });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  });
});

describe("QA r3 D-063: blank T01 text writes nothing", () => {
  it("each T01 text field: 400 validation.blank, row version and value unchanged", async () => {
    const items = (await call<Any>(api.app, "GET", `${T}/diagnostic-items?limit=50`, { session: lead() })).body.items;
    const item = items[0];
    for (const field of ["currentState", "rootCause", "impactText"]) {
      const res = await call<Any>(api.app, "PATCH", `${T}/diagnostic-items/${item.id}`, {
        session: lead(),
        headers: ifm(item.version),
        body: { [field]: "\r\n   " },
      });
      expect([res.status, res.body.errors?.[0]?.pointer, res.body.errors?.[0]?.code]).toEqual([
        400,
        `/${field}`,
        "validation.blank",
      ]);
    }
    const after = (await call<Any>(api.app, "GET", `${T}/diagnostic-items/${item.id}`, { session: lead() })).body;
    expect(after.version).toBe(item.version);
    expect([after.currentState, after.rootCause, after.impactText]).toEqual([
      item.currentState,
      item.rootCause,
      item.impactText,
    ]);
  });
});

describe("QA r3 DB guards (migration 0010) fire independently of the API", () => {
  const sqlState = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      return "no-error";
    } catch (e) {
      return String((e as { code?: string }).code ?? e);
    }
  };
  let charterId: string;
  beforeAll(async () => {
    charterId = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body.charter.id;
  });

  it("version must step by exactly 1 (23514 check_violation)", async () => {
    const code = await sqlState(() =>
      sql`UPDATE charter SET version = version + 2 WHERE id = ${charterId}`.execute(api.db),
    );
    console.log(`QA-R3 guard version+2 -> ${code}`);
    expect(code).toBe("23514");
  });

  it("organization_id / transformation_id / created_by are immutable (23514)", async () => {
    const code = await sqlState(() =>
      sql`UPDATE charter SET created_by = ${p.sponsor.id}, version = version + 1 WHERE id = ${charterId}`.execute(api.db),
    );
    console.log(`QA-R3 guard created_by change -> ${code}`);
    expect(code).toBe("23514");
  });

  it("an update without its audit event cannot commit (23000 integrity_constraint_violation)", async () => {
    const before = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body.charter;
    const code = await sqlState(() =>
      api.db.transaction().execute(async (tx) => {
        await sql`UPDATE charter SET out_of_scope = 'QA unaudited', version = version + 1 WHERE id = ${charterId}`.execute(
          tx,
        );
      }),
    );
    console.log(`QA-R3 guard unaudited update -> ${code}`);
    expect(code).toBe("23000");
    const after = (await call<Any>(api.app, "GET", `${T}/charter`, { session: lead() })).body.charter;
    expect([after.version, after.outOfScope]).toEqual([before.version, before.outOfScope]);
  });

  it("charter_version history is append-only (UPDATE and DELETE refused)", async () => {
    const upd = await sqlState(() =>
      sql`UPDATE charter_version SET change_summary = 'QA tamper' WHERE charter_id = ${charterId}`.execute(api.db),
    );
    const del = await sqlState(() => sql`DELETE FROM charter_version WHERE charter_id = ${charterId}`.execute(api.db));
    console.log(`QA-R3 guard charter_version UPDATE -> ${upd}; DELETE -> ${del}`);
    expect(upd).not.toBe("no-error");
    expect(del).not.toBe("no-error");
    const versions = (await call<Any>(api.app, "GET", `${T}/charter/versions`, { session: lead() })).body.items;
    expect(versions.length).toBeGreaterThanOrEqual(3);
    expect(versions.some((v: Any) => v.changeSummary === "QA tamper")).toBe(false);
  });
});
