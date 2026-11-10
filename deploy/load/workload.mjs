#!/usr/bin/env node
// The load-run workload harness (ADR-0058 §3, §5, §6; REQ-S20-029; T-DG6-DO-F). Node built-ins and `pg` only (no new
// dependency, D-195 Q9).
//
//   MTH_LOAD_DB_URL=postgres://…/mth  node deploy/load/workload.mjs --sessions "$TMPDIR/mth-load-sessions.json" \
//     --base-url http://127.0.0.1:25680 --out docs/delivery/test-evidence/DG6/load/run-1/rep-1 \
//     [--warmup-s 120] [--steady-s 600] [--seed 20261027] [--repetition 1] [--users 100]
//
// What it does, in order:
//   1. Setup (never measured). Reads the sessions file written by deploy/load/sessions.mjs (one session per load
//      virtual user). Reads, READ-ONLY, from the load database the targets each user may act on: the transformations of
//      its scoped assignments, the initiatives partitioned to it for updates (each initiative to exactly ONE user holding
//      initiative.edit on its transformation, so concurrent users never edit the same row), the workstreams, the
//      reporting periods and the search terms drawn from generated titles. It refuses a database without the load
//      marker. Then, through the API, it creates per user one saved view and one form draft (the targets of
//      putSavedView and updateFormDraft) when the user's permissions allow it.
//   2. 100 virtual users run concurrently. Each repeats: choose a class by the ADR-0058 §3 shares (ordinary read 50,
//      ordinary update 15, search 8, key dashboard 25, export start 2; a class with no operation the user may perform is
//      left out of THAT user's draw, and the achieved shares are reported), choose an operation of the class uniformly,
//      send it, read the body to its end, then think 1000-3000 ms. Every random choice is integer arithmetic on a 32-bit
//      mulberry32 seeded per (seed, repetition, user), so a user's request sequence is deterministic given the responses.
//   3. Measurement: client-side, per request, from just before `fetch` to the end of the body (`performance.now()`,
//      rounded to integer microseconds). Requests that START inside the warm-up are excluded; requests that start inside
//      the steady-state window are kept. The machine load average is sampled every 5 s.
//   4. Output in --out: samples.csv.gz (one line per request: phase, user index, class, operationId, status, outcome,
//      integer microseconds), loadavg.csv, setup.json (targets and setup outcomes, no credentials) and run.json (the
//      window, the counts). Statistics (nearest-rank p50/p95/p99, max, count, errors) are computed by report.mjs from
//      the samples, never here, so one implementation produces every figure.
//   --only op1,op2 restricts every user to those operations: the diagnostic pass that captures the EXPLAIN plans of an
//      operation whose p95 missed (T-DG6-DO-F). It is never used for a measured repetition.
//
// Outcomes: "ok" (the operation's success status), "conflict" (409 on an update; counted separately, expected 0 by the
// partitioning), "error" (any 5xx, any other 4xx including 429, or a network failure). Nothing is retried while
// measuring. After a 409 the harness re-reads the row OUTSIDE the measurement to refresh its ETag.
//
// Synthetic and not production: the load users, their sessions and every write belong to the disposable load database
// (mth_load_v1). The figures are engineering measurements on the stated sandbox host, not Mobily production capacity.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadavg } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";
import { mulberry32 } from "./generate.mjs";

const requireFromDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));

export const WORKLOAD_VERSION = "1.0.0";
export const DEFAULT_SEED = 20261027;

/** ADR-0058 §3: the classes, their targets (ms) and request shares (percent). */
export const CLASSES = Object.freeze([
  { key: "read", label: "Ordinary read", targetMs: 2000, share: 50 },
  { key: "update", label: "Ordinary update", targetMs: 2000, share: 15 },
  { key: "search", label: "Search", targetMs: 2000, share: 8 },
  { key: "dashboard", label: "Key dashboard", targetMs: 4000, share: 25 },
  { key: "export", label: "Export start", targetMs: 2000, share: 2 },
]);

