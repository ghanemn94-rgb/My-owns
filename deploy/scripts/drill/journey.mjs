#!/usr/bin/env node
// deploy/scripts/drill/journey.mjs: the D8 journey of the transfer drill in mode `oidc-drill` (ADR-0069 §4 D8;
// p7-work-split §B.2; tests T-B10; T-DG7-DO-D). It does not change deploy/scripts/smoke.mjs.
//
//   node deploy/scripts/drill/journey.mjs --mode oidc-drill --app <target origin> [--api <url>] --user <sub>
//        [--unbound-user <sub>] [--source-origin <origin>] [--downloads <downloads.json>] [--steps a,b,...]
//        [--out <journey.json>]
//
// Steps (default: every one, in this order):
//   signin    GET /api/v1/auth/login, follow the redirect to the SYNTHETIC drill IdP with `login_hint=<sub>`, then the
//             callback on the target's origin; /api/v1/me must answer 200 with authMode `oidc`.
//   unbound   the same for --unbound-user: the callback must refuse it (`/login?error=identity_unbound`), no session.
//   csrf      a write (POST /api/v1/transformations) with the SOURCE origin in `Origin` is refused 403: the target acts
//             on its own origin only (ADR-0069 §1 item 1, D8 (c)).
//   writes    D8 (b): the A02 steps that create and change records. Built here: a transformation is created (201 +
//             ETag) and read back with its audit trail. NOT built (T-DG7-DO-D gap, reported FAIL, never skipped):
//             the KPI value, the RAID item, the gate submission and the approval decision.
//   downloads D8 (a): every entry of <downloads.json> ([{ path, sha256 }], built by the drill from the attachment
//             manifest) is fetched over HTTP from the target and its SHA-256 compared.
//   deeplink  D8 (d): a deep link issued on the target opens under its origin. NOT built (T-DG7-DO-D gap): FAIL.
// Output: one line per step, then a JSON summary (also written to --out). Exit 0 only if every step passed; 1 a step
// failed; 2 BLOCKED (usage). Every user and value is SYNTHETIC; nothing here is a business, Finance or IT approval.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const STEPS = ["signin", "unbound", "csrf", "writes", "downloads", "deeplink"];
export const NOT_BUILT = "not built in T-DG7-DO-D (handback, known gaps)";

class StepFailure extends Error {}
const fail = (m) => {
  throw new StepFailure(m);
};

/** A per-host cookie jar (the smoke.mjs simplification: no path or expiry handling beyond deletion). */
export class Jar {
  #byHost = new Map();
  store(url, res) {
    const host = new URL(url).host;
    const jar = this.#byHost.get(host) ?? new Map();
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (value === "" || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) jar.delete(name);
      else jar.set(name, value);
    }
    this.#byHost.set(host, jar);
  }
  header(url) {
    const jar = this.#byHost.get(new URL(url).host);
    return jar && jar.size > 0 ? [...jar].map(([k, v]) => `${k}=${v}`).join("; ") : null;
  }
}

/** The client of one journey: `app` is the target's public origin, `api` where it is reachable (default: `app`). */
export function client({ app, api }) {
  const APP = new URL(app);
  const API = new URL(api ?? app);
  const toApi = (url) => {
    const u = new URL(url, APP);
    return u.origin === APP.origin ? new URL(`${u.pathname}${u.search}`, API).href : u.href;
  };
  async function http(jar, method, url, { body, headers = {}, raw = false } = {}) {
    const target = toApi(url);
    const h = { ...headers };
    const cookie = jar?.header(target);
    if (cookie) h.cookie = cookie;
    let payload;
    if (body !== undefined) {
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
    if (raw) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: res.status, headers: res.headers, text, json };
  }

  /** The OIDC sign-in through the drill IdP. Returns { ok, location, me }. */
  async function oidcSignIn(jar, sub) {
    const start = await http(jar, "GET", "/api/v1/auth/login?returnTo=/");
    const idpUrl = start.headers.get("location");
    if (start.status !== 302 || !idpUrl) fail(`/api/v1/auth/login: HTTP ${start.status}`);
    if (idpUrl.startsWith("/login?error=")) fail(`the API could not start the OIDC login (${idpUrl})`);
    const authz = new URL(idpUrl);
    authz.searchParams.set("login_hint", sub);
    const idp = await http(jar, "GET", authz.href);
    const callback = idp.headers.get("location");
    if (idp.status !== 302 || !callback) fail(`drill IdP refused ${sub}: HTTP ${idp.status} ${idp.text ?? ""}`);
    if (new URL(callback).origin !== APP.origin)
      fail(`the IdP redirected to ${new URL(callback).origin}, expected the target origin ${APP.origin}`);
    const done = await http(jar, "GET", callback);
    const next = done.headers.get("location") ?? "";
    if (done.status !== 302 || next.startsWith("/login?error="))
      return { ok: false, location: next, status: done.status };
    const me = await http(jar, "GET", "/api/v1/me");
    return { ok: me.status === 200, location: next, me: me.json, status: me.status };
  }

  return { APP, API, http, oidcSignIn };
}

