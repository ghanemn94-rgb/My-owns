# ADR-0058: P6 performance: the synthetic load dataset and its generator, the workload mix, 100 concurrent signed-in users and how their sessions are minted, the infrastructure statement, the p95 method, the index plan, and the asynchronous export at full scale

- **Status:** Proposed for P6 (DG6). Author: solution-architect (T-DG6-ARCH-04), 2026-10-27.
- **Requirements (slice G of `docs/architecture/p6-plan.md`):** REQ-S20-029, REQ-S20-030. Slice H is ADR-0057.
- **Sources (quoted where a design point has one):**
  - M0398 (§20) "Use a documented realistic load dataset. As provisional test targets, exercise 50 transformations, 1,000 initiatives, 10,000 KPI-period actuals, 100,000 audit events and 100 concurrent signed-in users. Aim for p95 ordinary reads/updates within 2 seconds and key dashboards within 4 seconds on specified infrastructure; define the tested workload and report actual results. Long exports run asynchronously with visible progress. These are proposed engineering targets, not verified Mobily capacity requirements. Agree final production scale, availability and recovery objectives with IT."
  - REQ-S20-029 acceptance: "A22;A13: the load report states the dataset, infrastructure and workload, and gives actual p95 figures for reads/updates and dashboards, with any miss against 2 s/4 s listed as a finding". Notes: "Provisional engineering targets, not verified Mobily capacity requirements. Final production scale, availability and recovery objectives must be agreed with Mobily IT."
  - REQ-S20-030 acceptance: "A15;A13: exporting the full load dataset returns immediately with a job ID, progress rises to 100%, and the file downloads only for the requester". Permissions: "request:scoped users; download:requester with same scope".
  - Playbook: no block states a performance target; nothing below is attributed to it.
- **Decisions applied:** D-195 Q9 ("the load run on the sandbox host (stated hardware and settings), sessions minted in a `MTH_ENV=load` database, a Node harness without a new dependency, each p95 miss a Medium, non-mandatory finding"), D-195 seam 17 (exports), seam 25 (the load dataset is a separate generator, never the demo seed), D-196, D-193, D-088 §2, D-141, F-DG3-100.
- **Builds on:** ADR-0005 (sessions: `createSession`, token and CSRF hashes), ADR-0011 (configuration), ADR-0046 (export jobs, `export_job_progress`, requester-only download), ADR-0050 §1 (`deployment_environment`, production and demo markers), ADR-0057 (search; `0110` indexes).
- **Physical model:** `packages/db/migrations/0108_p6_search_saved_views_help.sql` (`load_dataset_marker`), `0110_p6_register_filter_indexes.sql` (first indexes); probe groups LM, G05 in `docs/delivery/handbacks/DG6/T-DG6-ARCH-04-evidence/probe-output.txt`.
- **Two gate systems.** The load run reads and writes only a disposable load database. It never touches DG0–DG7 records, and nothing in it is a G1–G6 business approval. The figures it reports are engineering measurements on stated sandbox hardware, never "Mobily capacity" or "production performance".

## Context

1. No load dataset, harness or report exists (`ls deploy/load` finds nothing at `HEAD` `5e4cbad`).
2. The demo seed (`packages/db/src/demo/**`, ADR-0050) writes one synthetic roaming transformation and marks its database `demo` in `deployment_environment`; `mth-db bootstrap` marks a database `production`. ADR-0005: "AUTH_MODE=dev is refused when NODE_ENV=production" (`packages/config/src/load.ts`), so the dev-login route cannot mint 100 sessions on a production build, and OIDC cannot be driven 100 times offline (D-195 Q9).
3. P5 export jobs (`createExport`, ADR-0046) render one report snapshot of **one** transformation, with `export_job_progress` (stage, percent, sections) and a requester-only download (`getExport`/`downloadExport`: "requester; transformation.read re-checked; others 404"). `EXPORT_MAX_BYTES` = 200 MiB (`packages/reporting/src/storage.ts`).

## Decision

### 1. The targets and the finding rule

The provisional targets are M0398's: p95 of **ordinary reads and updates ≤ 2 s**, p95 of **key dashboards ≤ 4 s**, with 50 transformations, 1,000 initiatives, 10,000 KPI-period actuals, 100,000 audit events and 100 concurrent signed-in users. Each class whose measured p95 exceeds its target is listed in the report and raised as **one Medium, non-mandatory finding per class** (D-195 Q9). The workload, dataset or infrastructure is never changed after a run to turn a miss into a pass (p6-plan R4); a re-run after a fix (BE-S) is reported beside the first run.

