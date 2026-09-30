#!/usr/bin/env node
// Clean-start smoke test (T-DG1-DEVOPS; A18 first case, ADR-0011 §4). Dependency-free Node >= 22.
// Runs against a started stack and proves, with SYNTHETIC users only:
//   health and readiness -> (oidc) the IdP's discovery document -> [optional] egress is blocked ->
//   technical admin signs in (no business role), creates a business unit, grants a scoped role ->
//   the transformation-office user signs in, creates a transformation, reads it back (detail, list, audit trail) ->
//   the technical admin cannot see that business record (list excludes it, detail 404) -> both sign out.
//
// Modes (MTH_SMOKE_AUTH):
//   oidc  real authorization-code + PKCE login through the Keycloak TEST realm login form (Compose `smoke` service).
//         Requires the admin to be bootstrapped first (`mth db bootstrap ... --admin-subject <smoke.admin id>`).
//   dev   AUTH_MODE=dev login as the seeded synthetic users dev.admin / dev.office (local runs without containers).
//
// Environment:
//   MTH_SMOKE_API_URL           where to reach the API (default http://localhost:3000)
//   APP_BASE_URL                the app's configured public origin (Origin header, OIDC redirect_uri); default = API
//   MTH_SMOKE_AUTH              oidc | dev (default oidc)
//   MTH_SMOKE_ISSUER_URL        (oidc) issuer whose discovery document must be reachable
//   MTH_SMOKE_ADMIN_USER / MTH_SMOKE_OFFICE_USER     usernames (defaults: smoke.admin/smoke.office or dev.admin/dev.office)
//   MTH_SMOKE_PASSWORD_FILE     (oidc) file holding the synthetic users' password (never an environment value)
//   MTH_SMOKE_EXPECT_NO_EGRESS  1 = additionally assert that a public TCP connect and a public DNS lookup both FAIL
//   MTH_EGRESS_PROBE            host:port for that probe (default 1.1.1.1:443); MTH_EGRESS_DNS_PROBE (default registry.npmjs.org)
//   MTH_SMOKE_TIMEOUT_S         readiness/IdP wait budget (default 120)
// Output: one line per step with its duration, then a JSON summary line. Exit 0 only if every step passed.
import dns from "node:dns/promises";
import { readFileSync } from "node:fs";
import net from "node:net";
import { randomUUID } from "node:crypto";

const env = process.env;
const API = new URL(env.MTH_SMOKE_API_URL ?? "http://localhost:3000");
const APP = new URL(env.APP_BASE_URL ?? API.href);
const MODE = env.MTH_SMOKE_AUTH ?? "oidc";
const BUDGET_MS = Number(env.MTH_SMOKE_TIMEOUT_S ?? "120") * 1000;
const ADMIN = env.MTH_SMOKE_ADMIN_USER ?? (MODE === "dev" ? "dev.admin" : "smoke.admin");
const OFFICE = env.MTH_SMOKE_OFFICE_USER ?? (MODE === "dev" ? "dev.office" : "smoke.office");
if (MODE !== "oidc" && MODE !== "dev") {
  console.error("MTH_SMOKE_AUTH must be oidc or dev");
  process.exit(64);
}
const PASSWORD = MODE === "oidc" ? readFileSync(env.MTH_SMOKE_PASSWORD_FILE ?? "", "utf8").trim() : null;
const RUN = randomUUID().slice(0, 8).toUpperCase();

const results = [];
class StepFailure extends Error {}
const fail = (msg) => {
  throw new StepFailure(msg);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t0 = performance.now();
  try {
    const detail = await fn();
    const ms = Math.round(performance.now() - t0);
    results.push({ step: name, result: "PASS", ms, ...(detail ? { detail } : {}) });
    console.log(`PASS  ${name} (${ms} ms)${detail ? `: ${detail}` : ""}`);
  } catch (err) {
    const ms = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ step: name, result: "FAIL", ms, detail: msg });
    console.log(`FAIL  ${name} (${ms} ms): ${msg}`);
    throw err;
  }
}

// ------------------------------------------------------------------------------------------ minimal HTTP client
/** Per-actor cookie jar keyed by host; paths and expiry attributes are deliberately simplified for a smoke test. */
class Jar {
  #byHost = new Map();
  store(url, res) {
    const host = new URL(url).host;
    const jar = this.#byHost.get(host) ?? new Map();
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a)) || value === "";
      if (expired) jar.delete(name);
      else jar.set(name, value);
    }
    this.#byHost.set(host, jar);
  }
  header(url) {
    const jar = this.#byHost.get(new URL(url).host);
    return jar && jar.size > 0 ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : null;
  }
}

