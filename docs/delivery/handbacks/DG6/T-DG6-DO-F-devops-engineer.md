# Handback: T-DG6-DO-F, the workload harness and the first load run (devops-engineer)

- **Stage:** DG6 (P6 "Integration and system hardening"), BUILDING. This handback decides nothing about the DG6 engineering gate. Product gates G1–G6 are untouched, and nothing here grants a business, Finance or IT approval. The load dataset and its users are synthetic.
- **Assignment:** `docs/delivery/assignments/DG6/T-DG6-DO-F.md` (sha256 `ecd52273…bc2f3ec`, verified). Scope: `docs/architecture/p6-work-split.md` §H/G.8, ADR-0058 §1, §3, §5, §6, §10.
- **Invocation:** `DG6-T-DG6-DO-F-devops-engineer-20261030T074016Z-2eec07bc`, session `2eec07bc-da74-4fed-bb0d-f0d176b7afb4`.
- **Working tree:** `/home/user/wt/dg6-do-f`, branch `dg6/do-f`, base `HEAD` `9ca454f20cc830f85ecd7d70d9e873370c98c60c`. The changes are **uncommitted**.
- **Time:** started `2026-10-30T07:40:36Z`; finished at `__END__` (see §8).
- **Evidence:** `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/`. The run is in `load/run-1/` (see §6, item 1).

## 0. Preceding gate

`node tools/gates/validate.mjs --historical --stage DG5` → **exit 0**, `PASS gate DG5 (historical)`, 2 m 58.7 s (`validate-dg5-historical.txt`).

## 1. Changed files

| File | Purpose |
| --- | --- |
| `deploy/load/workload.mjs` (new) | ADR-0058 §3, §6 harness. 100 concurrent virtual users, each with its own minted session, and the class mix by share. Deterministic integer mulberry32 draws per (seed, repetition, user) and think time of 1000–3000 ms. Integer-microsecond samples (`performance.now()`, start of `fetch` to end of body). Warm-up is excluded and the load average is sampled every 5 s. The update targets are partitioned (each initiative goes to exactly one editor). It refuses a database without the load marker. `--only` is for diagnostic passes only. |
| `deploy/load/report.mjs` (new) | `capture-infra`: the §5 infrastructure statement, measured at the run (CPU, memory, kernel, Node, PostgreSQL version and non-default settings, the process and pool sizes, `df`, the marker and counts, the search index state). `report`: nearest-rank p50/p95/p99, max, count, errors and 409s per class per repetition. The class result is the highest p95 of the repetitions. It also gives per-operation figures, achieved shares, request templates and load average. Operations without samples are listed as "not measured". Run notes are embedded. |
| `deploy/load/harness.node-test.mjs` (new) | 7 self-tests with Node's built-in runner: nearest-rank, null (not 0) when unmeasured, integer µs, the shares of the draw, think-time determinism and range, the partition (each initiative goes to exactly one editor), and search terms. |
| `docs/delivery/handbacks/DG6/T-DG6-DO-F-*` | This handback, the run-1 evidence (driver, samples, report, EXPLAIN), the check logs and the generator patch. |

No migration, no new dependency, no OpenAPI, zod or schema change, and no operation routed.

## 2. Behaviour delivered

**REQ-S20-029.** Acceptance: "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding".

DO-F's part is delivered: the harness, the report generator, and the first run with its draft report (`load/run-1/report.md`). That report states:

- the dataset: the marker row and the counts at capture;
- the infrastructure, as measured;
- the workload: templates, shares, think time, window and repetitions;
- actual p50/p95/p99/max per class for each of 3 repetitions;
- the miss, listed as a finding candidate.

**The row is not complete:** BE-S (fixes) and DO-G (the final run on the frozen tree) follow (§H/G.13).

Run-1 results. Steady state is 10 min per repetition after a 2 min warm-up, on a freshly started API and worker each time. 100 users, seed 20261027, nearest-rank, figures in ms:

| Class (target) | rep-1 p95 | rep-2 p95 | rep-3 p95 | Highest p95 | Result | Requests (3 reps) | Errors |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ordinary read (2 s) | 745.8 | 658.2 | 681.2 | 745.8 | within | 40,010 | 0 |
| Ordinary update (2 s) | 1,007.4 | 918.0 | 980.3 | 1,007.4 | within | 11,126 | 0 (0 × 409) |
| Search (2 s) | 748.2 | 634.1 | 707.2 | 748.2 | within | 6,474 | 0 |
| Key dashboard (4 s) | 1,185.3 | 1,097.6 | 1,191.2 | 1,191.2 | within | 20,021 | 0 |
| Export start (2 s) | 2,688.1 | 2,257.2 | 2,453.3 | **2,688.1** | **MISS** | 1,483 | 0 |
| Ordinary read incl. search (2 s) | 745.9 | 655.8 | 687.4 | 745.9 | within | 46,484 | 0 |

