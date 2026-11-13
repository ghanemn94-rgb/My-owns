#!/usr/bin/env node
// deploy/scripts/drill/journey.mjs: the journeys of the transfer drill (ADR-0069 §4 D1, D7, D8, D9; p7-work-split §B.2
// and §B.6 DO-D2; tests T-B10; T-DG7-DO-D, T-DG7-DO-D2). It does not change deploy/scripts/smoke.mjs.
//
//   node deploy/scripts/drill/journey.mjs --mode oidc-drill|dev --app <origin> [--api <url>] --user <sub|username>
//        [--approver <sub>] [--kpi-user <sub>] [--kpi-definition <id>] [--kpi-value-nature <n>] [--unbound-user <sub>] [--source-origin <origin>] [--transformation <id>] [--gate <code>]
//        [--expect-origin <origin>] [--expect-environment <kind>] [--downloads <downloads.json>]
//        [--journal <journal.json>] [--steps a,b,...] [--out <journey.json>]
//
// Steps (default: signin, unbound, csrf, status, writes, approve, downloads, deeplink, in this order):
//   signin    oidc-drill: GET /api/v1/auth/login, follow the redirect to the SYNTHETIC drill IdP with
//             `login_hint=<sub>`, then the callback on the target's origin; /api/v1/me answers 200 with authMode `oidc`.
//             dev (the source S only, D1): POST /api/v1/auth/dev-login with the seed-dev username.
//   unbound   the same for --unbound-user: the callback must refuse it (`/login?error=identity_unbound`), no session.
//   csrf      a write with the SOURCE origin in `Origin` is refused 403 (ADR-0069 §1 item 1, D8 (c)).
//   status    D7: getDeploymentStatus (GET /api/v1/admin/deployment): `origin` equals --expect-origin and
//             `environmentKind` equals --expect-environment (the package's sourceEnvironment).
//   uploads   D1 (on S): two SYNTHETIC file evidence items are created and their bytes uploaded through the API, so
//             D8 (a) is never vacuous. Their keys go to the journal of S (not used by the allowance of T).
//   writes    D8 (b): on --transformation: a new transformation is created (201 + ETag) and read back with its audit
//             trail; a RAID item is created; a KPI value is recorded by --kpi-user (a kpi_actual.submit holder who
//             owns or stewards it) on --kpi-definition in an open reporting period (without them: the signed-in user
//             on the first active definition); gate --gate (default G1) is submitted.
//   approve   D8 (b): the REBOUND approver --approver signs in and decides the submission (outcome `deferred`, a
//             SYNTHETIC drill decision; it approves nothing real). Then the KPI evaluation the worker derives is read
//             back through the API.
//   downloads D8 (a): every entry of <downloads.json> ([{ path, sha256 }]) is fetched from the target and its SHA-256
//             compared.
//   exportq   D9 (before the restart, worker stopped): one report export is requested (createExport), so it stays
//             queued; its id is journalled (export_job is operational).
//   exportwait D9 (after the restart): that export reaches `succeeded` within 120 s and its file downloads with the
//             SHA-256 the job reports.
//   deeplink  D8 (d): a link issued on the target (the approver's inbox notification for the submission, else the
//             submitter's) resolves under the target's origin and opens there (HTTP 200).
// Journal (--journal): a sign-in appends { table: "user_identity", key: [--issuer, sub], op: "signin" } when --issuer
// is given (allowance.mjs resolves it on the target); every create and change appends { table, key, op: "added"|"changed", via } with the key from
// the API response; derived rows read back through the API are journalled the same way (ADR-0064 A1.9). The journal
// is read and extended, so D8 and D9 share one file.
// Output: one line per step, then a JSON summary (also written to --out). Exit 0 only if every step passed; 1 a step
// failed; 2 BLOCKED (usage). Every user and value is SYNTHETIC; nothing here is a business, Finance or IT approval,
// and no G1-G6 decision recorded by the drill approves anything.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const STEPS = ["signin", "unbound", "csrf", "status", "writes", "approve", "downloads", "deeplink"];
export const ALL_STEPS = [...STEPS, "uploads", "exportq", "exportwait"];

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
  async function http(jar, method, url, { body, bytes, headers = {}, raw = false } = {}) {
    const target = toApi(url);
    const h = { ...headers };
    const cookie = jar?.header(target);
    if (cookie) h.cookie = cookie;
    let payload;
    if (bytes !== undefined) {
      payload = bytes;
      h["content-type"] = "application/octet-stream";
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

  /** The development sign-in of the source S (D1 only; seed-dev usernames). */
  async function devSignIn(jar, username) {
    const r = await http(jar, "POST", "/api/v1/auth/dev-login", {
      body: { username },
      headers: { origin: APP.origin },
    });
    if (r.status !== 204) fail(`dev-login ${username}: HTTP ${r.status} ${(r.text ?? "").slice(0, 200)}`);
    const me = await http(jar, "GET", "/api/v1/me");
    return { ok: me.status === 200, location: "", me: me.json, status: me.status };
  }

  return { APP, API, http, oidcSignIn, devSignIn };
}

/** A journal of the keys the journey wrote (ADR-0064 A1.9: keys come from API responses, never from the target). */
export class Journal {
  constructor(file) {
    this.file = file;
    this.entries = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).entries : [];
  }
  add(table, key, op, via) {
    const k = Array.isArray(key) ? key.map(String) : [String(key)];
    if (k.some((x) => !x || x === "undefined")) fail(`journal: no key for ${table} from ${via}`);
    this.entries.push({ table, key: k, op, via });
  }
  save() {
    if (this.file)
      writeFileSync(
        this.file,
        JSON.stringify({ schemaVersion: "mth-drill-journal/1", entries: this.entries }, null, 2) + "\n",
      );
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const items = (j) => (Array.isArray(j) ? j : (j?.items ?? []));

/** Runs the journey. Returns { result, steps: [{ step, result, ms, detail }] }. */
export async function runJourney(o) {
  const c = client(o);
  const steps = [];
  const journal = new Journal(o.journal);
  const ctx = { jar: new Jar(), csrf: null, me: null, tr: o.transformation ?? null, gate: o.gate ?? "G1", sub: null };
  const run = Array.isArray(o.steps) && o.steps.length > 0 ? o.steps : STEPS;
  const as =
    (who) =>
    (method, path, body, extra = {}, origin = c.APP.origin) =>
      c.http(who.jar, method, path, {
        body,
        headers: method === "GET" ? extra : { ...extra, origin, "x-csrf-token": who.csrf ?? "" },
      });
  const call = (...a) => as(ctx)(...a);
  const signIn = async (jar, user) => (o.authMode === "dev" ? c.devSignIn(jar, user) : c.oidcSignIn(jar, user));
  const need = (cond, m) => (cond ? undefined : fail(m));
  const created = (r, what) => {
    if (r.status !== 201 || !r.json?.id) fail(`${what}: HTTP ${r.status} ${(r.text ?? "").slice(0, 200)}`);
    return r.json;
  };
  const pickTransformation = async () => {
    if (ctx.tr) return ctx.tr;
    const l = await call("GET", "/api/v1/transformations?limit=100");
    const t = items(l.json)[0]?.id;
    need(l.status === 200 && t, `no transformation readable by the signed-in user (HTTP ${l.status})`);
    return (ctx.tr = t);
  };
  const impl = {
    async signin() {
      const r = await signIn(ctx.jar, o.user);
      if (!r.ok) fail(`sign-in of ${o.user} refused: ${r.location || `HTTP ${r.status}`}`);
      const mode = o.authMode === "dev" ? "dev" : "oidc";
      if (r.me?.authMode !== mode) fail(`/me.authMode is ${r.me?.authMode}, expected ${mode}`);
      ctx.me = r.me;
      ctx.csrf = r.me.csrfToken;
      // The signed-in identity, by (issuer, subject), for the allowance (resolved on the target by allowance.mjs).
      if (mode === "oidc" && o.issuer) journal.add("user_identity", [o.issuer, o.user], "signin", "oidc sign-in");
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
    async status() {
      if (!o.expectOrigin || !o.expectEnvironment) fail("no --expect-origin or --expect-environment given");
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const r = await call("GET", "/api/v1/admin/deployment");
      if (r.status !== 200) fail(`getDeploymentStatus: HTTP ${r.status} ${(r.text ?? "").slice(0, 200)}`);
      if (r.json.origin !== o.expectOrigin)
        fail(`getDeploymentStatus.origin is ${r.json.origin}, expected ${o.expectOrigin}`);
      if (r.json.environmentKind !== o.expectEnvironment)
        fail(`getDeploymentStatus.environmentKind is ${r.json.environmentKind}, expected ${o.expectEnvironment}`);
      return `origin ${r.json.origin}, environmentKind ${r.json.environmentKind}, schema ${r.json.schema?.status}`;
    },
    async uploads() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const t = await pickTransformation();
      const done = [];
      for (const n of [1, 2]) {
        const e = created(
          await call("POST", `/api/v1/transformations/${t}/evidence`, {
            kind: "file",
            title: `Transfer drill evidence ${n} (synthetic)`,
            fileName: `drill-evidence-${n}.txt`,
            ownerUserId: ctx.me.user.id,
          }),
          `create evidence ${n}`,
        );
        journal.add("evidence", e.id, "added", "createEvidence");
        const bytes = Buffer.from(`SYNTHETIC transfer drill evidence ${n} ${randomUUID()}\n`, "utf8");
        const etag = (await call("GET", `/api/v1/transformations/${t}/evidence/${e.id}`)).headers.get("etag");
        const up = await c.http(ctx.jar, "POST", `/api/v1/transformations/${t}/evidence/${e.id}/content`, {
          bytes,
          headers: {
            origin: c.APP.origin,
            "x-csrf-token": ctx.csrf,
            "if-match": etag ?? `"${e.version}"`,
            "x-file-name": `drill-evidence-${n}.txt`,
          },
        });
        if (up.status !== 200 && up.status !== 201)
          fail(`upload ${n}: HTTP ${up.status} ${(up.text ?? "").slice(0, 200)}`);
        done.push(`${e.id} sha256 ${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`);
      }
      return `2 evidence files uploaded on ${t}: ${done.join("; ")}`;
    },
    async writes() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const run = randomUUID().slice(0, 8).toUpperCase();
      const bus = await call("GET", `/api/v1/organizations/${ctx.me.organization.id}/business-units`);
      const buId = items(bus.json)[0]?.id;
      if (bus.status !== 200 || !buId) fail(`no business unit readable on the target (HTTP ${bus.status})`);
      const nt = await call(
        "POST",
        "/api/v1/transformations",
        { businessUnitId: buId, name: `Transfer drill ${run} (synthetic)`, mode: "end_to_end" },
        { "idempotency-key": `drill-${run}-create-0001` },
      );
      created(nt, "create transformation");
      if (!nt.headers.get("etag")) fail("create transformation: no ETag");
      journal.add("transformation", nt.json.id, "added", "createTransformation");
      const d = await call("GET", `/api/v1/transformations/${nt.json.id}`);
      if (d.status !== 200) fail(`read back: HTTP ${d.status}`);
      const a = await call("GET", `/api/v1/transformations/${nt.json.id}/audit`);
      if (a.status !== 200) fail(`audit trail: HTTP ${a.status}`);
      // The carried transformation the rebound users hold roles on.
      const t = await pickTransformation();
      const raid = created(
        await call("POST", `/api/v1/transformations/${t}/raid`, {
          type: "issue",
          description: `Transfer drill ${run} RAID item (synthetic)`,
          impact: "low",
          ownerUserId: ctx.me.user.id,
        }),
        "create RAID item",
      );
      journal.add("raid_entry", raid.id, "added", "createRaidEntry");
      // A KPI value. The routine update is refused unless the caller holds kpi_actual.submit AND owns or stewards the
      // definition (apps/api/src/modules/kpi/actuals.ts), so --kpi-user (that rebound user, signed in separately and
      // journalled) records it on --kpi-definition; without them, the signed-in user on the first active definition.
      const kpiActor = { jar: new Jar(), csrf: ctx.csrf };
      if (o.kpiUser && o.kpiUser !== o.user) {
        const kr = await signIn(kpiActor.jar, o.kpiUser);
        if (!kr.ok) fail(`sign-in of the KPI user ${o.kpiUser} refused: ${kr.location || `HTTP ${kr.status}`}`);
        kpiActor.csrf = kr.me.csrfToken;
        if (o.authMode !== "dev" && o.issuer)
          journal.add("user_identity", [o.issuer, o.kpiUser], "signin", "oidc sign-in (KPI user)");
      } else kpiActor.jar = ctx.jar;
      const kcall = as(kpiActor);
      const defs = await kcall("GET", `/api/v1/transformations/${t}/kpi-definitions?limit=100`);
      const periods = await kcall("GET", `/api/v1/transformations/${t}/reporting-periods`);
      const def = o.kpiDefinition
        ? items(defs.json).find((k) => k.id === o.kpiDefinition)
        : (items(defs.json).find((k) => k.status === "active") ?? items(defs.json)[0]);
      // One slot per KPI, scope and period: a period without a slot takes the routine update (create); when every open
      // period has one, the slot gets a new value version (POST .../kpi-actuals/{a}/values with If-Match).
      const slots = def
        ? await kcall("GET", `/api/v1/transformations/${t}/kpi-definitions/${def.id}/actuals?limit=100`)
        : null;
      const slotOf = (p) =>
        items(slots?.json).find(
          (x) => x.reportingPeriodId === p.id && (x.scopeId ?? t) === t && x.scopeKind !== "business_unit",
        );
      const open = items(periods.json).filter((p) => p.status === "open");
      const period = open.find((p) => !slotOf(p)) ?? open[0] ?? items(periods.json)[0];
      need(
        def && period,
        `no KPI definition${o.kpiDefinition ? ` ${o.kpiDefinition}` : ""} (HTTP ${defs.status}) or reporting period (HTTP ${periods.status}) on ${t}`,
      );
      const entry = {
        action: "save_draft",
        // decimal strings, never JSON numbers; a ratio KPI takes a numerator and a denominator instead of a value
        ...(o.kpiValueNature === "ratio" ? { numerator: "3", denominator: "2" } : { value: "1.5" }),
        dataAsOf: today(),
        comment: `Transfer drill ${run} (synthetic)`,
      };
      const slot = slotOf(period);
      const kv = slot
        ? await kcall("POST", `/api/v1/transformations/${t}/kpi-actuals/${slot.id}/values`, entry, {
            "if-match": `"${slot.version}"`,
          })
        : await kcall("POST", `/api/v1/transformations/${t}/kpi-definitions/${def.id}/actuals`, {
            scopeKind: "transformation",
            scopeId: t,
            reportingPeriodId: period.id,
            ...entry,
          });
      if (kv.status !== 201 && kv.status !== 200)
        fail(`record KPI value: HTTP ${kv.status} ${(kv.text ?? "").slice(0, 200)}`);
      const actualId = kv.json?.actual?.id ?? kv.json?.id;
      journal.add("kpi_actual", actualId, slot ? "changed" : "added", slot ? "addKpiActualValue" : "submitKpiActual");
      // kpi_actual_value rows have an id the API does not return (the value is presented by valueNo): they are not
      // journalled; T-B17 measured how mode 2 explains them (allowance.mjs D8_TOUCHED_AUDITED / D8_TOUCHED_CHILDREN).
      ctx.kpi = { def: def.id, actual: actualId };
      // The gate submission.
      const g = await call("GET", `/api/v1/transformations/${t}/gates/${ctx.gate}`);
      need(g.status === 200, `gate ${ctx.gate}: HTTP ${g.status}`);
      const sub = await call(
        "POST",
        `/api/v1/transformations/${t}/gates/${ctx.gate}/submissions`,
        { submissionNote: `Transfer drill ${run} submission (synthetic; approves nothing real)` },
        { "if-match": g.headers.get("etag") ?? "" },
      );
      if (sub.status !== 201) fail(`submit gate ${ctx.gate}: HTTP ${sub.status} ${(sub.text ?? "").slice(0, 200)}`);
      const s = sub.json?.submission ?? sub.json;
      journal.add("gate_submission", s.id, "added", "submitGate");
      ctx.sub = { no: s.submissionNo, id: s.id };
      return `transformation ${nt.json.id}; RAID ${raid.id}; KPI actual ${actualId}; gate ${ctx.gate} submission ${s.submissionNo} on ${t}`;
    },
    async approve() {
      if (!o.approver) fail("no --approver given");
      if (!ctx.sub) fail("no submission (the writes step must pass first)");
      const ap = { jar: new Jar(), csrf: null };
      const r = await signIn(ap.jar, o.approver);
      if (!r.ok) fail(`sign-in of the rebound approver ${o.approver} refused: ${r.location || `HTTP ${r.status}`}`);
      ap.csrf = r.me.csrfToken;
      if (o.authMode !== "dev" && o.issuer)
        journal.add("user_identity", [o.issuer, o.approver], "signin", "oidc sign-in");
      const t = ctx.tr;
      const dec = await as(ap)("POST", `/api/v1/transformations/${t}/gates/${ctx.gate}/decision`, {
        submissionNo: ctx.sub.no,
        outcome: "deferred",
        rationale: "Transfer drill decision (synthetic; approves nothing real)",
      });
      if (dec.status !== 201 && dec.status !== 200)
        fail(`decide gate ${ctx.gate}: HTTP ${dec.status} ${(dec.text ?? "").slice(0, 200)}`);
      const decisionId = dec.json?.decision?.id ?? dec.json?.id;
      journal.add("gate_decision", decisionId, "added", "decideGate");
      if (dec.json?.decisionId)
        journal.add("decision", dec.json.decisionId, "added", "decideGate (canonical decision)");
      ctx.approverJar = ap.jar;
      // The KPI evaluation the worker derives, read back through the API (journalled as derived rows).
      let derived = "no KPI evaluation read";
      if (ctx.kpi) {
        const st = await call("GET", `/api/v1/transformations/${t}/kpi-definitions/${ctx.kpi.def}/status`);
        if (st.status === 200 && st.json?.evaluationId) {
          journal.add("kpi_evaluation", st.json.evaluationId, "added", "getKpiStatus (worker-derived)");
          if (st.json.calculationRunId)
            journal.add("calculation_run", st.json.calculationRunId, "added", "getKpiStatus (worker-derived)");
          derived = `KPI evaluation ${st.json.evaluationId}`;
        }
      }
      return `${o.approver} (rebound) decided ${ctx.gate} submission ${ctx.sub.no}: deferred (decision ${decisionId}); ${derived}`;
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
    async exportq() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const t = await pickTransformation();
      const r = await call("POST", "/api/v1/exports", {
        report: { definitionCode: "registers", subjectId: t },
        format: "csv",
        language: "en",
      });
      if (![200, 201, 202].includes(r.status) || !r.json?.id)
        fail(`createExport: HTTP ${r.status} ${(r.text ?? "").slice(0, 200)}`);
      journal.add("export_job", r.json.id, "added", "createExport");
      if (r.json.status !== "queued") fail(`the export is ${r.json.status}, expected queued (is the worker stopped?)`);
      return `export ${r.json.id} queued`;
    },
    async exportwait() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const id = [...journal.entries].reverse().find((e) => e.table === "export_job")?.key[0];
      if (!id) fail("no queued export in the journal (step exportq)");
      const t0 = Date.now();
      let job = null;
      while (Date.now() - t0 < 120_000) {
        const r = await call("GET", `/api/v1/exports/${id}`);
        job = r.json;
        if (job?.status === "succeeded" || job?.status === "failed" || job?.status === "cancelled") break;
        await new Promise((res) => setTimeout(res, 1000));
      }
      if (job?.status !== "succeeded")
        fail(`the export queued before the restart did not complete within 120 s (status ${job?.status ?? "unknown"})`);
      const f = await c.http(ctx.jar, "GET", `/api/v1/exports/${id}/download`, { raw: true });
      const sha = createHash("sha256").update(f.bytes).digest("hex");
      if (f.status !== 200 || sha !== job.fileSha256) fail(`download: HTTP ${f.status}, sha256 ${sha.slice(0, 12)}`);
      return `export ${id} succeeded after ${Math.round((Date.now() - t0) / 1000)} s; ${f.bytes.length} bytes, SHA-256 equal`;
    },
    async deeplink() {
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      const jar = ctx.approverJar ?? ctx.jar;
      const inbox = await c.http(jar, "GET", "/api/v1/me/inbox?limit=50");
      if (inbox.status !== 200) fail(`inbox: HTTP ${inbox.status}`);
      const n = items(inbox.json).find((x) => !ctx.tr || x.transformationId === ctx.tr) ?? items(inbox.json)[0];
      if (!n?.linkPath) fail("no notification with a link was issued on the target");
      const url = new URL(n.linkPath, c.APP);
      if (url.origin !== c.APP.origin) fail(`the link resolves to ${url.origin}, expected ${c.APP.origin}`);
      const page = await c.http(jar, "GET", url.href);
      const loc = page.headers.get("location");
      if (page.status === 200) return `notification ${n.id}: ${url.href} -> 200`;
      if (page.status >= 300 && page.status < 400 && loc && new URL(loc, c.APP).origin === c.APP.origin)
        return `notification ${n.id}: ${url.href} -> ${page.status} ${loc} (same origin)`;
      fail(`opening ${url.href}: HTTP ${page.status}${loc ? ` -> ${loc}` : ""}`);
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
  journal.save();
  return {
    schemaVersion: "mth-transfer-journey/1",
    mode: o.authMode === "dev" ? "dev" : "oidc-drill",
    idp: "synthetic drill IdP (not a corporate IdP)",
    app: c.APP.origin,
    steps,
    journalEntries: journal.entries.length,
    result: steps.length > 0 && steps.every((s) => s.result === "PASS") ? "PASS" : "FAIL",
  };
}

async function main() {
  let v;
  try {
    ({ values: v } = parseArgs({
      args: process.argv.slice(2),
      options: Object.fromEntries(
        [
          "mode",
          "app",
          "api",
          "user",
          "approver",
          "kpi-user",
          "kpi-definition",
          "kpi-value-nature",
          "issuer",
          "unbound-user",
          "source-origin",
          "transformation",
          "gate",
          "expect-origin",
          "expect-environment",
          "downloads",
          "journal",
          "steps",
          "out",
        ].map((k) => [k, { type: "string" }]),
      ),
      strict: true,
    }));
  } catch {
    v = {};
  }
  if (!["oidc-drill", "dev"].includes(v.mode) || !v.app || !v.user) {
    console.error("BLOCKED: usage: journey.mjs --mode oidc-drill|dev --app <origin> --user <sub> [options]");
    process.exit(2);
  }
  const report = await runJourney({
    app: v.app,
    api: v.api,
    authMode: v.mode === "dev" ? "dev" : "oidc",
    user: v.user,
    approver: v.approver,
    kpiUser: v["kpi-user"],
    kpiDefinition: v["kpi-definition"],
    kpiValueNature: v["kpi-value-nature"],
    issuer: v.issuer,
    unboundUser: v["unbound-user"],
    sourceOrigin: v["source-origin"],
    transformation: v.transformation,
    gate: v.gate,
    expectOrigin: v["expect-origin"],
    expectEnvironment: v["expect-environment"],
    downloads: v.downloads,
    journal: v.journal,
    steps: v.steps ? v.steps.split(",") : undefined,
  });
  if (v.out) writeFileSync(v.out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, steps: report.steps.length }));
  process.exit(report.result === "PASS" ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
