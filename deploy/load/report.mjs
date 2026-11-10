#!/usr/bin/env node
// The load-run report (ADR-0058 §1, §5, §6, §10; REQ-S20-029; T-DG6-DO-F). Node built-ins and `pg` only.
//
//   Capture the infrastructure statement (at the run, never assumed; ADR-0058 §5):
//     MTH_LOAD_DB_URL=postgres://…/mth node deploy/load/report.mjs capture-infra --out <run-dir>/infrastructure.json \
//       [--pgdata <dir>] [--api-processes 1] [--api-pool 20] [--worker-processes 1] [--worker-pool 5]
//   Write the report from a run directory holding infrastructure.json and rep-1/, rep-2/, rep-3/ (workload.mjs output):
//     node deploy/load/report.mjs report --run <run-dir> [--title "…"] [--notes <markdown file>]
//       → <run-dir>/report.md and summary.json (the notes, the run's disclosures, are embedded verbatim)
//
// Statistics: latencies are integer microseconds; p50, p95 and p99 are nearest-rank samples on the sorted integers
// (rank = ceil(p/100 × n), computed in integer arithmetic), never interpolated. The class result compared with its
// target is the HIGHEST p95 of the repetitions. Search is reported as its own class and also counted with ordinary
// reads (ADR-0058 §3). A class without a steady-state sample in a repetition is "not measured", never 0 and never a pass.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, cpus, release, totalmem } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { gunzipSync } from "node:zlib";
import { CLASSES, TEMPLATES, WORKLOAD_VERSION } from "./workload.mjs";

const requireFromDb = createRequire(new URL("../../packages/db/package.json", import.meta.url));

/** Nearest-rank percentile of ascending-sorted integers; p is an integer percent 1-100. null when empty. */
export function nearestRank(sorted, p) {
  const n = sorted.length;
  if (n === 0) return null;
  const rank = Math.floor((p * n + 99) / 100); // ceil(p*n/100) in integers
  return sorted[Math.min(Math.max(rank, 1), n) - 1];
}

/** Summary of one set of samples ({micros, outcome}). */
export function summarize(rows) {
  const all = rows.map((r) => r.micros).sort((a, b) => a - b); // every steady-state request, errors included
  return {
    count: rows.length,
    errors: rows.filter((r) => r.outcome === "error").length,
    conflicts: rows.filter((r) => r.outcome === "conflict").length,
    p50: nearestRank(all, 50),
    p95: nearestRank(all, 95),
    p99: nearestRank(all, 99),
    max: all.length ? all[all.length - 1] : null,
  };
}

/** Parses a samples.csv.gz of workload.mjs. */
export function readSamples(path) {
  const lines = gunzipSync(readFileSync(path)).toString("utf8").trim().split("\n").slice(1);
  return lines.map((l) => {
    const [phase, user, cls, operation, status, outcome, micros] = l.split(",");
    return { phase, user: Number(user), cls, operation, status: Number(status), outcome, micros: Number(micros) };
  });
}

/** The class groups of the report: the five ADR classes plus "ordinary read including search". */
export const REPORT_GROUPS = Object.freeze([
  ...CLASSES.map((c) => ({ key: c.key, label: c.label, targetMs: c.targetMs, classes: [c.key] })),
  { key: "read+search", label: "Ordinary read incl. search", targetMs: 2000, classes: ["read", "search"] },
]);

const ms = (us) => (us === null ? "not measured" : `${(us / 1000).toFixed(1)}`);

// ------------------------------------------------------------------------------------------------- infrastructure

