#!/usr/bin/env node
// deploy/scripts/drill/journey.mjs: the journeys of the transfer drill (ADR-0069 §4 D1, D7, D8, D9; p7-work-split §B.2
// and §B.6 DO-D2; tests T-B10; T-DG7-DO-D, T-DG7-DO-D2). It does not change deploy/scripts/smoke.mjs.
//
//   node deploy/scripts/drill/journey.mjs --mode oidc-drill|dev --app <origin> [--api <url>] --user <sub|username>
//        [--approver <sub>] [--actors <pick-actors.json>] [--sub-prefix drill-] [--unbound-user <sub>] [--source-origin <origin>] [--transformation <id>] [--gate <code>]
//        [--expect-origin <origin>] [--expect-environment <kind>] [--status-user <sub>] [--downloads <downloads.json>]
//        [--download-user <sub>]
//        [--journal <journal.json>] [--steps a,b,...] [--out <journey.json>]
//
// Steps (default: signin, unbound, csrf, status, writes, approve, downloads, deeplink, in this order):
//   signin    oidc-drill: GET /api/v1/auth/login, follow the redirect to the SYNTHETIC drill IdP with
//             `login_hint=<sub>`, then the callback on the target's origin; /api/v1/me answers 200 with authMode `oidc`.
//             dev (the source S only, D1): POST /api/v1/auth/dev-login with the seed-dev username.
//   unbound   the same for --unbound-user: the callback must refuse it (`/login?error=identity_unbound`), no session.
//   csrf      a write with the SOURCE origin in `Origin` is refused 403 (ADR-0069 §1 item 1, D8 (c)).
//   status    D7: getDeploymentStatus (GET /api/v1/admin/deployment): `origin` equals --expect-origin and
//             `environmentKind` equals --expect-environment (the package's sourceEnvironment). With --status-user
//             (an operations.read holder; T-DG7-DO-D5) that user signs in for this step, else the --user session is used.
//   uploads   D1 (on S): two SYNTHETIC file evidence items are created and their bytes uploaded through the API, so
//             D8 (a) is never vacuous. Their keys go to the journal of S (not used by the allowance of T).
//   writes    D8 (b) (ADR-0064 A3.6; B.8 DO-D4): on --transformation as the submitter S: a new transformation is created
//             (201 + ETag) and read back with its audit trail; a RAID item is created; then the gate chain C0-C3 on
//             --gate: C0 getGate; C1 each missing item of each incomplete mandatory criterion, in order, gets its row of
//             the A3.6 remedy table, made by the actor the table names (--actors, the pick-actors.sql JSON; each actor
//             signs in through the drill IdP as <--sub-prefix><app_user id> and is journalled); C2 getGate every 2 s for
//             at most 120 s until canSubmit; C3 submitGate. A code without a remedy row, a role nobody fills or any 4xx
//             stops D8 with the A3.6 line (`D8 FAIL: ...`) and nothing is written after it.
//   approve   D8 (b) C4-C6: the REBOUND approver --approver signs in, polls getGate until canDecide (2 s, 120 s), decides
//             the submission (outcome `deferred`, a SYNTHETIC drill decision; it approves nothing real), reads it back
//             (getGateSubmission), waits at least 30 s for the worker, then reads the remedied KPIs' evaluations.
//   downloads D8 (a): every entry of <downloads.json> ([{ path, sha256 }]) is fetched from the target and its SHA-256
//             compared. With --download-user (an actor who can read the files' transformation, e.g. the rebound
//             uploader; T-DG7-DO-D5) that user signs in for this step, else the --user session is used.
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
export const ALL_STEPS = [...STEPS, "uploads", "exportq", "exportwait", "gatechain"];

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
    const j = file && existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    this.entries = j.entries ?? [];
    /** D-262 (a): the access grants D8 made through the API (createRoleAssignment), recorded for the report. Not
     * allowance keys: scoped_assignment is a D8 child table (allowance.mjs D8_TOUCHED_CHILDREN), explained through its
     * parent app_user (the grantee signs in and is journalled), and its audit_event is checked by the trail check. */
    this.grants = j.grants ?? [];
  }
  grant(g) {
    this.grants.push(g);
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
        JSON.stringify(
          {
            schemaVersion: "mth-drill-journal/1",
            entries: this.entries,
            ...(this.grants.length > 0 ? { grants: this.grants } : {}),
          },
          null,
          2,
        ) + "\n",
      );
  }
}