/** The request templates per operationId (ADR-0058 §3 lists the ids; the report prints these templates). */
export const TEMPLATES = Object.freeze({
  getMe: { cls: "read", method: "GET", path: "/api/v1/me" },
  getMyNavigation: { cls: "read", method: "GET", path: "/api/v1/me/navigation" },
  listTransformations: {
    cls: "read",
    method: "GET",
    path: "/api/v1/transformations?sort={code|-code|updatedAt|-updatedAt}",
  },
  getTransformation: { cls: "read", method: "GET", path: "/api/v1/transformations/{transformationId}" },
  listInitiatives: {
    cls: "read",
    method: "GET",
    path:
      "/api/v1/initiatives?transformationId={t}&limit=50 + one of: sort={code|-code|name|-name|plannedEnd|-plannedEnd|" +
      "updatedAt|-updatedAt} / q={term} / executiveOwnerUserId={u}; then &cursor={nextCursor} on the next call of the " +
      "same user while the page has one",
  },
  getInitiative: { cls: "read", method: "GET", path: "/api/v1/initiatives/{initiativeId}" },
  listFormRecordVersions: {
    cls: "read",
    method: "GET",
    path: "/api/v1/transformations/{t}/form-records/T05/{initiativeId}/versions",
  },
  listMyWorkItems: { cls: "read", method: "GET", path: "/api/v1/me/work-items" },
  listSavedViews: { cls: "read", method: "GET", path: "/api/v1/saved-views?listKey=initiatives" },
  updateInitiative: {
    cls: "update",
    method: "PATCH",
    path: "/api/v1/initiatives/{own partitioned initiativeId}",
    body: '{"risksSummary":"LOAD risks summary r{rep} u{user} n{k}"} with If-Match: {ETag} and X-CSRF-Token',
  },
  putSavedView: {
    cls: "update",
    method: "PUT",
    path: "/api/v1/saved-views/{own savedViewId}",
    body: '{"name":"LOAD view u{user} r{rep}","columns":["code","name"(,"plannedEnd")],"filters":{},"sort":[{"key":"code","direction":"asc|desc"}],"isDefault":false} with If-Match',
  },
  updateFormDraft: {
    cls: "update",
    method: "PUT",
    path: "/api/v1/transformations/{t}/form-drafts/{own draftId}",
    body: '{"payload":{"name":"LOAD draft u{user} n{k}"}} with If-Match',
  },
  searchRecords: { cls: "search", method: "GET", path: "/api/v1/search?q={term, en or ar}&limit=20" },
  getExecutiveOverview: { cls: "dashboard", method: "GET", path: "/api/v1/overview?organizationId={org}" },
  getTransformationDashboard: { cls: "dashboard", method: "GET", path: "/api/v1/transformations/{t}/dashboard" },
  getWorkstreamDashboard: {
    cls: "dashboard",
    method: "GET",
    path: "/api/v1/transformations/{t}/workstreams/{workstreamId}/dashboard",
  },
  getFinanceDashboard: { cls: "dashboard", method: "GET", path: "/api/v1/dashboards/finance?organizationId={org}" },
  getMyWork: { cls: "dashboard", method: "GET", path: "/api/v1/me/work" },
  createExport: {
    cls: "export",
    method: "POST",
    path: "/api/v1/exports",
    body:
      '{"format":"csv","language":"en","report":{"definitionCode":"registers","subjectId":"{t}","parameters":' +
      '{"register":"raid|benefits|kpis|decisions|dependencies"}}} with Idempotency-Key',
  },
});

/** The success status of each operation. */
const SUCCESS = Object.freeze({ createExport: [202, 200] });
const isSuccess = (op, status) => (SUCCESS[op] ?? [200]).includes(status);

/** Integer microseconds from two performance.now() readings (ADR-0058 §6). */
export function micros(t0, t1) {
  return Math.round((t1 - t0) * 1000);
}