### 2. The load dataset `mth_load_v1` (REQ-S20-029 "documented realistic load dataset")

`deploy/load/generate.mjs` (DO-E) is a Node script with no new dependency. It is **separate from the demo seed**: it imports nothing from `packages/db/src/demo/**`, the demo seed imports nothing from it, and it writes the `load_dataset_marker` row first, which `0108` accepts only in an **empty** database without a `deployment_environment` row (`load_dataset_marker_empty_database`; probe LM01, LM03, LM07). A production or demo database therefore never receives load data, and a load database never receives a production or demo marker through the CLI (DO-E adds the refusal "This database holds the synthetic load dataset; it cannot be bootstrapped or seeded as a demo." to `bootstrap` and `seed-demo` in `packages/db/src/cli.ts`).

- **Deterministic:** a seeded PRNG implemented in the script (a 32-bit mulberry32; seed recorded in the marker, default `20261027`). The same seed and generator version produce the same rows and ids.
- **Synthetic and labelled:** every organization, user and record name starts with "LOAD " (en) / "تجريبي " (ar); user e-mails use the reserved `example.invalid` domain; nothing is copied from the demo or from real data.
- **Writes through the database guards:** rows are written as `mth_owner` with every trigger enabled, each with its audit event (the deferred audit constraints hold), transformations through `p3_instantiate_transformation` (DG3), KPI actuals with decimal-string values. No trigger is disabled and no `session_replication_role = replica` is used.
- **Sizes (the marker records the exact counts):**

| Entity | Count | Distribution |
|---|---|---|
| organization | 1 | `LOAD-ORG` |
| business units | 6 | — |
| users | 120 | 100 load virtual users (assignments: 30 TL, 20 BO, 20 WL, 15 KDS, 10 FIN, 5 AUD, each on 1–5 transformations) + 20 owners and approvers named on records |
| transformations | 50 | `LOAD-T01` … `LOAD-T50`; phases spread over the six phases |
| initiatives | 1,000 | `LOAD-T01` holds 250 (the "1,000-initiative register" check of REQ-S15-013 also uses a 1,000-initiative transformation variant, §2 note); the other 750 spread 15–16 per transformation |
| KPI definitions | 500 | 10 per transformation |
| KPI-period actuals | 10,000 | 20 monthly periods × 500 KPIs; values decimal strings; statuses mixed (submitted, accepted, rejected) |
| benefits, RAID entries, dependencies, decisions, deliverables, evidence notes | 400, 1,500, 500, 500, 1,000, 1,000 | proportional to initiatives; evidence notes only (no file bytes) |
| audit events | ≥ 100,000 | the events of the writes above plus version steps of initiatives, KPIs and benefits until the count reaches 100,000 |

- **Note on the 1,000-initiative register (REQ-S15-013 acceptance):** the M0398 dataset spreads 1,000 initiatives over 50 transformations, while REQ-S15-013 asks for "a register with 1,000 initiatives". `generate.mjs --profile register-1000` writes one extra transformation `LOAD-R1K` with 1,000 initiatives for that check only, and the report states which profile each figure comes from. The M0398 run uses the default profile.
- After generation, DO-E runs the `search.reindex` job once so the search index is complete (ADR-0057 §2).

### 3. The workload (REQ-S20-029 "define the tested workload")

`deploy/load/workload.mjs` (DO-F; Node `fetch`, no new dependency): **100 virtual users run concurrently**, each signed in with its own session (§4), each repeating a weighted choice of the operations below with a deterministic think time of 1–3 s (seeded per user). Shares are of requests:

| Class (target) | Share | Operations (operationId) |
|---|---|---|
| Ordinary read (2 s) | 50 % | `getMe`, `getMyNavigation`, `listTransformations` (with `sort`), `getTransformation`, `listInitiatives` (with `q`, `executiveOwnerUserId`, `sort`, cursor paging), `getInitiative`, `listFormRecordVersions`, `listMyWorkItems`, `listSavedViews` |
| Ordinary update (2 s) | 15 % | `updateInitiative` (PATCH with If-Match on an initiative partitioned to that user, so concurrent users never edit the same row), `putSavedView`, `updateFormDraft` |
| Search (2 s; reported as its own class, counted with ordinary reads) | 8 % | `searchRecords` (terms drawn from generated titles, en and ar) |
| Key dashboard (4 s) | 25 % | `getExecutiveOverview`, `getTransformationDashboard`, `getWorkstreamDashboard`, `getFinanceDashboard`, `getMyWork` |
| Export start (2 s) | 2 % | `createExport` (returns the job id; completion is measured separately, §7) |

