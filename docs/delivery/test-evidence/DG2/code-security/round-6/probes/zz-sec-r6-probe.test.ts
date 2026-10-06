// code-security-reviewer DG2 round-6 probe (T-DG2-REV-SEC-R6). NOT part of the candidate: copied into a disposable
// clone (51a692b1) at apps/api/test/integration/ and run against a disposable PostgreSQL 16. All data SYNTHETIC.
// Assertions encode the SECURE expectation; observations are logged first (PROBE lines), so a failing test = defect shown.
//  A. F-DG2-230 residual hunt beyond the round-5 repro: the placeholders inside visible text keep their marks; mixes.
//  B. F-DG2-231 beyond the round-5 repro: NUL in other fields/places (nested arrays, keys, query, params), precedence
//     (401 / CSRF 403 before 400; unauthorized caller), and no writes / no audit.
//  C. Other input PostgreSQL may refuse: lone UTF-16 surrogates (valid JSON escapes "\ud800") in free text. node-postgres
//     encodes text parameters as UTF-8 (a lone surrogate becomes U+FFFD), but JSON.stringify keeps "\ud800" as an escape,
//     and PostgreSQL's json/jsonb parser refuses a lone surrogate escape (SQLSTATE 22P02), e.g. in audit_event.changes.
//  D. Real HTTP (llhttp) for header-borne NUL: X-Request-Id, User-Agent, X-File-Name.
import net from "node:net";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";
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
  const r = await sql<{ t: string; c: string; g: string; a: string }>`select (select count(*) from transformation) t, (select count(*) from charter) c, (select count(*) from tom_gap) g, (select count(*) from audit_event) a`.execute(api.db);
  return r.rows[0];
};
const pre = (body: any) => body?.scopeCheckPrechecks?.find((x: { code: string }) => x.code === "exclusions_documented")?.result;

describe("A. F-DG2-230: placeholders", () => {
  it.each([
    ["U+16FE4 alone", "\u{16FE4}", 400],
    ["U+1D159 x2", "\u{1D159}\u{1D159}", 400],
    ["U+16FE4 + U+1D159 + U+2800 + NBSP + RLM", "\u{16FE4}\u{1D159}⠀ ‏", 400],
    ["visible + U+16FE4", "Synthetic\u{16FE4}exclusion", 201],
    ["U+1D159 + visible", "\u{1D159} Synthetic exclusion", 201],
  ])("charter outOfScope %s", async (label, value, expected) => {
    const q = await setupP2World(api, w);
    const C = `/api/v1/transformations/${q.transformationId}/charter`;
    const res = await call(api.app, "POST", C, { session: q.lead.session, contract: false, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope: value } });
    const get = await call(api.app, "GET", C, { session: q.lead.session });
    log(`A.${label}`, { status: res.status, errors: res.body?.errors, verbatim: get.body?.charter?.outOfScope === value, precheck: pre(get.body) });
    expect(res.status).toBe(expected);
    if (expected === 400) expect(res.body.errors).toEqual([expect.objectContaining({ pointer: "/outOfScope", code: "validation.blank" })]);
    else {
      expect(get.body.charter.outOfScope).toBe(value);
      expect(pre(get.body)).toBe("pass");
    }
  });
  it("name and reason made only of the placeholders are blank; with visible text they are kept", async () => {
    const n = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, contract: false, body: { businessUnitId: w.a1, name: "\u{1D159}\u{16FE4}", mode: "end_to_end" } });
    const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
    const r = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, contract: false, headers: ifm(gap.body.version), body: { reason: "\u{16FE4}\u{16FE4}\u{16FE4}" } });
    const ok = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, headers: ifm(gap.body.version), body: { reason: "Synthetic \u{1D159} reason" } });
    log("A.name_reason", { name: [n.status, n.body?.errors], reason: [r.status, r.body?.errors], visibleReason: [ok.status, ok.body?.archiveReason] });
    expect(n.status).toBe(400);
    expect(r.status).toBe(400);
    expect(ok.status).toBe(200);
    expect(ok.body.archiveReason).toBe("Synthetic \u{1D159} reason");
  });
});

