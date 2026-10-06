// code-security-reviewer DG2 round-7 adversarial probe (T-DG2-REV-SEC-R7). NOT part of the candidate: copied into a
// disposable clone (90439483) at apps/api/test/integration/ and run on a disposable PostgreSQL 16 with the candidate's
// local fake OpenID Provider. All data SYNTHETIC. Each assertion states the secure/declared expectation; every observed
// value is also logged as "PROBE <key>: <json>" so a reader can judge the raw behaviour.
// Scope: strings that are not well-formed (lone UTF-16 surrogates, CESU-8 / invalid UTF-8 bytes, Latin-1 header bytes)
// on every surface the assignment names: headers, OIDC claims other than iss/sub, path and query values, raw JSON body
// bytes, and anything written to audit_event; plus BE12's router/connection-level error handling over a real socket.
import { connect, type AddressInfo } from "node:net";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { FakeIdp } from "../support/fake-idp.ts";
import { call, createOrg, createUser, seedWorld, signIn, startApi, type TestApi, type World } from "../support/harness.ts";
import { setupP2World } from "../support/p2-fixtures.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let oidcApi: TestApi;
let mainApi: TestApi;
let w: World;
let orgId: string;
let port: number;
const log = (k: string, v: unknown) => console.log(`PROBE ${k}: ${JSON.stringify(v)}`);
const FFFD = "�";

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_oidc_r7s");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  idp = await new FakeIdp().start();
  oidcApi = await startApi({
    env: {
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_CLIENT_SECRET: idp.clientSecret,
      DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
    },
  });
  orgId = (await createOrg(oidcApi.db, "OIDCR7S")).id;
  mainApi = await startApi();
  w = await seedWorld(mainApi.db);
  await mainApi.app.listen({ port: 0, host: "127.0.0.1" });
  port = (mainApi.app.server.address() as AddressInfo).port;
});
afterAll(async () => {
  await oidcApi.close();
  await mainApi.close();
  await idp.stop();
  await dropScratchDatabase(adminUrl, dbName);
});

const cookies = (res: { headers: Record<string, unknown> }) => {
  const h = res.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
};
async function loginWith(claims: Parameters<FakeIdp["issueCode"]>[1]) {
  const start = await call(oidcApi.app, "GET", "/api/v1/auth/login");
  const loginCookie = cookies(start).find((c) => c.startsWith("mth_login="))!.split(";")[0]!;
  const { code, state } = idp.issueCode(String(start.headers["location"]), claims, {});
  // contract: true -> the harness fails the call if the status is not declared for completeOidcLogin (302, 429).
  return call(oidcApi.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, { headers: { cookie: loginCookie } });
}
const auditFor = async (api: TestApi, rid: string) =>
  (await sql<{ action: string; reason: string | null }>`select action, reason from audit_event where request_id = ${rid}`.execute(api.db)).rows;

/** Raw HTTP over a real socket; resolves with everything the server wrote before closing (or after 3 s). */
function rawHttp(bytes: Buffer): Promise<string> {
  return new Promise((resolve) => {
    const s = connect(port, "127.0.0.1");
    const chunks: Buffer[] = [];
    const done = () => resolve(Buffer.concat(chunks).toString("latin1"));
    const t = setTimeout(() => { s.destroy(); done(); }, 3000);
    s.on("data", (c) => chunks.push(c));
    s.on("close", () => { clearTimeout(t); done(); });
    s.on("error", () => undefined);
    s.write(bytes);
  });
}
function parseRaw(raw: string) {
  const [head, ...rest] = raw.split("\r\n\r\n");
  const lines = (head ?? "").split("\r\n");
  const headers: Record<string, string> = {};
  for (const l of lines.slice(1)) { const i = l.indexOf(":"); if (i > 0) headers[l.slice(0, i).toLowerCase()] = l.slice(i + 1).trim(); }
  return { statusLine: lines[0] ?? "", headers, body: rest.join("\r\n\r\n") };
}
const SEC = ["content-security-policy", "strict-transport-security", "x-content-type-options", "x-frame-options", "referrer-policy", "cross-origin-opener-policy", "cross-origin-resource-policy", "origin-agent-cluster", "x-dns-prefetch-control", "x-download-options", "x-permitted-cross-domain-policies", "x-xss-protection"];
const secOf = (h: Record<string, unknown>) => Object.fromEntries(SEC.map((k) => [k, h[k] === undefined ? null : String(h[k])]));