- Steady-state requests per repetition: 26,393, 26,424 and 26,297. Warm-up requests (excluded): 4,872, 5,268 and 4,792. Samples per file: 31,265, 31,692 and 31,089 rows.
- **Finding candidate (Medium, non-mandatory; ADR-0058 §1, D-195 Q9): Export start p95 2,688.1 ms > 2 s.** The orchestrator allocates the id.
  - Cause, from the EXPLAIN pass: `createExport` of a live selection assembles the report snapshot inside the request. No single statement exceeded 100 ms (5 concurrent exporters). The cost is volume:
    - `report_snapshot_source` is inserted row by row (759 inserts for 7 exports);
    - the scoped-assignment permission query runs about 41× per request;
    - the deferred `p2_audit_required` check costs up to 64.5 ms per call (DO-E's `TG_TABLE_NAME` candidate);
    - initiatives and dependencies are read once per row (265× each).
  - Digest with plans: `load/run-1/explain/createExport.explain-digest-all-statements.md`.
  - These are BE-S's inputs (§H/G.9). I made no fix.
- **Not measured:** `getWorkstreamDashboard`. The `default` dataset has no `workstream` row (§5, item 3).
- **Honesty.** The host was oversubscribed during the whole run: 1-minute load average 15.5–21.0 on 4 CPUs, mostly other agents' work. These are sandbox engineering measurements, not Mobily production capacity. One host is not high availability, and the targets are provisional (REQ-S20-029 notes). All of this is stated in the report.

**REQ-S20-030** is not DO-F's: the export proof belongs to BE-S, and the final run to DO-G.

## 3. Checks actually run

Environment for every check:

- Host: 4 vCPU Intel Xeon @ 2.80GHz, 16 GB RAM, no swap, kernel 6.18.44-fc-v185, Node 24.21.0, pnpm 10.33.0.
- Load cluster: a disposable PostgreSQL 16.15 cluster on 127.0.0.1:25650 (`fsync=off`, `max_connections=200`, `shared_buffers` 128 MB).
- Integration cluster: on ports 25670–25699.
- Offline. Other agents shared the host.

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG5` | 0 | PASS (`validate-dg5-historical.txt`) |
| 2 | `pnpm -r typecheck` | __TC__ | `typecheck.log` |
| 3 | `pnpm -r build` | __BUILD__ | `build.log` |
| 4 | `pnpm lint` | __LINT__ | `lint.log` |
| 5 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | __PRETTIER__ | `prettier.log` |
| 6 | `pnpm openapi:lint` | __OPENAPI__ | `openapi-lint.log` |
| 7 | `env -u LANG -u LC_ALL -u LC_CTYPE -u LANGUAGE pnpm test` | __UNIT1__ | `test-unit-locale-unset.log` |
| 8 | `LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test` | __UNIT2__ | `test-unit-c-utf8.log` |
| 9 | `QA_PG_PORT=25670 MTH_PORT_POOL=25671-25699 tests/qa/support/with-pg.sh pnpm test:integration` | __INT__ | `test-integration.log` |
| 10 | `node --test deploy/load/harness.node-test.mjs` | 0 | 7/7 pass (after the final edits) |
| 11 | Dataset: `generate.mjs --profile default` (patched copy, §5 item 1) into a fresh migrated database (110 migrations) | 0 | 384.9 s. The marker equals the planned counts, with 100,000 audit events. 0 non-RFC ids in `initiative` (1,000), `transformation` (50) and `audit_event`. 154 MB. Log: `load/generate-patched-default.txt` (commands: `load/generate-patched-default.sh.txt`) |
| 12 | Run-1 driver (`load/run-1/driver.sh`; output `driver-output.txt`) | 0 | sessions 100; search reindex completed; 3 repetitions exit 0; 0 API error-level log lines per repetition |
| 13 | EXPLAIN diagnostic passes (`auto_explain` analyze+buffers, then `ALTER DATABASE mth RESET ALL`, verified `none`) | 0 | 5 users × 60 s: 128 requests, no statement > 100 ms. 1 user × 20 s: 7/7 `202`, 10,572 plans |

The run-1 evidence files, with sha256:

- `rep-1/samples.csv.gz`: `f0e8e47c…a4e2c6`
- `rep-2/samples.csv.gz`: `4fd60115…6ff9ac`
- `rep-3/samples.csv.gz`: `048f480d…c0c1d6`
- `infrastructure.json`: `b602f9ac…951070`
- `summary.json`: `ea55b9de…a2ea`
- `report.md`: `1d10a57a…b7670`

__CHECK_NOTES__

## 4. Operations routed (pending-list delta)

None. DO-F has no pending list and no exercises file. There is no change to the operation count, media types, the rate-limit floor or the CSRF-exempt routes.

## 5. For the orchestrator: contract, schema, dependency and ownership needs

1. **Generator defect: the ids are not RFC UUIDs (DO-E's `deploy/load/generate.mjs`, sha256 `7470ea74…`).**
   - `loadId` and the SQL audit-step ids are bare `md5(key)::uuid`, without version or variant bits.
   - The API refuses them: `400 validation.invalid_format "Invalid UUID"` (`smoke-diagnosis-invalid-uuid.txt`). On the unpatched dataset, 881 of 1,000 initiatives answered 400.
   - **Proposed fix:** `generate-rfc-uuid.patch` (sha256 `67a5a817…f1b72`). It keeps the same md5 and sets the version-3 and RFC variant bits, in JS and in the SQL step.
   - Run-1 used a scratch copy with exactly this patch. **I did not change the tree file**, because it is outside my ownership.
   - DO-E's `generate.test.mjs` compares two runs of one generator, so it stays valid. Its recorded hashes in DO-E's evidence would change.
2. **Evidence path (contradiction).** §H/G.8 and REQ-S20-029 name `docs/delivery/test-evidence/DG6/load/run-1/`, but the write guard protects `docs/delivery/test-evidence/**` for implementers (refused: "protected path"). I did not work around it. Run-1 is in `docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/`. **Please copy it to `docs/delivery/test-evidence/DG6/load/run-1/`.** The driver's `RUN_DIR` is a parameter.
3. **The dataset has no workstreams.** So `getWorkstreamDashboard` (in ADR-0058 §3's mix) cannot be measured. Either DO-E's generator adds workstreams, or the ADR mix drops that operation. That is a decision for you before DO-G.
4. **`harness.node-test.mjs` is not in a Vitest project.** The Vitest include lists don't cover `deploy/` (the same point as DO-E §5 item 2). It runs with `node --test`. To run it inside `pnpm test`, add an include or convert it to Vitest. That's your call.
5. **The `deploy/load/README.md` usage section** for `workload.mjs` and `report.mjs` is DO-E's file, so I didn't edit it. The usage is in the headers of both scripts and in `load/run-1/driver.sh`.
6. **Contract observation (not changed).** `listTransformations` declares the query parameter `sort` twice in `docs/api/openapi.yaml`: the DG2 enum (`updatedAt:desc` …) and the ADR-0057 §5 enum (`-updatedAt`, `code` …). The harness sends the ADR-0057 values, which the API accepted (0 errors).
7. **No migration, no dependency, no new problem code.**

## 6. User-facing texts

None changed, and none became untrue. DO-F ships no UI string. A search of `apps/web/src/i18n` finds no load-test or p95 text.

## 7. Merge instructions

- Three new files under `deploy/load/` and the evidence folder. Nothing conflicts with other branches.
- `workload.mjs` imports `mulberry32` from DO-E's `generate.mjs`.
- To reproduce run-1:
  1. Start a disposable PostgreSQL cluster, `mth-db migrate`, and `generate.mjs --profile default` (with the §5 item 1 patch).
  2. Run `PG_PORT=… API_PORT=… RUN_DIR=… docs/delivery/handbacks/DG6/T-DG6-DO-F-evidence/load/run-1/driver.sh`. It needs `pnpm -r build` and runs the API and worker with `MTH_ENV=load`, `NODE_ENV=production`, `AUTH_MODE=oidc`, a never-contacted issuer and the product's default rate limits.
- In this sandbox, separate shell commands don't share a network namespace. The cluster, the API and the harness therefore have to run in one process tree, which the driver does.

## 8. What remains

- **REQ-S20-029 stays open.** Next are BE-S (fixes for the export-start miss named in §2, and the §5 item 1 decision) and DO-G (the final 3-repetition run on the frozen tree, the final report, and one Medium, non-mandatory finding per class that misses).
- **Orchestrator decisions:** §5 items 1–4.
- **Diffs after the run, disclosed.** Run-1 ran `workload.mjs` at sha256 `c138c217…` and `report.mjs` at `35bb1dc7…`. After the three repetitions:
  - `workload.mjs` gained `--only` (for the diagnostic pass) and Prettier formatting;
  - `report.mjs` gained the "not measured" list, `--notes`, and Prettier formatting.

  Diffs: `load/run-1/workload-changes-after-run.diff` and `report-changes-after-run.diff`. The report was regenerated from the unchanged samples, and every figure is unchanged.
- __REMAINS_CHECKS__
