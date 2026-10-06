// code-security-reviewer DG2 round-5 API probe (T-DG2-REV-SEC-R5). NOT part of the candidate: copied into a disposable
// clone (96a3c293) at apps/api/test/integration/ and run against a disposable PostgreSQL 16. All data SYNTHETIC.
// G1 is a PRODUCT gate, unrelated to DG0-DG7.
//  D1. F-DG2-180: the full round-4 residual set + Cc/Cs/tag/unassigned-DI through the API as Out of scope -> 400
//      validation.blank at /outOfScope, nothing stored.
//  D2. the same set as an archive reason -> 400 at /reason, record unchanged, no audit for the request.
//  D3. the shared `name` (transformation create) -> 400 at /name, nothing created.
//  D4. visible text WITH marks (VS16 emoji, Arabic + RLM, combining marks, Mongolian + FVS) is accepted and stored
//      verbatim (Out of scope, reason, name), and the B0041 pre-check reads pass.
//  E.  adversarial: code points that are invisible by design but outside the excluded properties (U+16FE4 KHITAN
//      SMALL SCRIPT FILLER, U+1D159 MUSICAL SYMBOL NULL NOTEHEAD). SECURE expectation asserted (a FAILING test =
//      residual shown).
//  F.  U+0000 inside otherwise visible text (PostgreSQL text cannot hold NUL): must be a 4xx, never a 500.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, startApi, type Res, type TestApi, type World } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let w: World;
let p: P2World;
let T: string;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const rid = (r: Res) => String(r.headers["x-request-id"]);
const errs = (r: Res) => ((r.body?.errors ?? []) as { pointer: string; code: string }[]).map((e) => `${e.pointer}:${e.code}`);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  T = `/api/v1/transformations/${p.transformationId}`;
});
afterAll(() => api.close());

const INVISIBLE: [string, string][] = [
  ["VS16", "️"], ["CGJ x2", "͏͏"], ["MONGOLIAN FVS1", "᠋"], ["MONGOLIAN FVS4", "᠏"],
  ["KHMER INHERENT AQ", "឴"], ["RLM+VS16", "‏️"], ["VS17 (astral)", "\u{e0100}"], ["U+FFF0 Cn DI", "￰"],
  ["U+E0020 tag", "\u{e0020}"], ["U+0001 Cc", "\u0001\u0001\u0001"], ["U+0000 NUL only", "\u0000"], ["lone U+D800", "\ud800"],
  ["mixed NEL+WJ+NBSP+VS16+CGJ", "\u0085⁠ ️͏"],
];

async function charterFor(outOfScope: string) {
  const q = await setupP2World(api, w);
  const Q = `/api/v1/transformations/${q.transformationId}`;
  const created = await call(api.app, "POST", `${Q}/charter`, { session: q.lead.session, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope } });
  const get = await call(api.app, "GET", `${Q}/charter`, { session: q.lead.session });
  return { q, Q, created, get };
}

describe("D1. F-DG2-180 set as Out of scope -> 400 validation.blank, nothing stored", () => {
  it.each(INVISIBLE)("%s", async (label, value) => {
    const { created, get } = await charterFor(value);
    log(`D1.${label}`, { create: created.status, errors: errs(created), audit: (await auditOfRequest(api.db, rid(created))).length, getAfter: get.status, storedOutOfScope: get.body?.charter?.outOfScope ?? null });
    expect(created.status).toBe(400);
    expect(errs(created)).toContain("/outOfScope:validation.blank");
    expect(await auditOfRequest(api.db, rid(created))).toEqual([]);
    expect(get.body?.charter?.outOfScope ?? null).toBeNull();
  });
});