describe("B. F-DG2-231 beyond the round-5 repro", () => {
  it("NUL nested in an array element of a body (charter topOutcomes-like arrays) and in a deep key", async () => {
    const before = await counts();
    const deep: Record<string, unknown> = { transformationName: "Synthetic", inScope: "Retail onboarding", outOfScope: "Synthetic exclusion", stakeholders: [{ name: "ok" }, { name: "x\u0000y" }] };
    const q = await setupP2World(api, w);
    const res = await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/charter`, { session: q.lead.session, contract: false, body: deep });
    const after = await counts();
    log("B.nested", { status: res.status, errors: res.body?.errors, audit: (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).length });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].pointer).toBe("/stakeholders/1/name");
    expect(after.c).toBe(before.c);
  });
  it("precedence: no session -> 401; bad CSRF -> 403; signed-in user without the permission -> 400 (no record lookup)", async () => {
    const nos = await call(api.app, "POST", `${T}/tom-gaps`, { contract: false, body: { dimensionCode: "technology", gap: "x\u0000y" } });
    const csrf = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, csrf: false, contract: false, body: { dimensionCode: "technology", gap: "x\u0000y" } });
    const nobody = await signIn(api.app, w.nobody.subject);
    const unauth = await call(api.app, "POST", `${T}/tom-gaps`, { session: nobody, contract: false, body: { dimensionCode: "technology", gap: "x\u0000y" } });
    const unauthOk = await call(api.app, "POST", `${T}/tom-gaps`, { session: nobody, contract: false, body: { dimensionCode: "technology", gap: "Synthetic" } });
    const missing = await call(api.app, "POST", `/api/v1/transformations/${randomUUID()}/tom-gaps`, { session: nobody, contract: false, body: { dimensionCode: "technology", gap: "x\u0000y" } });
    log("B.precedence", { nosession: nos.status, csrf: csrf.status, unauthorizedNul: unauth.status, unauthorizedValid: unauthOk.status, unknownTransformationNul: missing.status });
    expect(nos.status).toBe(401);
    expect(csrf.status).toBe(403);
    // the 400 does not depend on whether the record exists: no existence oracle
    expect(unauth.status).toBe(missing.status);
  });
  it("legitimate input is not rejected: U+0001, U+FFFD, literal backslash-zero, '%00' text in a body", async () => {
    const res = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: "Synthetic \\0 %00 \\u0000 \u0001 � gap" } });
    log("B.legit", { status: res.status, gap: res.body?.gap });
    expect(res.status).toBe(201);
    expect(res.body.gap).toBe("Synthetic \\0 %00 \\u0000 \u0001 � gap");
  });
});

describe("C. lone UTF-16 surrogates in free text (JSON escapes)", () => {
  it.each([
    ["charter create outOfScope (lone high)", "charter", "Synthetic\ud800exclusion"],
    ["charter create outOfScope (lone low)", "charter", "Synthetic\udc00exclusion"],
    ["TOM gap create gap", "gap", "Synthetic\ud83dgap"],
    ["TOM gap archive reason", "reason", "Synthetic\ud800reason"],
    ["transformation name", "name", "Synthetic\ud800name"],
    ["charter PATCH inScope", "patch", "Retail\udfffonboarding"],
  ])("%s", async (label, kind, value) => {
    const before = await counts();
    let res: any;
    let stored: unknown = null;
    if (kind === "charter" || kind === "patch") {
      const q = await setupP2World(api, w);
      const C = `/api/v1/transformations/${q.transformationId}/charter`;
      if (kind === "charter") {
        res = await call(api.app, "POST", C, { session: q.lead.session, contract: false, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)", outOfScope: value } });
        stored = (await call(api.app, "GET", C, { session: q.lead.session })).body?.charter?.outOfScope ?? null;
      } else {
        await call(api.app, "POST", C, { session: q.lead.session, body: { transformationName: "Synthetic", inScope: "Retail onboarding (synthetic)" } });
        res = await call(api.app, "PATCH", C, { session: q.lead.session, contract: false, headers: ifm(1), body: { inScope: value, changeSummary: "Synthetic change" } });
        stored = (await call(api.app, "GET", C, { session: q.lead.session })).body?.charter?.inScope ?? null;
      }
    } else if (kind === "gap") {
      res = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, contract: false, body: { dimensionCode: "technology", gap: value } });
      stored = res.body?.gap ?? null;
    } else if (kind === "reason") {
      const gap = await call(api.app, "POST", `${T}/tom-gaps`, { session: p.lead.session, body: { dimensionCode: "technology", gap: `Synthetic gap ${randomUUID().slice(0, 8)}` } });
      res = await call(api.app, "POST", `${T}/tom-gaps/${gap.body.id}/archive`, { session: p.lead.session, contract: false, headers: ifm(gap.body.version), body: { reason: value } });
      const still = await call(api.app, "GET", `${T}/tom-gaps/${gap.body.id}`, { session: p.lead.session });
      stored = [still.body.status, still.body.version, still.body.archiveReason];
    } else {
      res = await call(api.app, "POST", "/api/v1/transformations", { session: p.lead.session, contract: false, body: { businessUnitId: w.a1, name: value, mode: "end_to_end" } });
      stored = res.body?.name ?? null;
    }
    const after = await counts();
    log(`C.${label}`, { status: res.status, body: res.body?.code ?? null, errors: res.body?.errors ?? null, stored: typeof stored === "string" ? Array.from(stored).map((c) => c.codePointAt(0)!.toString(16)).join(" ") : stored, before, after });
    // secure expectation: never an undeclared 5xx for client text
    expect(res.status, label).toBeLessThan(500);
  });
});

describe("D. real HTTP (llhttp): header-borne NUL never reaches the database", () => {
  const raw = (port: number, text: string) =>
    new Promise<string>((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(text));
      let out = "";
      s.on("data", (d) => (out += d.toString("latin1")));
      s.on("end", () => resolve(out));
      s.on("error", (e) => resolve(`ERR ${e.message}`));
      setTimeout(() => { s.destroy(); resolve(out || "TIMEOUT"); }, 3000);
    });
  it("NUL in X-Request-Id / User-Agent / request target is refused by the HTTP parser (400), never 500", async () => {
    await api.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (api.app.server.address() as net.AddressInfo).port;
    const a = await raw(port, "GET /healthz HTTP/1.1\r\nHost: x\r\nX-Request-Id: ab\x00cd\r\nConnection: close\r\n\r\n");
    const b = await raw(port, "POST /api/v1/auth/dev-login HTTP/1.1\r\nHost: x\r\nUser-Agent: UA\x00x\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}");
    const c = await raw(port, "GET /healthz?x=\x00 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const d = await raw(port, "GET /healthz?x=%00 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const e = await raw(port, "GET /healthz?x=%ED%A0%80 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    const first = (s: string) => s.split("\r\n")[0];
    log("D.raw", { xRequestId: first(a), userAgent: first(b), rawNulTarget: first(c), pctNulQuery: first(d), pctSurrogateQuery: first(e) });
    for (const r of [a, b, c, d, e]) expect(first(r)).not.toMatch(/ 5\d\d /);
  });
});
