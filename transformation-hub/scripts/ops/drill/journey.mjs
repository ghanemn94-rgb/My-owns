#!/usr/bin/env node
// =====================================================================================================================
// Fresh-install drill — user journey and checks (driven by scripts/ops/fresh-install-drill.sh; DRILL ONLY).
//
//   node journey.mjs install   <config.json> <state.json>   checks right after migrate + production bootstrap
//   node journey.mjs run       <config.json> <state.json>   private mode, AI Off, egress blocked: users, two projects,
//                                                           documents (stored files), evidence accepted by a second
//                                                           person, a PDF export rendered by the worker's browser,
//                                                           two-project isolation; waits until the worker is idle
//   node journey.mjs inflight  <config.json> <state.json>   with the worker STOPPED: queue work that must not be
//                                                           redelivered blindly after a restore (export job, outbox)
//   node journey.mjs verify    <config.json> <state.json>   against the RESTORED database: sessions revoked, data,
//                                                           files, permissions, approval evidence, audit chain,
//                                                           isolation; no completed job re-run, held work stays held
//   node journey.mjs released  <config.json> <state.json>   after `restore.sh --release-held` of the reviewed job:
//                                                           it runs exactly once
//
// Every call goes through the HTTPS ingress stand-in (custom CA trusted via NODE_EXTRA_CA_CERTS) to the real API;
// users sign in through the OIDC stand-in with the API's real openid-client path. All data is synthetic ("DRILL").
// Output: one PASS/FAIL line per check; exit status 1 when any check fails.
// =====================================================================================================================
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(resolve(ROOT, 'apps/api/package.json'));
const { Pool } = require('pg');

const [phase, cfgFile, stateFile] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(cfgFile, 'utf8'));
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {};
const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(64)} ${detail}\n`);
  return ok;
}
function info(m) {
  process.stdout.write(`INFO  ${m}\n`);
}

// ------------------------------------------------------------------------------------------------------------- client
class Client {
  constructor(name, jar = {}) {
    this.name = name;
    this.jar = new Map(Object.entries(jar));
    this.csrf = null;
    this.userId = null;
  }
  store(res) {
    for (const c of res.headers.getSetCookie()) {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      const k = kv.slice(0, i).trim();
      const v = kv.slice(i + 1).trim();
      if (!v || /max-age=0|expires=thu, 01 jan 1970/i.test(c)) this.jar.delete(k);
      else this.jar.set(k, v);
    }
  }
  async req(method, path, { json, body, headers = {} } = {}) {
    const h = { ...headers, cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') };
    if (method !== 'GET' && this.csrf) h['x-csrf-token'] = this.csrf;
    if (json !== undefined) {
      h['content-type'] = 'application/json';
      body = JSON.stringify(json);
    }
    const res = await fetch(new URL(path, cfg.ingress), { method, headers: h, body, redirect: 'manual' });
    this.store(res);
    const bytes = Buffer.from(await res.arrayBuffer());
    let data = null;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        data = JSON.parse(bytes.toString('utf8'));
      } catch {
        data = null;
      }
    }
    return { status: res.status, headers: res.headers, body: data, bytes };
  }
  get = (p) => this.req('GET', p);
  post = (p, json) => this.req('POST', p, { json });
}

async function must(label, p, status) {
  const r = await p;
  if (r.status !== status) throw new Error(`${label}: expected ${status}, got ${r.status} ${JSON.stringify(r.body ?? r.bytes.toString('utf8').slice(0, 300))}`);
  return r;
}

/** Browser round trip through the OIDC stand-in: app login → IdP authorize (auto-consent as `user`) → app callback. */
async function sso(name, user) {
  const c = new Client(name);
  await fetch(`${cfg.idp}/__drill/next-user`, { method: 'POST', body: JSON.stringify(user) });
  const start = await c.get('/api/v1/auth/oidc/login');
  if (start.status !== 302) throw new Error(`${name}: oidc login → ${start.status} ${start.bytes.toString().slice(0, 200)}`);
  const idpRes = await fetch(start.headers.get('location'), { redirect: 'manual' });
  if (idpRes.status !== 302) throw new Error(`${name}: IdP authorize → ${idpRes.status}`);
  const back = new URL(idpRes.headers.get('location'));
  const cb = await c.get(`${back.pathname}${back.search}`);
  if (cb.status !== 302 || cb.headers.get('location') !== '/') throw new Error(`${name}: callback → ${cb.status} ${cb.headers.get('location')}`);
  const me = await must(`${name} me`, c.get('/api/v1/me'), 200);
  c.csrf = me.body.csrfToken;
  c.userId = me.body.user.id;
  c.me = me.body;
  return c;
}

const db = (url) => new Pool({ connectionString: url, max: 2 });
async function one(pool, text, params = []) {
  return (await pool.query(text, params)).rows[0];
}

// ----------------------------------------------------------------------------------------------------- shared checks
async function isolationChecks(label, a, b, A, B) {
  // a: member of A only; b: member of B only.
  for (const [c, own, other, ownName, otherName] of [
    [a, A, B, 'A', 'B'],
    [b, B, A, 'B', 'A'],
  ]) {
    const list = await must(`${c.name} projects`, c.get('/api/v1/projects?pageSize=100'), 200);
    const ids = list.body.items.map((p) => p.id);
    check(`${label}: ${c.name} lists only project ${ownName}`, list.body.total === 1 && ids[0] === own.id, `total=${list.body.total}`);
    const s1 = (await c.get(`/api/v1/projects/${other.id}`)).status;
    const s2 = (await c.get(`/api/v1/projects/${other.id}/documents`)).status;
    const s3 = (await c.get(`/api/v1/projects/${other.id}/documents/${other.docId}/versions/${other.versionId}/download`)).status;
    const s4 = (await c.get(`/api/v1/projects/${other.id}/tasks?pageSize=1`)).status;
    check(`${label}: ${c.name} → project ${otherName} (detail, documents, file, tasks) = 404`, [s1, s2, s3, s4].every((s) => s === 404), `${s1}/${s2}/${s3}/${s4}`);
    const search = await c.get(`/api/v1/projects/${own.id}/documents/search?q=${encodeURIComponent(other.marker)}`);
    check(`${label}: ${c.name} search in ${ownName} finds nothing of ${otherName}`, search.status === 200 && search.body.total === 0, `status=${search.status} total=${search.body?.total}`);
    const cross = await c.post(`/api/v1/projects/${own.id}/evidence`, { targetType: 'task', targetId: own.taskId, documentId: other.docId });
    check(`${label}: ${c.name} cannot link ${otherName}'s document as evidence in ${ownName}`, [404, 422].includes(cross.status), `status=${cross.status} ${cross.body?.code ?? ''}`);
  }
}

