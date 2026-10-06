// F-DG2-231 (T-DG2-BE10): U+0000 (NUL) in client text never reaches PostgreSQL, on a real PostgreSQL.
// PostgreSQL `text` cannot store NUL (SQLSTATE 22021), and a NUL inside otherwise visible text used to pass validation
// and come back as an undeclared 500. The central request check (platform `preHandler` hook) now rejects a NUL in ANY
// JSON body string, query parameter or path parameter with a 400 validation problem, code
// `validation.invalid_character`, at the field's JSON pointer. Nothing is written and the request leaves no audit row.
// Every call goes through the harness's OpenAPI contract assertion, so an undeclared status (such as 500) fails the test.
// Authentication and CSRF keep their precedence (401/403 before the 400).
// All data is SYNTHETIC. G1-G6 are PRODUCT gates (business approvals), unrelated to the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  seedWorld,
  signIn,
  startApi,
  type Res,
  type TestApi,
  type World,
} from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const NUL_TEXTS = ["Synthetic\u0000exclusion", "\u0000Synthetic leading NUL", "Synthetic trailing NUL\u0000"] as const;

/** 400 `validation.invalid_character` at `pointer`, and no audit row for the request. */
async function expectInvalidCharacter(res: Res, pointer: string) {
  expect(res.status, JSON.stringify(res.body)).toBe(400);
  const body = res.body as { code: string; type: string; errors: { pointer: string; code: string }[] };
  expect(body.code).toBe("validation");
  expect(body.type).toBe("urn:mth:problem:validation");
  expect(body.errors).toEqual([expect.objectContaining({ pointer, code: "validation.invalid_character" })]);
  expect(await auditOfRequest(api.db, String(res.headers["x-request-id"]))).toEqual([]);
}