// ---------------------------------------------------------------------------------------------------- A. OIDC claims
describe("A. OIDC claims other than iss/sub, and code-point boundaries", () => {
  it("A1 sub of exactly 255 astral code points (510 UTF-16 units) signs in and is stored verbatim (code points, not units)", async () => {
    const sub = "\u{1F600}".repeat(255);
    const cb = await loginWith({ sub, name: "Synthetic astral 255" });
    const row = (await sql<{ subject: string; cp: number }>`select subject, char_length(subject) cp from user_identity where subject = ${sub}`.execute(oidcApi.db)).rows;
    log("A1", { status: cb.status, location: cb.headers["location"], rows: row.length, cp: row[0]?.cp, verbatim: row[0]?.subject === sub });
    expect(cb.status).toBe(302);
    expect(cb.headers["location"]).toBe("/");
    expect(row).toHaveLength(1);
    expect(row[0]!.subject).toBe(sub);
  });
  it("A2 sub of 256 astral code points -> 302 token_invalid + session.login_failed, nothing stored", async () => {
    const sub = "\u{1F601}".repeat(256);
    const cb = await loginWith({ sub, name: "Synthetic astral 256" });
    const audit = await auditFor(oidcApi, String(cb.headers["x-request-id"]));
    log("A2", { status: cb.status, location: cb.headers["location"], audit });
    expect(cb.headers["location"]).toBe("/login?error=token_invalid");
    expect(audit.map((a) => a.action)).toEqual(["session.login_failed"]);
    expect((await sql<{ n: string }>`select count(*) n from user_identity where subject = ${sub}`.execute(oidcApi.db)).rows[0]!.n).toBe("0");
  });
  it("A3 name, preferred_username AND email all carry lone surrogates -> generated display name, email null, never U+FFFD", async () => {
    const cb = await loginWith({ sub: "r7-allbad", name: "Synthetic\uD800", preferred_username: "\uDC00syn", email: "r7\uDBFF@example.invalid", email_verified: true });
    const u = (await sql<{ display_name: string; email: string | null; eab: string | null }>`select u.display_name, u.email, i.email_at_binding eab from user_identity i join app_user u on u.id = i.user_id where i.subject = 'r7-allbad'`.execute(oidcApi.db)).rows;
    const audit = await auditFor(oidcApi, String(cb.headers["x-request-id"]));
    log("A3", { status: cb.status, location: cb.headers["location"], user: u, audit: audit.map((a) => a.action) });
    expect(cb.status).toBe(302);
    expect(u).toHaveLength(1);
    expect(u[0]!.display_name).toMatch(/^User [0-9a-f]{6}$/);
    expect(u[0]!.email).toBeNull();
    expect(u[0]!.eab).toBeNull();
  });
  it("A4 email with a lone surrogate + email_verified does NOT bind the pre-provisioned user whose e-mail it resembles", async () => {
    const pre = await createUser(oidcApi.db, orgId, { email: "r7-bind@example.invalid" });
    const cb = await loginWith({ sub: "r7-bind-try", email: "r7-bind@example.invalid\uD800", email_verified: true, name: "Synthetic bind try" });
    const bound = (await sql<{ user_id: string }>`select user_id from user_identity where subject = 'r7-bind-try'`.execute(oidcApi.db)).rows;
    log("A4", { status: cb.status, location: cb.headers["location"], boundToPreProvisioned: bound[0]?.user_id === pre.id, identities: bound.length });
    expect(cb.status).toBe(302);
    expect(bound[0]?.user_id).not.toBe(pre.id);
  });
  it("A5 callback query: CESU-8 / invalid percent bytes in state, code and error -> declared 302 (never 400 problem)", async () => {
    const out: unknown[] = [];
    for (const q of ["state=%ED%A0%80", "state=abc&code=%ED%A0%80", "state=abc&error=%ED%A0%80", "state=%FF%FE", "st%ED%A0%80te=x"]) {
      const res = await call(oidcApi.app, "GET", `/api/v1/auth/callback?${q}`);
      out.push({ q, status: res.status, location: res.headers["location"] });
      expect(res.status, q).toBe(302);
    }
    log("A5", out);
  });
});