async function aiOffChecks(label, c, P) {
  const st = await c.get(`/api/v1/projects/${P.id}/ai/status`);
  check(`${label}: AI status of ${P.code} is off (no provider)`, st.status === 200 && st.body.mode === 'off' && st.body.health === 'off', `status=${st.status} mode=${st.body?.mode} provider=${st.body?.provider} health=${st.body?.health}`);
  const ask = await c.post(`/api/v1/projects/${P.id}/ai/ask`, { question: 'DRILL: what is overdue?' });
  check(`${label}: AI ask refused while AI is off`, ask.status === 422 && ask.body?.code === 'ai.disabled', `status=${ask.status} code=${ask.body?.code}`);
  const det = await c.get(`/api/v1/projects/${P.id}/ai/detections`);
  check(`${label}: deterministic detections still work with AI off`, det.status === 200, `status=${det.status}`);
}

/**
 * A user's browser in the same egress-blocked namespace (REQ-DEP-014 "browser network log shows no external requests"):
 * SSO sign-in through the IdP stand-in, then the home page, a project cockpit and its documents. Every request the page
 * made is recorded; fonts must load from the application itself; the nonce-based CSP must not block anything the app
 * needs (no violation reported) and the app must hydrate (the user menu renders). The browser trusts the throwaway CA
 * by `ignoreHTTPSErrors` — a property of this test browser only, not of the application.
 */