/** A per-user PRNG: mulberry32 (integers in [0, 2^32)) over a stable 32-bit mix of (seed, repetition, user). */
export function userRng(seed, repetition, userIndex) {
  const h = createHash("sha256").update(`${seed}:${repetition}:${userIndex}`).digest();
  return mulberry32(h.readUInt32BE(0));
}

/** Think time in whole milliseconds, 1000-3000 inclusive. */
export function thinkMs(rng) {
  return 1000 + (rng() % 2001);
}

/** Picks a class key by share among the classes that `available` admits. */
export function pickClass(rng, available) {
  const classes = CLASSES.filter((c) => available.has(c.key));
  const total = classes.reduce((s, c) => s + c.share, 0);
  let r = rng() % total;
  for (const c of classes) {
    r -= c.share;
    if (r < 0) return c.key;
  }
  return classes[classes.length - 1].key;
}

const pick = (rng, list) => list[rng() % list.length];
const EXPORT_REGISTERS = ["raid", "benefits", "kpis", "decisions", "dependencies"];

// ---------------------------------------------------------------------------------------------------------------- setup

/** Read-only discovery of each user's targets from the load database. */
export async function discoverTargets(dbUrl, sessions) {
  const { Client } = requireFromDb("pg");
  const client = new Client({ connectionString: dbUrl, application_name: "mth-load workload (setup, read-only)" });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const marker = (await client.query("SELECT dataset_code, random_seed FROM load_dataset_marker")).rows[0];
    if (!marker) throw new Error("mth-load workload: refused: the database holds no load_dataset_marker row");
    const userIds = sessions.map((s) => s.userId);
    const assignments = (
      await client.query(
        `SELECT a.user_id, a.scope_id AS transformation_id, r.code AS role,
                bool_or(rp.permission_code = 'initiative.edit') AS can_edit,
                bool_or(rp.permission_code = 'export.create') AS can_export,
                bool_or(rp.permission_code = 'report.generate') AS can_report
           FROM scoped_assignment a
           JOIN role r ON r.id = a.role_id
           LEFT JOIN role_permission rp ON rp.role_id = a.role_id
          WHERE a.user_id = ANY($1::uuid[]) AND a.revoked_at IS NULL AND a.scope_type = 'transformation'
          GROUP BY a.user_id, a.scope_id, r.code
          ORDER BY a.user_id, a.scope_id, r.code`,
        [userIds],
      )
    ).rows;
    const initiatives = (
      await client.query(
        `SELECT i.id, i.transformation_id, i.executive_owner_user_id FROM initiative i ORDER BY i.transformation_id, i.code`,
      )
    ).rows;
    const workstreams = (
      await client.query(`SELECT id, transformation_id FROM workstream WHERE archived_at IS NULL ORDER BY code`)
    ).rows;
    const transformations = (await client.query(`SELECT id, organization_id, code FROM transformation ORDER BY code`))
      .rows;
    const reportDefs = (
      await client.query(
        `SELECT code, subject_type, needs_reporting_period, formats FROM report_definition ORDER BY ordinal`,
      )
    ).rows;
    const names = (await client.query(`SELECT name FROM initiative ORDER BY code LIMIT 400`)).rows.map((r) => r.name);
    await client.query("COMMIT");
    return { marker, assignments, initiatives, workstreams, transformations, reportDefs, names };
  } finally {
    await client.end();
  }
}

/** Search terms drawn from generated titles: distinct words of 4+ letters, English and Arabic. */
export function searchTerms(names) {
  const words = new Set();
  for (const n of names)
    for (const w of String(n).split(/[\s\-–—,.;:()]+/u)) {
      if (/^[A-Za-z]{4,}$/u.test(w) && w !== "LOAD") words.add(w.toLowerCase());
      else if (/^[؀-ۿ]{3,}$/u.test(w) && w !== "تجريبي") words.add(w);
    }
  return [...words].sort();
}