async function tomGapCount(transformationId: string): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*) AS n FROM tom_gap WHERE transformation_id = ${transformationId}`.execute(api.db);
  return Number(r.rows[0]!.n);
}

describe("U+0000 in a JSON body string is 400 validation.invalid_character; nothing is written or audited", () => {
  it("charter create (outOfScope, freeText): no charter is created", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    for (const text of NUL_TEXTS) {
      const res = await call(api.app, "POST", QC, {
        session: q.lead.session,
        body: { transformationName: "Synthetic", outOfScope: text },
      });
      await expectInvalidCharacter(res, "/outOfScope");
    }
    expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
  });

  it("charter update (inScope): version, value and audit trail unchanged", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    const created = await call(api.app, "POST", QC, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const charterId = created.body.charter.id as string;
    const before = await auditOf(api.db, charterId);
    const res = await call(api.app, "PATCH", QC, {
      session: q.lead.session,
      headers: ifm(1),
      body: { inScope: "Retail\u0000onboarding", changeSummary: "Synthetic NUL attempt" },
    });
    await expectInvalidCharacter(res, "/inScope");
    // The change summary is checked too (first offending field in document order is reported).
    const res2 = await call(api.app, "PATCH", QC, {
      session: q.lead.session,
      headers: ifm(1),
      body: { inScope: "Retail onboarding v2 (synthetic)", changeSummary: "Synthetic\u0000summary" },
    });
    await expectInvalidCharacter(res2, "/changeSummary");
    const after = await call(api.app, "GET", QC, { session: q.lead.session });
    expect([after.body.charter.version, after.body.charter.inScope]).toEqual([1, "Retail onboarding (synthetic)"]);
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("T03 TOM gap create and update (gap): no gap is created, the existing one is unchanged", async () => {
    const before = await tomGapCount(p.transformationId);
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic\u0000gap" },
    });
    await expectInvalidCharacter(res, "/gap");
    expect(await tomGapCount(p.transformationId)).toBe(before);

    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap (valid)" },
    });
    expect(gap.status, JSON.stringify(gap.body)).toBe(201);
    const auditBefore = await auditOf(api.db, gap.body.id);
    const upd = await call(api.app, "PATCH", `${T}/tom-gaps/${gap.body.id}`, {
      session: p.lead.session,
      headers: ifm(gap.body.version),
      body: { gap: "Synthetic\u0000updated gap" },
    });
    await expectInvalidCharacter(upd, "/gap");
    const after = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
    expect([after.body.version, after.body.gap]).toEqual([gap.body.version, "Synthetic gap (valid)"]);
    expect(await auditOf(api.db, gap.body.id)).toEqual(auditBefore);
  });

  it("T03 TOM gap archive reason: the gap stays open; a valid reason still archives (audited once)", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap to archive" },
    });
    expect(gap.status).toBe(201);
    const auditBefore = await auditOf(api.db, gap.body.id);
    for (const reason of NUL_TEXTS) {
      const res = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, {
        session: p.lead.session,
        headers: ifm(gap.body.version),
        body: { reason },
      });
      await expectInvalidCharacter(res, "/reason");
    }
    const still = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
    expect([still.body.version, still.body.status, still.body.archiveReason]).toEqual([gap.body.version, "open", null]);
    expect(await auditOf(api.db, gap.body.id)).toEqual(auditBefore);

    const ok = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, {
      session: p.lead.session,
      headers: ifm(gap.body.version),
      body: { reason: "Synthetic: superseded gap" },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await auditOf(api.db, gap.body.id)).length).toBe(auditBefore.length + 1);
  });

  it("P1 transformation name (shared name): no transformation is created", async () => {
    const before = await sql<{ n: string }>`SELECT count(*) AS n FROM transformation`.execute(api.db);
    const res = await call(api.app, "POST", "/api/v1/transformations", {
      session: p.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic\u0000name", mode: "end_to_end" },
    });
    await expectInvalidCharacter(res, "/name");
    const after = await sql<{ n: string }>`SELECT count(*) AS n FROM transformation`.execute(api.db);
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
  });

  it("a NUL in an object key is reported at that key's pointer", async () => {
    const q = await setupP2World(api, w);
    const res = await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", "out\u0000Scope": "Synthetic" },
    });
    await expectInvalidCharacter(res, "/out\u0000Scope");
  });
});

describe("U+0000 in a query or path parameter is 400 validation.invalid_character at /query or /params", () => {
  it("GET /transformations?q= (a text filter the database queries)", async () => {
    const res = await call(api.app, "GET", "/api/v1/transformations?q=Synthetic%00P2", { session: p.lead.session });
    await expectInvalidCharacter(res, "/query/q");
    // The same filter without NUL still works.
    const ok = await call(api.app, "GET", "/api/v1/transformations?q=Synthetic", { session: p.lead.session });
    expect(ok.status).toBe(200);
  });

  it("GET /users?q= (admin user search)", async () => {
    const res = await call(api.app, "GET", `/api/v1/users?organizationId=${w.orgA.id}&q=a%00b`, {
      session: await signIn(api.app, w.admin.subject),
    });
    await expectInvalidCharacter(res, "/query/q");
  });

  it("a path parameter (TOM gap id on archive)", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps/abc%00def/archive`, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic reason" },
    });
    await expectInvalidCharacter(res, "/params/tomGapId");
  });
});

describe("authentication and CSRF keep their precedence over the invalid-character check", () => {
  it("no session: 401, not 400", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      body: { dimensionCode: "technology", gap: "Synthetic\u0000gap" },
    });
    expect(res.status).toBe(401);
  });

  it("missing CSRF token: 403 csrf, not 400", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      csrf: false,
      body: { dimensionCode: "technology", gap: "Synthetic\u0000gap" },
    });
    expect(res.status).toBe(403);
    expect((res.body as { code: string }).code).toBe("csrf");
  });

  it("a user without write permission on a NUL body gets the 400 before any data access, and nothing is written", async () => {
    // Validation precedes the handler's policy check for every malformed request (ADR-0007 §5); the 400 reveals
    // nothing about the target record, and no audit row (neither a change nor a denial) is written.
    const before = await tomGapCount(p.transformationId);
    const res = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.auditor.session,
      body: { dimensionCode: "technology", gap: "Synthetic\u0000gap" },
    });
    await expectInvalidCharacter(res, "/gap");
    expect(await tomGapCount(p.transformationId)).toBe(before);
    // Without the NUL, the same user is denied (the check is not an authorization bypass).
    const denied = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.auditor.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap" },
    });
    expect([403, 404]).toContain(denied.status);
    expect(await tomGapCount(p.transformationId)).toBe(before);
  });
});