async function browserCheck(label, P, user) {
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ executablePath: cfg.chromium, headless: true });
  const allowed = new Set([new URL(cfg.ingress).origin, new URL(cfg.idp).origin]);
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ar-SA' });
    await ctx.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI} at ${e.sourceFile}:${e.lineNumber}:${e.columnNumber} ${e.sample ?? ''}`));
    });
    const page = await ctx.newPage();
    const requests = [];
    const problems = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' && /CSP violation|Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
    });
    await fetch(`${cfg.idp}/__drill/next-user`, { method: 'POST', body: JSON.stringify(user) });
    await page.goto(`${cfg.ingress}/api/v1/auth/oidc/login`);
    await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 30_000 });
    await page.getByTestId('user-menu').waitFor({ timeout: 30_000 });
    const pages = ['/', `/projects/${P.id}`, `/projects/${P.id}/documents`];
    let csp = '';
    for (const path of pages) {
      const res = await page.goto(`${cfg.ingress}${path}`, { waitUntil: 'networkidle' });
      csp = res?.headers()['content-security-policy'] ?? '';
      await page.getByTestId('user-menu').waitFor({ timeout: 30_000 });
    }
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    });
    const outside = [...new Set(requests.map((u) => new URL(u).origin))].filter((o) => !allowed.has(o) && !o.startsWith('data:') && o !== 'null');
    check(`${label}: browser — every request stays on the application or the IdP`, outside.length === 0, `${requests.length} requests over ${pages.length} pages + SSO; outside=[${outside.join(' ')}]`);
    const fontReqs = requests.filter((u) => /\.woff2?(\?|$)/.test(u));
    check(`${label}: browser — fonts served by the application itself`, fonts.some((f) => /IBM Plex Sans/.test(f)) && fontReqs.every((u) => new URL(u).origin === new URL(cfg.ingress).origin), `loaded=[${[...new Set(fonts)].join(', ')}] font files=${fontReqs.length}`);
    const script = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
    check(`${label}: browser — nonce CSP, no inline-script allowance, nothing blocked`, /'nonce-[A-Za-z0-9+/=]+'/.test(script) && !script.includes("'unsafe-inline'") && problems.length === 0, `script-src=${script.replace(/'nonce-[^']+'/, "'nonce-…'")} problems=${problems.length ? problems.slice(0, 3).join(' | ') : 0}`);
  } finally {
    await browser.close();
  }
}

async function waitIdle(owner, timeoutMs = 120_000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await one(owner, `select (select count(*)::int from outbox_event where dispatched_at is null) as outbox,
                                    (select count(*)::int from job where status in ('queued','running') and run_at <= now() and kind not like 'platform.%') as jobs`);
    if (last.outbox === 0 && last.jobs === 0) return { ok: true, ms: Date.now() - t0 };
    await sleep(1000);
  }
  return { ok: false, last };
}

async function pollExport(c, P, exportId, timeoutMs = 120_000) {
  const t0 = Date.now();
  for (;;) {
    const st = await must('export status', c.get(`/api/v1/projects/${P.id}/report-exports/${exportId}`), 200);
    if (['ready', 'failed'].includes(st.body.status) || Date.now() - t0 > timeoutMs) return st.body;
    await sleep(1000);
  }
}

const jobsSnapshot = (owner) =>
  owner.query(`select id, kind, status, attempts, coalesce(finished_at::text, '') as finished_at from job order by id`).then((r) => r.rows);

// ============================================================================================================ phases
async function install() {
  const owner = db(cfg.ownerUrl);
  try {
    const r = await one(
      owner,
      `select (select count(*)::int from organization) orgs, (select slug from organization limit 1) slug,
              (select count(*)::int from project) projects, (select count(*)::int from app_user) users,
              (select count(*)::int from app_user where is_demo) demo_users, (select count(*)::int from app_user where oidc_subject is not null) bound,
              (select count(*)::int from project_template_version where status = 'published') templates,
              (select count(*)::int from scheduled_job where kind like 'platform.%') schedules,
              (select count(*)::int from drizzle.__drizzle_migrations) migrations`,
    );
    check('install: one organization, from the bootstrap environment', r.orgs === 1 && r.slug === cfg.orgSlug, `orgs=${r.orgs} slug=${r.slug}`);
    check('install: no demo data, no project, one IdP-bound administrator', r.projects === 0 && r.demo_users === 0 && r.users === 1 && r.bound === 1, `projects=${r.projects} users=${r.users} demo=${r.demo_users} bound=${r.bound}`);
    check('install: templates published, platform schedules, migrations applied', r.templates >= 2 && r.schedules >= 2 && r.migrations >= 1, `templates=${r.templates} schedules=${r.schedules} migrations=${r.migrations}`);
    const roles = await one(owner, `select string_agg(rolname || ':' || rolsuper || ':' || rolbypassrls, ' ' order by rolname) s from pg_roles where rolname in ('hub_owner','hub_app')`);
    check('install: runtime role NOSUPERUSER NOBYPASSRLS', /hub_app:false:false/.test(roles.s), roles.s);
  } finally {
    await owner.end();
  }
}

