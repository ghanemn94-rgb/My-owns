#!/usr/bin/env node
// The job table of the automation operations guide (ADR-0072 §6; p7-work-split §H, DOC-C; REQ-S19-015 item
// "Automation guide").
//
//   node tools/release/automation-jobs.mjs [--root <dir>] [--guide <file>] (--check | --write | --stdout)
//
// The table is the block between `<!-- generated:automation-jobs begin -->` and `<!-- generated:automation-jobs end -->`
// of docs/handover/automation-operations.md. Its sources, all read from the tree, never typed by hand:
//   - the registered handlers: `DOMAIN_HANDLERS` of apps/worker/src/handlers/index.ts (the owning domain is the handler
//     file that exports the queue) plus the platform registrations of apps/worker/src/worker.ts, read from its
//     `work(<queue>, …)` (captured: failure queue) and `boss.work(<queue>, …)` (not captured) calls;
//   - the service identity of each queue: `JOB_SERVICE_IDENTITIES` of apps/worker/src/kit.ts (ADR-0053 §1);
//   - the retry policy: `DOMAIN_QUEUES` and `RETRY_POLICY` of apps/worker/src/queues/** (ADR-0008 §4);
//   - the events each queue consumes: `QUEUES_FOR_EVENT` (D-102);
//   - the default schedules: the `INSERT INTO job_schedule` rows of packages/db/migrations/*.sql (enabled unless the
//     row says false), and the platform purge cron `PURGE_CRON`.
// The worker modules are imported in a child `node --conditions=@mth/source` process (Node 24 type stripping), so this
// tool needs an installed workspace (pnpm install): without one it exits 3 (BLOCKED), never 0.
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (the block differs), 2 BLOCKED (missing or invalid input,
// usage), 3 BLOCKED (no installed workspace). Dependency-free itself (Node built-ins). Never reads docs/delivery/**.
// Nothing here runs, schedules or approves a job; no job approves a G1-G6 gate, a Finance validation or a DG gate.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { InputError, insertRows } from "./role-matrix.mjs";

const SELF = fileURLToPath(import.meta.url);
export const DEFAULT_ROOT = resolve(dirname(SELF), "..", "..");
export const GUIDE_PATH = "docs/handover/automation-operations.md";
export const BEGIN = "<!-- generated:automation-jobs begin -->";
export const END = "<!-- generated:automation-jobs end -->";

export class WorkspaceError extends Error {}

// ------------------------------------------------------------------------------------------------ registry dump (child)

/** Runs inside `node --conditions=@mth/source`: imports the worker registry and returns plain JSON. */
async function dumpRegistry(root) {
  const w = (p) => pathToFileURL(join(root, "apps/worker/src", p)).href;
  const kit = await import(w("kit.ts"));
  const queues = await import(w("queues/index.ts"));
  const platform = await import(w("queues/platform.ts"));
  const jobRuns = await import(w("job-runs.ts"));
  const handlersIndex = await import(w("handlers/index.ts"));

  // Owning domain: the handler file (or directory) that exports the queue in a *_HANDLERS array.
  const indexSrc = readFileSync(join(root, "apps/worker/src/handlers/index.ts"), "utf8");
  const domainOf = new Map();
  for (const m of indexSrc.matchAll(/from "\.\/([\w-]+)(\/index)?\.ts"/g)) {
    const domain = m[1];
    const mod = await import(w(`handlers/${domain}${m[2] ?? ""}.ts`));
    for (const [name, value] of Object.entries(mod))
      if (name.endsWith("_HANDLERS") && Array.isArray(value))
        for (const h of value) if (!domainOf.has(h.queue)) domainOf.set(h.queue, domain);
  }

  const handlers = handlersIndex.DOMAIN_HANDLERS.map((h) => ({
    queue: h.queue,
    domain: domainOf.get(h.queue) ?? null,
    captured: true,
    platform: false,
  }));

  // Platform registrations: the worker's own work()/boss.work() calls with a named queue.
  const workerSrc = readFileSync(join(root, "apps/worker/src/worker.ts"), "utf8").replace(/\/\/[^\n]*/g, "");
  const resolveQueue = (id) => {
    if (id.startsWith("QUEUES.")) return queues.QUEUES[id.slice("QUEUES.".length)];
    if (id === "FAILURE_RETRY_QUEUE") return kit.FAILURE_RETRY_QUEUE;
    if (id === "RUN_NOW_QUEUE") return jobRuns.RUN_NOW_QUEUE;
    return undefined;
  };
  let domainLoopCaptured = false;
  for (const m of workerSrc.matchAll(/(?<!\w)(boss\.)?work\(\s*([A-Za-z_][\w.]*)\s*,/g)) {
    const direct = m[1] !== undefined;
    const id = m[2];
    if (id === "queue") continue; // the `work` helper's own pass-through
    if (id === "h.queue") {
      if (direct) throw new Error("worker.ts registers the domain handlers without the failure capture");
      domainLoopCaptured = true;
      continue;
    }
    const queue = resolveQueue(id);
    if (typeof queue !== "string") throw new Error(`worker.ts registers ${id}, which this tool cannot resolve`);
    handlers.push({ queue, domain: "platform", captured: !direct, platform: true });
  }
  if (!domainLoopCaptured) throw new Error("worker.ts: the domain handler loop (work(h.queue, …)) was not found");

  const purgeBlock = /const purge = \{([^}]*)\}/.exec(readFileSync(join(root, "apps/worker/src/queues/platform.ts"), "utf8"));
  const num = (re) => {
    const m = purgeBlock === null ? null : re.exec(purgeBlock[1]);
    return m === null ? null : Number(m[1]);
  };
  return {
    handlers,
    identities: kit.JOB_SERVICE_IDENTITIES.map((d) => ({
      queue: d.queue,
      permissions: [...d.permissions],
      sensitiveAccess: d.sensitiveAccess,
    })),
    specs: queues.DOMAIN_QUEUES.map((s) => ({ ...s })),
    retryPolicy: { ...queues.RETRY_POLICY },
    platformPolicy: {
      [queues.QUEUES.purge]: { retryLimit: num(/retryLimit:\s*(\d+)/), retryDelaySeconds: num(/retryDelay:\s*(\d+)/), retryBackoff: false },
    },
    deadLetter: queues.QUEUES.failed,
    jobFailedQueue: kit.JOB_FAILED_QUEUE,
    purgeQueue: queues.QUEUES.purge,
    purgeCron: platform.PURGE_CRON,
    scheduleSyncQueue: queues.QUEUES.jobScheduleUpdated,
    eventsByQueue: Object.entries(queues.QUEUES_FOR_EVENT).reduce((acc, [event, qs]) => {
      for (const q of qs) (acc[q] ??= []).push(event);
      return acc;
    }, {}),
  };
}

/** Spawns the child that imports the worker. Throws WorkspaceError when the workspace is not installed. */
export function loadRegistry(root) {
  for (const p of ["apps/worker/src/handlers/index.ts", "apps/worker/src/worker.ts", "apps/worker/src/kit.ts"])
    if (!existsSync(join(root, p))) throw new InputError(`missing ${p} under ${root}`);
  let out;
  try {
    out = execFileSync(process.execPath, ["--conditions=@mth/source", SELF, "--dump-registry", root], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const stderr = String(e.stderr ?? "");
    if (/ERR_MODULE_NOT_FOUND|Cannot find package/.test(stderr))
      throw new WorkspaceError(`the worker's dependencies are not installed (run pnpm install): ${firstLine(stderr)}`);
    throw new InputError(`cannot read the worker registry: ${firstLine(stderr) || String(e.message)}`);
  }
  return JSON.parse(out);
}

const firstLine = (s) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .find((l) => /Error|error/.test(l)) ?? s.split("\n")[0];

// ------------------------------------------------------------------------------------------------ schedules (migrations)

/** queue -> { cron, timezone, enabled } from every `INSERT INTO job_schedule` row of the migrations. */
export function seededSchedules(migrationsDir) {
  if (!existsSync(migrationsDir)) throw new InputError(`no migrations directory: ${migrationsDir}`);
  const out = new Map();
  for (const f of readdirSync(migrationsDir)
    .filter((x) => x.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(migrationsDir, f), "utf8");
    const code = sql.replace(/--[^\n]*/g, "");
    if (/UPDATE\s+job_schedule\b[^;]*\bSET\b[^;]*\b(cron|enabled|timezone|queue_name)\s*=/i.test(code))
      throw new InputError(`${f} changes a seeded job schedule; this tool reads INSERT rows only`);
    for (const r of insertRows(sql, "job_schedule")) {
      if (out.has(r.queue_name)) throw new InputError(`job schedule of ${r.queue_name} is seeded twice (${f})`);
      const enabled = r.enabled === undefined ? true : r.enabled.toLowerCase() === "true";
      out.set(r.queue_name, { code: r.code, cron: r.cron, timezone: r.timezone, enabled, file: f });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ the table

/** The rows of the table, sorted by queue name. Throws InputError on a gap (no identity, no domain, unscheduled row). */
export function buildRows(reg, schedules) {
  const ids = new Map(reg.identities.map((d) => [d.queue, d]));
  const specs = new Map(reg.specs.map((s) => [s.name, s]));
  const seen = new Set();
  const rows = [];
  for (const h of reg.handlers) {
    if (seen.has(h.queue)) throw new InputError(`queue ${h.queue} is registered twice`);
    seen.add(h.queue);
    if (h.domain === null) throw new InputError(`queue ${h.queue}: no handler file exports it`);
    const id = ids.get(h.queue);
    if (id === undefined) throw new InputError(`queue ${h.queue} declares no service identity (ADR-0053 §1)`);
    const policy = h.platform && reg.platformPolicy[h.queue] ? reg.platformPolicy[h.queue] : { ...reg.retryPolicy, ...(specs.get(h.queue) ?? {}) };
    if (!Number.isInteger(policy.retryLimit) || !Number.isInteger(policy.retryDelaySeconds))
      throw new InputError(`queue ${h.queue}: retry policy unreadable`);
    rows.push({ ...h, identity: id, policy, schedule: schedules.get(h.queue) ?? null, events: [...(reg.eventsByQueue[h.queue] ?? [])].sort() });
  }
  for (const q of schedules.keys())
    if (!seen.has(q)) throw new InputError(`job_schedule names ${q}, which the worker does not register`);
  return rows.sort((a, b) => (a.queue < b.queue ? -1 : a.queue > b.queue ? 1 : 0));
}

const code = (s) => `\`${s}\``;

function trigger(row, reg) {
  const parts = [];
  if (row.schedule !== null)
    parts.push(
      `schedule ${code(row.schedule.cron)} (${row.schedule.timezone}), ${row.schedule.enabled ? "enabled" : "**disabled**"}`,
    );
  if (row.queue === reg.purgeQueue) parts.push(`pg-boss schedule ${code(reg.purgeCron)} (worker start; not a job_schedule row)`);
  if (row.events.length > 0) parts.push(`event${row.events.length > 1 ? "s" : ""} ${row.events.map(code).join(", ")}`);
  if (parts.length === 0) parts.push("on request only (the API enqueues it)");
  return parts.join("; ");
}

function retries(p) {
  return `retry limit ${p.retryLimit} (up to ${p.retryLimit + 1} attempts), delay ${p.retryDelaySeconds} s${p.retryBackoff ? ", exponential backoff" : ", fixed"}`;
}

function onFailure(row, reg) {
  return row.captured
    ? `failure queue (${code("operational_failure")}), event ${code("job.failed")} → ${code(reg.jobFailedQueue)}, exception ${code("job_failed")}; then ${code(reg.deadLetter)}`
    : `${code(reg.deadLetter)} only (not captured in the failure queue)`;
}

function recovery(row, reg) {
  const parts = [];
  if (row.captured) parts.push(`retry from the failure queue (${code("retryAutomationFailure")}, ${code("job.repair")})`);
  if (row.schedule !== null) parts.push(`${code("runJobNow")} when enabled (${code("job.repair")})`);
  if (row.queue === reg.purgeQueue) parts.push("the next scheduled run");
  if (row.queue === reg.scheduleSyncQueue) parts.push("schedules are re-registered at every worker start");
  if (parts.length === 0) parts.push("the next event or request");
  return parts.join("; ");
}

function identityCell(row) {
  const perms = row.identity.permissions.length === 0 ? "no permission" : row.identity.permissions.map(code).join(", ");
  const sensitive = row.identity.sensitiveAccess === "none" ? "" : `; sensitive: ${row.identity.sensitiveAccess}`;
  return `${code(`job:${row.queue}`)} (${perms}${sensitive})`;
}

/** The generated block, markers included (deterministic; no timestamp). */
export function renderBlock(rows, reg) {
  const L = [BEGIN, ""];
  const scheduled = rows.filter((r) => r.schedule !== null);
  L.push(
    `${rows.length} registered jobs: ${rows.filter((r) => !r.platform).length} domain handlers (\`DOMAIN_HANDLERS\`) and ${rows.filter((r) => r.platform).length} platform handlers (\`worker.ts\`). ${scheduled.length} have a \`job_schedule\` row, and ${scheduled.filter((r) => !r.schedule.enabled).length} of those ${scheduled.filter((r) => !r.schedule.enabled).length === 1 ? "ships" : "ship"} disabled.`,
    "",
  );
  L.push("| Job (queue) | Domain | Service identity (declared permissions) | Trigger and default schedule | Retries | After the last attempt fails | Recovery |");
  L.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const r of rows)
    L.push(
      `| ${code(r.queue)} | ${r.domain} | ${identityCell(r)} | ${trigger(r, reg)} | ${retries(r.policy)} | ${onFailure(r, reg)} | ${recovery(r, reg)} |`,
    );
  L.push("", END);
  return L.join("\n");
}

/** Replaces the block in `guide`; throws InputError when the markers are missing or out of order. */
export function spliceBlock(guide, block) {
  const b = guide.indexOf(BEGIN);
  const e = guide.indexOf(END);
  if (b === -1 || e === -1 || e < b || guide.indexOf(BEGIN, b + 1) !== -1)
    throw new InputError(`the guide must hold exactly one ${BEGIN} … ${END} block`);
  return guide.slice(0, b) + block + guide.slice(e + END.length);
}

/** The queue names in the guide's generated table (first column). */
export function tableQueues(guide) {
  const b = guide.indexOf(BEGIN);
  const e = guide.indexOf(END);
  if (b === -1 || e === -1 || e < b) return null;
  const out = [];
  for (const line of guide.slice(b, e).split("\n")) {
    const m = /^\| `([^`]+)` \|/.exec(line);
    if (m !== null) out.push(m[1]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ CLI

function parseArgs(argv) {
  const opts = { root: DEFAULT_ROOT, guide: undefined, mode: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--root" || a === "--guide") {
      const v = argv[i + 1];
      if (v === undefined) throw new InputError(`${a} needs a value`);
      if (a === "--root") opts.root = resolve(v);
      else opts.guide = resolve(v);
      i += 1;
    } else if (a === "--check" || a === "--write" || a === "--stdout") {
      if (opts.mode !== undefined) throw new InputError("give exactly one of --check, --write, --stdout");
      opts.mode = a.slice(2);
    } else throw new InputError(`unknown argument ${a}`);
  }
  if (opts.mode === undefined) throw new InputError("give exactly one of --check, --write, --stdout");
  opts.guide ??= join(opts.root, GUIDE_PATH);
  return opts;
}

export async function main(argv) {
  if (argv[0] === "--dump-registry") {
    process.stdout.write(JSON.stringify(await dumpRegistry(resolve(argv[1] ?? DEFAULT_ROOT))));
    return 0;
  }
  let opts;
  let block;
  let current;
  let next;
  try {
    opts = parseArgs(argv);
    const reg = loadRegistry(opts.root);
    block = renderBlock(buildRows(reg, seededSchedules(join(opts.root, "packages/db/migrations"))), reg);
    if (opts.mode !== "stdout") {
      if (!existsSync(opts.guide)) throw new InputError(`missing guide ${opts.guide}`);
      current = readFileSync(opts.guide, "utf8");
      next = spliceBlock(current, block);
    }
  } catch (e) {
    if (e instanceof WorkspaceError) {
      console.error(`BLOCKED: ${e.message}`);
      return 3;
    }
    if (e instanceof InputError) {
      console.error(`BLOCKED: ${e.message}`);
      console.error(
        "usage: node tools/release/automation-jobs.mjs [--root <dir>] [--guide <file>] (--check | --write | --stdout)",
      );
      return 2;
    }
    throw e;
  }
  if (opts.mode === "stdout") {
    process.stdout.write(`${block}\n`);
    return 0;
  }
  if (opts.mode === "write") {
    writeFileSync(opts.guide, next);
    console.log(`automation-jobs: wrote the job table of ${opts.guide}`);
    return 0;
  }
  if (next === current) {
    console.log(`automation-jobs: PASS (the job table of ${opts.guide} is current)`);
    return 0;
  }
  console.error(`FAIL: the job table of ${opts.guide} differs from the registry; run node tools/release/automation-jobs.mjs --write`);
  return 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SELF) process.exitCode = await main(process.argv.slice(2));
