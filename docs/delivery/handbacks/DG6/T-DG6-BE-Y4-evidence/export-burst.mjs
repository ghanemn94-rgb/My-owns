#!/usr/bin/env node
// T-DG6-BE-Y4 (F-DG6-147): N simultaneous createExport starts, part B's body (registers/raid, csv, live selection),
// against a running API on a load database. Pairs (user, transformation) are every exporter grant, round-robin, each
// start with its own Idempotency-Key, all fired at once. Reports the start latency (nearest-rank p50/p95/max) and, with
// --wait, the jobs' final statuses. Synthetic data only; sandbox figures, not Mobily capacity; approves nothing.
//   node export-burst.mjs --sessions S --base-url U --db-url D --n 50 --label L [--wait]
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
const { values: o } = parseArgs({
  options: {
    sessions: { type: "string" },
    "base-url": { type: "string" },
    "db-url": { type: "string" },
    n: { type: "string", default: "50" },
    label: { type: "string", default: "burst" },
    wait: { type: "boolean", default: false },
  },
});
const root = process.cwd();
const { Client } = createRequire(`${root}/packages/db/package.json`)("pg");
const sf = JSON.parse(readFileSync(o.sessions, "utf8"));
const sessions = sf.sessions;
const c = new Client({ connectionString: o["db-url"] });
await c.connect();
const grants = (
  await c.query(
    `SELECT a.user_id, a.scope_id AS t FROM scoped_assignment a JOIN role_permission rp ON rp.role_id = a.role_id
      WHERE a.user_id = ANY($1::uuid[]) AND a.revoked_at IS NULL AND a.scope_type = 'transformation'
      GROUP BY a.user_id, a.scope_id
     HAVING bool_or(rp.permission_code = 'export.create') AND bool_or(rp.permission_code = 'report.generate')
      ORDER BY a.user_id, a.scope_id`,
    [sessions.map((s) => s.userId)],
  )
).rows;
await c.end();
const byId = new Map(sessions.map((s) => [s.userId, s]));
const pairs = grants.map((g) => ({ s: byId.get(g.user_id), t: g.t }));
if (pairs.length === 0) throw new Error("no exporter grant");
const n = Number(o.n);
const call = async (s, method, path, body, key) => {
  const h = { cookie: s.cookie, accept: "application/json" };
  if (method !== "GET") Object.assign(h, { "x-csrf-token": s.csrfToken, origin: sf.appBaseUrl ?? o["base-url"] });
  if (body) h["content-type"] = "application/json";
  if (key) h["idempotency-key"] = key;
  const t0 = performance.now();
  const r = await fetch(o["base-url"] + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  return { status: r.status, ms: performance.now() - t0, json };
};
const run = `${o.label}-${Date.now()}`;
const plan = Array.from({ length: n }, (_, i) => pairs[i % pairs.length]);
const t0 = performance.now();
const res = await Promise.all(
  plan.map((p, i) =>
    call(
      p.s,
      "POST",
      "/api/v1/exports",
      {
        format: "csv",
        language: "en",
        report: { definitionCode: "registers", subjectId: p.t, parameters: { register: "raid" } },
      },
      `burst-${run}-${i}`,
    ),
  ),
);
const wall = performance.now() - t0;
const ms = res.map((r) => r.ms).sort((a, b) => a - b);
const rank = (p) => ms[Math.max(0, Math.floor((p * ms.length + 99) / 100) - 1)];
const statuses = {};
for (const r of res) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
const out = {
  label: o.label,
  n,
  distinctPairs: pairs.length,
  distinctUsers: new Set(plan.map((p) => p.s.userId)).size,
  statuses,
  startMs: { p50: +rank(50).toFixed(1), p95: +rank(95).toFixed(1), max: +ms.at(-1).toFixed(1), wall: +wall.toFixed(1) },
  over2s: ms.filter((x) => x > 2000).length,
  firstProblem: res.find((r) => r.status !== 202)?.json ?? null,
};
if (o.wait) {
  const deadline = performance.now() + 300_000;
  const final = {};
  await Promise.all(
    res.map(async (r, i) => {
      if (r.status !== 202) return;
      for (;;) {
        const g = await call(plan[i].s, "GET", `/api/v1/exports/${r.json.id}`);
        const st = g.json?.status;
        if (["succeeded", "failed", "cancelled"].includes(st) || performance.now() > deadline) {
          const k = `${st}${g.json?.errorCode ? `:${g.json.errorCode}` : ""}`;
          final[k] = (final[k] ?? 0) + 1;
          return;
        }
        await new Promise((z) => setTimeout(z, 250));
      }
    }),
  );
  out.final = final;
}
console.log(JSON.stringify(out));