async function run() {
  const owner = db(cfg.ownerUrl);
  const t0 = Date.now();
  try {
    const conf = await must('auth config', new Client('anon').get('/api/v1/auth/config'), 200);
    check('run: production configuration (no demo login, OIDC configured)', conf.body.demoLogin === false && conf.body.oidc.status !== 'not_configured', JSON.stringify(conf.body));

    const admin = await sso('admin', { sub: cfg.admin.sub, email: cfg.admin.email });
    check('run: first administrator signs in through the IdP (TLS with the custom CA)', admin.me.orgRoles.includes('platform_admin') && admin.me.orgRoles.includes('portfolio_admin') && admin.me.mode.authMethod === 'oidc', `roles=${admin.me.orgRoles.join(',')} auth=${admin.me.mode.authMethod}`);
    const none = await must('projects', admin.get('/api/v1/projects?pageSize=100'), 200);
    check('run: fresh installation has no project (no demo sandbox)', none.body.total === 0, `total=${none.body.total}`);

    const tag = randomBytes(3).toString('hex');
    const people = {
      pmA: { email: `drill.pm.a.${tag}@example.invalid`, displayName: 'DRILL PM A (synthetic)' },
      apprA: { email: `drill.approver.a.${tag}@example.invalid`, displayName: 'DRILL Approver A (synthetic)' },
      pmB: { email: `drill.pm.b.${tag}@example.invalid`, displayName: 'DRILL PM B (synthetic)' },
    };
    for (const p of Object.values(people)) {
      const u = await must('create user', admin.post('/api/v1/admin/users', { ...p }), 201);
      p.id = u.body.id;
      p.sub = `drill-sub-${randomBytes(6).toString('hex')}`;
    }
    const templates = (await must('templates', admin.get('/api/v1/templates'), 200)).body.items;
    const dcT = templates.find((t) => t.templateKey === 'dc-carveout');
    const genT = templates.find((t) => t.templateKey === 'general-transformation');
    const A = { code: `DRILL-A-${tag.toUpperCase()}`, marker: `DRILLMARKA${tag}` };
    const B = { code: `DRILL-B-${tag.toUpperCase()}`, marker: `DRILLMARKB${tag}` };
    A.id = (await must('create A', admin.post('/api/v1/projects', { templateVersionId: dcT.id, code: A.code, name: 'DRILL project A (synthetic)', projectManagerUserId: people.pmA.id, classification: 'internal' }), 201)).body.id;
    B.id = (await must('create B', admin.post('/api/v1/projects', { templateVersionId: genT.id, code: B.code, name: 'DRILL project B (synthetic)', projectManagerUserId: people.pmB.id, classification: 'internal' }), 201)).body.id;
    check('run: two projects created from published templates', !!A.id && !!B.id, `${A.code} ${B.code}`);
    const adminSees = (await admin.get(`/api/v1/projects/${A.id}/documents`)).status;
    check('run: the platform administrator has no project content access', adminSees === 404 || adminSees === 403, `status=${adminSees}`);

    const pmA = await sso('pmA', { sub: people.pmA.sub, email: people.pmA.email });
    const apprA = await sso('apprA', { sub: people.apprA.sub, email: people.apprA.email });
    const pmB = await sso('pmB', { sub: people.pmB.sub, email: people.pmB.email });
    check('run: pre-provisioned users bind their IdP identity at first login (verified email)', [pmA, apprA, pmB].every((c) => c.me.mode.authMethod === 'oidc'), 'pmA, apprA, pmB');
    await must('grant approver', pmA.post(`/api/v1/projects/${A.id}/members`, { userId: people.apprA.id, role: 'functional_approver', reason: 'DRILL: second person for evidence review' }), 201);

    for (const [c, P, name] of [
      [pmA, A, 'A'],
      [pmB, B, 'B'],
    ]) {
      const tasks = await must('tasks', c.get(`/api/v1/projects/${P.id}/tasks?pageSize=1`), 200);
      P.taskId = tasks.body.items[0]?.id;
      const content = Buffer.from(`DRILL — SYNTHETIC CONTENT. Project ${name} working paper ${P.marker}. ${randomBytes(24).toString('hex')}\n`, 'utf8');
      P.docId = (await must('create document', c.post(`/api/v1/projects/${P.id}/documents`, { title: `DRILL working paper ${P.marker}`, kind: 'evidence', classification: 'internal' }), 201)).body.id;
      const up = await must(
        'upload version',
        c.req('POST', `/api/v1/projects/${P.id}/documents/${P.docId}/versions`, { body: content, headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(`drill-${name}.txt`), 'x-file-type': 'txt' } }),
        201,
      );
      P.versionId = up.body.versionId;
      P.fileSha256 = sha256(content);
      check(`run: file stored in project ${name} (S3 stand-in, SHA-256 recorded = uploaded bytes)`, up.body.sha256 === P.fileSha256, `${up.body.sha256.slice(0, 16)}… ${up.body.sizeBytes} B scan=${up.body.scanStatus ?? '?'}`);
    }

    // Approval evidence: PM A links the file to a task; a SECOND person accepts it.
    const link = await must('link evidence', pmA.post(`/api/v1/projects/${A.id}/evidence`, { targetType: 'task', targetId: A.taskId, documentVersionId: A.versionId, purpose: 'DRILL evidence' }), 201);
    A.linkId = link.body.id;
    const links = await must('evidence list', apprA.get(`/api/v1/projects/${A.id}/evidence?targetType=task&targetId=${A.taskId}`), 200);
    const l = links.body.items.find((x) => x.id === A.linkId);
    const ver = await must('verify evidence', apprA.post(`/api/v1/projects/${A.id}/evidence/${A.linkId}/verify`, { expectedVersion: l.version, decision: 'accept', note: 'DRILL: checked against the file' }), 201);
    const self = await pmA.post(`/api/v1/projects/${A.id}/evidence/${A.linkId}/verify`, { expectedVersion: ver.body.version, decision: 'accept' });
    check('run: evidence accepted by a second person; the linker cannot review it', ver.body.status === 'active' && [403, 409, 422].includes(self.status), `review=${ver.body.status} self=${self.status}`);

    // Report → PDF rendered by the worker's offline browser (Chromium inside the egress-blocked namespace).
    const snap = await must('generate report', pmA.post(`/api/v1/projects/${A.id}/report-snapshots`, { kind: 'executive_summary' }), 201);
    A.snapshotId = snap.body.id;
    const ex = await must('request export', pmA.post(`/api/v1/projects/${A.id}/report-snapshots/${A.snapshotId}/exports`, { format: 'pdf', locale: 'ar' }), 201);
    const st = await pollExport(pmA, A, ex.body.id);
    const dl = await pmA.get(`/api/v1/projects/${A.id}/report-exports/${ex.body.id}/download`);
    A.exportId = ex.body.id;
    A.exportSha256 = st.sha256;
    check('run: PDF export rendered by the worker (offline browser), stored and downloaded', st.status === 'ready' && dl.status === 200 && dl.bytes.subarray(0, 5).toString('latin1') === '%PDF-' && sha256(dl.bytes) === st.sha256, `status=${st.status} ${dl.bytes.length} B`);

    await isolationChecks('run', pmA, pmB, A, B);
    await aiOffChecks('run', pmA, A);
    if (cfg.chromium) await browserCheck('run', A, { sub: people.pmA.sub, email: people.pmA.email });

    const idle = await waitIdle(owner);
    check('run: worker drained the outbox and the job queue', idle.ok, idle.ok ? `${idle.ms} ms` : JSON.stringify(idle.last));
    Object.assign(state, {
      tag,
      people,
      A,
      B,
      jars: { pmA: Object.fromEntries(pmA.jar), pmB: Object.fromEntries(pmB.jar) },
      completedJobs: await jobsSnapshot(owner),
      counts: await one(owner, `select (select count(*)::int from audit_event) audit, (select count(*)::int from delivery_record) deliveries, (select count(*)::int from notification) notifications, (select count(*)::int from report_export where status = 'ready') exports_ready`),
    });
    info(`run phase: ${state.completedJobs.length} job rows (${state.completedJobs.filter((j) => j.status === 'succeeded').length} succeeded), ${state.counts.audit} audit rows, ${Date.now() - t0} ms`);
    save();
  } finally {
    await owner.end();
  }
}