/** URLs on the app's public origin are sent to where the API is actually reachable (e.g. http://api:3000). */
function toApi(url) {
  const u = new URL(url, APP);
  if (u.origin === APP.origin) return new URL(`${u.pathname}${u.search}`, API).href;
  return u.href;
}

async function http(jar, method, url, { body, headers = {}, form } = {}) {
  const target = toApi(url);
  const h = { ...headers };
  const cookie = jar?.header(target);
  if (cookie) h.cookie = cookie;
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    h["content-type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    h["content-type"] = "application/json";
  }
  const res = await fetch(target, {
    method,
    headers: h,
    body: payload,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  jar?.store(target, res);
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* HTML or empty */
  }
  return { status: res.status, headers: res.headers, text, json, url: target };
}

// ------------------------------------------------------------------------------------------ actors
function actor(username) {
  return { username, jar: new Jar(), csrf: null, me: null };
}

async function signIn(a) {
  if (MODE === "dev") {
    const r = await http(a.jar, "POST", "/api/v1/auth/dev-login", {
      body: { username: a.username },
      headers: { origin: APP.origin },
    });
    if (r.status !== 204) fail(`dev-login ${a.username}: HTTP ${r.status} ${r.text.slice(0, 200)}`);
  } else {
    const start = await http(a.jar, "GET", "/api/v1/auth/login?returnTo=/");
    const idpUrl = start.headers.get("location");
    if (start.status !== 302 || !idpUrl) fail(`/api/v1/auth/login: HTTP ${start.status}`);
    if (idpUrl.startsWith("/login?error=")) fail(`API could not start the OIDC login (${idpUrl})`);
    let page = await http(a.jar, "GET", idpUrl);
    for (let i = 0; i < 5 && page.status >= 300 && page.status < 400; i++) {
      page = await http(a.jar, "GET", new URL(page.headers.get("location"), page.url).href);
    }
    if (page.status !== 200) fail(`IdP login page: HTTP ${page.status}`);
    const formTag = /<form\b[^>]*id="kc-form-login"[^>]*>/i.exec(page.text)?.[0];
    const action = formTag && /action="([^"]+)"/i.exec(formTag)?.[1]?.replace(/&amp;/g, "&");
    if (!action) fail("IdP login page has no kc-form-login form");
    const posted = await http(a.jar, "POST", new URL(action, page.url).href, {
      form: { username: a.username, password: PASSWORD, credentialId: "" },
    });
    const callback = posted.headers.get("location");
    if (posted.status !== 302 || !callback)
      fail(`IdP rejected the synthetic credentials for ${a.username} (HTTP ${posted.status})`);
    if (new URL(callback).origin !== APP.origin)
      fail(`IdP redirected to ${new URL(callback).origin}, expected ${APP.origin}`);
    const done = await http(a.jar, "GET", callback);
    const next = done.headers.get("location") ?? "";
    if (done.status !== 302 || next.startsWith("/login?error="))
      fail(`OIDC callback for ${a.username}: HTTP ${done.status} -> ${next}`);
  }
  const me = await http(a.jar, "GET", "/api/v1/me");
  if (me.status !== 200 || !me.json?.csrfToken) fail(`/api/v1/me after sign-in: HTTP ${me.status}`);
  a.me = me.json;
  a.csrf = me.json.csrfToken;
  if (me.json.authMode !== MODE) fail(`/me.authMode is ${me.json.authMode}, expected ${MODE}`);
  return `${a.username} -> user ${a.me.user.id}, roles [${a.me.assignments.map((x) => x.roleCode).join(",")}]`;
}

function call(a, method, path, body, extra = {}) {
  const headers = { ...extra };
  if (method !== "GET") {
    headers.origin = APP.origin;
    headers["x-csrf-token"] = a.csrf;
  }
  return http(a.jar, method, path, { body, headers });
}

// ------------------------------------------------------------------------------------------ checks
async function waitFor(what, fn) {
  const deadline = Date.now() + BUDGET_MS;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const r = await fn();
      if (r.ok) return r.detail;
      last = r.detail;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(1000);
  }
  fail(`${what} not reached within ${BUDGET_MS / 1000}s (last: ${last})`);
}