/** Builds the per-user plan: transformations, the update partition, workstreams. Deterministic. */
export function buildPlan(sessions, d) {
  const byUser = new Map(
    sessions.map((s, i) => [
      s.userId,
      { index: i, session: s, transformations: [], editable: new Set(), exportable: new Set() },
    ]),
  );
  for (const a of d.assignments) {
    const u = byUser.get(a.user_id);
    if (!u) continue;
    if (!u.transformations.includes(a.transformation_id)) u.transformations.push(a.transformation_id);
    if (a.can_edit) u.editable.add(a.transformation_id);
    if (a.can_export && a.can_report) u.exportable.add(a.transformation_id);
  }
  // Partition: each initiative to exactly one editor of its transformation, round-robin by user index.
  const editorsOf = new Map();
  for (const u of byUser.values())
    for (const t of u.editable) {
      if (!editorsOf.has(t)) editorsOf.set(t, []);
      editorsOf.get(t).push(u);
    }
  for (const list of editorsOf.values()) list.sort((a, b) => a.index - b.index);
  const owned = new Map();
  const counter = new Map();
  for (const i of d.initiatives) {
    const eds = editorsOf.get(i.transformation_id);
    if (!eds || eds.length === 0) continue;
    const k = counter.get(i.transformation_id) ?? 0;
    counter.set(i.transformation_id, k + 1);
    const u = eds[k % eds.length];
    if (!owned.has(u.session.userId)) owned.set(u.session.userId, []);
    owned.get(u.session.userId).push(i.id);
  }
  const initiativesOf = new Map();
  const ownersOf = new Map();
  for (const i of d.initiatives) {
    if (!initiativesOf.has(i.transformation_id)) initiativesOf.set(i.transformation_id, []);
    initiativesOf.get(i.transformation_id).push(i.id);
    if (i.executive_owner_user_id) {
      if (!ownersOf.has(i.transformation_id)) ownersOf.set(i.transformation_id, new Set());
      ownersOf.get(i.transformation_id).add(i.executive_owner_user_id);
    }
  }
  const workstreamsOf = new Map();
  for (const w of d.workstreams) {
    if (!workstreamsOf.has(w.transformation_id)) workstreamsOf.set(w.transformation_id, []);
    workstreamsOf.get(w.transformation_id).push(w.id);
  }
  // The export start uses the `registers` output (CSV, one register per export, ADR-0045 §1) of a transformation.
  const exportDef = d.reportDefs.find((r) => r.code === "registers" && (r.formats ?? []).includes("csv"));
  return [...byUser.values()]
    .sort((a, b) => a.index - b.index)
    .map((u) => ({
      index: u.index,
      userId: u.session.userId,
      roles: u.session.roles,
      transformations: u.transformations,
      initiatives: u.transformations.flatMap((t) => (initiativesOf.get(t) ?? []).map((id) => ({ t, id }))),
      owners: u.transformations.flatMap((t) => [...(ownersOf.get(t) ?? [])].map((o) => ({ t, o }))),
      workstreams: u.transformations.flatMap((t) => (workstreamsOf.get(t) ?? []).map((id) => ({ t, id }))),
      ownUpdates: (owned.get(u.session.userId) ?? []).map((id) => ({ id, etag: null })),
      exportTargets: exportDef ? [...u.exportable] : [],
      exportDefinition: exportDef?.code ?? null,
      organizationId: d.transformations[0]?.organization_id ?? null,
    }));
}

// ------------------------------------------------------------------------------------------------------------ requests

// A browser sends Origin on every state-changing request; the API's CSRF check requires it to equal APP_BASE_URL's
// origin (taken from the sessions file, which records the API's own configuration).
let appOrigin = null;
function headersFor(session, extra = {}) {
  return { cookie: session.cookie, accept: "application/json", "accept-language": "en", ...extra };
}

async function call(base, session, method, path, { body, ifMatch, idempotencyKey } = {}) {
  const h = headersFor(session);
  if (method !== "GET") {
    h["x-csrf-token"] = session.csrfToken;
    if (appOrigin) h.origin = appOrigin;
  }
  if (body !== undefined) h["content-type"] = "application/json";
  if (ifMatch !== undefined) h["if-match"] = ifMatch;
  if (idempotencyKey !== undefined) h["idempotency-key"] = idempotencyKey;
  const res = await fetch(base + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, etag: res.headers.get("etag"), buf };
}