/** Runs the journey. Returns { result, steps: [{ step, result, ms, detail }] }. */
export async function runJourney(o) {
  const c = client(o);
  const steps = [];
  const ctx = { jar: new Jar(), csrf: null, me: null };
  const run = Array.isArray(o.steps) && o.steps.length > 0 ? o.steps : STEPS;
  const call = (method, path, body, extra = {}, origin = c.APP.origin) =>
    c.http(ctx.jar, method, path, {
      body,
      headers: method === "GET" ? extra : { ...extra, origin, "x-csrf-token": ctx.csrf ?? "" },
    });
  const impl = {
    async signin() {
      const r = await c.oidcSignIn(ctx.jar, o.user);
      if (!r.ok) fail(`sign-in of ${o.user} refused: ${r.location || `HTTP ${r.status}`}`);
      if (r.me?.authMode !== "oidc") fail(`/me.authMode is ${r.me?.authMode}, expected oidc`);
      ctx.me = r.me;
      ctx.csrf = r.me.csrfToken;
      return `${o.user} -> user ${r.me.user.id}, roles [${r.me.assignments.map((x) => x.roleCode).join(",")}]`;
    },
    async unbound() {
      if (!o.unboundUser) fail("no --unbound-user given");
      const jar = new Jar();
      const r = await c.oidcSignIn(jar, o.unboundUser);
      if (r.ok) fail(`the unbound user ${o.unboundUser} signed in`);
      if (r.location !== "/login?error=identity_unbound") fail(`refused with ${r.location}, expected identity_unbound`);
      const me = await c.http(jar, "GET", "/api/v1/me");
      if (me.status !== 401) fail(`/me after the refused sign-in: HTTP ${me.status}, expected 401`);
      return `${o.unboundUser} refused: identity_unbound; /me 401`;
    },
    async csrf() {
      if (!o.sourceOrigin) fail("no --source-origin given");
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const r = await call("POST", "/api/v1/transformations", { name: "csrf probe (synthetic)" }, {}, o.sourceOrigin);
      if (r.status !== 403) fail(`a write with Origin ${o.sourceOrigin} answered HTTP ${r.status}, expected 403`);
      return `Origin ${o.sourceOrigin} -> 403 ${r.json?.code ?? ""}`.trim();
    },
    async writes() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const run = randomUUID().slice(0, 8).toUpperCase();
      const bus = await call("GET", `/api/v1/organizations/${ctx.me.organization.id}/business-units`);
      const buId = bus.json?.items?.[0]?.id ?? bus.json?.[0]?.id;
      if (bus.status !== 200 || !buId) fail(`no business unit readable on the target (HTTP ${bus.status})`);
      const r = await call(
        "POST",
        "/api/v1/transformations",
        { businessUnitId: buId, name: `Transfer drill ${run} (synthetic)`, mode: "end_to_end" },
        { "idempotency-key": `drill-${run}-create-0001` },
      );
      if (r.status !== 201 || !r.json?.id || !r.headers.get("etag"))
        fail(`create: HTTP ${r.status} ${r.text.slice(0, 200)}`);
      const d = await call("GET", `/api/v1/transformations/${r.json.id}`);
      if (d.status !== 200) fail(`read back: HTTP ${d.status}`);
      const a = await call("GET", `/api/v1/transformations/${r.json.id}/audit`);
      if (a.status !== 200) fail(`audit trail: HTTP ${a.status}`);
      // The remaining A02 writes of D8 (b) are not built: reported, never counted as passed.
      fail(
        `transformation ${r.json.id} created and read back; KPI value, RAID item, gate submission and approval decision ${NOT_BUILT}`,
      );
    },
    async downloads() {
      if (!o.downloads) fail("no --downloads given");
      const list = JSON.parse(readFileSync(o.downloads, "utf8"));
      if (!Array.isArray(list) || list.length === 0) fail("the download list is empty (no evidence file to prove)");
      const bad = [];
      for (const e of list) {
        const r = await c.http(ctx.jar, "GET", e.path, { raw: true });
        const sha = createHash("sha256").update(r.bytes).digest("hex");
        if (r.status !== 200 || sha !== e.sha256) bad.push(`${e.path}: HTTP ${r.status}, sha256 ${sha.slice(0, 12)}`);
      }
      if (bad.length > 0) fail(`${bad.length} of ${list.length} downloads differ: ${bad.slice(0, 3).join("; ")}`);
      return `${list.length} evidence files downloaded, SHA-256 equal`;
    },
    async deeplink() {
      fail(`the deep-link step ${NOT_BUILT}`);
    },
  };
  for (const name of run) {
    const t0 = performance.now();
    try {
      if (!impl[name]) fail(`unknown step ${name}`);
      const detail = await impl[name]();
      steps.push({ step: name, result: "PASS", ms: Math.round(performance.now() - t0), detail: detail ?? "" });
    } catch (e) {
      steps.push({
        step: name,
        result: "FAIL",
        ms: Math.round(performance.now() - t0),
        detail: e?.message ?? String(e),
      });
    }
    const s = steps.at(-1);
    console.log(`${s.result}  ${s.step} (${s.ms} ms): ${s.detail}`);
  }
  return {
    schemaVersion: "mth-transfer-journey/1",
    mode: "oidc-drill",
    idp: "synthetic drill IdP (not a corporate IdP)",
    app: c.APP.origin,
    steps,
    result: steps.length > 0 && steps.every((s) => s.result === "PASS") ? "PASS" : "FAIL",
  };
}

async function main() {
  let v;
  try {
    ({ values: v } = parseArgs({
      args: process.argv.slice(2),
      options: Object.fromEntries(
        ["mode", "app", "api", "user", "unbound-user", "source-origin", "downloads", "steps", "out"].map((k) => [
          k,
          { type: "string" },
        ]),
      ),
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (v.mode !== "oidc-drill" || !v.app || !v.user) {
    console.error("BLOCKED: usage: journey.mjs --mode oidc-drill --app <origin> --user <sub> [options]");
    process.exit(2);
  }
  const report = await runJourney({
    app: v.app,
    api: v.api,
    user: v.user,
    unboundUser: v["unbound-user"],
    sourceOrigin: v["source-origin"],
    downloads: v.downloads,
    steps: v.steps ? v.steps.split(",") : undefined,
  });
  if (v.out) writeFileSync(v.out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, steps: report.steps.length }));
  process.exit(report.result === "PASS" ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