async function inflight() {
  // The worker is stopped: these stay queued / undispatched in the backup.
  const owner = db(cfg.ownerUrl);
  try {
    const pmA = await sso('pmA', { sub: state.people.pmA.sub, email: state.people.pmA.email });
    const A = state.A;
    const ex = await must('request export (worker stopped)', pmA.post(`/api/v1/projects/${A.id}/report-snapshots/${A.snapshotId}/exports`, { format: 'pdf', locale: 'en' }), 201);
    state.heldExportId = ex.body.id;
    const note = await must('evidence note', pmA.post(`/api/v1/projects/${A.id}/evidence`, { targetType: 'task', targetId: A.taskId, note: 'DRILL: in-flight evidence note (outbox event pending at backup time)' }), 201);
    state.inflightLinkId = note.body.id;
    const r = await one(owner, `select (select count(*)::int from outbox_event where dispatched_at is null) outbox, (select count(*)::int from job where status = 'queued' and kind not like 'platform.%') queued, (select id from job where payload::text like '%' || $1 || '%' and kind not like 'platform.%' limit 1) export_job`, [state.heldExportId]);
    state.heldExportJobId = r.export_job;
    check('inflight: work pending at the backup point (queued export job, undispatched outbox)', r.queued >= 1 && r.outbox >= 1 && !!r.export_job, `queued=${r.queued} outbox=${r.outbox}`);
    state.backupPoint = {
      jobs: await jobsSnapshot(owner),
      counts: await one(owner, `select (select count(*)::int from delivery_record) deliveries, (select count(*)::int from notification) notifications`),
    };
    save();
  } finally {
    await owner.end();
  }
}