export async function captureInfrastructure({ dbUrl, pgdata, api, worker }) {
  const cpuinfo = readFileSync("/proc/cpuinfo", "utf8");
  const model = /model name\s*:\s*(.+)/.exec(cpuinfo)?.[1] ?? cpus()[0]?.model ?? "unknown";
  const meminfo = readFileSync("/proc/meminfo", "utf8")
    .split("\n")
    .filter((l) => /^(MemTotal|MemAvailable|SwapTotal):/.test(l));
  const df = (p) => {
    try {
      return execFileSync("df", ["-kP", p], { encoding: "utf8" }).trim();
    } catch (e) {
      return `df failed: ${e.message}`;
    }
  };
  const { Client } = requireFromDb("pg");
  const client = new Client({ connectionString: dbUrl, application_name: "mth-load report (infrastructure)" });
  await client.connect();
  let pg;
  try {
    const version = (await client.query("SELECT version() AS v")).rows[0].v;
    const settings = (
      await client.query(
        `SELECT name, setting, unit, source FROM pg_settings WHERE source NOT IN ('default', 'override') ORDER BY name`,
      )
    ).rows;
    const size = (await client.query("SELECT pg_size_pretty(pg_database_size(current_database())) AS s")).rows[0].s;
    const marker = (await client.query("SELECT to_jsonb(m) AS m FROM load_dataset_marker m")).rows[0]?.m ?? null;
    const counts = (
      await client.query(
        `SELECT (SELECT count(*) FROM transformation)::int AS transformations,
                (SELECT count(*) FROM initiative)::int AS initiatives,
                (SELECT count(*) FROM kpi_actual)::int AS kpi_actuals,
                (SELECT count(*) FROM audit_event)::int AS audit_events,
                (SELECT count(*) FROM app_user)::int AS users`,
      )
    ).rows[0];
    const search = (await client.query(`SELECT record_type, status FROM search_index_state ORDER BY record_type`)).rows;
    pg = {
      version,
      nonDefaultSettings: settings,
      databaseSize: size,
      marker,
      countsAtCapture: counts,
      searchIndex: search,
    };
  } finally {
    await client.end();
  }
  return {
    capturedAt: new Date().toISOString(),
    cpu: { model, logicalCpus: cpus().length, availableParallelism: availableParallelism() },
    memory: { totalBytes: totalmem(), meminfo },
    kernel: release(),
    node: process.version,
    postgres: pg,
    processes: { api, worker },
    disk: { cwd: df(process.cwd()), ...(pgdata ? { pgdata: df(pgdata) } : {}) },
    statement:
      "The load harness, the API, the worker and PostgreSQL share ONE sandbox host, so every figure includes client-side " +
      "CPU contention. This is not Mobily production infrastructure, and a single-host run is not evidence of high " +
      "availability or production capacity.",
  };
}

// ------------------------------------------------------------------------------------------------------------ report