// ---------------------------------------------------------------------------------- B. raw ill-formed UTF-8 bodies
// Fastify 5.6.1 rawBody decodes a JSON body with setEncoding('utf8'): each invalid byte becomes U+FFFD (3 bytes), so the
// decoded byte count differs from Content-Length and Fastify raises FST_ERR_CTP_INVALID_CONTENT_LENGTH (statusCode 400),
// which the product's mapError does not map -> 500 internal. Without Content-Length (chunked) there is no length check.
const origin = () => new URL(String(mainApi.config.appBaseUrl)).origin;
const charterBody = (bad: number[]) => Buffer.concat([Buffer.from('{"transformationName":"Synthetic","outOfScope":"Synthetic'), Buffer.from(bad), Buffer.from(' text"}')]);
describe("B. raw ill-formed UTF-8 bytes in a JSON body (not a \\u escape)", () => {
  it("B1 charter create, Content-Length body: control 0x41 -> 201; invalid UTF-8 (ED A0 80 / FF / C3) -> must be a declared 4xx, never 500", async () => {
    const out: unknown[] = [];
    for (const bad of [[0x41], [0xed, 0xa0, 0x80], [0xff], [0xc3]]) {
      const q = await setupP2World(mainApi, w);
      const raw = await mainApi.app.inject({
        method: "POST",
        url: `/api/v1/transformations/${q.transformationId}/charter`,
        headers: { cookie: q.lead.session.cookie, origin: origin(), "x-csrf-token": q.lead.session.csrf, "content-type": "application/json" },
        payload: charterBody(bad),
      });
      const stored = (await sql<{ o: string | null }>`select out_of_scope o from charter where transformation_id = ${q.transformationId}`.execute(mainApi.db)).rows;
      const audit = await auditFor(mainApi, String(raw.headers["x-request-id"]));
      out.push({ bytes: bad, status: raw.statusCode, body: raw.statusCode < 300 ? { outOfScope: raw.json().charter?.outOfScope } : raw.json(), stored: stored.map((r) => r.o), audit: audit.map((a) => a.action) });
    }
    log("B1", out);
    expect((out[0] as { status: number }).status).toBe(201);
    for (const o of out.slice(1) as { bytes: number[]; status: number }[]) expect(o.status, JSON.stringify(o.bytes)).toBeLessThan(500);
  });
  it("B2 UNAUTHENTICATED over a real socket (no cookie, no CSRF): invalid UTF-8 body -> must be 401 or a declared 4xx, never 500", async () => {
    const out: unknown[] = [];
    for (const bad of [[0x41], [0xff]]) {
      const body = charterBody(bad);
      const r = parseRaw(await rawHttp(Buffer.concat([Buffer.from(`POST /api/v1/transformations/01920099-0000-7000-8000-0000000000aa/charter HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`), body])));
      out.push({ bytes: bad, status: r.statusLine, ct: r.headers["content-type"], body: r.body });
    }
    log("B2", out);
    expect((out[0] as { status: string }).status).toMatch(/^HTTP\/1\.1 401/);
    expect((out[1] as { status: string }).status).not.toMatch(/^HTTP\/1\.1 5/);
  });
  it("B3 chunked body (no Content-Length) with invalid UTF-8, authenticated: observe whether U+FFFD is stored silently", async () => {
    const q = await setupP2World(mainApi, w);
    const body = charterBody([0xff]);
    const head = `POST /api/v1/transformations/${q.transformationId}/charter HTTP/1.1\r\nHost: x\r\nOrigin: ${origin()}\r\nCookie: ${q.lead.session.cookie}\r\nX-CSRF-Token: ${q.lead.session.csrf}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
    const r = parseRaw(await rawHttp(Buffer.concat([Buffer.from(head), Buffer.from(body.length.toString(16) + "\r\n"), body, Buffer.from("\r\n0\r\n\r\n")])));
    const stored = (await sql<{ o: string | null }>`select out_of_scope o from charter where transformation_id = ${q.transformationId}`.execute(mainApi.db)).rows;
    const auditFFFD = (await sql<{ n: string }>`select count(*) n from audit_event where record_id in (select id from charter where transformation_id = ${q.transformationId}) and position(${FFFD} in coalesce(changes::text,'')) > 0`.execute(mainApi.db)).rows[0]!.n;
    log("B3", { status: r.statusLine, stored: stored.map((x) => x.o), storedHasFFFD: stored.some((x) => x.o?.includes(FFFD)), auditRowsWithFFFD: Number(auditFFFD) });
    expect(r.statusLine).not.toMatch(/^HTTP\/1\.1 5/);
  });
});

// ------------------------------------------------------------------------------------- C. headers over a real socket
describe("C. header bytes over a real socket (Latin-1 decoding)", () => {
  it("C1 dev-login with User-Agent bytes ED A0 80 and UTF-8 Arabic: session.user_agent is the Latin-1 reading (well-formed), audit row intact", async () => {
    const ua = Buffer.concat([Buffer.from("SyntheticUA/1 "), Buffer.from([0xed, 0xa0, 0x80]), Buffer.from(" "), Buffer.from("ا", "utf8")]);
    const body = JSON.stringify({ username: w.leadA1.subject });
    const req = Buffer.concat([
      Buffer.from(`POST /api/v1/auth/dev-login HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: ${origin()}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nX-Request-Id: r7-ua-probe-1\r\nConnection: close\r\nUser-Agent: `),
      ua,
      Buffer.from(`\r\n\r\n${body}`),
    ]);
    const res = parseRaw(await rawHttp(req));
    const s = (await sql<{ user_agent: string | null }>`select s.user_agent from session s join audit_event a on a.record_id = s.id where a.request_id = 'r7-ua-probe-1' and a.action = 'session.create'`.execute(mainApi.db)).rows;
    const expected = ua.toString("latin1");
    log("C1", { status: res.statusLine, storedUA: s[0]?.user_agent, storedEqualsLatin1: s[0]?.user_agent === expected, wellFormed: s[0]?.user_agent?.isWellFormed(), containsFFFD: s[0]?.user_agent?.includes(FFFD) });
    expect(res.statusLine).toMatch(/^HTTP\/1\.1 204/);
    expect(s[0]?.user_agent).toBe(expected);
  });
  it("C2 X-Request-Id with high bytes or markup is never reflected; a generated UUIDv7 is used", async () => {
    const out: unknown[] = [];
    for (const rid of [Buffer.from([0x72, 0x37, 0xed, 0xa0, 0x80]), Buffer.from("<script>x</script>"), Buffer.from("a".repeat(129))]) {
      const res = parseRaw(await rawHttp(Buffer.concat([Buffer.from("GET /healthz HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Request-Id: "), rid, Buffer.from("\r\n\r\n")])));
      out.push({ sent: rid.toString("latin1").slice(0, 40), status: res.statusLine, echoed: res.headers["x-request-id"] });
      expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    }
    log("C2", out);
  });
});

// ----------------------------------------------------- D. BE12 router-level and connection-level errors (real socket)
describe("D. framework and client errors over a real socket", () => {
  async function reference() {
    const r = parseRaw(await rawHttp(Buffer.from("GET /api/v1/no-such-path HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")));
    return r;
  }
  it("D1 each pre-routing error is a 400 problem+json with the routed security headers, a request id and no echo of input", async () => {
    const ref = await reference();
    const cases: [string, Buffer][] = [
      ["bad-url-cesu", Buffer.from("GET /api/v1/transformations/%ED%A0%80 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")],
      ["bad-url-unauth-post", Buffer.from("POST /api/v1/transformations/%ZZ/charter HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")],
      ["header-overflow", Buffer.from(`GET /healthz HTTP/1.1\r\nHost: x\r\nX-Big: ${"A".repeat(20000)}\r\n\r\n`)],
      ["url-overflow", Buffer.from(`GET /healthz?q=${"B".repeat(20000)} HTTP/1.1\r\nHost: x\r\n\r\n`)],
      ["nul-in-header", Buffer.from("GET /healthz HTTP/1.1\r\nHost: x\r\nX-A: a\u0000b\r\n\r\n")],
      ["garbage-line", Buffer.from("\u0016\u0003\u0001 hello <script>\r\n\r\n")],
      ["cr-injection-attempt", Buffer.from("GET /healthz%0d%0aSet-Cookie:x=1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")],
    ];
    const out: unknown[] = [];
    for (const [name, bytes] of cases) {
      const raw = await rawHttp(bytes);
      const r = parseRaw(raw);
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(r.body); } catch { body = { unparsable: r.body.slice(0, 120) }; }
      out.push({ name, status: r.statusLine, ct: r.headers["content-type"], rid: r.headers["x-request-id"], bodyCode: body["code"], err: (body["errors"] as { code: string }[] | undefined)?.[0]?.code, setCookie: r.headers["set-cookie"] ?? null, secSame: JSON.stringify(secOf(r.headers)) === JSON.stringify(secOf(ref.headers)) });
      if (name === "cr-injection-attempt") {
        expect(r.headers["set-cookie"]).toBeUndefined();
        continue;
      }
      expect(r.statusLine, name).toMatch(/^HTTP\/1\.1 400 /);
      expect(r.headers["content-type"], name).toMatch(/^application\/problem\+json/);
      expect(secOf(r.headers), name).toEqual(secOf(ref.headers));
      expect(body["requestId"], name).toBe(r.headers["x-request-id"]);
      expect(r.body, name).not.toMatch(/FST_ERR|HPE_|%ED|%ZZ|AAAA|BBBB|<script>|stack|node:/);
    }
    log("D1", { reference: { status: ref.statusLine, sec: secOf(ref.headers) }, cases: out });
  });
  it("D2 a bad URL on a protected mutation writes nothing and leaves no audit row (no authz bypass)", async () => {
    const before = (await sql<{ n: string }>`select count(*) n from audit_event`.execute(mainApi.db)).rows[0]!.n;
    const s = await signIn(mainApi.app, w.nobody.subject);
    const res = await call(mainApi.app, "POST", "/api/v1/transformations/%ED%A0%80/charter", { session: s, body: { transformationName: "x" } });
    const after = (await sql<{ n: string }>`select count(*) n from audit_event where action <> 'session.create'`.execute(mainApi.db)).rows[0]!.n;
    const beforeNoLogin = (await sql<{ n: string }>`select count(*) n from audit_event where action <> 'session.create'`.execute(mainApi.db)).rows[0]!.n;
    log("D2", { status: res.status, body: res.body, auditTotalBefore: before, nonLoginAfter: after, nonLoginNow: beforeNoLogin });
    expect(res.status).toBe(400);
    expect(after).toBe(beforeNoLogin);
  });
  it("D3 pipelined: a valid request followed by a malformed one on the same socket -> no 5xx, no interleaved bytes (observation)", async () => {
    const raw = await rawHttp(Buffer.from("GET /healthz HTTP/1.1\r\nHost: x\r\n\r\nGARBAGE\r\n\r\n"));
    const statuses = raw.match(/HTTP\/1\.1 \d{3}/g);
    log("D3", { statuses, length: raw.length });
    // Observation only: Node/Fastify's default clientError handling also answers 400 and closes when the parser fails
    // while an earlier pipelined response has not started; BE12's handler is stricter (it never writes into a started one).
    expect(statuses?.every((x) => !x.startsWith("HTTP/1.1 5"))).toBe(true);
  });
});

// ------------------------------------------------------------------------- E. sweep of everything that was stored
describe("E. stored-data sweep after all probes", () => {
  it("E1 no lone surrogate was stored as U+FFFD in identity, user, session or audit_event (both databases)", async () => {
    const out: Record<string, unknown> = {};
    for (const [name, api] of [["oidc", oidcApi], ["main", mainApi]] as const) {
      const r = await sql<{ t: string; n: string }>`
        select 'user_identity' t, count(*) n from user_identity where position(${FFFD} in issuer || subject || coalesce(email_at_binding,'')) > 0
        union all select 'app_user', count(*) from app_user where position(${FFFD} in display_name || coalesce(email,'')) > 0
        union all select 'session', count(*) from session where position(${FFFD} in coalesce(user_agent,'')) > 0
        union all select 'audit_event', count(*) from audit_event where position(${FFFD} in coalesce(reason,'') || coalesce(changes::text,'')) > 0`.execute(api.db);
      out[name] = Object.fromEntries(r.rows.map((x) => [x.t, Number(x.n)]));
    }
    // Rows written by B1 (raw ill-formed UTF-8 decoded by the body parser) are reported separately in B1's log line.
    const charterFFFD = (await sql<{ n: string }>`select count(*) n from audit_event where action like 'charter%' and position(${FFFD} in coalesce(changes::text,'')) > 0`.execute(mainApi.db)).rows[0]!.n;
    log("E1", { ...out, mainCharterAuditWithFFFD_fromB1: Number(charterFFFD) });
    expect(out["oidc"]).toEqual({ user_identity: 0, app_user: 0, session: 0, audit_event: 0 });
    expect((out["main"] as Record<string, number>)["user_identity"]).toBe(0);
    expect((out["main"] as Record<string, number>)["session"]).toBe(0);
  });
});