async function verify() {
  const owner = db(cfg.ownerUrl);
  try {
    const { A, B, people } = state;
    // Sessions from before the backup are revoked by the restore.
    const old = new Client('pmA-old-session', state.jars.pmA);
    const oldMe = await old.get('/api/v1/me');
    check('verify: sessions from before the restore are revoked (401)', oldMe.status === 401, `status=${oldMe.status}`);

    const admin = await sso('admin', { sub: cfg.admin.sub, email: cfg.admin.email });
    const pmA = await sso('pmA', { sub: people.pmA.sub, email: people.pmA.email });
    const apprA = await sso('apprA', { sub: people.apprA.sub, email: people.apprA.email });
    const pmB = await sso('pmB', { sub: people.pmB.sub, email: people.pmB.email });
    check('verify: every user signs in again through the IdP (identities preserved)', [admin, pmA, apprA, pmB].every((c) => !!c.userId), 'admin, pmA, apprA, pmB');

    // Permissions preserved.
    const accA = pmA.me.projects.find((p) => p.projectId === A.id);
    const accAppr = apprA.me.projects.find((p) => p.projectId === A.id);
    check('verify: permissions preserved (memberships and roles)', accA?.roles.includes('project_manager') && accAppr?.roles.includes('functional_approver') && !pmA.me.projects.some((p) => p.projectId === B.id), `pmA=${accA?.roles} apprA=${accAppr?.roles}`);
    check('verify: organization roles preserved', admin.me.orgRoles.includes('platform_admin'), admin.me.orgRoles.join(','));

    // Stored files restored byte for byte.
    for (const [c, P, name] of [
      [pmA, A, 'A'],
      [pmB, B, 'B'],
    ]) {
      const dl = await c.get(`/api/v1/projects/${P.id}/documents/${P.docId}/versions/${P.versionId}/download`);
      check(`verify: stored file of project ${name} restored (download SHA-256 = uploaded)`, dl.status === 200 && sha256(dl.bytes) === P.fileSha256, `status=${dl.status}`);
    }
    const pdf = await pmA.get(`/api/v1/projects/${A.id}/report-exports/${A.exportId}/download`);
    check('verify: exported PDF restored (download SHA-256 = before backup)', pdf.status === 200 && sha256(pdf.bytes) === A.exportSha256, `status=${pdf.status}`);

    // Approval evidence preserved.
    const links = await must('evidence list', pmA.get(`/api/v1/projects/${A.id}/evidence?targetType=task&targetId=${A.taskId}`), 200);
    const l = links.body.items.find((x) => x.id === A.linkId);
    check('verify: approval evidence preserved (link active, reviewed by the second person)', l?.status === 'active' && l?.reviewedBy === people.apprA.id && !!l?.reviewedAt, `status=${l?.status} reviewer=${l?.reviewedBy === people.apprA.id}`);

    // Audit history preserved and extended.
    const orgId = (await one(owner, 'select id from organization limit 1')).id;
    const breaks = await one(owner, 'select count(*)::int n from hub_audit_verify($1)', [orgId]);
    const head = await one(owner, 'select max(chain_pos)::int pos, count(*)::int n from audit_event where org_id = $1', [orgId]);
    const logins = await one(owner, `select count(*)::int n from audit_event where action = 'identity.login' and outcome = 'success'`);
    check('verify: audit hash chain intact after restore and extended by new events', breaks.n === 0 && head.n > state.counts.audit, `breaks=${breaks.n} rows=${head.n} (run phase ${state.counts.audit}) logins=${logins.n}`);

    await isolationChecks('verify', pmA, pmB, A, B);
    await aiOffChecks('verify', pmA, A);

    // No mass redelivery: let the worker run several poll cycles, then compare with the backup point.
    await sleep(cfg.workerSettleMs ?? 8000);
    const before = new Map(state.backupPoint.jobs.map((j) => [j.id, j]));
    const now = await jobsSnapshot(owner);
    const rerun = now.filter((j) => before.get(j.id)?.status === 'succeeded' && (j.attempts !== before.get(j.id).attempts || j.finished_at !== before.get(j.id).finished_at));
    check('verify: no completed job ran again after the restore', rerun.length === 0, `${[...before.values()].filter((j) => j.status === 'succeeded').length} completed jobs unchanged; re-run=${rerun.length}`);
    const held = await one(owner, `select status, attempts, run_at = 'infinity' held, result ? 'restoreHold' marked from job where id = $1`, [state.heldExportJobId]);
    const exp = await must('held export', pmA.get(`/api/v1/projects/${A.id}/report-exports/${state.heldExportId}`), 200);
    check('verify: work queued at the backup point is held for review, not executed', held?.status === 'queued' && held.held && held.marked && held.attempts === 0 && exp.body.status === 'queued', `job=${held?.status}/${held?.attempts} held=${held?.held} export=${exp.body.status}`);
    const outbox = await one(owner, `select count(*)::int held, (select count(*)::int from outbox_event where dispatched_at is null) open from outbox_event where dispatched_at = 'infinity'`);
    check('verify: outbox events pending at the backup point are held, not re-dispatched', outbox.held >= 1 && outbox.open === 0, `held=${outbox.held} undispatched=${outbox.open}`);
    const newJobs = now.filter((j) => !before.has(j.id) && !j.kind.startsWith('platform.'));
    const counts = await one(owner, `select (select count(*)::int from delivery_record) deliveries, (select count(*)::int from notification) notifications`);
    check('verify: no new jobs, deliveries or notifications from pre-backup work', newJobs.length === 0 && counts.deliveries === state.backupPoint.counts.deliveries && counts.notifications === state.backupPoint.counts.notifications, `new jobs=${newJobs.length} deliveries=${counts.deliveries} notifications=${counts.notifications}`);
    state.verifyJobs = now;
    save();
  } finally {
    await owner.end();
  }
}