export function buildReport(runDir, title, notes = null) {
  const infra = JSON.parse(readFileSync(join(runDir, "infrastructure.json"), "utf8"));
  const reps = readdirSync(runDir)
    .filter((n) => /^rep-\d+$/.test(n) && existsSync(join(runDir, n, "samples.csv.gz")))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  const repData = reps.map((r) => {
    const dir = join(runDir, r);
    const run = JSON.parse(readFileSync(join(dir, "run.json"), "utf8"));
    const samples = readSamples(join(dir, "samples.csv.gz")).filter((s) => s.phase === "steady");
    const loadRows = readFileSync(join(dir, "loadavg.csv"), "utf8").trim().split("\n").slice(1);
    const load1 = loadRows.map((l) => Number(l.split(",")[2]));
    return {
      name: r,
      run,
      samples,
      load: {
        samples: load1.length,
        min: Math.min(...load1),
        max: Math.max(...load1),
        mean: load1.reduce((s, x) => s + x, 0) / (load1.length || 1),
      },
    };
  });
  const groups = REPORT_GROUPS.map((g) => {
    const perRep = repData.map((r) => summarize(r.samples.filter((s) => g.classes.includes(s.cls))));
    const p95s = perRep.map((s) => s.p95);
    const measured = p95s.length > 0 && p95s.every((p) => p !== null);
    const worst = measured ? Math.max(...p95s) : null;
    return {
      ...g,
      perRep,
      worstP95: worst,
      verdict: !measured ? "not measured" : worst <= g.targetMs * 1000 ? "within target" : "MISS",
    };
  });
  const operations = [...new Set(repData.flatMap((r) => r.samples.map((s) => s.operation)))].sort();
  const perOperation = operations.map((op) => ({
    operation: op,
    cls: TEMPLATES[op]?.cls ?? "?",
    perRep: repData.map((r) => summarize(r.samples.filter((s) => s.operation === op))),
  }));
  const statusCounts = {};
  for (const r of repData)
    for (const s of r.samples)
      if (s.outcome !== "ok") {
        const k = `${r.name} ${s.operation} ${s.status}`;
        statusCounts[k] = (statusCounts[k] ?? 0) + 1;
      }
  const total = repData.reduce((s, r) => s + r.samples.length, 0);
  const achievedShares = CLASSES.map((c) => {
    const n = repData.reduce((s, r) => s + r.samples.filter((x) => x.cls === c.key).length, 0);
    return { key: c.key, planned: c.share, achieved: total ? Math.round((n * 1000) / total) / 10 : null, n };
  });
  const summary = {
    title,
    workloadVersion: WORKLOAD_VERSION,
    repetitions: repData.map((r) => ({ name: r.name, ...r.run, load1: r.load })),
    groups: groups.map((g) => ({
      key: g.key,
      label: g.label,
      targetMs: g.targetMs,
      worstP95Micros: g.worstP95,
      verdict: g.verdict,
      perRep: g.perRep,
    })),
    perOperation,
    nonOkByRepOperationStatus: statusCounts,
    achievedShares,
  };

  const L = [];
  L.push(`# ${title}`, "");
  L.push(
    "> **Engineering measurements on the stated sandbox host, not Mobily production capacity.** The targets (p95 of ordinary",
    "> reads and updates ≤ 2 s, key dashboards ≤ 4 s) are M0398's provisional engineering targets, not verified Mobily",
    "> capacity requirements. Final production scale, availability and recovery objectives must be agreed with Mobily IT",
    "> (REQ-S20-029 notes). One host running everything is not a high-availability deployment. The dataset and every",
    "> user are synthetic. Nothing here is a G1–G6 business approval or a DG0–DG7 gate decision.",
    "",
  );
  L.push("## 1. Results per class (steady state; milliseconds; nearest-rank)", "");
  L.push("| Class | Target p95 | " + repData.map((r) => `${r.name} p95`).join(" | ") + " | Highest p95 | Result |");
  L.push("| --- | --- | " + repData.map(() => "---").join(" | ") + " | --- | --- |");
  for (const g of groups)
    L.push(
      `| ${g.label} | ${g.targetMs / 1000} s | ${g.perRep.map((s) => ms(s.p95)).join(" | ")} | ${ms(g.worstP95)} | ${g.verdict} |`,
    );
  L.push("");
  L.push("Per repetition (p50 / p95 / p99 / max in ms; count; errors; 409 conflicts):", "");
  L.push("| Class | Repetition | p50 | p95 | p99 | max | count | errors | conflicts |");
  L.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const g of groups)
    g.perRep.forEach((s, i) =>
      L.push(
        `| ${g.label} | ${repData[i].name} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.p99)} | ${ms(s.max)} | ${s.count} | ${s.errors} | ${s.conflicts} |`,
      ),
    );
  L.push("");
  const misses = groups.filter((g) => g.verdict === "MISS" && g.key !== "read+search");
  L.push(
    "## 2. Misses against the targets (each a Medium, non-mandatory finding candidate; ADR-0058 §1, D-195 Q9)",
    "",
  );
  if (misses.length === 0) L.push("None of the five ADR-0058 §3 classes missed its target in any repetition.");
  for (const g of misses) L.push(`- **${g.label}**: highest p95 ${ms(g.worstP95)} ms against ${g.targetMs / 1000} s.`);
  const comb = groups.find((g) => g.key === "read+search");
  if (comb?.verdict === "MISS")
    L.push(`- (Combined) ordinary read incl. search: highest p95 ${ms(comb.worstP95)} ms against 2 s.`);
  L.push("");
  L.push("## 3. Per operation (steady state; ms)", "");
  L.push("| Operation | Class | " + repData.map((r) => `${r.name} p95 (n, err)`).join(" | ") + " |");
  L.push("| --- | --- | " + repData.map(() => "---").join(" | ") + " |");
  for (const o of perOperation)
    L.push(
      `| \`${o.operation}\` | ${o.cls} | ${o.perRep.map((s) => `${ms(s.p95)} (${s.count}, ${s.errors})`).join(" | ")} |`,
    );
  L.push("");
  const unmeasured = Object.keys(TEMPLATES).filter((op) => !operations.includes(op));
  L.push(
    "Operations of the ADR-0058 §3 mix with no steady-state sample (**not measured**, never 0; the reason is in the run notes): " +
      (unmeasured.length ? unmeasured.map((op) => `\`${op}\``).join(", ") : "none") +
      ".",
    "",
  );
  L.push("Non-success responses (repetition, operation, HTTP status; 0 = network failure): ", "");
  const nonOk = Object.entries(statusCounts).sort();
  if (nonOk.length === 0) L.push("- none");
  for (const [k, n] of nonOk) L.push(`- ${k}: ${n}`);
  L.push("");
  if (notes) L.push("## Run notes (disclosures)", "", notes.trim(), "");
  L.push("## 4. The dataset", "");
  L.push("Profile `default` of `deploy/load/generate.mjs` (ADR-0058 §2). The marker row:", "");
  L.push("```json", JSON.stringify(infra.postgres.marker, null, 2), "```", "");
  L.push("Counts at capture (before the repetitions; the run's own updates add audit events):", "");
  L.push("```json", JSON.stringify(infra.postgres.countsAtCapture, null, 2), "```", "");
  L.push("Search index state at capture:", "");
  L.push("```", ...infra.postgres.searchIndex.map((r) => `${r.record_type}: ${r.status}`), "```", "");
  L.push("## 5. The workload (ADR-0058 §3, §6)", "");
  const r0 = repData[0]?.run;
  L.push(
    `- \`deploy/load/workload.mjs\` version ${WORKLOAD_VERSION}; ${r0?.users ?? "?"} concurrent virtual users, each with its own minted session (\`deploy/load/sessions.mjs\`); seed ${r0?.seed ?? "?"}.`,
    `- Warm-up ${r0?.warmupSeconds ?? "?"} s (excluded), steady state ${r0?.steadySeconds ?? "?"} s per repetition; ${repData.length} repetition(s), each on a freshly started API and worker over the same database.`,
    "- Think time 1000–3000 ms (integer, uniform, seeded per user and repetition). Measured from just before `fetch` to the end of the body, integer microseconds.",
    "- Class draw by share; a class with no operation the user may perform (for example updates for an AUD user) is left out of that user's draw. Achieved shares of steady-state requests:",
    "",
  );
  L.push("| Class | Planned % | Achieved % | Requests |", "| --- | --- | --- | --- |");
  for (const s of achievedShares) L.push(`| ${s.key} | ${s.planned} | ${s.achieved ?? "—"} | ${s.n} |`);
  L.push(
    "",
    "Request templates:",
    "",
    "| Operation | Class | Method | Path | Body |",
    "| --- | --- | --- | --- | --- |",
  );
  for (const [op, t] of Object.entries(TEMPLATES))
    L.push(`| \`${op}\` | ${t.cls} | ${t.method} | \`${t.path}\` | ${t.body ? `\`${t.body}\`` : "—"} |`);
  L.push("");
  L.push("## 6. The infrastructure (measured at the run; ADR-0058 §5)", "");
  L.push(
    `- CPU: ${infra.cpu.model}; ${infra.cpu.logicalCpus} logical CPUs (availableParallelism ${infra.cpu.availableParallelism}).`,
    `- Memory: ${infra.memory.meminfo.join("; ")}.`,
    `- Kernel ${infra.kernel}; Node ${infra.node}.`,
    `- PostgreSQL: ${infra.postgres.version}; database size ${infra.postgres.databaseSize}.`,
    `- Processes: API ${infra.processes.api.processes} process(es), database pool max ${infra.processes.api.pool}; worker ${infra.processes.worker.processes} process(es), pool max ${infra.processes.worker.pool}.`,
    "",
    "PostgreSQL settings not at their default (`SELECT name, setting FROM pg_settings WHERE source NOT IN ('default', 'override')`):",
    "",
    "| name | setting | unit | source |",
    "| --- | --- | --- | --- |",
    ...infra.postgres.nonDefaultSettings.map((s) => `| ${s.name} | ${s.setting} | ${s.unit ?? ""} | ${s.source} |`),
    "",
    "Disk as reported by the OS (`df -kP`):",
    "",
    "```",
    infra.disk.cwd,
    ...(infra.disk.pgdata ? [infra.disk.pgdata] : []),
    "```",
    "",
    "Machine load average (1 min), sampled every 5 s during each repetition:",
    "",
    "| Repetition | Started | Ended | Samples | min | mean | max |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...repData.map(
      (r) =>
        `| ${r.name} | ${r.run.started} | ${r.run.ended} | ${r.load.samples} | ${r.load.min.toFixed(2)} | ${r.load.mean.toFixed(2)} | ${r.load.max.toFixed(2)} |`,
    ),
    "",
    `**${infra.statement}**`,
    "",
  );
  return { markdown: `${L.join("\n")}\n`, summary };
}

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === "capture-infra") {
    const { values } = parseArgs({
      args: rest,
      options: {
        out: { type: "string" },
        pgdata: { type: "string" },
        "api-processes": { type: "string", default: "1" },
        "api-pool": { type: "string", default: "20" },
        "worker-processes": { type: "string", default: "1" },
        "worker-pool": { type: "string", default: "5" },
      },
      strict: true,
    });
    const dbUrl = process.env.MTH_LOAD_DB_URL;
    if (!values.out || !dbUrl) {
      console.error("mth-load report: capture-infra needs --out and MTH_LOAD_DB_URL");
      return 64;
    }
    const infra = await captureInfrastructure({
      dbUrl,
      pgdata: values.pgdata,
      api: { processes: Number(values["api-processes"]), pool: Number(values["api-pool"]) },
      worker: { processes: Number(values["worker-processes"]), pool: Number(values["worker-pool"]) },
    });
    writeFileSync(values.out, `${JSON.stringify(infra, null, 2)}\n`);
    console.log(`mth-load report: infrastructure captured to ${values.out}`);
    return 0;
  }
  if (mode === "report") {
    const { values } = parseArgs({
      args: rest,
      options: {
        run: { type: "string" },
        title: { type: "string", default: "Load run report (draft)" },
        notes: { type: "string" },
      },
      strict: true,
    });
    if (!values.run) {
      console.error("mth-load report: report needs --run <dir>");
      return 64;
    }
    const notes = values.notes ? readFileSync(values.notes, "utf8") : null;
    const { markdown, summary } = buildReport(values.run, values.title, notes);
    writeFileSync(join(values.run, "report.md"), markdown);
    writeFileSync(join(values.run, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    for (const g of summary.groups) console.log(`${g.label}: highest p95 ${ms(g.worstP95Micros)} ms (${g.verdict})`);
    return 0;
  }
  console.error("usage: report.mjs capture-infra --out <file> | report --run <dir>");
  return 64;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`mth-load report: failed: ${err?.stack ?? err}`);
      process.exit(1);
    },
  );
}