/**
 * The codes of the A3.6 remedy table (C1); any other code stops D8 (g5.performance_no_kpi, *_not_loaded).
 * T-DG7-DO-D5 (D-261): g5.adoption_none is remedied by creating the missing adoption configuration through the public
 * API (createAdoptionMetricLink, adoption.edit) as a rebound holder: the KPI-fed measure pick-actors.sql chooses
 * (`adoptionLink`), attached to the transformation and fed by an existing active KPI of matching unit and polarity; that
 * KPI then gets the KPI remedy. No demo data and no gate rule is changed.
 */
export const REMEDY_CODES = new Set([
  "g5.adoption_none",
  "g5.performance_no_accepted_actual",
  "g5.performance_kpi_not_known",
  "g5.performance_pilot_evidence_missing",
  "g5.adoption_indicator_unknown",
  "g5.decision_log_empty",
  "g5.decision_date_missing",
  "g5.decision_overdue",
  "g5.risk_open",
]);
/** A3.6 C2/C4: poll every 2 s for at most 120 s. */
const POLL_MS = 120_000;
/** B.8 DO-D4: wait at least 30 s after C6 before D9's snapshot (MTH_DRILL_SETTLE_MS may only raise it). */
const SETTLE_MS = Math.max(30_000, Number(process.env.MTH_DRILL_SETTLE_MS ?? 0) || 0);
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
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
  // ------------------------------------------------------------------ ADR-0064 A3.6: the D8 gate chain (C0-C6)
  const actors = o.actors ?? {};
  const subOf = (userId) => `${o.subPrefix ?? "drill-"}${userId}`;
  const sessions = new Map();
  /** Every mutating call D8 made after C0 (operation ids), for the report and T-B18. */
  const writes = [];
  /** The signed-in session of a rebound user (by app_user id); journalled once (A3.6 "each signs in ... journalled"). */
  const actor = async (userId, permission, role) => {
    if (!userId) fail(`D8 FAIL: no rebound user holds ${permission}`);
    if (sessions.has(userId)) return sessions.get(userId);
    let s;
    if (userId === ctx.me?.user?.id) s = { jar: ctx.jar, csrf: ctx.csrf, id: userId };
    else {
      const jar = new Jar();
      const r = await signIn(jar, subOf(userId));
      if (!r.ok) fail(`sign-in of the ${role} ${subOf(userId)} refused: ${r.location || `HTTP ${r.status}`}`);
      s = { jar, csrf: r.me.csrfToken, id: r.me.user.id };
      if (o.authMode !== "dev" && o.issuer)
        journal.add("user_identity", [o.issuer, subOf(userId)], "signin", `oidc sign-in (${role})`);
    }
    sessions.set(userId, s);
    return s;
  };
  /** A separate session for a step run as another user (by its full subject or dev username); journalled like actor(). */
  const subSession = async (sub, role) => {
    if (sessions.has(sub)) return sessions.get(sub);
    const jar = new Jar();
    const r = await signIn(jar, sub);
    if (!r.ok) fail(`sign-in of the ${role} ${sub} refused: ${r.location || `HTTP ${r.status}`}`);
    const s = { jar, csrf: r.me.csrfToken, id: r.me.user.id };
    if (o.authMode !== "dev" && o.issuer)
      journal.add("user_identity", [o.issuer, sub], "signin", `oidc sign-in (${role})`);
    sessions.set(sub, s);
    return s;
  };
  /** One API call of the chain: a refusal (any 4xx, or an unexpected status) stops D8 with the A3.6 line. */
  const op = async (who, opId, method, path, body, headers = {}, ok = [200, 201]) => {
    const r = await as(who)(method, path, body, headers);
    if (!ok.includes(r.status)) fail(`D8 FAIL: ${opId} HTTP ${r.status} ${r.json?.code ?? ""}`.trim());
    if (method !== "GET") writes.push(opId);
    return r;
  };
  const etagOf = (r, v) => r.headers.get("etag") ?? (v === undefined ? "" : `"${v}"`);
  const businessDate = (plusDays = 0) => {
    const d = new Date(
      `${new Intl.DateTimeFormat("en-CA", { timeZone: o.timezone ?? "Asia/Riyadh" }).format(new Date())}T00:00:00Z`,
    );
    d.setUTCDate(d.getUTCDate() + plusDays);
    return d.toISOString().slice(0, 10);
  };
  /**
   * T-DG7-DO-D5: the reporting period the KPI remedy reports in is the one holding today's business date. The demo's
   * last period is 2026-09, so an actual in an older open period is already past the KPI's staleAfterDays and stays
   * `stale` (T-B17 run 1: "actualStatus stale ... dataAsOf 2026-08-31, staleAfterDays 45"). The current period is
   * therefore opened through the public API by a rebound reporting_period.manage holder R (openReportingPeriod when it
   * is scheduled; createReportingPeriod for the calendar month, then openReportingPeriod, when it does not exist), as an
   * operator would at the start of a month. Demo data and the freshness rule are unchanged. Done once per run.
   */
  /**
   * D-262 (a), T-DG7-DO-D6: when no rebound user holds reporting_period.manage at organization scope, the rebound access
   * administrator G (access.assign at organization scope) grants the organization-wide TO role (reporting_period.manage,
   * organization.read) to the rebound drill actor `periodGrantee` through the public API (createRoleAssignment, with a
   * mandatory reason; the product audits it as scoped_assignment.create). The grant is recorded in the journal's
   * `grants`, and the grantee then signs in as R. SYNTHETIC: it grants no business, Finance or IT approval.
   */
  const grantPeriodManager = async (org) => {
    const G = await actor(actors.accessAdmin, "access.assign at organization scope", "access administrator G");
    if (!actors.periodGrantee || actors.periodGrantee === G.id)
      fail("D8 FAIL: no rebound drill actor to receive reporting_period.manage");
    const r = await op(
      G,
      "createRoleAssignment",
      "POST",
      "/api/v1/role-assignments",
      {
        userId: actors.periodGrantee,
        roleCode: "TO",
        scope: { type: "organization", id: org },
        reason: "SYNTHETIC transfer drill D8: open the current reporting period (D-262); approves nothing",
      },
      {},
      [201],
    );
    journal.grant({
      via: "createRoleAssignment",
      assignmentId: r.json.id,
      grantor: G.id,
      userId: actors.periodGrantee,
      roleCode: "TO",
      scope: { type: "organization", id: org },
    });
    return actor(actors.periodGrantee, "reporting_period.manage", "period manager R (granted)");
  };
  const currentPeriod = async (t, K) => {
    if (ctx.period) return ctx.period;
    const base = `/api/v1/transformations/${t}`;
    const today = businessDate(0);
    const periods = await op(K, "listTransformationReportingPeriods", "GET", `${base}/reporting-periods?limit=100`);
    const all = items(periods.json);
    let p = all.find((x) => x.frequency === "monthly" && x.periodStart <= today && today <= x.periodEnd);
    if (p?.status === "open") return (ctx.period = p);
    if (p && p.status !== "scheduled") fail(`D8 FAIL: the current reporting period ${p.periodLabel} is ${p.status}`);
    const org = all[0]?.organizationId;
    if (!org) fail(`D8 FAIL: no reporting period readable on ${t}`);
    const R = actors.periodManager
      ? await actor(actors.periodManager, "reporting_period.manage", "period manager R")
      : await grantPeriodManager(org);
    const obase = `/api/v1/organizations/${org}/reporting-periods`;
    if (!p) {
      const end = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1);
      end.setUTCDate(0);
      const due = new Date(end);
      due.setUTCDate(due.getUTCDate() + 5);
      const cr = await op(R, "createReportingPeriod", "POST", obase, {
        frequency: "monthly",
        periodLabel: today.slice(0, 7),
        periodStart: `${today.slice(0, 7)}-01`,
        periodEnd: end.toISOString().slice(0, 10),
        basis: "calendar",
        updateDueDate: due.toISOString().slice(0, 10),
      });
      p = cr.json;
      journal.add("reporting_period", p.id, "added", "createReportingPeriod");
    }
    const cur = await op(R, "getReportingPeriod", "GET", `${obase}/${p.id}`);
    const opened = await op(R, "openReportingPeriod", "POST", `${obase}/${p.id}/open`, undefined, {
      "if-match": etagOf(cur, cur.json?.version),
    });
    journal.add("reporting_period", p.id, "changed", "openReportingPeriod");
    return (ctx.period = opened.json ?? p);
  };
  /** The KPI remedy (A3.6 rows g5.performance_no_accepted_actual and g5.performance_kpi_not_known). */
  const kpiRemedy = async (t, k, run) => {
    ctx.kpisDone ??= [];
    if (ctx.kpisDone.includes(k)) return `KPI ${k} already remedied`;
    const a = actors.kpis?.[k] ?? {};
    const K = await actor(a.user, "kpi_actual.submit", "KPI user K");
    const base = `/api/v1/transformations/${t}`;
    const period = await currentPeriod(t, K);
    const slots = await op(K, "listKpiActuals", "GET", `${base}/kpi-definitions/${k}/actuals?limit=100`);
    const slot = items(slots.json).find(
      (x) => x.reportingPeriodId === period.id && (x.scopeId ?? t) === t && x.scopeKind !== "business_unit",
    );
    const entry = {
      action: "submit",
      // decimal strings, never JSON numbers; a ratio KPI takes a numerator and a denominator (DO-D3 finding 4)
      ...(a.valueNature === "ratio" ? { numerator: "3", denominator: "2" } : { value: "1.5" }),
      dataAsOf: businessDate(0) < period.periodEnd ? businessDate(0) : period.periodEnd,
      comment: `SYNTHETIC transfer drill ${run} actual`,
    };
    const kv = slot
      ? await op(K, "addKpiActualValue", "POST", `${base}/kpi-actuals/${slot.id}/values`, entry, {
          "if-match": `"${slot.version}"`,
        })
      : await op(K, "submitKpiActual", "POST", `${base}/kpi-definitions/${k}/actuals`, {
          scopeKind: "transformation",
          scopeId: t,
          reportingPeriodId: period.id,
          ...entry,
        });
    let act = kv.json?.actual ?? kv.json;
    journal.add("kpi_actual", act.id, slot ? "changed" : "added", slot ? "addKpiActualValue" : "submitKpiActual");
    if (act.status === "draft") {
      const s = await op(K, "submitKpiActualDraft", "POST", `${base}/kpi-actuals/${act.id}/submit`, undefined, {
        "if-match": etagOf(kv, act.version),
      });
      act = s.json?.actual ?? s.json;
    }
    let how = `submitted (${act.status})`;
    if (act.status !== "accepted") {
      const V = await actor(a.reviewer, "kpi_actual.accept", "KPI reviewer V");
      const acc = await op(
        V,
        "acceptKpiActual",
        "POST",
        `${base}/kpi-actuals/${act.id}/accept`,
        { comment: "SYNTHETIC transfer drill acceptance" },
        { "if-match": `"${act.version}"` },
      );
      act = acc.json?.actual ?? acc.json;
      how = `accepted (${act.status ?? "?"})`;
    }
    ctx.kpisDone.push(k);
    return `KPI ${k} ${how} in period ${period.periodLabel}`;
  };
  /** The remedy table of A3.6 C1, closed: a code without a row stops D8. */
  const remedy = async (t, it, run) => {
    const base = `/api/v1/transformations/${t}`;
    const S = await actor(ctx.me.user.id, "gate.submit", "submitter S");
    const id = (it.pointer ?? "").split("/").pop();
    switch (it.code) {
      case "g5.performance_no_accepted_actual":
      case "g5.performance_kpi_not_known":
        return kpiRemedy(t, id, run);
      case "g5.performance_pilot_evidence_missing": {
        const W = await actor(actors.evidenceReviewer, "evidence.review", "evidence reviewer W");
        const ev = await op(S, "createEvidence", "POST", `${base}/evidence`, {
          kind: "note",
          title: `SYNTHETIC transfer drill ${run} pilot evidence`,
          noteBody: "SYNTHETIC transfer drill pilot evidence note; it evidences nothing real.",
          evidenceType: "observation",
          ownerUserId: S.id,
        });
        journal.add("evidence", ev.json.id, "added", "createEvidence");
        const cur = await op(W, "getEvidence", "GET", `${base}/evidence/${ev.json.id}`);
        await op(
          W,
          "reviewEvidence",
          "POST",
          `${base}/evidence/${ev.json.id}/review`,
          { result: "verified", accessibilityStatus: "accessible", note: "SYNTHETIC transfer drill review" },
          { "if-match": etagOf(cur, cur.json?.version) },
        );
        journal.add("evidence", ev.json.id, "changed", "reviewEvidence");
        const steps = await op(S, "listPhaseSteps", "GET", `${base}/phase-steps?limit=100`);
        if (!items(steps.json).some((x) => x.stepKey === "transform.deliver_pilots"))
          fail("D8 FAIL: listPhaseSteps: no step transform.deliver_pilots");
        const ln = await op(
          S,
          "linkPhaseStepEvidence",
          "POST",
          `${base}/phase-steps/transform.deliver_pilots/evidence`,
          {
            evidenceId: ev.json.id,
          },
        );
        const lid = ln.json?.id ?? ln.json?.link?.id;
        if (lid) journal.add("phase_step_evidence", lid, "added", "linkPhaseStepEvidence");
        return `pilot evidence ${ev.json.id} verified and linked`;
      }
      case "g5.adoption_none": {
        const A = await actor(actors.adoptionEditor, "adoption.edit", "adoption editor A");
        const pick = actors.adoptionLink ?? {};
        if (!pick.templateKey || !pick.kpiDefinition)
          fail(
            `D8 FAIL: no API remedy for ${it.code} at ${it.pointer ?? "(no pointer)"} (no KPI-fed template matches an active KPI)`,
          );
        const ln = await op(A, "createAdoptionMetricLink", "POST", `${base}/adoption-metric-links`, {
          templateKey: pick.templateKey,
          targetKind: "transformation",
          kpiDefinitionId: pick.kpiDefinition,
        });
        journal.add("adoption_metric_link", ln.json.id, "added", "createAdoptionMetricLink");
        return `adoption link ${ln.json.id} (${pick.templateKey} <- KPI ${pick.kpiDefinition}): ${await kpiRemedy(t, pick.kpiDefinition, run)}`;
      }
      case "g5.adoption_indicator_unknown": {
        const l = await op(S, "getAdoptionMetricLink", "GET", `${base}/adoption-metric-links/${id}`);
        if (l.json?.kpiDefinitionId) return `adoption link ${id}: ${await kpiRemedy(t, l.json.kpiDefinitionId, run)}`;
        // training_records / assessment_records sources: no measured remedy here (A3.9 residual 5)
        return fail(`D8 FAIL: no API remedy for ${it.code} at ${it.pointer} (template ${l.json?.templateKey ?? "?"})`);
      }
      case "g5.decision_log_empty": {
        const O = await actor(actors.decisionOwner, "executive_decision.decide", "decision owner O");
        const dc = await op(O, "createExecutiveDecision", "POST", `${base}/executive-decisions`, {
          title: `SYNTHETIC transfer drill ${run} decision ask`,
          whyNow: "SYNTHETIC transfer drill; decides nothing real.",
          options: [{ title: "SYNTHETIC option A" }, { title: "SYNTHETIC option B" }],
          recommendation: "A",
          impactOfDelay: "SYNTHETIC transfer drill; none.",
          ownerUserId: O.id,
          requiredDate: businessDate(14),
        });
        journal.add("decision", dc.json.id, "added", "createExecutiveDecision");
        return `executive decision ${dc.json.code ?? dc.json.id} created`;
      }
      case "g5.decision_date_missing":
      case "g5.decision_overdue": {
        const O = await actor(actors.decisionOwners?.[id], "executive_decision.decide", "decision owner O");
        const cur = await op(O, "getExecutiveDecision", "GET", `${base}/executive-decisions/${id}`);
        await op(
          O,
          "recordExecutiveDecisionOutcome",
          "POST",
          `${base}/executive-decisions/${id}/outcome`,
          { outcome: "deferred", deferUntil: businessDate(14) },
          { "if-match": etagOf(cur, cur.json?.version) },
        );
        journal.add("decision", id, "changed", "recordExecutiveDecisionOutcome");
        return `executive decision ${cur.json?.code ?? id} deferred to ${businessDate(14)}`;
      }
      case "g5.risk_open": {
        const X = await actor(actors.riskEditor, "raid.edit", "RAID editor X");
        const cur = await op(X, "getRaidEntry", "GET", `${base}/raid/${id}`);
        await op(
          X,
          "closeRaidEntry",
          "POST",
          `${base}/raid/${id}/close`,
          { closureNote: "SYNTHETIC transfer drill closure" },
          { "if-match": etagOf(cur, cur.json?.version) },
        );
        journal.add("raid_entry", id, "changed", "closeRaidEntry");
        return `RAID ${cur.json?.code ?? id} closed`;
      }
      default:
        return fail(`D8 FAIL: no API remedy for ${it.code} at ${it.pointer ?? "(no pointer)"}`);
    }
  };
  /** The permission each remedy code needs, checked before C1 writes anything (A3.6 "stops D8 before C0/C1"). */
  const neededActors = (it) => {
    const id = (it.pointer ?? "").split("/").pop();
    switch (it.code) {
      case "g5.performance_no_accepted_actual":
      case "g5.performance_kpi_not_known":
        return [[actors.kpis?.[id]?.user, "kpi_actual.submit"]];
      case "g5.performance_pilot_evidence_missing":
        return [[actors.evidenceReviewer, "evidence.review"]];
      case "g5.adoption_none":
        return [
          [actors.adoptionEditor, "adoption.edit"],
          [actors.kpis?.[actors.adoptionLink?.kpiDefinition]?.user, "kpi_actual.submit"],
        ];
      case "g5.decision_log_empty":
        return [[actors.decisionOwner, "executive_decision.decide"]];
      case "g5.decision_date_missing":
      case "g5.decision_overdue":
        return [[actors.decisionOwners?.[id], "executive_decision.decide"]];
      case "g5.risk_open":
        return [[actors.riskEditor, "raid.edit"]];
      default:
        return [];
    }
  };
  const incomplete = (g) => (g.json?.criteria ?? []).filter((c) => c.mandatory && c.completeness === "incomplete");
  /** C0-C3. Returns the step detail. */
  const gateChain = async (t, run) => {
    const S = await actor(ctx.me.user.id, "gate.submit", "submitter S");
    const gpath = `/api/v1/transformations/${t}/gates/${ctx.gate}`;
    // C0
    let g = await op(S, "getGate", "GET", gpath);
    const missing = g.json?.canSubmit ? [] : incomplete(g).flatMap((c) => c.missing ?? []);
    ctx.c0 = missing.map((m) => ({ code: m.code, pointer: m.pointer ?? null }));
    const lines = [];
    if (!g.json?.canSubmit) {
      // Before C1 writes anything: every item must have a remedy row and an actor (so an unremediable gate writes nothing)
      for (const it of missing)
        if (!REMEDY_CODES.has(it.code))
          fail(`D8 FAIL: no API remedy for ${it.code} at ${it.pointer ?? "(no pointer)"}`);
      for (const it of missing)
        for (const [u, p] of neededActors(it)) if (!u) fail(`D8 FAIL: no rebound user holds ${p}`);
      // T-DG7-DO-D5: a KPI remedy reports in the current period; when it is not open yet, R must exist (read only here).
      const KPI_CODES = ["g5.performance_no_accepted_actual", "g5.performance_kpi_not_known", "g5.adoption_none"];
      const canGrant = actors.accessAdmin && actors.periodGrantee && actors.accessAdmin !== actors.periodGrantee;
      if (missing.some((it) => KPI_CODES.includes(it.code)) && !actors.periodManager && !canGrant) {
        const today = businessDate(0);
        const l = await op(
          S,
          "listTransformationReportingPeriods",
          "GET",
          `/api/v1/transformations/${t}/reporting-periods?limit=100`,
        );
        const cur = items(l.json).find(
          (x) => x.frequency === "monthly" && x.periodStart <= today && today <= x.periodEnd,
        );
        if (cur?.status !== "open")
          fail(
            `D8 FAIL: no rebound user holds reporting_period.manage (the current period ${cur?.periodLabel ?? today.slice(0, 7)} is ${cur?.status ?? "absent"}), and no rebound user holds access.assign at organization scope to grant it (D-262)`,
          );
      }
      // C1, in order, each item once
      for (const it of missing) lines.push(await remedy(t, it, run));
      // C2
      const t2 = Date.now();
      g = await op(S, "getGate", "GET", gpath);
      while (!g.json?.canSubmit && Date.now() - t2 < POLL_MS) {
        await sleep(2000);
        g = await op(S, "getGate", "GET", gpath);
      }
      if (!g.json?.canSubmit) {
        const left = incomplete(g);
        let kpi = "";
        const k = left.flatMap((c) => c.missing ?? []).find((m) => /^g5\.performance_kpi/.test(m.code));
        if (k) {
          const s = await as(S)(
            "GET",
            `/api/v1/transformations/${t}/kpi-definitions/${k.pointer.split("/").pop()}/status`,
          );
          kpi = ` getKpiStatus ${s.status} ${s.text ?? ""}`.slice(0, 1200);
        }
        fail(
          `D8 FAIL: ${ctx.gate} still incomplete: ${left.map((c) => `${c.key}: ${(c.missing ?? []).map((m) => m.code).join(",")}`).join("; ")}${kpi}`,
        );
      }
      lines.push(`C2 canSubmit after ${Math.round((Date.now() - t2) / 1000)} s`);
    }
    // C3
    const sub = await op(
      S,
      "submitGate",
      "POST",
      `${gpath}/submissions`,
      { submissionNote: "SYNTHETIC transfer drill submission; approves nothing real" },
      { "if-match": g.headers.get("etag") ?? "" },
      [201],
    );
    const s = sub.json?.submission ?? sub.json;
    journal.add("gate_submission", s.id, "added", "submitGate");
    ctx.sub = { no: s.submissionNo, id: s.id };
    return `C0 ${ctx.gate} missing [${ctx.c0.map((m) => m.code).join(", ")}]; C1 ${lines.join("; ")}; C3 submission ${s.submissionNo}`;
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
      const who = o.statusUser ? await subSession(o.statusUser, "status user") : ctx;
      if (!who.csrf) fail("not signed in (the signin step must pass first)");
      const r = await as(who)("GET", "/api/v1/admin/deployment");
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
        { businessUnitId: buId, name: `SYNTHETIC transfer drill ${run}`, mode: "end_to_end" },
        { "idempotency-key": `drill-${run}-create-0001` },
      );
      created(nt, "create transformation");
      if (!nt.headers.get("etag")) fail("create transformation: no ETag");
      // transformation has no _audit_required trigger, so allowance.mjs lists it under `tables` (BE-R3 gap 2)
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
          description: `SYNTHETIC transfer drill ${run} RAID item`,
          impact: "low",
          ownerUserId: ctx.me.user.id,
        }),
        "create RAID item",
      );
      journal.add("raid_entry", raid.id, "added", "createRaidEntry");
      // ADR-0064 A3.6 C0-C3: complete the chosen gate's missing required outputs through the public API, then submit.
      const done = await gateChain(t, run);
      return `transformation ${nt.json.id}; RAID ${raid.id}; ${done}`;
    },
    async gatechain() {
      // T-B18: the gate chain C0-C3 alone, on --transformation (no create, no RAID item)
      if (!ctx.csrf) fail("not signed in (the signin step must pass first)");
      return gateChain(await pickTransformation(), randomUUID().slice(0, 8).toUpperCase());
    },
    async approve() {
      if (!o.approver) fail("no --approver given");
      if (!ctx.sub) fail("no submission (the writes step must pass first)");
      const ap = { jar: new Jar(), csrf: null };
      const r = await signIn(ap.jar, o.approver);
      if (!r.ok) fail(`sign-in of the rebound approver ${o.approver} refused: ${r.location || `HTTP ${r.status}`}`);
      ap.csrf = r.me.csrfToken;
      if (o.authMode !== "dev" && o.issuer)
        journal.add("user_identity", [o.issuer, o.approver], "signin", "oidc sign-in (gate approver P)");
      const t = ctx.tr;
      const P = as(ap);
      const gpath = `/api/v1/transformations/${t}/gates/${ctx.gate}`;
      // C4: the gate.submitted routing runs in the worker; poll getGate as P until canDecide.
      const t4 = Date.now();
      let g = await P("GET", gpath);
      while (!(g.status === 200 && g.json?.canDecide === true) && Date.now() - t4 < POLL_MS) {
        await sleep(2000);
        g = await P("GET", gpath);
      }
      if (!(g.status === 200 && g.json?.canDecide === true))
        fail(`D8 FAIL: ${ctx.gate} not decidable by the approver after ${POLL_MS / 1000} s (getGate HTTP ${g.status})`);
      const c4 = Math.round((Date.now() - t4) / 1000);
      // C5: decideGate (deferred; a SYNTHETIC drill decision that approves nothing real).
      const dec = await P("POST", `${gpath}/decision`, {
        submissionNo: ctx.sub.no,
        outcome: "deferred",
        rationale: "SYNTHETIC transfer drill decision; approves nothing real",
      });
      if (dec.status !== 201) fail(`D8 FAIL: decideGate HTTP ${dec.status} ${dec.json?.code ?? ""}`.trim());
      writes.push("decideGate");
      const decisionId = dec.json?.decision?.id ?? dec.json?.id;
      journal.add("gate_decision", decisionId, "added", "decideGate");
      if (dec.json?.decisionId)
        journal.add("decision", dec.json.decisionId, "added", "decideGate (canonical decision)");
      ctx.approverJar = ap.jar;
      // C6: read the decision back, then wait for the worker (gate.decided and its starters).
      const sb = await P("GET", `${gpath}/submissions/${ctx.sub.no}`);
      if (sb.status !== 200) fail(`D8 FAIL: getGateSubmission HTTP ${sb.status} ${sb.json?.code ?? ""}`.trim());
      const st = sb.json?.submission?.status ?? sb.json?.status;
      if (st !== "decided") fail(`D8 FAIL: getGateSubmission: submission ${ctx.sub.no} is ${st}, expected decided`);
      await sleep(SETTLE_MS);
      // The KPI evaluations the worker derived for the remedied KPIs, read back through the API (journalled as derived).
      const derived = [];
      for (const k of ctx.kpisDone ?? []) {
        const s = await call("GET", `/api/v1/transformations/${t}/kpi-definitions/${k}/status`);
        if (s.status === 200 && s.json?.evaluationId) {
          journal.add("kpi_evaluation", s.json.evaluationId, "added", "getKpiStatus (worker-derived)");
          if (s.json.calculationRunId)
            journal.add("calculation_run", s.json.calculationRunId, "added", "getKpiStatus (worker-derived)");
          derived.push(s.json.evaluationId);
        }
      }
      return `C4 canDecide after ${c4} s; C5 ${o.approver} (rebound) decided ${ctx.gate} submission ${ctx.sub.no}: deferred (decision ${decisionId}); C6 submission decided; waited ${SETTLE_MS / 1000} s for the worker; KPI evaluations read: ${derived.length}`;
    },
    async downloads() {
      if (!o.downloads) fail("no --downloads given");
      const list = JSON.parse(readFileSync(o.downloads, "utf8"));
      if (!Array.isArray(list) || list.length === 0) fail("the download list is empty (no evidence file to prove)");
      const who = o.downloadUser ? await subSession(o.downloadUser, "download user") : ctx;
      const bad = [];
      for (const e of list) {
        const r = await c.http(who.jar, "GET", e.path, { raw: true });
        const sha = createHash("sha256").update(r.bytes).digest("hex");
        if (r.status !== 200 || sha !== e.sha256) bad.push(`${e.path}: HTTP ${r.status}, sha256 ${sha.slice(0, 12)}`);
      }
      if (bad.length > 0) fail(`${bad.length} of ${list.length} downloads differ: ${bad.slice(0, 3).join("; ")}`);
      return `${list.length} evidence files downloaded by ${o.downloadUser ?? o.user}, SHA-256 equal`;
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
    // A3.6: the missing items read at C0 and every mutating operation of the chain, in order (T-B18)
    gateChain: { gate: ctx.gate, c0Missing: ctx.c0 ?? null, writes },
    // D-262 (a): access grants D8 made through the API (empty when a period manager already existed)
    grants: journal.grants,
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
          "actors",
          "sub-prefix",
          "issuer",
          "unbound-user",
          "source-origin",
          "transformation",
          "gate",
          "expect-origin",
          "expect-environment",
          "status-user",
          "downloads",
          "download-user",
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
    actors: v.actors ? JSON.parse(readFileSync(v.actors, "utf8")) : undefined,
    subPrefix: v["sub-prefix"],
    issuer: v.issuer,
    unboundUser: v["unbound-user"],
    sourceOrigin: v["source-origin"],
    transformation: v.transformation,
    gate: v.gate,
    expectOrigin: v["expect-origin"],
    expectEnvironment: v["expect-environment"],
    statusUser: v["status-user"],
    downloads: v.downloads,
    downloadUser: v["download-user"],
    journal: v.journal,
    steps: v.steps ? v.steps.split(",") : undefined,
  });
  if (v.out) writeFileSync(v.out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ result: report.result, steps: report.steps.length }));
  process.exit(report.result === "PASS" ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await main();
