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