const jsonOf = (buf) => {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
};

/** Setup per user through the API (unmeasured): ETags of own initiatives, one saved view, one form draft. */
async function setupUser(base, u, session, repetition) {
  const out = { savedView: null, draft: null, initiativesWithEtag: 0, setupStatuses: {} };
  const note = (k, s) => (out.setupStatuses[k] = [...(out.setupStatuses[k] ?? []), s]);
  for (const o of u.ownUpdates) {
    const r = await call(base, session, "GET", `/api/v1/initiatives/${o.id}`);
    note("getInitiative", r.status);
    if (r.status === 200) {
      o.etag = r.etag;
      out.initiativesWithEtag++;
    }
  }
  u.ownUpdates = u.ownUpdates.filter((o) => o.etag);
  // One view per user and repetition: a name is unique per owner (saved_view.name_taken), so a later repetition on
  // the same database creates its own.
  const viewName = `LOAD view u${u.index} r${repetition}`;
  const sv = await call(base, session, "POST", "/api/v1/saved-views", {
    body: { listKey: "initiatives", name: viewName, columns: ["code", "name"], filters: {}, sort: [] },
  });
  note("createSavedView", sv.status);
  if (sv.status === 201 || sv.status === 200) out.savedView = { id: jsonOf(sv.buf)?.id, etag: sv.etag, name: viewName };
  const t = u.transformations[0];
  if (t) {
    const dr = await call(base, session, "POST", `/api/v1/transformations/${t}/form-drafts`, {
      body: { recordType: "T05", payload: { name: `LOAD draft u${u.index}` } },
    });
    note("createFormDraft", dr.status);
    if (dr.status === 201 || dr.status === 200) out.draft = { t, id: jsonOf(dr.buf)?.id, etag: dr.etag };
  }
  return out;
}

/** The operations a user can send, per class. */
export function operationsFor(u, st) {
  const ops = {
    read: ["getMe", "getMyNavigation", "listTransformations", "listMyWorkItems", "listSavedViews"],
    update: [],
    search: ["searchRecords"],
    dashboard: ["getExecutiveOverview", "getFinanceDashboard", "getMyWork"],
    export: [],
  };
  if (u.transformations.length > 0) {
    ops.read.push("getTransformation", "listInitiatives");
    ops.dashboard.push("getTransformationDashboard");
  }
  if (u.initiatives.length > 0) ops.read.push("getInitiative", "listFormRecordVersions");
  if (u.workstreams.length > 0) ops.dashboard.push("getWorkstreamDashboard");
  if (u.ownUpdates.length > 0) ops.update.push("updateInitiative");
  if (st.savedView?.id) ops.update.push("putSavedView");
  if (st.draft?.id) ops.update.push("updateFormDraft");
  if (u.exportTargets.length > 0 && u.exportDefinition) ops.export.push("createExport");
  return ops;
}