The operation ids are those of `docs/api/openapi.yaml` at the run; DO-F lists the exact request templates in the report. A 409 from an update is counted separately (expected to be 0 by the partitioning); any 5xx or unexpected 4xx is an error, reported per class with its count.

### 4. 100 concurrent signed-in users: minting the sessions (D-195 Q9)

- **`MTH_ENV=load`.** DO-E adds `load` to `MTH_ENVS` (`packages/config/src/index.ts`) and these rules to `packages/config/src/load.ts`: `MTH_ENV=load` requires `NODE_ENV=production` and `AUTH_MODE=oidc` (the production code path; the dev login stays refused). The API and the worker refuse to start (exit with a configuration problem) when `MTH_ENV=load` and the database has no `load_dataset_marker` row, and when `MTH_ENV` is `production` or `demo` and the database **has** a `load_dataset_marker` row (texts: "MTH_ENV=load needs a database generated by deploy/load/generate.mjs." and "This database holds the synthetic load dataset and cannot run as production or demo."). So load sessions can never exist in a production database.
- **`deploy/load/sessions.mjs`** (DO-E) runs only when `MTH_ENV=load` and the database has the marker and no `deployment_environment` row. It creates one session per load virtual user through the API's own `createSession` (`apps/api/src/modules/identity/sessions.ts`, ADR-0005: the same token and CSRF hashing; nothing re-implemented), with `auth_mode = 'oidc'` and `idp_issuer = 'urn:mth:load-harness'` so every load session is identifiable as synthetic, and writes the 100 cookies and CSRF tokens to a file under the run's `$TMPDIR` (never committed). Absolute expiry: the run's duration plus 1 hour.
- No route is added and no login path is changed.

### 5. The infrastructure statement (REQ-S20-029 "on specified infrastructure")

The report states, measured at the run (DO-F, DO-G), never assumed: CPU model and count (`/proc/cpuinfo`, `nproc`), memory (`/proc/meminfo`), kernel (`uname -r`), Node version, PostgreSQL version (16.13 on this host) and every non-default server setting (`SELECT name, setting FROM pg_settings WHERE source NOT IN ('default', 'override')`), the API and worker process counts and database pool sizes, the disk as reported by the OS, and the machine load average sampled every 5 s during each run. It states plainly that the harness, the API, the worker and PostgreSQL share one sandbox host, so the figures include client-side CPU contention, and that this is not Mobily production infrastructure (REQ-S20-029 notes).

### 6. The p95 method and the index plan

- **Measurement:** client-side, per request, from `fetch` start to the end of the body (`performance.now()`, converted to integer microseconds). **Warm-up** 2 minutes, excluded. **Steady state** 10 minutes per repetition, **3 repetitions** on a freshly started API and worker over the same database. **p95** per class per repetition by the nearest-rank method on the sorted integer samples (rank = ⌈0.95 × n⌉), no interpolation. The report gives p50, p95, p99, max, request count and error count per class per repetition, and the **highest p95 of the three repetitions** as the class result compared with the target.
- **Index plan.** `0110` creates the indexes for the new server-side filters and sorts and the search feed (ADR-0057 §5, §2). Further indexes are not guessed: DO-F's first run lists each operation whose p95 misses, with `EXPLAIN (ANALYZE, BUFFERS)` of its slowest queries; BE-S adds only indexes or query fixes that evidence names, in one migration of its own (next free id at merge, D-196), each with its before/after measurement. The candidates DO-F checks first: KPI actuals by (`kpi_definition_id`, `period_start`), dashboards' aggregate queries per transformation, `audit_event` by (`transformation_id`, `seq`) (exists, `0003`), and the search `ts_rank_cd` ordering. **Shipped (T-DG6-BE-S):** `0120_p6_audit_required_index_use.sql`, a query fix that makes the deferred audit check `p2_audit_required()` use `audit_event_record_idx` again; no new index (renumbered from 0119 at merge, D-196 item 2).