describe("text without NUL is unaffected", () => {
  it("visible text with other control-like marks (U+0001 inside, RLM) is accepted verbatim", async () => {
    const q = await setupP2World(api, w);
    const text = "‏Synthetic\u0001exclusion‏";
    const res = await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", outOfScope: text },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.charter.outOfScope).toBe(text);
  });
});

// F-DG2-260 (T-DG2-BE11): a lone UTF-16 surrogate is legal in a JSON string escape ("\ud800") and survives JSON.parse,
// but it cannot be stored faithfully: a text column used to receive U+FFFD silently, and a value that reaches jsonb
// directly (a journey step name) used to fail there as 400 validation.format at pointer ''. The central request check
// now refuses it exactly like U+0000: 400 validation.invalid_character at the field's pointer, nothing written or audited.
const LONE_SURROGATE_TEXTS = ["Synthetic\ud800exclusion", "\udc00Synthetic leading", "Synthetic \ud800\ud800"] as const;

async function journeyCount(transformationId: string): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*) AS n FROM journey WHERE transformation_id = ${transformationId}`.execute(api.db);
  return Number(r.rows[0]!.n);
}

describe("a lone UTF-16 surrogate in a JSON body string is 400 validation.invalid_character (F-DG2-260)", () => {
  it("charter create (outOfScope, text column): no charter is created, nothing is stored as U+FFFD", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    for (const text of LONE_SURROGATE_TEXTS) {
      const res = await call(api.app, "POST", QC, {
        session: q.lead.session,
        body: { transformationName: "Synthetic", outOfScope: text },
      });
      await expectInvalidCharacter(res, "/outOfScope");
    }
    expect((await call(api.app, "GET", QC, { session: q.lead.session })).status).toBe(404);
  });

  it("charter update (inScope): version, value and audit trail unchanged", async () => {
    const q = await setupP2World(api, w);
    const QC = `/api/v1/transformations/${q.transformationId}/charter`;
    const created = await call(api.app, "POST", QC, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)" },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const charterId = created.body.charter.id as string;
    const before = await auditOf(api.db, charterId);
    const res = await call(api.app, "PATCH", QC, {
      session: q.lead.session,
      headers: ifm(1),
      body: { inScope: "Synthetic\udfffscope", changeSummary: "Synthetic edit" },
    });
    await expectInvalidCharacter(res, "/inScope");
    const after = await call(api.app, "GET", QC, { session: q.lead.session });
    expect(after.body.charter.version).toBe(1);
    expect(after.body.charter.inScope).toBe("Retail onboarding (synthetic)");
    expect(await auditOf(api.db, charterId)).toEqual(before);
  });

  it("journey step name (reaches jsonb directly): 400 at /steps/0/name, not validation.format at ''", async () => {
    const q = await setupP2World(api, w);
    const QT = `/api/v1/transformations/${q.transformationId}`;
    const res = await call(api.app, "POST", `${QT}/journeys`, {
      session: q.lead.session,
      body: {
        name: "Synthetic journey",
        kind: "journey",
        state: "current",
        steps: [{ key: "01920099-0000-7000-8000-0000000000ab", ordinal: 1, name: "Synthetic\ud800step" }],
      },
    });
    await expectInvalidCharacter(res, "/steps/0/name");
    // A lone surrogate in a step's list item (systems[1]) is reported at that item.
    const res2 = await call(api.app, "POST", `${QT}/journeys`, {
      session: q.lead.session,
      body: {
        name: "Synthetic journey",
        kind: "journey",
        state: "current",
        steps: [
          {
            key: "01920099-0000-7000-8000-0000000000ac",
            ordinal: 1,
            name: "Synthetic step",
            systems: ["CRM", "\udc00Billing"],
          },
        ],
      },
    });
    await expectInvalidCharacter(res2, "/steps/0/systems/1");
    expect(await journeyCount(q.transformationId)).toBe(0);
  });

  it("archive reason (shared reason schema): the TOM gap stays open", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, {
      session: p.lead.session,
      body: { dimensionCode: "technology", gap: "Synthetic gap for the F-DG2-260 reason" },
    });
    expect(gap.status, JSON.stringify(gap.body)).toBe(201);
    const res = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, {
      session: p.lead.session,
      headers: ifm(gap.body.version),
      body: { reason: "Synthetic\ud800reason" },
    });
    await expectInvalidCharacter(res, "/reason");
    const still = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
    expect([still.body.version, still.body.status, still.body.archiveReason]).toEqual([gap.body.version, "open", null]);
  });

  it("a lone surrogate in an object key is reported at that key's pointer", async () => {
    const q = await setupP2World(api, w);
    const res = await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", "k\ud800": "x" },
    });
    await expectInvalidCharacter(res, "/k\ud800");
  });

  it("a percent-encoded lone surrogate (CESU-8 bytes %ED%A0%80) in a query or path never decodes to one, never a 5xx", async () => {
    // Query: the bytes are not valid UTF-8, so they are never decoded to a lone surrogate (declared outcome, checked
    // against the contract by the harness).
    const res = await call(api.app, "GET", "/api/v1/transformations?q=Synthetic%ED%A0%80", {
      session: p.lead.session,
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(500);
    // Path: Fastify's router refuses an undecodable path segment itself (FST_ERR_BAD_URL) before any handler or hook
    // runs. This answer predates F-DG2-260 and is the same for any malformed escape (%ZZ); it is plain JSON, not
    // problem+json, so the contract assertion is off here (reported in the T-DG2-BE11 handback as an observation).
    for (const bad of ["abc%ED%A0%80", "abc%ZZ"]) {
      const res2 = await call(api.app, "POST", `${T}/tom-gaps/${bad}/archive`, {
        session: p.lead.session,
        headers: ifm(1),
        body: { reason: "Synthetic reason" },
        contract: false,
      });
      expect(res2.status, bad).toBe(400);
      expect(await auditOfRequest(api.db, String(res2.headers["x-request-id"])), bad).toEqual([]);
    }
  });

  it("emoji (valid surrogate pairs) and Arabic are accepted and stored verbatim, in text and in jsonb", async () => {
    const q = await setupP2World(api, w);
    const QT = `/api/v1/transformations/${q.transformationId}`;
    const text = "نطاق تجريبي \u{1F600} \u{1F468}‍\u{1F469}‍\u{1F467}";
    const charter = await call(api.app, "POST", `${QT}/charter`, {
      session: q.lead.session,
      body: { transformationName: "Synthetic", outOfScope: text },
    });
    expect(charter.status, JSON.stringify(charter.body)).toBe(201);
    expect(charter.body.charter.outOfScope).toBe(text);
    const journey = await call(api.app, "POST", `${QT}/journeys`, {
      session: q.lead.session,
      body: {
        name: "Synthetic journey \u{1F680}",
        kind: "journey",
        state: "current",
        steps: [{ key: "01920099-0000-7000-8000-0000000000ad", ordinal: 1, name: text }],
      },
    });
    expect(journey.status, JSON.stringify(journey.body)).toBe(201);
    expect(journey.body.steps[0].name).toBe(text);
    expect(journey.body.name).toBe("Synthetic journey \u{1F680}");
  });
});