async function released() {
  const owner = db(cfg.ownerUrl);
  try {
    const pmA = await sso('pmA', { sub: state.people.pmA.sub, email: state.people.pmA.email });
    const st = await pollExport(pmA, state.A, state.heldExportId);
    const job = await one(owner, 'select status, attempts from job where id = $1', [state.heldExportJobId]);
    const dl = await pmA.get(`/api/v1/projects/${state.A.id}/report-exports/${state.heldExportId}/download`);
    check('released: the reviewed job ran exactly once after its release', st.status === 'ready' && job.status === 'succeeded' && job.attempts === 1 && dl.status === 200 && sha256(dl.bytes) === st.sha256, `export=${st.status} job=${job.status}/${job.attempts}`);
  } finally {
    await owner.end();
  }
}

const phases = { install, run, inflight, verify, released };
if (!phases[phase]) {
  console.error(`unknown phase ${phase}; expected ${Object.keys(phases).join(' | ')}`);
  process.exit(2);
}
// Exit status: 0 all checks passed; 1 a check failed (the drill continues); 3 the journey itself broke off (fatal).
let aborted = false;
try {
  await phases[phase]();
} catch (e) {
  aborted = true;
  check(`${phase}: journey step`, false, String(e?.stack ?? e).split('\n').slice(0, 3).join(' | '));
}
process.exit(aborted ? 3 : failures ? 1 : 0);