/** Builds one request of `op` for user `u` (state `st`), advancing the user's deterministic counters. */
function buildRequest(op, u, st, rng, ctx) {
  const k = st.k++;
  switch (op) {
    case "getMe":
      return { method: "GET", path: "/api/v1/me" };
    case "getMyNavigation":
      return { method: "GET", path: "/api/v1/me/navigation" };
    case "listTransformations":
      return {
        method: "GET",
        path: `/api/v1/transformations?sort=${pick(rng, ["code", "-code", "updatedAt", "-updatedAt"])}`,
      };
    case "getTransformation":
      return { method: "GET", path: `/api/v1/transformations/${pick(rng, u.transformations)}` };
    case "listInitiatives": {
      if (st.cursor) {
        const p = `${st.cursor.base}&cursor=${encodeURIComponent(st.cursor.next)}`;
        return { method: "GET", path: p, paging: st.cursor.base };
      }
      const t = pick(rng, u.transformations);
      const v = rng() % 3;
      let base = `/api/v1/initiatives?transformationId=${t}&limit=50`;
      if (v === 0)
        base += `&sort=${pick(rng, ["code", "-code", "name", "-name", "plannedEnd", "-plannedEnd", "updatedAt", "-updatedAt"])}`;
      else if (v === 1) base += `&q=${encodeURIComponent(pick(rng, ctx.terms))}`;
      else {
        const owners = u.owners.filter((o) => o.t === t);
        if (owners.length > 0) base += `&executiveOwnerUserId=${pick(rng, owners).o}`;
        else base += "&sort=code";
      }
      return { method: "GET", path: base, paging: base };
    }
    case "getInitiative":
      return { method: "GET", path: `/api/v1/initiatives/${pick(rng, u.initiatives).id}` };
    case "listFormRecordVersions": {
      const i = pick(rng, u.initiatives);
      return { method: "GET", path: `/api/v1/transformations/${i.t}/form-records/T05/${i.id}/versions` };
    }
    case "listMyWorkItems":
      return { method: "GET", path: "/api/v1/me/work-items" };
    case "listSavedViews":
      return { method: "GET", path: "/api/v1/saved-views?listKey=initiatives" };
    case "updateInitiative": {
      const o = pick(rng, u.ownUpdates);
      return {
        method: "PATCH",
        path: `/api/v1/initiatives/${o.id}`,
        body: { risksSummary: `LOAD risks summary r${ctx.repetition} u${u.index} n${k}` },
        ifMatch: o.etag,
        onEtag: (e) => (o.etag = e),
        refetch: `/api/v1/initiatives/${o.id}`,
      };
    }
    case "putSavedView": {
      const asc = k % 2 === 0;
      return {
        method: "PUT",
        path: `/api/v1/saved-views/${st.savedView.id}`,
        body: {
          name: st.savedView.name,
          columns: asc ? ["code", "name"] : ["code", "name", "plannedEnd"],
          filters: {},
          sort: [{ key: "code", direction: asc ? "asc" : "desc" }],
          isDefault: false,
        },
        ifMatch: st.savedView.etag,
        onEtag: (e) => (st.savedView.etag = e),
        refetch: `/api/v1/saved-views/${st.savedView.id}`,
      };
    }
    case "updateFormDraft":
      return {
        method: "PUT",
        path: `/api/v1/transformations/${st.draft.t}/form-drafts/${st.draft.id}`,
        body: { payload: { name: `LOAD draft u${u.index} n${k}` } },
        ifMatch: st.draft.etag,
        onEtag: (e) => (st.draft.etag = e),
        refetch: `/api/v1/transformations/${st.draft.t}/form-drafts/${st.draft.id}`,
      };
    case "searchRecords":
      return { method: "GET", path: `/api/v1/search?q=${encodeURIComponent(pick(rng, ctx.terms))}&limit=20` };
    case "getExecutiveOverview":
      return { method: "GET", path: `/api/v1/overview?organizationId=${u.organizationId}` };
    case "getTransformationDashboard":
      return { method: "GET", path: `/api/v1/transformations/${pick(rng, u.transformations)}/dashboard` };
    case "getWorkstreamDashboard": {
      const w = pick(rng, u.workstreams);
      return { method: "GET", path: `/api/v1/transformations/${w.t}/workstreams/${w.id}/dashboard` };
    }
    case "getFinanceDashboard":
      return { method: "GET", path: `/api/v1/dashboards/finance?organizationId=${u.organizationId}` };
    case "getMyWork":
      return { method: "GET", path: "/api/v1/me/work" };
    case "createExport":
      return {
        method: "POST",
        path: "/api/v1/exports",
        body: {
          format: "csv",
          language: "en",
          report: {
            definitionCode: u.exportDefinition,
            subjectId: pick(rng, u.exportTargets),
            parameters: { register: pick(rng, EXPORT_REGISTERS) },
          },
        },
        idempotencyKey: `mth-load-r${ctx.repetition}-u${u.index}-n${k}`,
      };
    default:
      throw new Error(`unknown operation ${op}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs one virtual user until `endAt` (performance.now() ms). Pushes sample rows into `samples`. */
async function runUser(base, u, session, st, ctx, samples) {
  const rng = userRng(ctx.seed, ctx.repetition, u.index);
  const ops = operationsFor(u, st);
  if (ctx.only) for (const c of Object.keys(ops)) ops[c] = ops[c].filter((op) => ctx.only.includes(op));
  const available = new Set(
    Object.entries(ops)
      .filter(([, l]) => l.length > 0)
      .map(([c]) => c),
  );
  // Stagger the start deterministically over the first think interval.
  await sleep(rng() % 3000);
  while (performance.now() < ctx.endAt) {
    const cls = pickClass(rng, available);
    const op = pick(rng, ops[cls]);
    const req = buildRequest(op, u, st, rng, ctx);
    const startedAt = performance.now();
    const phase = startedAt < ctx.steadyAt ? "warmup" : "steady";
    let status = 0;
    let etag = null;
    let buf = null;
    let t1;
    try {
      const r = await call(base, session, req.method, req.path, req);
      t1 = performance.now();
      status = r.status;
      etag = r.etag;
      buf = r.buf;
    } catch {
      t1 = performance.now();
      status = 0;
    }
    const outcome = isSuccess(op, status) ? "ok" : status === 409 && cls === "update" ? "conflict" : "error";
    samples.push(`${phase},${u.index},${cls},${op},${status},${outcome},${micros(startedAt, t1)}`);
    if (outcome === "ok" && req.onEtag && etag) req.onEtag(etag);
    if (op === "listInitiatives" && outcome === "ok") {
      const next = jsonOf(buf)?.nextCursor;
      st.cursor = next ? { base: req.paging, next } : null;
    } else if (op === "listInitiatives") st.cursor = null;
    if (outcome === "conflict" && req.refetch) {
      const r = await call(base, session, "GET", req.refetch).catch(() => null); // outside the measurement
      if (r?.status === 200 && r.etag) req.onEtag(r.etag);
    }
    await sleep(thinkMs(rng));
  }
}

/** Samples the machine load average every `everyMs` until stopped. */
function sampleLoad(rows, t0, everyMs = 5000) {
  const take = () => {
    const [a, b, c] = loadavg();
    rows.push(
      `${new Date().toISOString()},${Math.round(performance.now() - t0)},${a.toFixed(2)},${b.toFixed(2)},${c.toFixed(2)}`,
    );
  };
  take();
  const timer = setInterval(take, everyMs);
  return () => {
    clearInterval(timer);
    take();
  };
}

export async function runWorkload(opts) {
  const sessionsFile = JSON.parse(readFileSync(opts.sessions, "utf8"));
  const sessions = sessionsFile.sessions.slice(0, opts.users);
  appOrigin = sessionsFile.appBaseUrl ?? null;
  if (sessions.length < opts.users)
    throw new Error(`mth-load workload: the sessions file holds ${sessions.length} sessions, ${opts.users} requested`);
  const d = await discoverTargets(opts.dbUrl, sessions);
  const plan = buildPlan(sessions, d);
  const terms = searchTerms(d.names);
  if (terms.length === 0) throw new Error("mth-load workload: no search term could be drawn from the generated titles");
  const states = [];
  const setupStarted = new Date().toISOString();
  for (const u of plan) {
    const st = { k: 0, cursor: null, ...(await setupUser(opts.baseUrl, u, sessions[u.index], opts.repetition)) };
    states.push(st);
  }
  const setupSummary = {
    note: "Setup of the load run (unmeasured). No credentials are written here.",
    workloadVersion: WORKLOAD_VERSION,
    datasetMarker: d.marker,
    setupStarted,
    setupEnded: new Date().toISOString(),
    users: plan.length,
    searchTerms: terms.length,
    exportDefinition: plan[0]?.exportDefinition ?? null,
    perUser: plan.map((u, i) => ({
      index: u.index,
      roles: u.roles,
      transformations: u.transformations.length,
      readableInitiatives: u.initiatives.length,
      ownUpdateInitiatives: u.ownUpdates.length,
      workstreams: u.workstreams.length,
      exportTargets: u.exportTargets.length,
      savedView: Boolean(states[i].savedView?.id),
      formDraft: Boolean(states[i].draft?.id),
      operations: operationsFor(u, states[i]),
      setupStatuses: states[i].setupStatuses,
    })),
  };
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(join(opts.out, "setup.json"), `${JSON.stringify(setupSummary, null, 2)}\n`);

  const samples = [];
  const loadRows = [];
  const t0 = performance.now();
  const ctx = {
    seed: opts.seed,
    repetition: opts.repetition,
    only: opts.only ?? null,
    terms,
    steadyAt: t0 + opts.warmupS * 1000,
    endAt: t0 + (opts.warmupS + opts.steadyS) * 1000,
  };
  const startedIso = new Date().toISOString();
  const stopLoad = sampleLoad(loadRows, t0);
  await Promise.all(plan.map((u, i) => runUser(opts.baseUrl, u, sessions[u.index], states[i], ctx, samples)));
  stopLoad();
  const endedIso = new Date().toISOString();
  const steady = samples.filter((s) => s.startsWith("steady,"));
  const run = {
    workloadVersion: WORKLOAD_VERSION,
    repetition: opts.repetition,
    only: opts.only ?? null,
    seed: opts.seed,
    users: plan.length,
    baseUrl: opts.baseUrl,
    warmupSeconds: opts.warmupS,
    steadySeconds: opts.steadyS,
    started: startedIso,
    ended: endedIso,
    wallSeconds: Math.round(performance.now() - t0) / 1000,
    requestsTotal: samples.length,
    requestsSteady: steady.length,
    requestsWarmup: samples.length - steady.length,
  };
  writeFileSync(join(opts.out, "run.json"), `${JSON.stringify(run, null, 2)}\n`);
  writeFileSync(
    join(opts.out, "samples.csv.gz"),
    gzipSync(`phase,user,class,operation,status,outcome,micros\n${samples.join("\n")}\n`, { level: 9 }),
  );
  writeFileSync(join(opts.out, "loadavg.csv"), `time,elapsedMs,load1,load5,load15\n${loadRows.join("\n")}\n`);
  return run;
}

async function main() {
  const { values } = parseArgs({
    options: {
      sessions: { type: "string" },
      "base-url": { type: "string" },
      out: { type: "string" },
      "warmup-s": { type: "string", default: "120" },
      "steady-s": { type: "string", default: "600" },
      seed: { type: "string", default: String(DEFAULT_SEED) },
      repetition: { type: "string", default: "1" },
      users: { type: "string", default: "100" },
      only: { type: "string" },
    },
    strict: true,
  });
  const dbUrl = process.env.MTH_LOAD_DB_URL;
  if (!values.sessions || !values["base-url"] || !values.out || !dbUrl) {
    console.error("mth-load workload: --sessions, --base-url, --out and MTH_LOAD_DB_URL are required");
    return 64;
  }
  const int = (v, name) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} must be a non-negative integer`);
    return n;
  };
  const run = await runWorkload({
    sessions: values.sessions,
    baseUrl: values["base-url"].replace(/\/$/, ""),
    out: resolve(values.out),
    warmupS: int(values["warmup-s"], "warmup-s"),
    steadyS: int(values["steady-s"], "steady-s"),
    seed: int(values.seed, "seed"),
    repetition: int(values.repetition, "repetition"),
    users: int(values.users, "users"),
    only: values.only ? values.only.split(",") : null,
    dbUrl,
  });
  console.log(
    `mth-load workload: repetition ${run.repetition}: ${run.requestsSteady} steady-state request(s) ` +
      `(${run.requestsWarmup} warm-up, excluded) from ${run.users} virtual users in ${run.wallSeconds} s`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`mth-load workload: failed: ${err?.stack ?? err}`);
      process.exit(1);
    },
  );
}