### 7. The asynchronous export at full scale (REQ-S20-030)

- **What "the full load dataset" means here.** P5 export jobs export one transformation (Context 3); the product has no cross-transformation export, and adding one would be a new feature (and a contract change of a DG5 operation). This ADR therefore defines the REQ-S20-030 proof on the load dataset as: (a) one export of the **largest** transformation (`LOAD-T01`: 250 initiatives, its 10 KPI definitions with their 200 KPI-period actuals, its benefits, RAID entries and audit history) as a live selection of every section `ExportLiveSelection` offers, in `xlsx` and in `csv`; and (b) **50 exports queued at once**, one per transformation, by 50 different load users. This reading is raised to the orchestrator (handback); a cross-transformation export is not built.
- **Assertions (BE-S's `deploy/load/export-proof.mjs` on the load database, outside the vitest projects; DO-G repeats it in the final run):** every `createExport` returns its job id within 2 s (the ordinary-update target); `getExport` shows `percent` non-decreasing from 0 to 100 and `status = succeeded`; the file downloads (200) for the requester; another user with the same transformation scope gets 404 (the P5 "others 404" rule, which is how "downloads only for the requester" is met), and AUD gets 404 as well. The completion time of each job is reported (no target in M0398). A file above `EXPORT_MAX_BYTES` (200 MiB) fails the job with its DG5 error; if the measured size reaches it, the cap is a **reopen candidate with the measured reason** (p6-plan seam 17), not changed here.

### 8. Ownership

DO-E: `deploy/load/generate.mjs`, `deploy/load/sessions.mjs`, the `MTH_ENV=load` lines in `packages/config`, the CLI refusals, the `load` compose profile. DO-F: `deploy/load/workload.mjs`, the first run and the draft report in `docs/delivery/test-evidence/DG6/load/`. BE-S: the index migration and query fixes named by DO-F, the full-scale export proof. DO-G: the final run on the frozen tree and the final report (`p6-work-split.md` §H/G).

### 9. Authorization in the load run

The load users act through their seeded scoped assignments exactly as real users would; every request passes the normal authorization, validation, concurrency and audit paths. No technical administrator account performs a business write. AUD users only read. The report states the role mix of §2.

### 10. Decimal and Unknown semantics

Latencies are integer microseconds; percentiles are nearest-rank samples, so no floating-point interpolation is reported. Generated money and KPI values are decimal strings. A class that could not be measured in a repetition (for example, the harness stopped) is reported as "not measured" with the reason, never as 0 and never as a pass.

## Alternatives

1. **k6, Gatling or autocannon.** Rejected: a new dependency or runtime (D-195 Q9 "a Node harness without a new dependency").
2. **Sessions through the dev login.** Rejected: refused on a production build by design (ADR-0005); a load run on a development build would measure the wrong code path.
3. **Extending the demo seed to the load sizes.** Rejected: D-195 seam 25; the demo's reset checksums and its single-dataset marker would change.
4. **Pre-creating indexes for every plausible query.** Rejected: unmeasured indexes slow writes; BE-S adds only what DO-F's evidence names.
5. **A cross-transformation export for "the full load dataset".** Not built in P6 (§7); raised.

## Consequences

- `0108` adds `load_dataset_marker` (append-only, `load_dataset_marker_guard`); `0110` adds 8 btree indexes. No DG1–DG5 behaviour changes (probe G04).
- New configuration value `MTH_ENV=load` (DO-E), with two start-up refusals; the production and demo behaviour is unchanged when no load marker exists.
- Residuals: the figures are from the sandbox host only; production scale, availability and recovery objectives remain to be agreed with Mobily IT (REQ-S20-029 notes).

## Verification

- `probe-output.txt` (71/71 PASS, exit 0): LM01–LM07 (marker only in an empty, unmarked database; append-only; at most one; not writable by `mth_app`), G05 (the `0110` indexes exist).
- DO-E: generator determinism test (two runs, same seed, identical row hashes) and the marker refusals; DO-F/DO-G: the report in `docs/delivery/test-evidence/DG6/load/`; BE-S: `deploy/load/export-proof.mjs` and its output; QA-E verifies the report against the acceptance text.

## Amendment (2026-11-01, T-DG6-ARCH-09; D-203 O-1): worker job throughput and its two variables

Sources: D-203 O-1 (`docs/delivery/decisions.md`), the T-DG6-BE-X9 handback §2 and §5, and the merged tree at `c86e70ee2` (`packages/config/src/index.ts`, `packages/config/src/load.ts`, `apps/worker/src/worker.ts`, `apps/worker/src/main.ts`). The execution semantics (per-job settlement, exactly-once) are ADR-0043 amendment E5. Nothing above is removed.

### T1. Configuration and measured throughput (REQ-S20-029, REQ-S12-020)

- **The finding.** Each worker process took one job per queue per polling interval (`batchSize: 1`, `pollingIntervalSeconds: 2`, plus pg-boss 11's loop delay), so a burst of N events needed at least 2·N s; 1,000 import-accepted actuals would have taken at least 33 minutes (QA-H O-1, Medium).
- **Two new worker variables** (validated by the configuration loader; listed in `.env.example`, which is generated by `deploy/scripts/generate-env-example.mjs` and has no values):

  | Variable | Default | Range | Meaning |
  | --- | --- | --- | --- |
  | `WORKER_JOB_BATCH_SIZE` | 8 | 1–50 | jobs fetched per poll of one queue |
  | `WORKER_JOB_CONCURRENCY` | 4 | 1–16, and at most `WORKER_JOB_BATCH_SIZE` | jobs of one queue running at once in one worker process |

  A value outside its range, or a concurrency above the batch size, refuses start-up with a configuration problem naming the variable (`packages/config/src/load.ts`). The worker logs both values at start-up. They sit next to `WORKER_HEARTBEAT_SECONDS` (ADR-0053 §6). The worker's database pool is `max(5, WORKER_JOB_CONCURRENCY + 2)`, so a higher concurrency also needs that many connections from PostgreSQL's `max_connections` per worker replica. `platform.purge` and `job_schedule.updated` stay one job per fetch.
- **Measurement** (one queue, `automation.evaluate`; a backlog of 300 jobs = 240 relayed events plus 60 replays with new job ids and the same idempotency keys; the real API, relay and worker; `apps/api/test/integration/automation/automation-backlog-enablement.test.ts`):

  | Code | Result | Evidence |
  | --- | --- | --- |
  | before (the `HEAD` `worker.ts` and `engine.ts` of BE-X9's base) | **1.5 jobs/s**: 225 of 300 jobs completed in 150.1 s, then the test deadline | `docs/delivery/handbacks/DG6/T-DG6-BE-X9-evidence/throughput-before-head.log` (line 1406) |
  | after (defaults 8/4) | **120.1 jobs/s**: 300 of 300 in 2.5 s | `docs/delivery/handbacks/DG6/T-DG6-BE-X9-evidence/throughput-after.log` (line 1037) |

  Exactly-once held under the concurrent replays: 240 executions, 240 distinct trigger keys, all `succeeded`, and 240 tasks with 240 distinct subjects.
- **Limits of the figure.** It is one run, on the shared sandbox host (other work was running), with one worker process and one queue. It is indicative, not a benchmark, and not a production capacity statement (§5; production scale remains to be agreed with Mobily IT). It is not part of DO-F/DO-G's p95 report, whose workload is HTTP (§3).
- **Operations note.** `docs/operations/monitoring.md` is devops-owned; listing the two variables there next to `WORKER_HEARTBEAT_SECONDS` is suggested to its owner (BE-X9 handback §6 item 7), not done here.

## Amendment (2026-11-01, T-DG6-ARCH-11; D-207, F-DG6-147): §7, what the 2 s start measures

Sources: D-207 (`docs/delivery/decisions.md`, read verbatim), F-DG6-147, and the T-DG6-BE-Y4 handback (its measurement drivers in `T-DG6-BE-Y4-evidence/`). The design is ADR-0046 amendment H1–H6. Nothing above is removed. Where this amendment and §7 differ, this amendment wins.

### T2. The 2 s start of a live-selection export (REQ-S20-030)

- **The finding.** §7 asserts that "every `createExport` returns its job id within 2 s". With 50 simultaneous live-selection starts, that failed (F-DG6-147). About 55 % of each start was report assembly, which ADR-0046 §2 placed in the request, and trimming the assembly (T-DG6-BE-Y4) did not bring the starts under 2 s.
- **The target is unchanged: 2 s per start** (the ordinary-update target of §1). The work inside a start changes. A live-selection `createExport` now only does what ADR-0046 amendment H2 lists: validation, authorization, D-199's restricted-source check, and one transaction that writes the job, its progress and its audit event. It answers **202 with `snapshotId: null`**. The snapshot is assembled afterwards by the API snapshot watch (ADR-0046 amendment H3), and only then does the worker render.
- **What the proof asserts now (§7 "Assertions", amended).** For (a) and (b) of §7:
  1. every `createExport` returns 202 with a job id within 2 s, and its `snapshotId` is `null` or a UUID;
  2. `getExport` shows `snapshotId` assigned before `status` leaves `queued`, then `percent` non-decreasing from 0 to 100 and `status = succeeded`;
  3. the file downloads (200) for the requester, and another user with the same transformation scope gets 404, and so does AUD (unchanged).

  The completion time of each job is still reported, and it now includes the assembly. M0398 states no completion target, so none is added here.
- **The measurement.** Devops re-measures on the merged tree with the full dataset (T-DG6-DO-Y2, D-207). The load drivers run with `EXPORT_RATE_LIMIT_PER_MINUTE` set high (BE-Y4 handback item 1). At its default of 10 per minute per user, the `export` rate-limit class would refuse the proof's 11th and later starts from one user with 429. That setting is part of the stated workload (§3) and is reported with the figures, so it is not a change made after a run to turn a miss into a pass (§1). The before/after figures of 50 simultaneous starts are BE-Y5's (its assignment), and DO-Y2's run on the merged tree is the one the report cites. A start that still exceeds 2 s remains F-DG6-147's class finding, and it is not closed by this text.
- **Unchanged.** The export of an existing snapshot, §7's reading of "the full load dataset" (D-199 ARCH-04 §5 (2)), `EXPORT_MAX_BYTES` and the requester-only download.

Requirement row: REQ-S20-030. These figures are engineering measurements on the stated sandbox host, not a Mobily capacity statement. Nothing here touches product gates G1–G6 or the engineering gates DG0–DG7.

## Amendment (2026-11-02, T-DG6-ARCH-12; D-207, F-DG6-147): §7 and T2 against what T-DG6-BE-Y5 shipped

### T3. What the 2 s start now contains, as shipped

- **T2 holds as written**, with the names of ADR-0046 amendment R. "The API snapshot watch" is the **export assembly watch** (`apps/api/src/modules/reporting/exports/assembly.ts`). It runs every 1 s (`EXPORT_ASSEMBLY_INTERVAL_MS`) and right after each pending 202 (`kick`), with 2 concurrent claims per API process (`EXPORT_ASSEMBLY_CONCURRENCY`).
- **The in-request work of a live-selection start depends on the requester** (ADR-0046 R3):
  - When the requester is restricted from **no** record of the transformation, the start does no assembly. It runs one indexed `record_sensitivity` query instead. This is the case for every user of the synthetic load dataset, which has no sensitive marks.
  - When the requester **is** restricted from some record of the transformation, the start still assembles the report read-only in the request, to keep D-199's synchronous 403. Such a start costs about what a DG5 start cost.
  - The proof's workload (§3) has no such user. So a 2 s result on the load dataset says nothing about starts by restricted requesters, and the report must say so rather than generalise. This is stated, not hidden: a sensitive-marks workload is not part of M0398's proof.
- **Completion time includes queueing at the watch.** With 50 simultaneous starts, assembly runs 2 at a time per API process, so the last job's snapshot arrives later than the first. §7 and T2 report each job's completion time, and M0398 sets no target for it.
- **BE-Y5's sandbox figures** (smoke profile, `EXPORT_RATE_LIMIT_PER_MINUTE=100000`, 3 bursts of 50): 0 of 300 starts over 2 s in the two AFTER runs, worst 1.38 s (`docs/delivery/handbacks/DG6/T-DG6-BE-Y5-backend-workflow-engineer.md`). They are provisional and not a controlled A/B, and the before and after host loads differed. **The run the report cites is DO-Y2's** on the merged tree with the full dataset. F-DG6-147 stays open until a reviewer verifies it.

Requirement row: REQ-S20-030. These are engineering measurements on a shared sandbox host, not a Mobily capacity statement. Nothing here grants a business, Finance or IT approval (G1–G6), and nothing implies a DG0–DG7 result.