function probeTcp(hostPort) {
  const [host, port] = hostPort.split(":");
  return new Promise((resolve) => {
    const s = net.connect({ host, port: Number(port), timeout: 5000 });
    s.once("connect", () => (s.destroy(), resolve("connected")));
    s.once("timeout", () => (s.destroy(), resolve("timeout")));
    s.once("error", (e) => resolve(`error ${e.code ?? e.message}`));
  });
}

const admin = actor(ADMIN);
const office = actor(OFFICE);
const ctx = {};
const t0 = performance.now();
let ok = false;
try {
  console.log(`mth smoke: mode=${MODE} api=${API.origin} app=${APP.origin} run=${RUN} (all users and data SYNTHETIC)`);

  await step("GET /healthz returns 200 {status: ok}", () =>
    waitFor("liveness", async () => {
      const r = await http(null, "GET", "/healthz");
      return { ok: r.status === 200 && r.json?.status === "ok", detail: `HTTP ${r.status} ${r.text.slice(0, 200)}` };
    }),
  );

  await step("GET /readyz returns 200 ready (database + migrations)", () =>
    waitFor("readiness", async () => {
      const r = await http(null, "GET", "/readyz");
      return { ok: r.status === 200 && r.json?.status === "ready", detail: `HTTP ${r.status} ${r.text}` };
    }),
  );

  if (MODE === "oidc") {
    await step("IdP discovery document reachable on the internal network", () =>
      waitFor("IdP discovery", async () => {
        const issuer = env.MTH_SMOKE_ISSUER_URL;
        if (!issuer) return { ok: false, detail: "MTH_SMOKE_ISSUER_URL not set" };
        const r = await http(null, "GET", `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
        const good = r.status === 200 && r.json?.issuer === issuer.replace(/\/$/, "");
        return { ok: good, detail: good ? `issuer ${r.json.issuer}` : `HTTP ${r.status} issuer=${r.json?.issuer}` };
      }),
    );
  }

  if (env.MTH_SMOKE_EXPECT_NO_EGRESS === "1") {
    await step("no outbound internet: public TCP connect and public DNS lookup both fail", async () => {
      const target = env.MTH_EGRESS_PROBE ?? "1.1.1.1:443";
      const tcp = await probeTcp(target);
      if (tcp === "connected") fail(`TCP connect to ${target} SUCCEEDED: the network has egress`);
      const name = env.MTH_EGRESS_DNS_PROBE ?? "registry.npmjs.org";
      let dnsResult;
      try {
        const addrs = await dns.lookup(name, { all: true });
        dnsResult = `resolved ${addrs.map((x) => x.address).join(",")}`;
      } catch (e) {
        dnsResult = `error ${e.code ?? e.message}`;
      }
      if (dnsResult.startsWith("resolved")) fail(`DNS lookup of ${name} ${dnsResult}: the network has egress`);
      return `tcp ${target}: ${tcp}; dns ${name}: ${dnsResult}`;
    });
  }

  await step(`technical admin signs in (${MODE})`, () => signIn(admin));

  await step("technical admin holds no business role", async () => {
    const business = admin.me.assignments.filter((x) => !String(x.roleCode).startsWith("ADM_"));
    if (business.length > 0) fail(`unexpected business roles: ${business.map((x) => x.roleCode).join(",")}`);
  });

  await step("admin creates a business unit (201 + ETag)", async () => {
    const orgId = admin.me.organization.id;
    const r = await call(admin, "POST", `/api/v1/organizations/${orgId}/business-units`, {
      code: `SMOKE-${RUN}`,
      nameEn: `Smoke BU ${RUN} (synthetic)`,
      nameAr: `وحدة اختبار ${RUN} (اصطناعية)`,
    });
    if (r.status !== 201 || !r.json?.id || !r.headers.get("etag")) fail(`HTTP ${r.status} ${r.text.slice(0, 300)}`);
    ctx.buId = r.json.id;
    return `business unit ${ctx.buId}`;
  });

  await step(`transformation-office user signs in (${MODE})`, () => signIn(office));

  if (MODE === "oidc") {
    await step("new OIDC user starts with no roles; creating a transformation is refused (403/404)", async () => {
      if (office.me.assignments.length > 0)
        return `already has ${office.me.assignments.map((x) => x.roleCode).join(",")} (re-run)`;
      const r = await call(office, "POST", "/api/v1/transformations", {
        businessUnitId: ctx.buId,
        name: `Smoke refused ${RUN} (synthetic)`,
        mode: "end_to_end",
      });
      if (r.status !== 403 && r.status !== 404) fail(`expected 403 or 404, got HTTP ${r.status}`);
      return `HTTP ${r.status} (ADR-0006: no read on the target gives 404, read without the action gives 403)`;
    });
    await step("admin grants TO at organization scope (201, audited)", async () => {
      if (office.me.assignments.some((x) => x.roleCode === "TO")) return "already granted (re-run)";
      const r = await call(admin, "POST", "/api/v1/role-assignments", {
        userId: office.me.user.id,
        roleCode: "TO",
        scope: { type: "organization", id: admin.me.organization.id },
        reason: `Smoke test ${RUN}: synthetic transformation-office user`,
      });
      if (r.status !== 201) fail(`HTTP ${r.status} ${r.text.slice(0, 300)}`);
      return `assignment ${r.json.id}`;
    });
    await step("office user signs in again and now holds TO", async () => {
      office.jar = new Jar();
      await signIn(office);
      if (!office.me.assignments.some((x) => x.roleCode === "TO")) fail("TO not active after grant");
    });
  }

  await step("office creates a transformation (201 + ETag, Idempotency-Key)", async () => {
    const r = await call(
      office,
      "POST",
      "/api/v1/transformations",
      { businessUnitId: ctx.buId, name: `Smoke transformation ${RUN} (synthetic)`, mode: "end_to_end" },
      { "idempotency-key": `smoke-${RUN}-create-0001` },
    );
    if (r.status !== 201 || !r.json?.id || !r.headers.get("etag")) fail(`HTTP ${r.status} ${r.text.slice(0, 300)}`);
    ctx.trId = r.json.id;
    ctx.trName = r.json.name;
    return `transformation ${ctx.trId} code ${r.json.code}`;
  });

  await step("office reads it back: detail, list and audit trail", async () => {
    const d = await call(office, "GET", `/api/v1/transformations/${ctx.trId}`);
    if (d.status !== 200 || d.json?.name !== ctx.trName) fail(`detail HTTP ${d.status}`);
    const l = await call(office, "GET", "/api/v1/transformations?limit=100");
    if (l.status !== 200 || !l.json?.items?.some((x) => x.id === ctx.trId))
      fail(`list HTTP ${l.status} without the new record`);
    const a = await call(office, "GET", `/api/v1/transformations/${ctx.trId}/audit`);
    if (a.status !== 200 || !Array.isArray(a.json?.items) || a.json.items.length < 1) fail(`audit HTTP ${a.status}`);
    return `audit actions [${a.json.items.map((x) => x.action).join(",")}]`;
  });

  await step("technical admin cannot see the business record: list excludes it, detail is 404", async () => {
    const l = await call(admin, "GET", "/api/v1/transformations?limit=100");
    if (l.status !== 200) fail(`list HTTP ${l.status}`);
    if (l.json.items.some((x) => x.id === ctx.trId)) fail("the technical admin's list contains the business record");
    const d = await call(admin, "GET", `/api/v1/transformations/${ctx.trId}`);
    if (d.status !== 404) fail(`detail HTTP ${d.status}, expected 404`);
    return `list 200 with ${l.json.items.length} visible, detail 404`;
  });

  await step("both users sign out", async () => {
    for (const a of [office, admin]) {
      const r = await call(a, "POST", "/api/v1/auth/logout");
      if (r.status !== 200 && r.status !== 204) fail(`${a.username}: HTTP ${r.status}`);
      const me = await http(a.jar, "GET", "/api/v1/me");
      if (me.status !== 401) fail(`${a.username}: /me after logout is HTTP ${me.status}, expected 401`);
    }
  });
  ok = true;
} catch (err) {
  if (!(err instanceof StepFailure)) console.log(`ERROR ${err instanceof Error ? err.stack : String(err)}`);
} finally {
  const summary = {
    smoke: ok ? "PASS" : "FAIL",
    mode: MODE,
    run: RUN,
    steps: results.length,
    passed: results.filter((r) => r.result === "PASS").length,
    totalMs: Math.round(performance.now() - t0),
    transformationId: ctx.trId ?? null,
  };
  console.log(JSON.stringify(summary));
  process.exitCode = ok ? 0 : 1;
}