describe("D2. F-DG2-180 set (x3) as archive reason -> 400 at /reason, record unchanged, no audit", () => {
  it("every value refused", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
    expect(gap.status).toBe(201);
    const G = `${T}/tom-gaps/${gap.body.id}`;
    for (const [label, v] of INVISIBLE) {
      const r = await call(api.app, "POST", `${G}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason: v.repeat(3) } });
      const audit = await auditOfRequest(api.db, rid(r));
      log(`D2.${label}`, [r.status, errs(r), audit.length]);
      expect(r.status).toBe(400);
      expect(errs(r)).toContain("/reason:validation.blank");
      expect(audit).toEqual([]);
    }
    const still = await call(api.app, "GET", G, { session: p.lead.session });
    log("D2.after", [still.body.status, still.body.version, still.body.archiveReason]);
    expect([still.body.status, still.body.version, still.body.archiveReason]).toEqual(["open", gap.body.version, null]);
  });
});

describe("D3. shared `name` (transformation create) -> 400 at /name, nothing created", () => {
  it("every value refused", async () => {
    const before = await api.db.selectFrom("transformation").select("id").execute();
    for (const [label, v] of INVISIBLE) {
      const r = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, body: { businessUnitId: w.a1, name: v, mode: "end_to_end" } });
      log(`D3.${label}`, [r.status, errs(r)]);
      expect(r.status).toBe(400);
      expect(errs(r)).toContain("/name:validation.blank");
    }
    const after = await api.db.selectFrom("transformation").select("id").execute();
    expect(after.length).toBe(before.length);
  });
});

const VISIBLE: [string, string][] = [
  ["heart+VS16", "❤️ out of scope"], ["RLM + Arabic", "‏خارج النطاق"],
  ["decomposed e-acute", "Café kiosks"], ["Arabic shadda+fatha", "بَّ"], ["Mongolian a + FVS1", "ᠠ᠋"],
  ["keycap", "1️⃣ region"], ["ZWJ family", "\u{1f468}‍\u{1f469}‍\u{1f467}"],
];
describe("D4. visible text with marks is accepted and stored verbatim", () => {
  it.each(VISIBLE)("Out of scope: %s", async (label, value) => {
    const { created, get } = await charterFor(value);
    const pre = get.body?.scopeCheckPrechecks?.find((x: { code: string }) => x.code === "exclusions_documented")?.result;
    log(`D4.oos.${label}`, { create: created.status, verbatim: get.body?.charter?.outOfScope === value, precheck: pre });
    expect(created.status).toBe(201);
    expect(get.body.charter.outOfScope).toBe(value);
    expect(pre).toBe("pass");
  });
  it("reason and name keep their marks", async () => {
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
    const reason = "‏مكرر ❤️ é";
    const r = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason } });
    const name = "‏تحول ❤️";
    const t = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, body: { businessUnitId: w.a1, name, mode: "end_to_end" } });
    log("D4.reason+name", { archive: r.status, reasonVerbatim: r.body?.archiveReason === reason, create: t.status, nameVerbatim: t.body?.name === name });
    expect(r.status).toBe(200);
    expect(r.body.archiveReason).toBe(reason);
    expect(t.status).toBe(201);
    expect(t.body.name).toBe(name);
  });
});

describe("E. adversarial residual: invisible-by-design code points outside the excluded properties", () => {
  it.each([["U+16FE4 KHITAN SMALL SCRIPT FILLER", "\u{16fe4}"], ["U+1D159 MUSICAL SYMBOL NULL NOTEHEAD x2", "\u{1d159}\u{1d159}"]] as [string, string][])(
    "%s as Out of scope must not document an exclusion",
    async (label, value) => {
      const { Q, q, created, get } = await charterFor(value);
      const pre = get.body?.scopeCheckPrechecks?.find((x: { code: string }) => x.code === "exclusions_documented")?.result;
      let g1Missing: boolean | undefined;
      if (created.status === 201) {
        const g1 = await call(api.app, "GET", `${Q}/gates/G1`, { session: q.lead.session });
        g1Missing = g1.body.criteria.find((c: { key: string }) => c.key === "g1.initial_charter").missing.some((m: { pointer: string }) => m.pointer === "/charter/outOfScope");
      }
      log(`E.${label}`, { create: created.status, precheck: pre, g1OutOfScopeMissing: g1Missing });
      if (created.status === 201) {
        expect(pre).toBe("attention");
        expect(g1Missing).toBe(true);
      } else expect(created.status).toBe(400);
    },
  );
});

describe("F. U+0000 inside visible text must be a 4xx, never a 500", () => {
  it("Out of scope 'scope\\u0000x'", async () => {
    const { created, get } = await charterFor("scope\u0000x");
    log("F.oos.nul", { create: created.status, code: created.body?.code, type: created.body?.type, detail: created.body?.detail, errors: errs(created), getAfter: get.status, stored: get.body?.charter?.outOfScope ?? null });
    expect(created.status).toBeGreaterThanOrEqual(400);
    expect(created.status).toBeLessThan(500);
  });
  it("transformation name 'Synthetic\\u0000name'", async () => {
    const t = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, body: { businessUnitId: w.a1, name: "Synthetic\u0000name", mode: "end_to_end" } });
    log("F.name.nul", { status: t.status, code: t.body?.code, detail: t.body?.detail, errors: errs(t) });
    expect(t.status).toBeGreaterThanOrEqual(400);
    expect(t.status).toBeLessThan(500);
  });
});
